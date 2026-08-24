import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  leistungsanfragenTable,
  leistungsantwortenTable,
  leistungsantwortEntscheidungenTable,
  serviceChangeProposalsTable,
  serviceClarificationsTable,
  serviceConstraintsTable,
  serviceReadinessChecksTable,
  type ServiceChangeProposal,
} from "@workspace/db";
import { applyAcceptedScheduleChange, prepareAcceptedScheduleChange } from "./schedule-change-service";
import { deriveServiceCoordinationState } from "./service-coordination-state";
import { compareCalendarDates, differenceInCalendarDays } from "../lib/calendar-date-utils";

export type CoordinationParty = "AG" | "AN";

export interface ScheduleDelta {
  startDays: number;
  endDays: number;
  durationDays: number;
  hasChange: boolean;
}

export function maxDate(...values: Array<Date | string | null | undefined>): Date | null {
  const dates = values
    .filter((value): value is Date | string => value != null)
    .map((value) => value instanceof Date ? value : new Date(value))
    .filter((value) => !Number.isNaN(value.getTime()));
  return dates.length ? new Date(Math.max(...dates.map((value) => value.getTime()))) : null;
}

function dateOnly(value: Date | string): string {
  return (value instanceof Date ? value.toISOString() : value).slice(0, 10);
}

export function calculateScheduleDelta(
  baseStart: Date | string | null | undefined,
  baseEnd: Date | string | null | undefined,
  nextStart: Date | string | null | undefined,
  nextEnd: Date | string | null | undefined,
): ScheduleDelta {
  const dates = [baseStart, baseEnd, nextStart, nextEnd].map((v) => v ? new Date(v).toISOString().slice(0, 10) : null);
  if (dates.some((v) => !v)) return { startDays: 0, endDays: 0, durationDays: 0, hasChange: false };
  const [a, b, c, d] = dates as [string, string, string, string];
  const baseDuration = differenceInCalendarDays(a, b) + 1;
  const nextDuration = differenceInCalendarDays(c, d) + 1;
  return {
    startDays: differenceInCalendarDays(a, c),
    endDays: differenceInCalendarDays(b, d),
    durationDays: nextDuration - baseDuration,
    hasChange: a !== c || b !== d,
  };
}

export function partyForOrg(
  request: { guOrgId: string; nuOrgId: string },
  orgId: string,
): CoordinationParty | null {
  if (request.guOrgId === orgId) return "AG";
  if (request.nuOrgId === orgId) return "AN";
  return null;
}

export function deriveCoordinationState(input: {
  openProposal?: Pick<ServiceChangeProposal, "proposerOrgId"> | null;
  currentAgreement?: { start: Date | null; end: Date | null } | null;
  guOrgId?: string;
  nuOrgId: string;
}): { state: "AGREED" | "AG_ACTION_REQUIRED" | "AN_ACTION_REQUIRED" | "NO_AGREEMENT"; nextActionOwner: CoordinationParty | null } {
  if (!input.currentAgreement?.start || !input.currentAgreement.end) {
    return { state: "NO_AGREEMENT", nextActionOwner: input.openProposal ? (input.openProposal.proposerOrgId === input.guOrgId ? "AN" : "AG") : null };
  }
  if (!input.openProposal) return { state: "AGREED", nextActionOwner: null };
  const nextActionOwner = input.openProposal.proposerOrgId === input.guOrgId ? "AN" : "AG";
  return { state: nextActionOwner === "AG" ? "AG_ACTION_REQUIRED" : "AN_ACTION_REQUIRED", nextActionOwner };
}

export type CoordinationTimelineExtras = {
  responseAt?: Date | null;
  decisionAt?: Date | null;
  agreedAt?: Date | null;
  clarifications?: Array<{ id: string; askedByOrgId: string; createdAt: Date; answeredAt: Date | null; updatedAt?: Date | null; status: string }>;
  constraints?: Array<{ id: string; createdAt: Date; resolvedAt: Date | null; reportedByRole: CoordinationParty; responsibleRole?: CoordinationParty; status: string }>;
  readiness?: { updatedAt: Date; updatedByOrgId?: string | null; updatedByRole?: CoordinationParty | "SYSTEM" } | null;
};

