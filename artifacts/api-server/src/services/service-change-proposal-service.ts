import { and, desc, eq, sql } from "drizzle-orm";
import { agDb } from "@workspace/db";
import {
  leistungsanfragenTable,
  leistungsantwortenTable,
  leistungsantwortEntscheidungenTable,
  leistungsanfrageSnapshotsTable,
  leistungenTable,
  projectsTable,
  organizationsTable,
  coordinationPoliciesTable,
  serviceChangeProposalsTable,
  serviceClarificationsTable,
  serviceConstraintsTable,
  serviceReadinessChecksTable,
  type ServiceChangeProposal,
} from "@workspace/db";
import { applyAcceptedScheduleChange } from "./schedule-change-service";
import { createPolicySnapshot } from "./policy-snapshot-service";
import { createConstructXPolicy, resolvePolicyDelta } from "./construct-x-policy-service";
import { assertLeistungsanfragePolicyAccess } from "./leistungsanfrage-policy-guard";
import { deriveServiceCoordinationState } from "./service-coordination-state";
import { compareCalendarDates, differenceInCalendarDays } from "../lib/calendar-date-utils";
import {
  toExternalResourceRequirementsFromSnapshot,
  toExternalServiceRequest,
  publicSnapshotFromRecord,
} from "./dataspace/external-mappers";
import { deliverLocalCoordinationDecision, deliverLocalServiceRequest } from "./dataspace/local-dataspace-delivery";
import type { ExternalCoordinationDecision, ExternalServiceRequest, ExternalServiceResponse } from "./dataspace/external-contracts";

export type CoordinationParty = "AG" | "AN";
export interface ScheduleDelta { startDays: number; endDays: number; durationDays: number; hasChange: boolean; }

export function maxDate(...values: Array<Date | string | null | undefined>): Date | null {
  const dates = values.filter((value): value is Date | string => value != null)
    .map((value) => value instanceof Date ? value : new Date(value))
    .filter((value) => !Number.isNaN(value.getTime()));
  return dates.length ? new Date(Math.max(...dates.map((value) => value.getTime()))) : null;
}
function dateOnly(value: Date | string): string { return (value instanceof Date ? value.toISOString() : value).slice(0, 10); }

/**
 * Schedule changes are their own immutable child-policy versions.  The
 * proposal id is deliberately retained in the snapshot: it is the durable
 * correlation between the bilateral proposal history and the policy version
 * (there is no cross-domain writable foreign key).
 */
async function createScheduleChangePolicy(tx: any, input: {
  request: typeof leistungsanfragenTable.$inferSelect;
  proposal: ServiceChangeProposal;
  createdByUserId: string | null;
}) {
  if (!input.request.performancePolicyId) return null; // legacy requests predate Construct-X policies
  const [parent] = await tx.select().from(coordinationPoliciesTable).where(and(
    eq(coordinationPoliciesTable.id, input.request.performancePolicyId),
    eq(coordinationPoliciesTable.kind, "PERFORMANCE_REQUEST"),
  )).limit(1);
  if (!parent || !["PUBLISHED", "ACCEPTED"].includes(parent.lifecycleStatus)) {
    throw Object.assign(new Error("Eine wirksame Leistungsrichtlinie ist für die Terminänderung erforderlich"), { statusCode: 422 });
  }
  const baseSnapshot = createPolicySnapshot({
    templateId: "SCHEDULE_COORDINATION",
    providerContext: { organizationId: input.request.guOrgId, userId: input.createdByUserId ?? undefined, organizationType: "AG" },
    overrides: {
      recipientOrganizationId: input.request.nuOrgId,
      purpose: "scheduleCoordination",
      projectReference: (parent.effectivePolicy?.projectReference as string | undefined) ?? null,
    },
  });
  const candidate = {
    ...baseSnapshot,
    policyType: "SCHEDULE_CHANGE" as const,
    permissions: ["READ", "USE_FOR_SCHEDULE_COORDINATION"],
  };
  const resolution = resolvePolicyDelta(parent.effectivePolicy ?? parent.policySnapshot, candidate);
  if (resolution.deltaClass === "NOT_PERMITTED") {
    throw Object.assign(new Error("Die Terminänderungsrichtlinie liegt außerhalb der wirksamen Leistungsrichtlinie"), { statusCode: 403 });
  }
  const policyKey = `${input.request.id}:schedule-change`;
  const [latest] = await tx.select({ version: coordinationPoliciesTable.version })
    .from(coordinationPoliciesTable).where(eq(coordinationPoliciesTable.policyKey, policyKey))
    .orderBy(desc(coordinationPoliciesTable.version)).limit(1);
  const policy = createConstructXPolicy({
    baseSnapshot,
    policyType: "SCHEDULE_CHANGE",
    policyVersion: (latest?.version ?? 0) + 1,
    parentPolicyId: parent.id,
    lifecycleStatus: resolution.deltaClass === "REQUIRES_CONSENT" ? "CONSENT_REQUIRED" : "PUBLISHED",
    deltaClass: resolution.deltaClass,
    diff: resolution.diff,
    effectivePolicy: resolution.effectivePolicy,
  });
  const snapshot = { ...policy, changeProposalId: input.proposal.id };
  await tx.insert(coordinationPoliciesTable).values({
    id: policy.policyId, policyKey, version: policy.policyVersion, kind: policy.policyType,
    projectId: parent.projectId, providerOrgId: input.request.guOrgId, recipientOrgId: input.request.nuOrgId,
    parentPolicyId: parent.id, lifecycleStatus: policy.lifecycleStatus, deltaClass: policy.deltaClass,
    policySnapshot: snapshot as Record<string, unknown>, diff: policy.diff,
    effectivePolicy: policy.effectivePolicy, createdByUserId: input.createdByUserId,
  });
  return snapshot;
}

