import {
  agDb,
  anDb,
  anLeistungsanfrageResourceRequirementsTable,
  anLeistungsanfragenTable,
  dataPublicationRecipientsTable,
  dataPublicationsTable,
  projectMembershipsTable,
  resourceTypesTable,
  resourceBookingsTable,
  resourcesTable,
  leistungsanfragenTable,
  taktRequestsTable,
  coordinationPoliciesTable,
} from "@workspace/db";
import { and, desc, eq, gt, inArray } from "drizzle-orm";
import { createHash } from "node:crypto";
import type {
  ExternalCoordinationDecision,
  ExternalDataOffer,
  ExternalDataOfferResponse,
  ExternalProjectInvitation,
  ExternalProjectInvitationResponse,
  ExternalServiceRequest,
  ExternalServiceResponse,
} from "./external-contracts";
import { assertPolicySnapshotParticipants } from "./external-contracts";
import { applyIncomingServiceResponseOnAg } from "../nu-response-service";
import { storeIncomingProjectInvitation } from "../an-project-invitation-service";
import { storeIncomingDataOffer } from "../an-project-invitation-service";
import { createAnServiceResponse } from "../nu-response-service";
import { runAnAvailabilityCheck } from "../an-leistungsanfrage-service";
import { createDataspaceExchange } from "./dataspace-exchange-factory";
import { applyIncomingAnScheduleChangeProposalOnAg } from "../service-change-proposal-service";
import { applyAcceptedAnScheduleChange } from "../an-schedule-change-booking-service";

/**
 * Domain boundary for Dataspace deliveries. Transport code only validates the
 * envelope; this module applies the existing coordination persistence paths.
 */