export function buildCoordinationTimeline(request: {
  guOrgId?: string;
  createdAt: Date;
  sentAt: Date | null;
  deliveredAt: Date | null;
  agreedStart: Date | null;
  agreedEnd: Date | null;
}, proposals: ServiceChangeProposal[], extras: CoordinationTimelineExtras = {}) {
  const agreementAt = extras.decisionAt ?? extras.agreedAt ?? null;
  const roleForOrg = (orgId: string | null | undefined): CoordinationParty =>
    orgId && request.guOrgId && orgId === request.guOrgId ? "AG" : "AN";
  const oppositeRole = (role: CoordinationParty): CoordinationParty => role === "AG" ? "AN" : "AG";
  const events = [
    { type: "REQUEST_CREATED", at: request.createdAt, actorRole: "AG" as CoordinationParty },
    ...(request.sentAt ? [{ type: "REQUEST_SENT", at: request.sentAt, actorRole: "AG" as CoordinationParty }] : []),
    ...(request.deliveredAt ? [{ type: "REQUEST_DELIVERED", at: request.deliveredAt, actorRole: "AN" as CoordinationParty }] : []),
    ...(request.agreedStart && request.agreedEnd && agreementAt ? [{
      type: "AGREEMENT_REACHED",
      at: agreementAt,
      actorRole: "AG" as CoordinationParty,
      start: request.agreedStart,
      end: request.agreedEnd,
    }] : []),
    ...proposals.flatMap((p) => {
      const proposerRole = roleForOrg(p.proposerOrgId);
      const resolution = p.status === "ACCEPTED"
        ? "CHANGE_PROPOSAL_ACCEPTED"
        : p.status === "REJECTED"
          ? "CHANGE_PROPOSAL_REJECTED"
          : p.status === "SUPERSEDED"
            ? "CHANGE_PROPOSAL_SUPERSEDED"
            : null;
      return [
        { type: "CHANGE_PROPOSAL_CREATED", at: p.createdAt, actorRole: proposerRole, proposalId: p.id, start: p.start, end: p.end },
        ...(p.resolvedAt && resolution ? [{
          type: resolution,
          at: p.resolvedAt,
          actorRole: oppositeRole(proposerRole),
          proposalId: p.id,
        }] : []),
      ];
    }),
    ...(extras.responseAt ? [{ type: "RESPONSE_SUBMITTED", at: extras.responseAt, actorRole: "AN" as CoordinationParty }] : []),
    ...(extras.clarifications ?? []).flatMap((clarification) => [
      { type: "CLARIFICATION_CREATED", at: clarification.createdAt, actorRole: roleForOrg(clarification.askedByOrgId), clarificationId: clarification.id },
      ...(clarification.answeredAt ? [{ type: "CLARIFICATION_RESOLVED", at: clarification.answeredAt, actorRole: oppositeRole(roleForOrg(clarification.askedByOrgId)), clarificationId: clarification.id }] : []),
      ...(clarification.status === "CANCELLED" && !clarification.answeredAt ? [{ type: "CLARIFICATION_CANCELLED", at: clarification.updatedAt ?? clarification.createdAt, actorRole: roleForOrg(clarification.askedByOrgId), clarificationId: clarification.id }] : []),
    ]),
    ...(extras.constraints ?? []).flatMap((constraint) => [
      { type: "CONSTRAINT_REPORTED", at: constraint.createdAt, actorRole: constraint.reportedByRole, constraintId: constraint.id },
      ...(constraint.status === "RESOLVED" && constraint.resolvedAt ? [{ type: "CONSTRAINT_RESOLVED", at: constraint.resolvedAt, actorRole: constraint.responsibleRole ?? constraint.reportedByRole, constraintId: constraint.id }] : []),
      ...(constraint.status === "CANCELLED" && constraint.resolvedAt ? [{ type: "CONSTRAINT_CANCELLED", at: constraint.resolvedAt, actorRole: constraint.reportedByRole, constraintId: constraint.id }] : []),
    ]),
    ...(extras.readiness ? [{ type: "READINESS_CHANGED", at: extras.readiness.updatedAt, actorRole: extras.readiness.updatedByRole ?? "SYSTEM" as const, actorOrgId: extras.readiness.updatedByOrgId }] : []),
  ].filter((event) => event.at instanceof Date && !Number.isNaN(event.at.getTime()));
  return events.sort((a, b) => a.at.getTime() - b.at.getTime());
}