async function setScheduleChangePolicyLifecycle(tx: any, input: {
  request: typeof leistungsanfragenTable.$inferSelect;
  proposal: ServiceChangeProposal;
  lifecycleStatus: "ACCEPTED" | "REJECTED" | "SUPERSEDED";
  consentedByOrgId?: string | null;
}) {
  const policyKey = `${input.request.id}:schedule-change`;
  const proposalMatch = sql`${coordinationPoliciesTable.policySnapshot}->>'changeProposalId' = ${input.proposal.id}`;
  const [candidate] = await tx.select().from(coordinationPoliciesTable).where(and(
    eq(coordinationPoliciesTable.policyKey, policyKey), proposalMatch,
  )).limit(1);
  if (!candidate) return; // legacy request without a Construct-X performance policy
  if (input.lifecycleStatus === "ACCEPTED") {
    await tx.update(coordinationPoliciesTable).set({
      lifecycleStatus: "SUPERSEDED", updatedAt: new Date(),
    }).where(and(
      eq(coordinationPoliciesTable.policyKey, policyKey),
      eq(coordinationPoliciesTable.lifecycleStatus, "ACCEPTED"),
    ));
    const [activated] = await tx.update(coordinationPoliciesTable).set({
      lifecycleStatus: "ACCEPTED", consentedAt: new Date(),
      consentedByOrgId: input.consentedByOrgId ?? null, updatedAt: new Date(),
    }).where(and(
      eq(coordinationPoliciesTable.id, candidate.id),
      sql`${coordinationPoliciesTable.lifecycleStatus} IN ('PUBLISHED', 'CONSENT_REQUIRED')`,
    )).returning({ id: coordinationPoliciesTable.id });
    if (!activated) throw new Error("Schedule-change policy could not be activated");
    await tx.update(leistungsanfragenTable).set({
      scheduleChangePolicyId: candidate.id, updatedAt: new Date(),
    }).where(eq(leistungsanfragenTable.id, input.request.id));
    return;
  }
  await tx.update(coordinationPoliciesTable).set({
    lifecycleStatus: input.lifecycleStatus, updatedAt: new Date(),
  }).where(and(
    eq(coordinationPoliciesTable.id, candidate.id),
    sql`${coordinationPoliciesTable.lifecycleStatus} IN ('PUBLISHED', 'CONSENT_REQUIRED')`,
  ));
}

/** Re-evaluate the effective root policy at the irreversible consent point. */
async function assertScheduleAcceptancePolicy(tx: any, request: typeof leistungsanfragenTable.$inferSelect) {
  if (!request.performancePolicyId) return; // legacy requests have no policy chain
  const [policy] = await tx.select().from(coordinationPoliciesTable)
    .where(eq(coordinationPoliciesTable.id, request.performancePolicyId)).limit(1);
  if (!policy) throw Object.assign(new Error("NOT_PERMITTED"), { statusCode: 409 });
  const effective = policy.effectivePolicy as Record<string, unknown> | null;
  try {
    assertLeistungsanfragePolicyAccess({
      policyDeltaClass: policy.deltaClass,
      policyConsentStatus: policy.lifecycleStatus === "ACCEPTED" ? "ACCEPTED" :
        policy.deltaClass === "REQUIRES_CONSENT" ? "PENDING" : "NOT_REQUIRED",
      validFrom: effective?.validFrom as string | null | undefined,
      validUntil: effective?.validUntil as string | null | undefined,
      retentionUntil: effective?.retentionUntil as string | null | undefined,
    }, "ANSWER");
  } catch (error) {
    if (error instanceof Error) Object.assign(error, { statusCode: 409 });
    throw error;
  }
}

function assertPersistedPolicyUsable(policy: typeof coordinationPoliciesTable.$inferSelect) {
  const effective = policy.effectivePolicy as Record<string, unknown> | null;
  const lifecycleDenied = ["DRAFT", "REJECTED", "SUPERSEDED", "REVOKED"].includes(policy.lifecycleStatus);
  if (lifecycleDenied) {
    throw Object.assign(new Error("NOT_PERMITTED"), { statusCode: 409 });
  }
  if (policy.lifecycleStatus === "CONSENT_REQUIRED") {
    throw Object.assign(new Error("POLICY_CONSENT_REQUIRED"), { statusCode: 409 });
  }
  try {
    assertLeistungsanfragePolicyAccess({
      policyDeltaClass: policy.deltaClass,
      policyConsentStatus: policy.lifecycleStatus === "ACCEPTED" ? "ACCEPTED" :
        policy.deltaClass === "REQUIRES_CONSENT" ? "PENDING" : "NOT_REQUIRED",
      validFrom: effective?.validFrom as string | null | undefined,
      validUntil: effective?.validUntil as string | null | undefined,
      retentionUntil: effective?.retentionUntil as string | null | undefined,
    }, "ANSWER");
  } catch (error) {
    if (error instanceof Error) Object.assign(error, { statusCode: 409 });
    throw error;
  }
}

function snapshotWindow(snapshot: Record<string, unknown>): { start?: string; end?: string } {
  const window = snapshot.plannedTimeWindow ?? snapshot.taktWindow ?? snapshot.timeWindow;
  return window && typeof window === "object" && !Array.isArray(window)
    ? window as { start?: string; end?: string }
    : {};
}

/**
 * Create the next immutable AG request version for a change to an open
 * request. The current Leistung and its confirmed date remain untouched until
 * the AN accepts the new request. This is deliberately separate from
 * serviceChangeProposals: a proposal is the bilateral negotiation for an
 * existing agreement, while this operation changes an unagreed request.
 */
