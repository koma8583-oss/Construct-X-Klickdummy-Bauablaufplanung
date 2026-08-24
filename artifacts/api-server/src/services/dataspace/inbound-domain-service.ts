import { db, leistungsantwortenTable, taktRequestsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import type { ExternalServiceRequest, ExternalServiceResponse } from "./external-contracts";
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