export async function getCoordination(requestId: string, orgId: string) {
  const [request] = await db.select().from(leistungsanfragenTable).where(eq(leistungsanfragenTable.id, requestId)).limit(1);
  const party = request ? partyForOrg(request, orgId) : null;
  if (!request || !party) return null;
  const [proposals, responses, decisions, clarifications, constraints, readinessRows] = await Promise.all([
    db.select().from(serviceChangeProposalsTable)
      .where(eq(serviceChangeProposalsTable.leistungsanfrageId, requestId))
      .orderBy(desc(serviceChangeProposalsTable.createdAt)),
    db.select().from(leistungsantwortenTable)
      .where(eq(leistungsantwortenTable.leistungsanfrageId, requestId))
      .orderBy(desc(leistungsantwortenTable.createdAt)),
    db.select().from(leistungsantwortEntscheidungenTable)
      .where(eq(leistungsantwortEntscheidungenTable.leistungsanfrageId, requestId)),
    db.select().from(serviceClarificationsTable).where(eq(serviceClarificationsTable.serviceRequestId, requestId)),
    db.select().from(serviceConstraintsTable).where(eq(serviceConstraintsTable.serviceRequestId, requestId)),
    db.select().from(serviceReadinessChecksTable)
      .where(eq(serviceReadinessChecksTable.serviceRequestId, requestId))
      .limit(1),
  ]);
  const openProposal = proposals.find((p) => p.status === "OPEN") ?? null;
  const currentAgreement = request.agreedStart && request.agreedEnd ? { start: request.agreedStart, end: request.agreedEnd } : null;
  const state = deriveCoordinationState({ openProposal, currentAgreement, guOrgId: request.guOrgId, nuOrgId: request.nuOrgId });
  const response = responses[0];
  const decision = response ? decisions.find((row) => row.responseId === response.id) ?? null : null;
  const initialDecision = decisions
    .filter((row) => ["CONFIRM_ACCEPTED", "ACCEPT_ALTERNATIVE"].includes(row.decisionType))
    .sort((a, b) => a.decidedAt.getTime() - b.decidedAt.getTime())[0] ?? null;
  const clarification = clarifications[0];
  const constraint = constraints[0];
  const readiness = readinessRows[0];
  const readinessNeedsConfirmation = !!readiness && !(
    readiness.scheduleConfirmed &&
    readiness.siteReady &&
    readiness.informationComplete &&
    readiness.agReady &&
    readiness.anReady
  );
  const action = deriveServiceCoordinationState({
    requestStatus: request.status,
    hasResponse: !!response,
    hasDecision: !!response && decisions.some((decision) => decision.responseId === response.id),
    openProposalProposer: openProposal
      ? openProposal.proposerOrgId === request.guOrgId ? "AG" : "AN"
      : null,
    responseRequiredBy: request.responseRequiredBy,
    decisionRequiredBy: request.guDecisionRequiredBy,
    clarificationWaitingFor: clarification
      ? clarification.askedByOrgId === request.guOrgId ? "AN" : "AG"
      : null,
    constraintResponsible: constraint
      ? constraint.responsibleOrgId === request.guOrgId ? "AG" : "AN"
      : null,
    readinessActionRequiredBy: readinessNeedsConfirmation
      ? (readiness?.agReady && readiness?.scheduleConfirmed && readiness?.siteReady && readiness?.informationComplete
        ? "AN"
        : "AG")
      : null,
  });
  const delta = openProposal
    ? calculateScheduleDelta(currentAgreement?.start, currentAgreement?.end, openProposal.start, openProposal.end)
    : { startDays: 0, endDays: 0, durationDays: 0, hasChange: false };
  const publicProposal = (proposal: ServiceChangeProposal | null) => proposal ? {
    id: proposal.id,
    start: proposal.start,
    end: proposal.end,
    proposerRole: proposal.proposerOrgId === request.guOrgId ? "AG" : "AN",
    reasonCode: proposal.reasonCode,
    comment: proposal.comment,
    action: proposal.action,
    status: proposal.status,
    createdAt: proposal.createdAt,
    resolvedAt: proposal.resolvedAt,
  } : null;
  return {
    currentAgreement,
    openProposal: publicProposal(openProposal),
    proposals: proposals.map(publicProposal),
    coordinationState: state.state,
    nextActionOwner: action.nextActionOwner,
    nextAction: action.nextAction,
    actionRequiredBy: action.actionRequiredBy,
    responseRequiredBy: request.responseRequiredBy,
    scheduleDelta: delta,
    lastChangedAt: (maxDate(
      request.updatedAt,
      response?.createdAt,
      ...decisions.flatMap((row) => [row.createdAt, row.decidedAt]),
      ...proposals.flatMap((proposal) => [proposal.createdAt, proposal.resolvedAt]),
      ...constraints.flatMap((row) => [row.createdAt, row.updatedAt, row.resolvedAt]),
      ...clarifications.flatMap((row) => [row.createdAt, row.updatedAt, row.answeredAt]),
      readiness?.updatedAt,
    ) ?? request.updatedAt).toISOString(),
    timeline: buildCoordinationTimeline(request, proposals, {
      responseAt: response?.createdAt,
      decisionAt: initialDecision?.decidedAt ?? null,
      clarifications: clarifications.map((row) => ({
        ...row,
        updatedAt: row.updatedAt,
      })),
      constraints: constraints.map((row) => ({
        ...row,
        responsibleRole: row.responsibleOrgId === request.guOrgId ? "AG" : "AN",
      })),
      readiness: readiness ? {
        updatedAt: readiness.updatedAt,
        updatedByOrgId: readiness.updatedByOrgId,
        updatedByRole: readiness.updatedByOrgId === request.guOrgId ? "AG" : readiness.updatedByOrgId === request.nuOrgId ? "AN" : "SYSTEM",
      } : null,
    }),
  };
}