export async function createLeistungsanfrageRevision(input: {
  requestId: string;
  orgId: string;
  userId: string;
  start: Date;
  end: Date;
  reasonCode?: string | null;
  comment?: string | null;
}) {
  if (Number.isNaN(input.start.getTime()) || Number.isNaN(input.end.getTime()) || input.end <= input.start) {
    throw Object.assign(new Error("Ende muss nach Beginn liegen"), { statusCode: 400 });
  }

  return agDb.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${input.requestId}, 0))`);
    const [request] = await tx.select().from(leistungsanfragenTable)
      .where(eq(leistungsanfragenTable.id, input.requestId)).limit(1);
    if (!request || request.guOrgId !== input.orgId) {
      throw Object.assign(new Error("Leistungsanfrage nicht gefunden"), { statusCode: 404 });
    }
    if (request.agreedStart || request.agreedEnd) {
      throw Object.assign(new Error("Für eine vereinbarte Leistung bitte einen Änderungsvorschlag verwenden"), { statusCode: 409 });
    }
    if (!["DRAFT", "SENT", "DELIVERED", "DETAILS_RETRIEVED", "UNDER_REVIEW", "REVISION_REQUIRED"].includes(request.status)) {
      throw Object.assign(new Error("Für diese Anfrage ist keine neue Version mehr möglich"), { statusCode: 409 });
    }

    const [existingSuccessor] = await tx.select({ id: leistungsanfragenTable.id })
      .from(leistungsanfragenTable)
      .where(eq(leistungsanfragenTable.supersedesRequestId, request.id))
      .limit(1);
    if (existingSuccessor) {
      throw Object.assign(new Error("Für diese Anfrage existiert bereits eine neuere Version"), { statusCode: 409 });
    }

    const [oldSnapshot] = await tx.select().from(leistungsanfrageSnapshotsTable)
      .where(eq(leistungsanfrageSnapshotsTable.leistungsanfrageId, request.id)).limit(1);
    if (!oldSnapshot) throw Object.assign(new Error("Die unveränderliche Anfrageversion fehlt"), { statusCode: 422 });

    const oldPayload = (oldSnapshot.snapshotPayload ?? {}) as Record<string, unknown>;
    const oldWindow = snapshotWindow(oldPayload);
    if (oldWindow.start && oldWindow.end &&
        dateOnly(oldWindow.start) === dateOnly(input.start) &&
        dateOnly(oldWindow.end) === dateOnly(input.end)) {
      throw Object.assign(new Error("Die neue Version muss einen geänderten Zeitraum enthalten"), { statusCode: 400 });
    }

    const [service] = await tx.select().from(leistungenTable)
      .where(eq(leistungenTable.id, request.leistungId)).limit(1);
    if (!service) throw Object.assign(new Error("Leistung nicht gefunden"), { statusCode: 404 });

    const previousRevision = oldPayload.revisionContext as Record<string, unknown> | undefined;
    const revisionNumber = typeof previousRevision?.revisionNumber === "number"
      ? previousRevision.revisionNumber + 1
      : 1;
    const now = new Date();
    const newRequestId = crypto.randomUUID();
    let revisionPolicy: ReturnType<typeof createConstructXPolicy> | null = null;
    if (request.performancePolicyId) {
      const [sourcePolicy] = await tx.select().from(coordinationPoliciesTable)
        .where(and(
          eq(coordinationPoliciesTable.id, request.performancePolicyId),
          eq(coordinationPoliciesTable.kind, "PERFORMANCE_REQUEST"),
        )).limit(1);
      if (!sourcePolicy) throw Object.assign(new Error("NOT_PERMITTED"), { statusCode: 409 });
      assertPersistedPolicyUsable(sourcePolicy);
      if (!sourcePolicy.parentPolicyId) {
        throw Object.assign(new Error("Die Leistungsrichtlinie hat keine Projektvereinbarung"), { statusCode: 409 });
      }
      const [agreement] = await tx.select().from(coordinationPoliciesTable).where(and(
        eq(coordinationPoliciesTable.id, sourcePolicy.parentPolicyId),
        eq(coordinationPoliciesTable.kind, "PROJECT_AGREEMENT"),
        eq(coordinationPoliciesTable.lifecycleStatus, "ACCEPTED"),
      )).limit(1);
      if (!agreement) throw Object.assign(new Error("NOT_PERMITTED"), { statusCode: 409 });
      assertPersistedPolicyUsable(agreement);

      const sourceSnapshot = sourcePolicy.policySnapshot as Record<string, unknown>;
      const sourceEffective = sourcePolicy.effectivePolicy as Record<string, unknown> | null;
      if (!sourceEffective) {
        throw Object.assign(new Error("NOT_PERMITTED"), { statusCode: 409 });
      }
      const baseSnapshot = createPolicySnapshot({
        templateId: typeof sourceSnapshot.templateId === "string"
          ? sourceSnapshot.templateId
          : "PERFORMANCE_COORDINATION",
        providerContext: { organizationId: request.guOrgId, userId: input.userId, organizationType: "AG" },
        overrides: {
          recipientOrganizationId: request.nuOrgId,
          purpose: String(sourceEffective.purpose ?? sourceSnapshot.purpose ?? "LEISTUNGSKOORDINATION"),
          projectReference: String(sourceEffective.projectReference ?? sourcePolicy.projectId),
          workPackageReference: String(sourceEffective.workPackageReference ?? request.leistungId),
          ...(typeof sourceEffective.validFrom === "string" ? { validFrom: sourceEffective.validFrom } : {}),
          ...(typeof sourceEffective.validUntil === "string" ? { validUntil: sourceEffective.validUntil } : {}),
        },
      });
      const candidate = {
        ...baseSnapshot,
        policyType: "PERFORMANCE_REQUEST" as const,
        permissions: Array.isArray(sourceEffective.permissions)
          ? sourceEffective.permissions as string[]
          : baseSnapshot.permissions,
        selectedFields: Array.isArray(sourceEffective.selectedFields)
          ? sourceEffective.selectedFields as string[]
          : Array.isArray(sourceSnapshot.selectedFields) ? sourceSnapshot.selectedFields as string[] : undefined,
      };
      const resolution = resolvePolicyDelta(agreement.effectivePolicy ?? agreement.policySnapshot, candidate);
      if (resolution.deltaClass === "NOT_PERMITTED") {
        throw Object.assign(new Error("NOT_PERMITTED"), { statusCode: 409 });
      }
      const [latest] = await tx.select({ version: coordinationPoliciesTable.version })
        .from(coordinationPoliciesTable)
        .where(eq(coordinationPoliciesTable.policyKey, sourcePolicy.policyKey))
        .orderBy(desc(coordinationPoliciesTable.version)).limit(1);
      revisionPolicy = createConstructXPolicy({
        baseSnapshot,
        policyType: "PERFORMANCE_REQUEST",
        policyVersion: (latest?.version ?? sourcePolicy.version) + 1,
        parentPolicyId: agreement.id,
        lifecycleStatus: resolution.deltaClass === "REQUIRES_CONSENT" ? "CONSENT_REQUIRED" : "PUBLISHED",
        deltaClass: resolution.deltaClass,
        diff: resolution.diff,
        effectivePolicy: resolution.effectivePolicy,
      });
      await tx.insert(coordinationPoliciesTable).values({
        id: revisionPolicy.policyId,
        policyKey: sourcePolicy.policyKey,
        version: revisionPolicy.policyVersion,
        kind: revisionPolicy.policyType,
        projectId: sourcePolicy.projectId,
        providerOrgId: request.guOrgId,
        recipientOrgId: request.nuOrgId,
        parentPolicyId: agreement.id,
        lifecycleStatus: revisionPolicy.lifecycleStatus,
        deltaClass: revisionPolicy.deltaClass,
        policySnapshot: {
          ...revisionPolicy,
          supersedesPolicyId: sourcePolicy.id,
          sourceRequestId: request.id,
          successorRequestId: newRequestId,
        } as Record<string, unknown>,
        diff: revisionPolicy.diff,
        effectivePolicy: revisionPolicy.effectivePolicy,
        createdByUserId: input.userId,
      });
    }
    const newSnapshotPayload: Record<string, unknown> = {
      ...oldPayload,
      plannedStart: dateOnly(input.start),
      plannedEnd: dateOnly(input.end),
      plannedTimeWindow: { start: dateOnly(input.start), end: dateOnly(input.end) },
      revisionContext: {
        revisionNumber,
        previousRequestId: request.id,
        previousTimeWindow: {
          start: oldWindow.start ?? service.plannedStart,
          end: oldWindow.end ?? service.plannedEnd,
        },
        proposedTimeWindow: { start: dateOnly(input.start), end: dateOnly(input.end) },
        reasonCode: input.reasonCode ?? null,
        comment: input.comment ?? null,
        createdAt: now.toISOString(),
      },
      ...(revisionPolicy ? { policySnapshot: revisionPolicy } : {}),
    };
    const [newRequest] = await tx.insert(leistungsanfragenTable).values({
      id: newRequestId,
      leistungId: request.leistungId,
      leistungVersion: request.leistungVersion,
      guOrgId: request.guOrgId,
      nuOrgId: request.nuOrgId,
      requestNumber: `${request.requestNumber}-R${revisionNumber}`,
      selectionGroupId: request.selectionGroupId,
      status: "DRAFT",
      responseRequiredBy: request.responseRequiredBy,
      supersedesRequestId: request.id,
      createdByUserId: input.userId,
      // Revisions remain governed by their fresh performance policy. Data
      // publications are an independent offer workflow and are never inherited.
      dataPublicationId: null,
      performancePolicyId: revisionPolicy?.policyId ?? null,
      createdAt: now,
      updatedAt: now,
    }).returning();
    if (!newRequest) throw new Error("Neue Leistungsanfrageversion konnte nicht gespeichert werden");

    const [newSnapshot] = await tx.insert(leistungsanfrageSnapshotsTable).values({
      leistungsanfrageId: newRequest.id,
      schemaVersion: oldSnapshot.schemaVersion,
      snapshotPayload: newSnapshotPayload,
    }).returning();
    if (!newSnapshot) throw new Error("Snapshot der neuen Leistungsanfrageversion konnte nicht gespeichert werden");

    return {
      id: newRequest.id,
      requestId: newRequest.id,
      supersedesRequestId: request.id,
      requestNumber: newRequest.requestNumber,
      status: newRequest.status,
      plannedStart: dateOnly(input.start),
      plannedEnd: dateOnly(input.end),
      revisionNumber,
      previousTimeWindow: {
        start: oldWindow.start ?? service.plannedStart,
        end: oldWindow.end ?? service.plannedEnd,
      },
      snapshotId: newSnapshot.id,
      sent: false,
    };
  });
}

export function calculateScheduleDelta(baseStart: Date | string | null | undefined, baseEnd: Date | string | null | undefined, nextStart: Date | string | null | undefined, nextEnd: Date | string | null | undefined): ScheduleDelta {
  const dates = [baseStart, baseEnd, nextStart, nextEnd].map((v) => v ? new Date(v).toISOString().slice(0, 10) : null);
  if (dates.some((v) => !v)) return { startDays: 0, endDays: 0, durationDays: 0, hasChange: false };
  const [a, b, c, d] = dates as [string, string, string, string];
  const baseDuration = differenceInCalendarDays(a, b) + 1;
  const nextDuration = differenceInCalendarDays(c, d) + 1;
  return { startDays: differenceInCalendarDays(a, c), endDays: differenceInCalendarDays(b, d), durationDays: nextDuration - baseDuration, hasChange: a !== c || b !== d };
}
export function partyForOrg(request: { guOrgId: string; nuOrgId: string }, orgId: string): CoordinationParty | null {
  if (request.guOrgId === orgId) return "AG";
  if (request.nuOrgId === orgId) return "AN";
  return null;
}
export function deriveCoordinationState(input: { openProposal?: Pick<ServiceChangeProposal, "proposerOrgId"> | null; currentAgreement?: { start: Date | null; end: Date | null } | null; guOrgId?: string; nuOrgId: string }): { state: "AGREED" | "AG_ACTION_REQUIRED" | "AN_ACTION_REQUIRED" | "NO_AGREEMENT"; nextActionOwner: CoordinationParty | null } {
  if (!input.currentAgreement?.start || !input.currentAgreement.end) return { state: "NO_AGREEMENT", nextActionOwner: input.openProposal ? (input.openProposal.proposerOrgId === input.guOrgId ? "AN" : "AG") : null };
  if (!input.openProposal) return { state: "AGREED", nextActionOwner: null };
  const nextActionOwner = input.openProposal.proposerOrgId === input.guOrgId ? "AN" : "AG";
  return { state: nextActionOwner === "AG" ? "AG_ACTION_REQUIRED" : "AN_ACTION_REQUIRED", nextActionOwner };
}

export type CoordinationTimelineExtras = {
  responseAt?: Date | null; decisionAt?: Date | null; agreedAt?: Date | null;
  clarifications?: Array<{ id: string; askedByOrgId: string; createdAt: Date; answeredAt: Date | null; updatedAt?: Date | null; status: string }>;
  constraints?: Array<{ id: string; createdAt: Date; resolvedAt: Date | null; reportedByRole: CoordinationParty; responsibleRole?: CoordinationParty; status: string }>;
  readiness?: { updatedAt: Date; updatedByOrgId?: string | null; updatedByRole?: CoordinationParty | "SYSTEM" } | null;
};
export function buildCoordinationTimeline(request: { guOrgId?: string; createdAt: Date; sentAt: Date | null; deliveredAt: Date | null; agreedStart: Date | null; agreedEnd: Date | null }, proposals: ServiceChangeProposal[], extras: CoordinationTimelineExtras = {}) {
  const agreementAt = extras.decisionAt ?? extras.agreedAt ?? null;
  const roleForOrg = (orgId: string | null | undefined): CoordinationParty => orgId && request.guOrgId && orgId === request.guOrgId ? "AG" : "AN";
  const oppositeRole = (role: CoordinationParty): CoordinationParty => role === "AG" ? "AN" : "AG";
  const events = [
    { type: "REQUEST_CREATED", at: request.createdAt, actorRole: "AG" as CoordinationParty },
    ...(request.sentAt ? [{ type: "REQUEST_SENT", at: request.sentAt, actorRole: "AG" as CoordinationParty }] : []),
    ...(request.deliveredAt ? [{ type: "REQUEST_DELIVERED", at: request.deliveredAt, actorRole: "AN" as CoordinationParty }] : []),
    ...(request.agreedStart && request.agreedEnd && agreementAt ? [{ type: "AGREEMENT_REACHED", at: agreementAt, actorRole: "AG" as CoordinationParty, start: request.agreedStart, end: request.agreedEnd }] : []),
    ...proposals.flatMap((p) => {
      const proposerRole = roleForOrg(p.proposerOrgId);
      const resolution = p.status === "ACCEPTED" ? "CHANGE_PROPOSAL_ACCEPTED" : p.status === "REJECTED" ? "CHANGE_PROPOSAL_REJECTED" : p.status === "SUPERSEDED" ? "CHANGE_PROPOSAL_SUPERSEDED" : null;
      return [{ type: "CHANGE_PROPOSAL_CREATED", at: p.createdAt, actorRole: proposerRole, proposalId: p.id, start: p.start, end: p.end }, ...(p.resolvedAt && resolution ? [{ type: resolution, at: p.resolvedAt, actorRole: oppositeRole(proposerRole), proposalId: p.id }] : [])];
    }),
    ...(extras.responseAt ? [{ type: "RESPONSE_SUBMITTED", at: extras.responseAt, actorRole: "AN" as CoordinationParty }] : []),
    ...(extras.clarifications ?? []).flatMap((c) => [{ type: "CLARIFICATION_CREATED", at: c.createdAt, actorRole: roleForOrg(c.askedByOrgId), clarificationId: c.id }, ...(c.answeredAt ? [{ type: "CLARIFICATION_RESOLVED", at: c.answeredAt, actorRole: oppositeRole(roleForOrg(c.askedByOrgId)), clarificationId: c.id }] : []), ...(c.status === "CANCELLED" && !c.answeredAt ? [{ type: "CLARIFICATION_CANCELLED", at: c.updatedAt ?? c.createdAt, actorRole: roleForOrg(c.askedByOrgId), clarificationId: c.id }] : [])]),
    ...(extras.constraints ?? []).flatMap((c) => [{ type: "CONSTRAINT_REPORTED", at: c.createdAt, actorRole: c.reportedByRole, constraintId: c.id }, ...(c.status === "RESOLVED" && c.resolvedAt ? [{ type: "CONSTRAINT_RESOLVED", at: c.resolvedAt, actorRole: c.responsibleRole ?? c.reportedByRole, constraintId: c.id }] : []), ...(c.status === "CANCELLED" && c.resolvedAt ? [{ type: "CONSTRAINT_CANCELLED", at: c.resolvedAt, actorRole: c.reportedByRole, constraintId: c.id }] : [])]),
    ...(extras.readiness ? [{ type: "READINESS_CHANGED", at: extras.readiness.updatedAt, actorRole: extras.readiness.updatedByRole ?? "SYSTEM" as const, actorOrgId: extras.readiness.updatedByOrgId }] : []),
  ].filter((event) => event.at instanceof Date && !Number.isNaN(event.at.getTime()));
  return events.sort((a, b) => a.at.getTime() - b.at.getTime());
}

export async function getCoordination(requestId: string, orgId: string) {
  const [request] = await agDb.select().from(leistungsanfragenTable).where(eq(leistungsanfragenTable.id, requestId)).limit(1);
  const party = request ? partyForOrg(request, orgId) : null;
  if (!request || !party) return null;
  const [proposals, responses, decisions, clarifications, constraints, readinessRows] = await Promise.all([
    agDb.select().from(serviceChangeProposalsTable).where(eq(serviceChangeProposalsTable.leistungsanfrageId, requestId)).orderBy(desc(serviceChangeProposalsTable.createdAt)),
    agDb.select().from(leistungsantwortenTable).where(eq(leistungsantwortenTable.leistungsanfrageId, requestId)).orderBy(desc(leistungsantwortenTable.createdAt)),
    agDb.select().from(leistungsantwortEntscheidungenTable).where(eq(leistungsantwortEntscheidungenTable.leistungsanfrageId, requestId)),
    agDb.select().from(serviceClarificationsTable).where(eq(serviceClarificationsTable.serviceRequestId, requestId)),
    agDb.select().from(serviceConstraintsTable).where(eq(serviceConstraintsTable.serviceRequestId, requestId)),
    agDb.select().from(serviceReadinessChecksTable).where(eq(serviceReadinessChecksTable.serviceRequestId, requestId)).limit(1),
  ]);
  const openProposal = proposals.find((p) => p.status === "OPEN") ?? null;
  const currentAgreement = request.agreedStart && request.agreedEnd ? { start: request.agreedStart, end: request.agreedEnd } : null;
  const state = deriveCoordinationState({ openProposal, currentAgreement, guOrgId: request.guOrgId, nuOrgId: request.nuOrgId });
  const response = responses[0];
  const decision = response ? decisions.find((row) => row.responseId === response.id) ?? null : null;
  const initialDecision = decisions.filter((row) => ["CONFIRM_ACCEPTED", "ACCEPT_ALTERNATIVE"].includes(row.decisionType)).sort((a, b) => a.decidedAt.getTime() - b.decidedAt.getTime())[0] ?? null;
  const clarification = clarifications[0], constraint = constraints[0], readiness = readinessRows[0];
  const readinessNeedsConfirmation = !!readiness && !(readiness.scheduleConfirmed && readiness.siteReady && readiness.informationComplete && readiness.agReady && readiness.anReady);
  const action = deriveServiceCoordinationState({
    requestStatus: request.status, hasResponse: !!response, hasDecision: !!response && decisions.some((d) => d.responseId === response.id),
    openProposalProposer: openProposal ? openProposal.proposerOrgId === request.guOrgId ? "AG" : "AN" : null,
    responseRequiredBy: request.responseRequiredBy, decisionRequiredBy: request.guDecisionRequiredBy,
    clarificationWaitingFor: clarification ? clarification.askedByOrgId === request.guOrgId ? "AN" : "AG" : null,
    constraintResponsible: constraint ? constraint.responsibleOrgId === request.guOrgId ? "AG" : "AN" : null,
    readinessActionRequiredBy: readinessNeedsConfirmation ? readiness?.agReady && readiness.scheduleConfirmed && readiness.siteReady && readiness.informationComplete ? "AN" : "AG" : null,
  });
  const delta = openProposal ? calculateScheduleDelta(currentAgreement?.start, currentAgreement?.end, openProposal.start, openProposal.end) : { startDays: 0, endDays: 0, durationDays: 0, hasChange: false };
  const publicProposal = (p: ServiceChangeProposal | null) => p ? { id: p.id, start: p.start, end: p.end, proposerRole: p.proposerOrgId === request.guOrgId ? "AG" : "AN", reasonCode: p.reasonCode, comment: p.comment, action: p.action, status: p.status, createdAt: p.createdAt, resolvedAt: p.resolvedAt } : null;
  return {
    currentAgreement, openProposal: publicProposal(openProposal), proposals: proposals.map(publicProposal),
    coordinationState: state.state, nextActionOwner: action.nextActionOwner, nextAction: action.nextAction, actionRequiredBy: action.actionRequiredBy,
    responseRequiredBy: request.responseRequiredBy, scheduleDelta: delta,
    lastChangedAt: (maxDate(request.updatedAt, response?.createdAt, ...decisions.flatMap((r) => [r.createdAt, r.decidedAt]), ...proposals.flatMap((p) => [p.createdAt, p.resolvedAt]), ...constraints.flatMap((r) => [r.createdAt, r.updatedAt, r.resolvedAt]), ...clarifications.flatMap((r) => [r.createdAt, r.updatedAt, r.answeredAt]), readiness?.updatedAt) ?? request.updatedAt).toISOString(),
    timeline: buildCoordinationTimeline(request, proposals, {
      responseAt: response?.createdAt, decisionAt: initialDecision?.decidedAt ?? null,
      clarifications: clarifications.map((r) => ({ ...r, updatedAt: r.updatedAt })),
      constraints: constraints.map((r) => ({ ...r, responsibleRole: r.responsibleOrgId === request.guOrgId ? "AG" : "AN" })),
      readiness: readiness ? { updatedAt: readiness.updatedAt, updatedByOrgId: readiness.updatedByOrgId, updatedByRole: readiness.updatedByOrgId === request.guOrgId ? "AG" : readiness.updatedByOrgId === request.nuOrgId ? "AN" : "SYSTEM" } : null,
    }),
  };
}

export async function createChangeProposal(input: { requestId: string; orgId: string; userId: string; start: Date; end: Date; reasonCode?: string | null; comment?: string | null; action?: "PROPOSE" | "COUNTER"; supersedesProposalId?: string | null }) {
  if (compareCalendarDates(dateOnly(input.end), dateOnly(input.start)) < 0) throw Object.assign(new Error("Ende muss nach Beginn liegen"), { statusCode: 400 });
  const result = await agDb.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${input.requestId}, 0))`);
    const [request] = await tx.select().from(leistungsanfragenTable).where(eq(leistungsanfragenTable.id, input.requestId)).limit(1);
    const party = request && partyForOrg(request, input.orgId);
    if (!request || !party) throw Object.assign(new Error("Leistungsanfrage nicht gefunden"), { statusCode: 404 });
    if (!request.agreedStart || !request.agreedEnd) throw Object.assign(new Error("CHANGE_PROPOSAL_REQUIRES_AGREEMENT"), { statusCode: 422 });
    if (["CANCELLED", "EXPIRED", "SUPERSEDED", "REJECTED"].includes(request.status)) throw Object.assign(new Error("Für diese Anfrage ist keine Änderung mehr möglich"), { statusCode: 409 });
    if (request.performancePolicyId) {
      const [performancePolicy] = await tx.select().from(coordinationPoliciesTable)
        .where(eq(coordinationPoliciesTable.id, request.performancePolicyId)).limit(1);
      if (!performancePolicy) throw Object.assign(new Error("NOT_PERMITTED"), { statusCode: 409 });
      const effective = performancePolicy.effectivePolicy as Record<string, unknown>;
      try {
        assertLeistungsanfragePolicyAccess({
          policyDeltaClass: performancePolicy.deltaClass,
          policyConsentStatus: performancePolicy.lifecycleStatus === "ACCEPTED" ? "ACCEPTED" :
            performancePolicy.deltaClass === "REQUIRES_CONSENT" ? "PENDING" : "NOT_REQUIRED",
          validFrom: effective.validFrom as string | null | undefined,
          validUntil: effective.validUntil as string | null | undefined,
          retentionUntil: effective.retentionUntil as string | null | undefined,
        }, "AVAILABILITY");
      } catch (error) {
        if (error instanceof Error) Object.assign(error, { statusCode: 409 });
        throw error;
      }
    }
    const [open] = await tx.select().from(serviceChangeProposalsTable).where(and(eq(serviceChangeProposalsTable.leistungsanfrageId, input.requestId), eq(serviceChangeProposalsTable.status, "OPEN"))).limit(1);
    if (open) {
      if (input.action !== "COUNTER" || open.proposerOrgId === input.orgId) throw Object.assign(new Error("Es existiert bereits ein offener Vorschlag"), { statusCode: 409 });
      if (input.supersedesProposalId && input.supersedesProposalId !== open.id) throw Object.assign(new Error("Der Gegenvorschlag bezieht sich nicht auf den offenen Vorschlag"), { statusCode: 409 });
      await tx.update(serviceChangeProposalsTable).set({ status: "SUPERSEDED", resolvedAt: new Date(), resolvedByUserId: input.userId }).where(eq(serviceChangeProposalsTable.id, open.id));
      await setScheduleChangePolicyLifecycle(tx, { request, proposal: open, lifecycleStatus: "SUPERSEDED" });
    }
    const [proposal] = await tx.insert(serviceChangeProposalsTable).values({ leistungsanfrageId: input.requestId, proposerOrgId: input.orgId, proposerUserId: input.userId, start: input.start, end: input.end, reasonCode: input.reasonCode ?? null, comment: input.comment ?? null, action: input.action ?? "PROPOSE", supersedesProposalId: input.supersedesProposalId ?? open?.id ?? null }).returning();
    if (!proposal) throw new Error("Vorschlag konnte nicht gespeichert werden");
    const schedulePolicy = await createScheduleChangePolicy(tx, { request, proposal, createdByUserId: input.userId });

    // Build the public Dataspace request while the AG transaction still has
    // the request context, but publish only after the transaction commits.
    const [service] = await tx.select().from(leistungenTable)
      .where(eq(leistungenTable.id, request.leistungId)).limit(1);
    if (!service) throw new Error("Leistungsanfrage unvollständig");
    const [[project], [senderOrganization]] = await Promise.all([
      tx.select({ name: projectsTable.name }).from(projectsTable)
        .where(eq(projectsTable.id, service.projectId)).limit(1),
      tx.select({ name: organizationsTable.name }).from(organizationsTable)
        .where(eq(organizationsTable.id, request.guOrgId)).limit(1),
    ]);
    const [snapshot] = await tx.select({ snapshotPayload: leistungsanfrageSnapshotsTable.snapshotPayload })
      .from(leistungsanfrageSnapshotsTable)
      .where(eq(leistungsanfrageSnapshotsTable.leistungsanfrageId, request.id)).limit(1);
    const snapshotPayload = snapshot?.snapshotPayload as Record<string, unknown> | undefined;
    const requirements = toExternalResourceRequirementsFromSnapshot(
      snapshotPayload?.resourceRequirements,
      { start: dateOnly(proposal.start), end: dateOnly(proposal.end) },
    );
    const payload = toExternalServiceRequest({
      requestId: proposal.id,
      requestVersion: 1,
      requestKind: "SCHEDULE_CHANGE",
      sourceRequestId: request.id,
      changeProposalId: proposal.id,
      supersedesProposalId: input.supersedesProposalId ?? open?.id ?? undefined,
      baseTimeWindow: { start: request.agreedStart.toISOString(), end: request.agreedEnd.toISOString() },
      projectReference: service.projectId,
      plannedStart: proposal.start.toISOString(),
      plannedEnd: proposal.end.toISOString(),
      projectName: project?.name,
      senderOrganizationName: senderOrganization?.name,
      senderOrgId: request.guOrgId,
      receiverOrgId: request.nuOrgId,
      correlationId: proposal.id,
      messageId: `schedule-change:${proposal.id}`,
      resourceRequirements: requirements,
      ...(schedulePolicy ? {
        // The proposal correlation is AG-internal policy provenance; the
        // public policy contract remains the strict Construct-X snapshot.
        policySnapshot: (() => {
          const { changeProposalId: _proposalId, ...externalPolicy } = schedulePolicy;
          return externalPolicy;
        })(),
      } : {}),
      ...(snapshotPayload ? { publicSnapshot: publicSnapshotFromRecord(snapshotPayload) } : {}),
    });
    return { proposal, payload };
  });
  const delivery = await deliverLocalServiceRequest(result.payload);
  const [current] = await agDb.select().from(serviceChangeProposalsTable)
    .where(eq(serviceChangeProposalsTable.id, result.proposal.id)).limit(1);
  return {
    ...(current ?? result.proposal),
    transportStatus: delivery.status,
    transportMessageId: result.payload.metadata.messageId,
  };
}

