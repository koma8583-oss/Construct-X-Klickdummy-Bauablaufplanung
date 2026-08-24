import {
  agDb,
  anDb,
  dataPublicationRecipientsTable,
  projectMembershipsTable,
  taktRequestsTable,
  takteTable,
} from "@workspace/db";
import { and, eq } from "drizzle-orm";
import type { ExternalProjectInvitation, ExternalProjectInvitationResponse, ExternalServiceRequest, ExternalServiceResponse } from "./external-contracts";
import { processNuResponse } from "../nu-response-service";
import { storeIncomingProjectInvitation } from "../an-project-invitation-service";

/**
 * Domain boundary for Dataspace deliveries. Transport code only validates the
 * envelope; this module applies the existing coordination persistence paths.
 */
export async function processIncomingServiceRequest(payload: ExternalServiceRequest): Promise<void> {
  const [request] = await anDb.select().from(taktRequestsTable)
    .where(eq(taktRequestsTable.id, payload.requestId)).limit(1);
  if (!request) throw new Error(`Inbound service request ${payload.requestId} does not exist`);
  if (request.guOrgId !== payload.metadata.senderOrgId || request.nuOrgId !== payload.metadata.receiverOrgId) {
    throw new Error("Inbound service request organisations do not match the coordination request");
  }
  const [takt] = await anDb.select({ projectId: takteTable.projectId })
    .from(takteTable)
    .where(and(eq(takteTable.id, request.taktId), eq(takteTable.projectId, payload.projectReference)))
    .limit(1);
  if (!takt) throw new Error("Inbound service request project does not match the coordination request");
  if (payload.requestVersion < request.taktVersion) {
    throw new Error("Inbound service request version is older than the current request");
  }
  await anDb.update(taktRequestsTable).set({
    taktVersion: payload.requestVersion,
    status: request.status === "DRAFT" ? "SENT" : request.status,
    sentAt: request.sentAt ?? new Date(payload.metadata.createdAt),
    updatedAt: new Date(),
  }).where(eq(taktRequestsTable.id, request.id));
}

export async function processIncomingServiceResponse(payload: ExternalServiceResponse): Promise<void> {
  const [request] = await agDb.select().from(taktRequestsTable)
    .where(eq(taktRequestsTable.id, payload.requestId)).limit(1);
  if (!request) throw new Error(`Inbound service response ${payload.requestId} does not exist`);
  if (request.nuOrgId !== payload.metadata.senderOrgId || request.guOrgId !== payload.metadata.receiverOrgId) {
    throw new Error("Inbound service response organisations do not match the coordination request");
  }
  const acceptedTimeWindow = payload.decision === "ACCEPTED" && payload.alternatives?.[0]?.timeWindow
    ? payload.alternatives[0].timeWindow
    : undefined;
  await processNuResponse({
    taktRequestId: request.id,
    nuOrgId: request.nuOrgId,
    userId: request.createdByUserId,
    decision: payload.decision,
    acceptedTimeWindow,
    alternatives: payload.alternatives?.map((alternative) => ({
      alternativeId: alternative.alternativeId,
      rank: alternative.rank,
      timeWindow: alternative.timeWindow,
      crewSize: alternative.crewSize ?? undefined,
      conditions: alternative.conditions ? [alternative.conditions] : undefined,
    })),
    answerableStatuses: new Set(["SENT", "DELIVERED", "DETAILS_RETRIEVED", "UNDER_REVIEW", "REVISION_REQUIRED"]),
    currentRequestStatus: request.status,
    messageId: payload.metadata.messageId,
  });
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