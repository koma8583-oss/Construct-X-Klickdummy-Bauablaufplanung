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
  taktRequestsTable,
} from "@workspace/db";
import { and, desc, eq, gt, inArray } from "drizzle-orm";
import { createHash } from "node:crypto";
import type {
  ExternalCoordinationDecision,
  ExternalProjectInvitation,
  ExternalProjectInvitationResponse,
  ExternalServiceRequest,
  ExternalServiceResponse,
} from "./external-contracts";
import { assertPolicySnapshotParticipants } from "./external-contracts";
import { applyIncomingServiceResponseOnAg } from "../nu-response-service";
import { storeIncomingProjectInvitation } from "../an-project-invitation-service";
import { createAnServiceResponse } from "../nu-response-service";
import { runAnAvailabilityCheck } from "../an-leistungsanfrage-service";
import { createDataspaceExchange } from "./dataspace-exchange-factory";

/**
 * Domain boundary for Dataspace deliveries. Transport code only validates the
 * envelope; this module applies the existing coordination persistence paths.
 */
export async function processIncomingServiceRequest(
  payload: ExternalServiceRequest,
  dispatchResponse?: (payload: ExternalServiceResponse) => Promise<unknown>,
): Promise<void> {
  const { metadata } = payload;
  assertPolicySnapshotParticipants(payload);
  if (!metadata.senderOrgId || !metadata.receiverOrgId || metadata.senderOrgId === metadata.receiverOrgId) {
    throw new Error("Inbound service request organisations conflict");
  }

  const canonical = JSON.stringify(payload, (_, value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return value;
    return Object.keys(value).sort().reduce<Record<string, unknown>>((sorted, key) => {
      sorted[key] = value[key];
      return sorted;
    }, {});
  });
  const hash = createHash("sha256").update(canonical).digest("hex");
  const leistungReference = payload.leistungReference ?? payload.taktReference ?? payload.requestId;

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

  const [previousProjection] = payload.sourceRequestId
    ? await anDb.select({ id: anLeistungsanfragenTable.id }).from(anLeistungsanfragenTable).where(and(
      eq(anLeistungsanfragenTable.receiverAnOrgId, metadata.receiverOrgId),
      eq(anLeistungsanfragenTable.externalLeistungsanfrageId, payload.sourceRequestId),
    )).orderBy(desc(anLeistungsanfragenTable.externalRequestVersion)).limit(1)
    : [];
  const availability = await runAnAvailabilityCheck(
    payload.requestId,
    metadata.receiverOrgId,
    null,
    { excludeSourceReferenceIds: previousProjection ? [previousProjection.id] : [] },
  );
  if (!availability) throw new Error("Schedule-change AN projection could not be evaluated");
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
      const requirements = await tx.select().from(anLeistungsanfrageResourceRequirementsTable)
        .where(eq(anLeistungsanfrageResourceRequirementsTable.anLeistungsanfrageId, projection.id));
      await tx.delete(resourceBookingsTable).where(and(
        eq(resourceBookingsTable.nuOrgId, metadata.receiverOrgId),
        eq(resourceBookingsTable.sourceType, "TAKT_REQUEST"),
        eq(resourceBookingsTable.sourceReferenceId, projection.id),
        eq(resourceBookingsTable.status, "CONFIRMED"),
      ));
      const bookingValues = requirements
        .filter((requirement) => Boolean(requirement.localResourceTypeId) && Number(requirement.requiredCapacity ?? 0) > 0)
        .map((requirement) => ({
          nuOrgId: metadata.receiverOrgId,
          resourceId: null,
          resourceTypeId: requirement.localResourceTypeId!,
          quantity: Number(requirement.requiredCapacity ?? 1),
          sourceType: "TAKT_REQUEST" as const,
          sourceReferenceId: projection.id,
          startAt: new Date(timeWindow.start),
          endAt: new Date(timeWindow.end),
          utilizationPercent: requirement.utilizationPercent,
          status: "CONFIRMED" as const,
          note: `AG decision ${payload.decisionType}`,
        }));
      if (bookingValues.length) await tx.insert(resourceBookingsTable).values(bookingValues);
      await tx.update(anLeistungsanfragenTable).set({
        status: "CONFIRMED",
        updatedAt: now,
      }).where(eq(anLeistungsanfragenTable.id, projection.id));
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

export async function processIncomingProjectInvitationResponse(payload: ExternalProjectInvitationResponse): Promise<void> {
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