export async function createChangeProposal(input: {
  requestId: string;
  orgId: string;
  userId: string;
  start: Date;
  end: Date;
  reasonCode?: string | null;
  comment?: string | null;
  action?: "PROPOSE" | "COUNTER";
  supersedesProposalId?: string | null;
}) {
  if (compareCalendarDates(dateOnly(input.end), dateOnly(input.start)) < 0) {
    throw Object.assign(new Error("Ende muss nach Beginn liegen"), { statusCode: 400 });
  }
  return db.transaction(async (tx) => {
    // Serialize proposal creation per request. The OPEN lookup and insert must
    // be one critical section, otherwise two concurrent submissions can both
    // observe an empty OPEN set before either insert commits.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${input.requestId}, 0))`);
    const [request] = await tx.select().from(leistungsanfragenTable).where(eq(leistungsanfragenTable.id, input.requestId)).limit(1);
    const party = request && partyForOrg(request, input.orgId);
    if (!request || !party) throw Object.assign(new Error("Leistungsanfrage nicht gefunden"), { statusCode: 404 });
    if (!request.agreedStart || !request.agreedEnd) {
      throw Object.assign(new Error("CHANGE_PROPOSAL_REQUIRES_AGREEMENT"), { statusCode: 422 });
    }
    if (["CANCELLED", "EXPIRED", "SUPERSEDED", "REJECTED"].includes(request.status)) {
      throw Object.assign(new Error("Für diese Anfrage ist keine Änderung mehr möglich"), { statusCode: 409 });
    }
    const [open] = await tx.select().from(serviceChangeProposalsTable).where(and(
      eq(serviceChangeProposalsTable.leistungsanfrageId, input.requestId),
      eq(serviceChangeProposalsTable.status, "OPEN"),
    )).limit(1);
    if (open) {
      if (input.action !== "COUNTER" || open.proposerOrgId === input.orgId) {
        throw Object.assign(new Error("Es existiert bereits ein offener Vorschlag"), { statusCode: 409 });
      }
      if (input.action === "COUNTER" && input.supersedesProposalId && input.supersedesProposalId !== open.id) {
        throw Object.assign(new Error("Der Gegenvorschlag bezieht sich nicht auf den offenen Vorschlag"), { statusCode: 409 });
      }
      await tx.update(serviceChangeProposalsTable).set({ status: "SUPERSEDED", resolvedAt: new Date(), resolvedByUserId: input.userId })
        .where(eq(serviceChangeProposalsTable.id, open.id));
    }
    const [proposal] = await tx.insert(serviceChangeProposalsTable).values({
      leistungsanfrageId: input.requestId,
      proposerOrgId: input.orgId,
      proposerUserId: input.userId,
      start: input.start,
      end: input.end,
      reasonCode: input.reasonCode ?? null,
      comment: input.comment ?? null,
      action: input.action ?? "PROPOSE",
      supersedesProposalId: input.supersedesProposalId ?? open?.id ?? null,
    }).returning();
    return proposal;
  });
}

