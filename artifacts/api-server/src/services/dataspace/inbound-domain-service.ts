import {
  agDb,
  anDb,
  anLeistungsanfragenTable,
  anLeistungsanfrageResourceRequirementsTable,
  dataPublicationRecipientsTable,
  projectMembershipsTable,
  taktRequestsTable,
} from "@workspace/db";
import { and, desc, eq, gt } from "drizzle-orm";
import { createHash } from "node:crypto";
import type { ExternalProjectInvitation, ExternalProjectInvitationResponse, ExternalServiceRequest, ExternalServiceResponse } from "./external-contracts";
import { applyIncomingServiceResponseOnAg } from "../nu-response-service";
import { storeIncomingProjectInvitation } from "../an-project-invitation-service";

/**
 * Domain boundary for Dataspace deliveries. Transport code only validates the
 * envelope; this module applies the existing coordination persistence paths.
 */
export async function processIncomingServiceRequest(payload: ExternalServiceRequest): Promise<void> {
  const { metadata } = payload;
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
      policySnapshot: payload.policy ?? null,
      payloadSnapshot: payload as unknown as Record<string, unknown>,
      status: "RECEIVED",
      receivedAt: new Date(metadata.createdAt),
    }).returning({ id: anLeistungsanfragenTable.id });
    if (!projection) throw new Error("Inbound service request projection could not be created");
    if (payload.resourceRequirements.length) {
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
          localResourceTypeId: null,
          notes: null,
        })),
      );
    }
  });
}

export async function processIncomingServiceResponse(payload: ExternalServiceResponse): Promise<void> {
  await applyIncomingServiceResponseOnAg(payload);
}

export async function processIncomingProjectInvitation(payload: ExternalProjectInvitation): Promise<void> {
  await storeIncomingProjectInvitation(payload);
}

export async function processIncomingProjectInvitationResponse(payload: ExternalProjectInvitationResponse): Promise<void> {
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