export async function processIncomingServiceRequest(
  payload: ExternalServiceRequest,
  dispatchResponse?: (payload: ExternalServiceResponse) => Promise<unknown>,
  options: { automaticResponse?: boolean } = {},
): Promise<void> {
  const { metadata } = payload;
  assertPolicySnapshotParticipants(payload);
  if (!metadata.senderOrgId || !metadata.receiverOrgId || metadata.senderOrgId === metadata.receiverOrgId) {
    throw new Error("Inbound service request organisations conflict");
  }

  // An AN-originated schedule change is delivered to the AG side of the
  // Dataspace. Keep it out of the AN inbound projection path: an AN route must
  // never create a self-addressed projection or write AG proposal tables.
  if (payload.requestKind === "SCHEDULE_CHANGE" && payload.sourceRequestId) {
    const [agRequest] = await agDb.select({
      guOrgId: leistungsanfragenTable.guOrgId,
      nuOrgId: leistungsanfragenTable.nuOrgId,
    }).from(leistungsanfragenTable)
      .where(eq(leistungsanfragenTable.id, payload.sourceRequestId))
      .limit(1);
    if (agRequest &&
        agRequest.guOrgId === metadata.receiverOrgId &&
        agRequest.nuOrgId === metadata.senderOrgId) {
      await applyIncomingAnScheduleChangeProposalOnAg(payload);
      return;
    }
  }

  const canonical = JSON.stringify(payload, (_, value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return value;
    return Object.keys(value).sort().reduce<Record<string, unknown>>((sorted, key) => {
      sorted[key] = value[key];
      return sorted;
    }, {});
  });
  const hash = createHash("sha256").update(canonical).digest("hex");
  const leistungReference = payload.leistungReference ?? payload.requestId;

  const [sameMessage] = await anDb.select().from(anLeistungsanfragenTable)
    .where(eq(anLeistungsanfragenTable.sourceMessageId, metadata.messageId)).limit(1);
  if (sameMessage) {
    if (sameMessage.payloadHash !== hash) {
      throw new Error("Inbound service request messageId conflicts with existing AN projection");
    }
    return;
  }

  const [sameVersion] = await anDb.select().from(anLeistungsanfragenTable).where(and(
    eq(anLeistungsanfragenTable.receiverAnOrgId, metadata.receiverOrgId),
    eq(anLeistungsanfragenTable.externalLeistungsanfrageId, payload.requestId),
    eq(anLeistungsanfragenTable.externalRequestVersion, payload.requestVersion),
  )).limit(1);
  if (sameVersion) {
    if (sameVersion.payloadHash !== hash) {
      throw new Error("Inbound service request version conflicts with existing AN projection");
    }
    return;
  }

  const [latest] = await anDb.select().from(anLeistungsanfragenTable).where(and(
    eq(anLeistungsanfragenTable.receiverAnOrgId, metadata.receiverOrgId),
    eq(anLeistungsanfragenTable.externalLeistungsanfrageId, payload.requestId),
  )).orderBy(desc(anLeistungsanfragenTable.externalRequestVersion)).limit(1);
  if (latest && payload.requestVersion < latest.externalRequestVersion) {
    throw new Error("Inbound service request version is older than the current AN projection");
  }

  let projectionId: string | undefined;
  await anDb.transaction(async (tx) => {
    if (latest && payload.requestVersion > latest.externalRequestVersion) {
      await tx.update(anLeistungsanfragenTable).set({
        status: "SUPERSEDED",
        updatedAt: new Date(),
      }).where(and(
        eq(anLeistungsanfragenTable.receiverAnOrgId, metadata.receiverOrgId),
        eq(anLeistungsanfragenTable.externalLeistungsanfrageId, payload.requestId),
        gt(anLeistungsanfragenTable.externalRequestVersion, 0),
      ));
    }
    const [projection] = await tx.insert(anLeistungsanfragenTable).values({
      externalLeistungsanfrageId: payload.requestId,
      externalRequestVersion: payload.requestVersion,
      sourceMessageId: metadata.messageId,
      payloadHash: hash,
      correlationId: metadata.correlationId,
      senderAgOrgId: metadata.senderOrgId,
      receiverAnOrgId: metadata.receiverOrgId,
      projectReference: payload.projectReference,
      leistungReference,
      plannedStart: payload.plannedStart,
      plannedEnd: payload.plannedEnd,
      policySnapshot: payload.policySnapshot ?? payload.policy ?? null,
      policyDeltaClass: payload.policySnapshot?.deltaClass ?? null,
      // A schedule-change's bilateral accept/reject is the consent event for
      // its candidate child policy.  Do not create a second, impossible AN
      // policy-consent gate before the AN can evaluate that proposal.
      policyConsentStatus: payload.policySnapshot?.deltaClass === "REQUIRES_CONSENT" &&
        payload.requestKind !== "SCHEDULE_CHANGE"
        ? "PENDING"
        : "NOT_REQUIRED",
      policyDiff: payload.policySnapshot?.diff ?? null,
      effectivePolicy: payload.policySnapshot?.effectivePolicy ?? null,
      payloadSnapshot: payload as unknown as Record<string, unknown>,
      status: "RECEIVED",
      receivedAt: new Date(metadata.createdAt),
    }).returning({ id: anLeistungsanfragenTable.id });
    if (!projection) throw new Error("Inbound service request projection could not be created");
    projectionId = projection.id;
    if (payload.resourceRequirements.length) {
      const externalCodes = payload.resourceRequirements.map((resource) => resource.resourceTypeCode);
      const localTypes = await tx.select({
        id: resourceTypesTable.id,
        code: resourceTypesTable.code,
      }).from(resourceTypesTable).where(and(
        eq(resourceTypesTable.anOrgId, metadata.receiverOrgId),
        inArray(resourceTypesTable.code, externalCodes),
      ));
      const localTypeByCode = new Map(localTypes.map((type) => [type.code, type.id]));
      await tx.insert(anLeistungsanfrageResourceRequirementsTable).values(
        payload.resourceRequirements.map((resource) => ({
          anLeistungsanfrageId: projection.id,
          externalResourceTypeCode: resource.resourceTypeCode,
          externalResourceTypeName: resource.resourceTypeName,
          requiredCapacity: String(resource.requiredCapacity),
          capacityUnit: resource.capacityUnit,
          utilizationPercent: resource.utilizationPercent,
          periodStart: resource.periodStart,
          periodEnd: resource.periodEnd,
          requiredQualification: resource.requiredQualification ?? null,
          localResourceTypeId: localTypeByCode.get(resource.resourceTypeCode) ?? null,
          notes: null,
        })),
      );
    }
  });
  if (payload.requestKind !== "SCHEDULE_CHANGE" || !projectionId) return;
  const chainExternalRequestId = payload.sourceRequestId ?? payload.requestId;
  const chainProjections = await anDb.select({
    id: anLeistungsanfragenTable.id,
    externalLeistungsanfrageId: anLeistungsanfragenTable.externalLeistungsanfrageId,
    payloadSnapshot: anLeistungsanfragenTable.payloadSnapshot,
  }).from(anLeistungsanfragenTable).where(and(
    eq(anLeistungsanfragenTable.receiverAnOrgId, metadata.receiverOrgId),
  ));
  const previousProjectionIds = chainProjections
    .filter((candidate) => {
      const snapshot = candidate.payloadSnapshot as { sourceRequestId?: string } | null;
      return candidate.externalLeistungsanfrageId === chainExternalRequestId ||
        snapshot?.sourceRequestId === chainExternalRequestId;
    })
    .map((candidate) => candidate.id);

  // Every newly materialised schedule projection gets its own availability
  // history entry. Automatic response remains opt-in, but checking the
  // proposed window must not depend on that option.
  const availability = await runAnAvailabilityCheck(
    payload.sourceRequestId ?? payload.requestId,
    metadata.receiverOrgId,
    null,
    { excludeSourceReferenceIds: previousProjectionIds, projectionId },
  );
  if (!availability) throw new Error("Schedule-change AN projection could not be evaluated");
  if (options.automaticResponse !== true) return;

  const decision = availability.publicResultPayload?.recommendedDecision === "ACCEPTED"
    ? "ACCEPTED"
    : "REJECTED";
  const response = await createAnServiceResponse({
    anLeistungsanfrageId: projectionId,
    anOrgId: metadata.receiverOrgId,
    userId: null,
    decision,
    acceptedTimeWindow: decision === "ACCEPTED"
      ? { start: payload.plannedStart, end: payload.plannedEnd }
      : undefined,
    reasonCode: decision === "REJECTED" ? "RESOURCE_CONFLICT" : undefined,
    comment: decision === "REJECTED" ? "Der Zielzeitraum ist aus AN-Sicht nicht verfügbar." : undefined,
    outboundMessageId: `schedule-change-response:${payload.changeProposalId ?? payload.requestId}`,
  });
  if (dispatchResponse) {
    await dispatchResponse(response.payload);
  } else {
    const exchange = createDataspaceExchange();
    await exchange.publishServiceResponse(response.payload);
  }
}