export async function resolveChangeProposal(input: {
  requestId: string;
  proposalId: string;
  orgId: string;
  userId: string;
  status: "ACCEPTED" | "REJECTED";
}) {
  return db.transaction(async (tx) => {
     // All decisions for a request share one critical section. This keeps the
     // OPEN read, feasibility preparation and conditional resolution atomic
     // against concurrent accept/reject calls and proposal creation.
     await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${input.requestId}, 0))`);
      const [proposal] = await tx.select().from(serviceChangeProposalsTable).where(eq(serviceChangeProposalsTable.id, input.proposalId)).limit(1);
      if (!proposal) throw Object.assign(new Error("Offener Vorschlag nicht gefunden"), { statusCode: 404 });
      if (proposal.status !== "OPEN") {
        throw Object.assign(new Error("CHANGE_PROPOSAL_ALREADY_RESOLVED"), { statusCode: 409 });
      }
    if (proposal.leistungsanfrageId !== input.requestId) throw Object.assign(new Error("Vorschlag gehört nicht zu dieser Anfrage"), { statusCode: 404 });
    const [request] = await tx.select().from(leistungsanfragenTable).where(eq(leistungsanfragenTable.id, proposal.leistungsanfrageId)).limit(1);
    if (!request || !partyForOrg(request, input.orgId) || proposal.proposerOrgId === input.orgId) {
      throw Object.assign(new Error("Nur die Gegenseite darf diesen Vorschlag entscheiden"), { statusCode: 403 });
    }
      const prepared = input.status === "ACCEPTED"
        ? await prepareAcceptedScheduleChange(tx, {
          serviceRequestId: request.id,
          newStart: proposal.start,
          newEnd: proposal.end,
        })
        : undefined;
     const now = new Date();
    const [updated] = await tx.update(serviceChangeProposalsTable).set({
      status: input.status, resolvedAt: now, resolvedByUserId: input.userId,
    }).where(and(eq(serviceChangeProposalsTable.id, input.proposalId), eq(serviceChangeProposalsTable.status, "OPEN"))).returning();
     if (!updated) {
       throw Object.assign(new Error("CHANGE_PROPOSAL_ALREADY_RESOLVED"), { statusCode: 409 });
     }
    if (input.status === "ACCEPTED") {
       await applyAcceptedScheduleChange(tx, {
         serviceRequestId: request.id,
         newStart: proposal.start,
         newEnd: proposal.end,
         initiatedBy: proposal.proposerOrgId === request.guOrgId ? "AG" : "AN",
         proposalId: proposal.id,
          prepared,
       });
    }
    return updated;
  });
}