export async function resolveChangeProposal(input: { requestId: string; proposalId: string; orgId: string; userId: string; status: "ACCEPTED" | "REJECTED" }) {
  const result = await agDb.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${input.requestId}, 0))`);
    const [proposal] = await tx.select().from(serviceChangeProposalsTable).where(eq(serviceChangeProposalsTable.id, input.proposalId)).limit(1);
    if (!proposal) throw Object.assign(new Error("Offener Vorschlag nicht gefunden"), { statusCode: 404 });
    if (proposal.status !== "OPEN") throw Object.assign(new Error("CHANGE_PROPOSAL_ALREADY_RESOLVED"), { statusCode: 409 });
    if (proposal.leistungsanfrageId !== input.requestId) throw Object.assign(new Error("Vorschlag gehört nicht zu dieser Anfrage"), { statusCode: 404 });
    const [request] = await tx.select().from(leistungsanfragenTable).where(eq(leistungsanfragenTable.id, proposal.leistungsanfrageId)).limit(1);
    if (!request || !partyForOrg(request, input.orgId) || proposal.proposerOrgId === input.orgId) throw Object.assign(new Error("Nur die Gegenseite darf diesen Vorschlag entscheiden"), { statusCode: 403 });
    if (input.status === "REJECTED") {
      const [updated] = await tx.update(serviceChangeProposalsTable).set({ status: "REJECTED", resolvedAt: new Date(), resolvedByUserId: input.userId }).where(and(eq(serviceChangeProposalsTable.id, input.proposalId), eq(serviceChangeProposalsTable.status, "OPEN"))).returning();
      if (!updated) throw Object.assign(new Error("CHANGE_PROPOSAL_ALREADY_RESOLVED"), { statusCode: 409 });
      await setScheduleChangePolicyLifecycle(tx, { request, proposal: updated, lifecycleStatus: "REJECTED" });
      return { proposal: updated, payload: null, request };
    }
    const [updated] = await tx.update(serviceChangeProposalsTable).set({
      status: "ACCEPTED",
      resolvedAt: new Date(),
      resolvedByUserId: input.userId,
    }).where(and(
      eq(serviceChangeProposalsTable.id, input.proposalId),
      eq(serviceChangeProposalsTable.status, "OPEN"),
    )).returning();
    if (!updated) throw Object.assign(new Error("CHANGE_PROPOSAL_ALREADY_RESOLVED"), { statusCode: 409 });
    await assertScheduleAcceptancePolicy(tx, request);
    await applyAcceptedScheduleChange(tx, {
      serviceRequestId: request.id, newStart: updated.start, newEnd: updated.end,
    });
    await setScheduleChangePolicyLifecycle(tx, {
      request, proposal: updated, lifecycleStatus: "ACCEPTED", consentedByOrgId: input.orgId,
    });
    return { proposal: updated, payload: null, request };
  });
  const decision: ExternalCoordinationDecision = {
    metadata: {
      messageId: `coordination-decision:${result.proposal.id}:${result.proposal.status}`,
      correlationId: result.proposal.id,
      schemaVersion: "1.0",
      senderOrgId: result.request.guOrgId,
      receiverOrgId: result.request.nuOrgId,
      createdAt: new Date().toISOString(),
    },
    requestId: result.proposal.id,
    requestVersion: 1,
    taktVersion: 1,
    decisionType: result.proposal.status === "ACCEPTED" ? "CONFIRM_ACCEPTED" : "CLOSE_WITHOUT_AGREEMENT",
    confirmedTimeWindow: result.proposal.status === "ACCEPTED"
      ? { start: result.proposal.start.toISOString(), end: result.proposal.end.toISOString() }
      : null,
    closedAt: result.proposal.status === "REJECTED" ? new Date().toISOString() : undefined,
  };
  const delivery = await deliverLocalCoordinationDecision(decision);
  const [current] = await agDb.select().from(serviceChangeProposalsTable).where(eq(serviceChangeProposalsTable.id, result.proposal.id)).limit(1);
  return { ...(current ?? result.proposal), transportStatus: delivery.status, transportMessageId: decision.metadata.messageId };
}

export async function applyIncomingScheduleChangeResponseOnAg(payload: ExternalServiceResponse) {
  const proposalId = payload.changeProposalId, sourceRequestId = payload.sourceRequestId;
  if (!proposalId || !sourceRequestId || payload.requestId !== proposalId) throw new Error("Inbound schedule-change response is missing its proposal correlation");
  const [proposal] = await agDb.select().from(serviceChangeProposalsTable).where(eq(serviceChangeProposalsTable.id, proposalId)).limit(1);
  if (!proposal || proposal.leistungsanfrageId !== sourceRequestId) throw new Error("Inbound schedule-change response references an unknown proposal");
  const [request] = await agDb.select().from(leistungsanfragenTable).where(eq(leistungsanfragenTable.id, sourceRequestId)).limit(1);
  if (!request || request.guOrgId !== payload.metadata.receiverOrgId || request.nuOrgId !== payload.metadata.senderOrgId || payload.metadata.correlationId !== proposalId) throw new Error("Inbound schedule-change response organisations or correlation do not match");
  const payloadHash = JSON.stringify(payload);
  if (proposal.status !== "OPEN") return { idempotent: true, newStatus: proposal.status === "ACCEPTED" ? "ACCEPTED" : "REJECTED", payloadHash };
  if (payload.decision === "ALTERNATIVES_PROPOSED") {
    return { idempotent: false, newStatus: "ALTERNATIVES_PROPOSED", payloadHash };
  }
  const nextStatus = payload.decision === "ACCEPTED" ? "ACCEPTED" : "REJECTED";
  const outcome = await agDb.transaction(async (tx) => {
    // Serialise every decision for this agreement before re-reading OPEN state.
    // The conditional update below remains the definitive claim in case a
    // caller bypasses the lock in a future integration.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${sourceRequestId}, 0))`);
    const [open] = await tx.select().from(serviceChangeProposalsTable).where(and(
      eq(serviceChangeProposalsTable.id, proposalId),
      eq(serviceChangeProposalsTable.status, "OPEN"),
    )).limit(1);
    if (!open) {
      const [current] = await tx.select({ status: serviceChangeProposalsTable.status })
        .from(serviceChangeProposalsTable).where(eq(serviceChangeProposalsTable.id, proposalId)).limit(1);
      return { won: false, status: current?.status ?? proposal.status };
    }
    if (nextStatus === "ACCEPTED") {
      if (!payload.acceptedTimeWindow) throw new Error("Accepted schedule-change response has no time window");
      const acceptedStart = new Date(payload.acceptedTimeWindow.start);
      const acceptedEnd = new Date(payload.acceptedTimeWindow.end);
      if (Number.isNaN(acceptedStart.getTime()) || Number.isNaN(acceptedEnd.getTime()) ||
          acceptedStart.getTime() !== open.start.getTime() || acceptedEnd.getTime() !== open.end.getTime()) {
        throw Object.assign(new Error("Accepted schedule-change response must exactly match the open proposal; submit a counterproposal instead"), { statusCode: 409 });
      }
    }
    const [updated] = await tx.update(serviceChangeProposalsTable)
      .set({ status: nextStatus, resolvedAt: new Date(), resolvedByUserId: null })
      .where(and(eq(serviceChangeProposalsTable.id, proposalId), eq(serviceChangeProposalsTable.status, "OPEN")))
      .returning();
    if (!updated) return { won: false, status: open.status };
    if (nextStatus === "ACCEPTED") {
      await assertScheduleAcceptancePolicy(tx, request);
      await applyAcceptedScheduleChange(tx, {
        serviceRequestId: sourceRequestId,
        newStart: updated.start,
        newEnd: updated.end,
      });
    }
    await setScheduleChangePolicyLifecycle(tx, {
      request, proposal: updated, lifecycleStatus: nextStatus,
      consentedByOrgId: payload.metadata.senderOrgId,
    });
    return { won: true, status: nextStatus };
  });
  return {
    idempotent: !outcome.won,
    newStatus: outcome.status === "ACCEPTED" ? "ACCEPTED" : "REJECTED",
    payloadHash,
  };
}