export async function processIncomingServiceResponse(payload: ExternalServiceResponse): Promise<void> {
  await applyIncomingServiceResponseOnAg(payload);
}

/**
 * Applies a public AG decision only inside the AN domain. The source reference
 * for bookings is the local projection ID, so AG request identifiers never
 * become a writable AN resource-booking key.
 */
export async function processIncomingCoordinationDecision(
  payload: ExternalCoordinationDecision,
): Promise<void> {
  const { metadata } = payload;
  if (!metadata.senderOrgId || !metadata.receiverOrgId || metadata.senderOrgId === metadata.receiverOrgId) {
    throw new Error("Inbound coordination decision organisations conflict");
  }
  const [projection] = await anDb.select().from(anLeistungsanfragenTable).where(and(
    eq(anLeistungsanfragenTable.receiverAnOrgId, metadata.receiverOrgId),
    eq(anLeistungsanfragenTable.externalLeistungsanfrageId, payload.requestId),
    eq(anLeistungsanfragenTable.externalRequestVersion, payload.requestVersion),
  )).limit(1);
  if (!projection) {
    throw new Error(`Inbound coordination decision references unknown AN projection ${payload.requestId}`);
  }
  if (projection.senderAgOrgId !== metadata.senderOrgId || projection.correlationId !== metadata.correlationId) {
    throw new Error("Inbound coordination decision does not match its AN projection");
  }

  const now = new Date();
  await anDb.transaction(async (tx) => {
    const acceptance =
      payload.decisionType === "CONFIRM_ACCEPTED" ||
      payload.decisionType === "ACCEPT_ALTERNATIVE";

    if (acceptance) {
      const timeWindow = payload.confirmedTimeWindow!;
      const projectionSnapshot = projection.payloadSnapshot as { requestKind?: string } | null;
      await applyAcceptedAnScheduleChange(tx, {
        projectionId: projection.id,
        targetStart: new Date(timeWindow.start),
        targetEnd: new Date(timeWindow.end),
        note: `AG decision ${payload.decisionType}`,
        useRequirementPeriods: projectionSnapshot?.requestKind === "SCHEDULE_CHANGE",
      });
      return;
    }

    if (payload.decisionType === "REQUEST_REVISION" || payload.decisionType === "CLOSE_WITHOUT_AGREEMENT") {
      await tx.update(resourceBookingsTable).set({ status: "CANCELLED", updatedAt: now }).where(and(
        eq(resourceBookingsTable.nuOrgId, metadata.receiverOrgId),
        eq(resourceBookingsTable.sourceType, "TAKT_REQUEST"),
        eq(resourceBookingsTable.sourceReferenceId, projection.id),
        eq(resourceBookingsTable.status, "CONFIRMED"),
      ));
      await tx.update(anLeistungsanfragenTable).set({
        status: payload.decisionType === "REQUEST_REVISION" ? "REVISION_REQUIRED" : "CANCELLED",
        updatedAt: now,
      }).where(eq(anLeistungsanfragenTable.id, projection.id));
    }
  });
}

