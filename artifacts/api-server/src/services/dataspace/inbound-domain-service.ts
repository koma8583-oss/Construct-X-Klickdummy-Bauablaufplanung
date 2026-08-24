import { db, taktRequestsTable, takteTable, projectMembershipsTable, projectsTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import type { ExternalProjectInvitation, ExternalProjectInvitationResponse, ExternalServiceRequest, ExternalServiceResponse } from "./external-contracts";
import { processNuResponse } from "../nu-response-service";

/**
 * Domain boundary for Dataspace deliveries. Transport code only validates the
 * envelope; this module applies the existing coordination persistence paths.
 */
export async function processIncomingServiceRequest(payload: ExternalServiceRequest): Promise<void> {
  const [request] = await db.select().from(taktRequestsTable)
    .where(eq(taktRequestsTable.id, payload.requestId)).limit(1);
  if (!request) throw new Error(`Inbound service request ${payload.requestId} does not exist`);
  if (request.guOrgId !== payload.metadata.senderOrgId || request.nuOrgId !== payload.metadata.receiverOrgId) {
    throw new Error("Inbound service request organisations do not match the coordination request");
  }
  const [takt] = await db.select({ projectId: takteTable.projectId })
    .from(takteTable)
    .where(and(eq(takteTable.id, request.taktId), eq(takteTable.projectId, payload.projectReference)))
    .limit(1);
  if (!takt) throw new Error("Inbound service request project does not match the coordination request");
  if (payload.requestVersion < request.taktVersion) {
    throw new Error("Inbound service request version is older than the current request");
  }
  await db.update(taktRequestsTable).set({
    taktVersion: payload.requestVersion,
    status: request.status === "DRAFT" ? "SENT" : request.status,
    sentAt: request.sentAt ?? new Date(payload.metadata.createdAt),
    updatedAt: new Date(),
  }).where(eq(taktRequestsTable.id, request.id));
}

export async function processIncomingServiceResponse(payload: ExternalServiceResponse): Promise<void> {
  const [request] = await db.select().from(taktRequestsTable)
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
  const [project] = await db.select().from(projectsTable)
    .where(and(eq(projectsTable.id, payload.project.projectReference), eq(projectsTable.agOrgId, payload.metadata.senderOrgId))).limit(1);
  if (!project) throw new Error(`Inbound project invitation references an unknown project ${payload.project.projectReference}`);
  if (payload.metadata.receiverOrgId === payload.metadata.senderOrgId) throw new Error("Inbound project invitation has identical sender and receiver");

  const [existing] = await db.select().from(projectMembershipsTable)
    .where(eq(projectMembershipsTable.invitationId, payload.invitationId)).limit(1);
  if (existing) {
    if (existing.correlationId !== payload.metadata.correlationId || existing.agOrgId !== payload.metadata.senderOrgId ||
        existing.anOrgId !== payload.metadata.receiverOrgId) {
      throw new Error("Inbound project invitation conflicts with the existing invitation");
    }
    return;
  }
  await db.insert(projectMembershipsTable).values({
    projectId: project.id,
    agOrgId: payload.metadata.senderOrgId,
    anOrgId: payload.metadata.receiverOrgId,
    anParticipantId: `external:${payload.metadata.receiverOrgId}`,
    status: "INVITED",
    invitationId: payload.invitationId,
    correlationId: payload.metadata.correlationId,
    invitationMessage: payload.invitationMessage ?? null,
    invitationExpiresAt: payload.validUntil ? new Date(payload.validUntil) : null,
    invitedAt: new Date(payload.metadata.createdAt),
  }).onConflictDoNothing();
}

export async function processIncomingProjectInvitationResponse(payload: ExternalProjectInvitationResponse): Promise<void> {
  const [membership] = await db.select().from(projectMembershipsTable)
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
  if (membership.status === nextStatus) return;
  if (membership.status !== "INVITED") throw new Error("Inbound project invitation response conflicts with the current membership status");
  await db.update(projectMembershipsTable).set({
    status: nextStatus,
    respondedAt: new Date(payload.respondedAt),
    acceptedAt: nextStatus === "ACTIVE" ? new Date(payload.respondedAt) : null,
    rejectedAt: nextStatus === "REJECTED" ? new Date(payload.respondedAt) : null,
    updatedAt: new Date(),
  }).where(and(eq(projectMembershipsTable.id, membership.id), eq(projectMembershipsTable.status, "INVITED")));
}