/**
 * Materialise an AN-originated schedule proposal in the AG coordination
 * history. The AN request reaches this function through the Dataspace inbound
 * processor; it never receives an AG database handle from an AN HTTP route.
 */
export async function applyIncomingAnScheduleChangeProposalOnAg(
  payload: ExternalServiceRequest,
) {
  const sourceRequestId = payload.sourceRequestId;
  const proposalId = payload.changeProposalId;
  if (!sourceRequestId || !proposalId || payload.requestId !== proposalId) {
    throw new Error("Inbound AN schedule-change proposal is missing its proposal correlation");
  }

  return agDb.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${sourceRequestId}, 0))`);
    const [request] = await tx.select().from(leistungsanfragenTable)
      .where(eq(leistungsanfragenTable.id, sourceRequestId)).limit(1);
    if (!request ||
        request.guOrgId !== payload.metadata.receiverOrgId ||
        request.nuOrgId !== payload.metadata.senderOrgId) {
      throw new Error("Inbound AN schedule-change proposal organisations do not match the request");
    }
    if (!request.agreedStart || !request.agreedEnd) {
      throw Object.assign(new Error("CHANGE_PROPOSAL_REQUIRES_AGREEMENT"), { statusCode: 422 });
    }
    if (dateOnly(payload.baseTimeWindow?.start ?? "") !== dateOnly(request.agreedStart) ||
        dateOnly(payload.baseTimeWindow?.end ?? "") !== dateOnly(request.agreedEnd)) {
      throw new Error("Inbound AN schedule-change proposal base window does not match the agreement");
    }
    if (compareCalendarDates(dateOnly(payload.plannedEnd), dateOnly(payload.plannedStart)) < 0) {
      throw Object.assign(new Error("Ende muss nach Beginn liegen"), { statusCode: 400 });
    }

    const [existingProposal] = await tx.select().from(serviceChangeProposalsTable)
      .where(eq(serviceChangeProposalsTable.id, proposalId)).limit(1);
    if (existingProposal) {
      if (existingProposal.leistungsanfrageId !== sourceRequestId ||
          existingProposal.proposerOrgId !== request.nuOrgId) {
        throw new Error("Inbound AN schedule-change proposal conflicts with an existing proposal");
      }
      return existingProposal;
    }

    const [open] = await tx.select().from(serviceChangeProposalsTable).where(and(
      eq(serviceChangeProposalsTable.leistungsanfrageId, sourceRequestId),
      eq(serviceChangeProposalsTable.status, "OPEN"),
    )).limit(1);
    if (open) {
      if (open.proposerOrgId !== request.guOrgId) {
        throw Object.assign(new Error("Es existiert bereits ein offener Vorschlag"), { statusCode: 409 });
      }
      if (payload.supersedesProposalId !== open.id) {
        throw new Error("Inbound AN counterproposal does not unambiguously reference the open proposal");
      }
      await tx.update(serviceChangeProposalsTable).set({
        status: "SUPERSEDED",
        resolvedAt: new Date(),
        // AN users live in the AN database in the physical deployment. Do
        // not copy that user id into the AG foreign key.
        resolvedByUserId: null,
      }).where(eq(serviceChangeProposalsTable.id, open.id));
      await setScheduleChangePolicyLifecycle(tx, { request, proposal: open, lifecycleStatus: "SUPERSEDED" });
    }

    // The AG request owner is the only user id guaranteed to exist in this
    // database. Sender identity remains authenticated by the Dataspace org
    // boundary, not by an AG-local user foreign key.
    const proposerUserId = request.createdByUserId;
    const [proposal] = await tx.insert(serviceChangeProposalsTable).values({
      id: proposalId,
      leistungsanfrageId: sourceRequestId,
      proposerOrgId: request.nuOrgId,
      proposerUserId,
      start: new Date(payload.plannedStart),
      end: new Date(payload.plannedEnd),
      reasonCode: null,
      comment: payload.comment ?? null,
      action: open ? "COUNTER" : "PROPOSE",
      supersedesProposalId: open?.id ?? null,
    }).returning();
    if (!proposal) throw new Error("Inbound AN schedule-change proposal could not be stored");
    await createScheduleChangePolicy(tx, {
      request, proposal, createdByUserId: request.createdByUserId,
    });
    return proposal;
  });
}