export async function processIncomingProjectInvitation(payload: ExternalProjectInvitation): Promise<void> {
  assertPolicySnapshotParticipants(payload);
  await storeIncomingProjectInvitation(payload);
}

export async function processIncomingDataOffer(payload: ExternalDataOffer): Promise<void> {
  await storeIncomingDataOffer(payload);
}

/**
 * Apply an AN decision for a published data offer. This path intentionally
 * updates only the publication recipient row: a data offer is not a project
 * invitation and therefore can never activate, reject, or revoke membership.
 */
export async function processIncomingDataOfferResponse(
  payload: ExternalDataOfferResponse,
): Promise<void> {
  if (payload.metadata.senderOrgId === payload.metadata.receiverOrgId) {
    throw new Error("Inbound data-offer response organisations conflict");
  }
  const [publication] = await agDb.select().from(dataPublicationsTable)
    .where(and(
      eq(dataPublicationsTable.id, payload.publicationId),
      eq(dataPublicationsTable.projectId, payload.projectReference),
      eq(dataPublicationsTable.agOrgId, payload.metadata.receiverOrgId),
    ))
    .limit(1);
  const [recipient] = await agDb.select().from(dataPublicationRecipientsTable)
    .where(and(
      eq(dataPublicationRecipientsTable.publicationId, payload.publicationId),
      eq(dataPublicationRecipientsTable.anOrgId, payload.metadata.senderOrgId),
    ))
    .limit(1);
  if (!publication || !recipient) {
    throw new Error("Inbound data-offer response references an unknown publication recipient");
  }

  const nextStatus = payload.decision === "ACCEPTED" ? "ACCEPTED" : "REJECTED";
  if (recipient.status === nextStatus) return;
  if (recipient.status !== "OFFERED") {
    throw new Error("Inbound data-offer response conflicts with the current recipient status");
  }

  const respondedAt = new Date(payload.respondedAt);
  await agDb.transaction(async (tx) => {
    const [updated] = await tx.update(dataPublicationRecipientsTable).set(
      nextStatus === "ACCEPTED"
        ? { status: "ACCEPTED", policyAcceptedAt: respondedAt, updatedAt: new Date() }
        : { status: "REJECTED", policyRejectedAt: respondedAt, updatedAt: new Date() },
    ).where(and(
      eq(dataPublicationRecipientsTable.id, recipient.id),
      eq(dataPublicationRecipientsTable.status, "OFFERED"),
    )).returning();
    if (!updated) {
      const [currentRecipient] = await tx.select({
        status: dataPublicationRecipientsTable.status,
      }).from(dataPublicationRecipientsTable).where(
        eq(dataPublicationRecipientsTable.id, recipient.id),
      ).limit(1);
      if (currentRecipient?.status === nextStatus) return;
      throw new Error("Inbound data-offer response conflicts with the current recipient status");
    }
  });
}

export async function processIncomingProjectInvitationResponse(payload: ExternalProjectInvitationResponse): Promise<void> {
  // A PERFORMANCE_REQUEST consent deliberately reuses the established
  // invitation-response transport/outbox channel, but is distinguished by the
  // child policy id. It must never flow into membership handling below.
  if (payload.performancePolicyId) {
    if (payload.metadata.senderOrgId === payload.metadata.receiverOrgId) {
      throw new Error("Inbound performance-policy response organisations conflict");
    }
    const [policy] = await agDb.select().from(coordinationPoliciesTable).where(and(
      eq(coordinationPoliciesTable.id, payload.performancePolicyId),
      eq(coordinationPoliciesTable.projectId, payload.projectReference),
      eq(coordinationPoliciesTable.providerOrgId, payload.metadata.receiverOrgId),
      eq(coordinationPoliciesTable.recipientOrgId, payload.metadata.senderOrgId),
      eq(coordinationPoliciesTable.kind, "PERFORMANCE_REQUEST"),
    )).limit(1);
    if (!policy || policy.deltaClass !== "REQUIRES_CONSENT") {
      throw new Error("Inbound performance-policy response references an unknown consent-required child policy");
    }
    const lifecycleStatus = payload.decision === "ACCEPTED" ? "ACCEPTED" : "REJECTED";
    if (policy.lifecycleStatus === lifecycleStatus) return;
    if (policy.lifecycleStatus !== "CONSENT_REQUIRED") {
      throw new Error("Inbound performance-policy response conflicts with the child policy lifecycle");
    }
    const [updated] = await agDb.update(coordinationPoliciesTable).set({
      lifecycleStatus,
      consentedAt: new Date(payload.respondedAt),
      consentedByOrgId: payload.metadata.senderOrgId,
      updatedAt: new Date(),
    }).where(and(
      eq(coordinationPoliciesTable.id, policy.id),
      eq(coordinationPoliciesTable.lifecycleStatus, "CONSENT_REQUIRED"),
    )).returning({ id: coordinationPoliciesTable.id });
    if (!updated) throw new Error("Inbound performance-policy response could not update child policy");
    return;
  }
  if (payload.dataPublicationId) {
    throw new Error(
      "Project invitation responses cannot decide a data offer; use DATA_OFFER_RESPONSE",
    );
  }
  if (payload.dataPublicationId) {
    const [recipient] = await agDb.select().from(dataPublicationRecipientsTable)
      .where(and(
        eq(dataPublicationRecipientsTable.publicationId, payload.dataPublicationId),
        eq(dataPublicationRecipientsTable.anOrgId, payload.metadata.senderOrgId),
      )).limit(1);
    const [publication] = await agDb.select().from(dataPublicationsTable)
      .where(and(
        eq(dataPublicationsTable.id, payload.dataPublicationId),
        eq(dataPublicationsTable.agOrgId, payload.metadata.receiverOrgId),
      )).limit(1);
    if (
      !recipient ||
      !publication ||
      publication.projectId !== payload.projectReference
    ) {
      throw new Error("Inbound data-offer response references an unknown publication recipient");
    }
    const nextStatus = payload.decision === "ACCEPTED" ? "ACCEPTED" : "REJECTED";
    const [membership] = recipient.projectMembershipId
      ? await agDb.select().from(projectMembershipsTable).where(and(
        eq(projectMembershipsTable.id, recipient.projectMembershipId),
        eq(projectMembershipsTable.projectId, payload.projectReference),
        eq(projectMembershipsTable.agOrgId, payload.metadata.receiverOrgId),
        eq(projectMembershipsTable.anOrgId, payload.metadata.senderOrgId),
        eq(projectMembershipsTable.dataPublicationId, payload.dataPublicationId),
        eq(projectMembershipsTable.invitationId, payload.invitationId),
        eq(projectMembershipsTable.correlationId, payload.metadata.correlationId),
      )).limit(1)
      : [];
    if (recipient.projectMembershipId && !membership) {
      throw new Error("Inbound data-offer response references an unknown project membership");
    }

    const nextMembershipStatus = payload.decision === "ACCEPTED" ? "ACTIVE" : "REJECTED";
    if (
      recipient.status !== nextStatus &&
      recipient.status !== "OFFERED"
    ) {
      throw new Error("Inbound data-offer response conflicts with the current recipient status");
    }
    if (
      membership &&
      membership.status !== nextMembershipStatus &&
      membership.status !== "INVITED"
    ) {
      throw new Error("Inbound data-offer response conflicts with the current project membership status");
    }
    if (
      recipient.status === nextStatus &&
      (!membership || membership.status === nextMembershipStatus)
    ) return;

    const respondedAt = new Date(payload.respondedAt);
    await agDb.transaction(async (tx) => {
      if (membership && membership.status !== nextMembershipStatus) {
        const [updatedMembership] = await tx.update(projectMembershipsTable).set({
          status: nextMembershipStatus,
          respondedAt,
          acceptedAt: nextMembershipStatus === "ACTIVE" ? respondedAt : null,
          rejectedAt: nextMembershipStatus === "REJECTED" ? respondedAt : null,
          updatedAt: new Date(),
        }).where(and(
          eq(projectMembershipsTable.id, membership.id),
          eq(projectMembershipsTable.status, "INVITED"),
        )).returning();
        if (!updatedMembership) {
          throw new Error("Inbound data-offer response conflicts with the current project membership status");
        }
      }

      if (recipient.status !== nextStatus) {
        const [updatedRecipient] = await tx.update(dataPublicationRecipientsTable).set(
          nextStatus === "ACCEPTED"
            ? { status: "ACCEPTED", policyAcceptedAt: respondedAt, updatedAt: new Date() }
            : { status: "REJECTED", policyRejectedAt: respondedAt, updatedAt: new Date() },
        ).where(and(
          eq(dataPublicationRecipientsTable.id, recipient.id),
          eq(dataPublicationRecipientsTable.status, "OFFERED"),
        )).returning();
        if (!updatedRecipient) {
          throw new Error("Inbound data-offer response conflicts with the current recipient status");
        }
      }
    });
    return;
  }

  const [membership] = await agDb.select().from(projectMembershipsTable)
    .where(and(
      eq(projectMembershipsTable.invitationId, payload.invitationId),
      eq(projectMembershipsTable.agOrgId, payload.metadata.receiverOrgId),
      eq(projectMembershipsTable.anOrgId, payload.metadata.senderOrgId),
    )).limit(1);
  if (!membership) throw new Error(`Inbound project invitation response references an unknown invitation ${payload.invitationId}`);
  if (membership.correlationId !== payload.metadata.correlationId || membership.projectId !== payload.projectReference) {
    throw new Error("Inbound project invitation response does not match the invitation");
  }
  const nextStatus = payload.decision === "ACCEPTED" ? "ACTIVE" : "REJECTED";
  if (nextStatus === "ACTIVE" && payload.policyAccepted !== true) {
    throw new Error("Inbound project invitation acceptance requires policyAccepted=true");
  }
  if (membership.status === nextStatus) return;
  if (membership.status !== "INVITED") throw new Error("Inbound project invitation response conflicts with the current membership status");
  const respondedAt = new Date(payload.respondedAt);
  await agDb.transaction(async (tx) => {
    const [updated] = await tx.update(projectMembershipsTable).set({
      status: nextStatus,
      respondedAt,
      acceptedAt: nextStatus === "ACTIVE" ? respondedAt : null,
      rejectedAt: nextStatus === "REJECTED" ? respondedAt : null,
      updatedAt: new Date(),
    }).where(and(eq(projectMembershipsTable.id, membership.id), eq(projectMembershipsTable.status, "INVITED"))).returning();
    if (!updated) throw new Error("Inbound project invitation response conflicts with the current membership status");
    await tx.update(dataPublicationRecipientsTable).set(
      nextStatus === "ACTIVE"
        ? { status: "ACCEPTED", policyAcceptedAt: respondedAt }
        : { status: "REJECTED", policyRejectedAt: respondedAt },
    ).where(eq(dataPublicationRecipientsTable.projectMembershipId, membership.id));
  });
}
