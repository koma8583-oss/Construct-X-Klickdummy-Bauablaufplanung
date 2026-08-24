import { db, dataspaceExchangesTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import type {
  ExternalProjectInvitation,
  ExternalProjectInvitationResponse,
  ExternalServiceRequest,
  ExternalServiceResponse,
} from "./external-contracts";

export type InboundProcessResult = {
  duplicate: boolean;
  status: "PROCESSED" | "DUPLICATE";
};

function validateMetadata(payload: { metadata: ExternalServiceRequest["metadata"] }): void {
  const metadata = payload.metadata;
  if (!metadata?.messageId || !metadata.correlationId || metadata.schemaVersion !== "1.0") {
    throw new Error("Invalid external exchange metadata");
  }
}

async function processIncoming<T extends ExternalServiceRequest | ExternalServiceResponse>(
  payload: T,
  messageType: "SERVICE_REQUEST" | "SERVICE_RESPONSE",
  process?: (payload: T) => Promise<void>,
): Promise<InboundProcessResult> {
  validateMetadata(payload);

  // The insert is the claim. Only its winner may execute business logic, so two
  // simultaneous deliveries cannot both produce side effects. A FAILED row is
  // claimable for an intentional retry; RECEIVED means another delivery owns it.
  const [inserted] = await db.insert(dataspaceExchangesTable).values({
    direction: "INBOUND",
    messageType,
    messageId: payload.metadata.messageId,
    correlationId: payload.metadata.correlationId,
    senderOrgId: payload.metadata.senderOrgId,
    receiverOrgId: payload.metadata.receiverOrgId,
    businessObjectId: payload.requestId,
    businessObjectVersion: payload.requestVersion,
    status: "RECEIVED",
  }).onConflictDoNothing().returning();

  let exchange = inserted;
  if (!exchange) {
    const [existing] = await db.select().from(dataspaceExchangesTable)
      .where(eq(dataspaceExchangesTable.messageId, payload.metadata.messageId)).limit(1);
    if (!existing || existing.status === "PROCESSED" || existing.status === "RECEIVED") {
      return { duplicate: true, status: "DUPLICATE" };
    }

    // Claim a failed delivery atomically. If another retry won the claim, this
    // request is a duplicate and must not invoke the processor.
    const [claimed] = await db.update(dataspaceExchangesTable)
      .set({ status: "RECEIVED", errorCode: null, updatedAt: new Date() })
      .where(and(
        eq(dataspaceExchangesTable.id, existing.id),
        eq(dataspaceExchangesTable.status, "FAILED"),
      )).returning();
    if (!claimed) return { duplicate: true, status: "DUPLICATE" };
    exchange = claimed;
  }

  try {
    await process?.(payload);
    await db.update(dataspaceExchangesTable).set({ status: "PROCESSED", updatedAt: new Date() })
      .where(eq(dataspaceExchangesTable.id, exchange.id));
  } catch (error) {
    await db.update(dataspaceExchangesTable).set({ status: "FAILED", errorCode: error instanceof Error ? error.name : "PROCESSING_ERROR", updatedAt: new Date() })
      .where(eq(dataspaceExchangesTable.id, exchange.id));
    throw error;
  }
  return { duplicate: false, status: "PROCESSED" };
}

async function processIncomingInvitation<T extends ExternalProjectInvitation | ExternalProjectInvitationResponse>(
  payload: T,
  messageType: "PROJECT_INVITATION" | "PROJECT_INVITATION_RESPONSE",
  process?: (payload: T) => Promise<void>,
): Promise<InboundProcessResult> {
  validateMetadata(payload);
  const [inserted] = await db.insert(dataspaceExchangesTable).values({
    direction: "INBOUND",
    messageType,
    messageId: payload.metadata.messageId,
    correlationId: payload.metadata.correlationId,
    senderOrgId: payload.metadata.senderOrgId,
    receiverOrgId: payload.metadata.receiverOrgId,
    businessObjectId: payload.invitationId,
    businessObjectVersion: 1,
    status: "RECEIVED",
  }).onConflictDoNothing().returning();

  let exchange = inserted;
  if (!exchange) {
    const [existing] = await db.select().from(dataspaceExchangesTable)
      .where(eq(dataspaceExchangesTable.messageId, payload.metadata.messageId)).limit(1);
    if (!existing || existing.status === "PROCESSED" || existing.status === "RECEIVED") {
      return { duplicate: true, status: "DUPLICATE" };
    }
    const [claimed] = await db.update(dataspaceExchangesTable)
      .set({ status: "RECEIVED", errorCode: null, updatedAt: new Date() })
      .where(and(eq(dataspaceExchangesTable.id, existing.id), eq(dataspaceExchangesTable.status, "FAILED")))
      .returning();
    if (!claimed) return { duplicate: true, status: "DUPLICATE" };
    exchange = claimed;
  }

  try {
    await process?.(payload);
    await db.update(dataspaceExchangesTable).set({ status: "PROCESSED", updatedAt: new Date() })
      .where(eq(dataspaceExchangesTable.id, exchange.id));
  } catch (error) {
    await db.update(dataspaceExchangesTable).set({
      status: "FAILED",
      errorCode: error instanceof Error ? error.name : "PROCESSING_ERROR",
      updatedAt: new Date(),
    }).where(eq(dataspaceExchangesTable.id, exchange.id));
    throw error;
  }
  return { duplicate: false, status: "PROCESSED" };
}

export async function handleIncomingServiceRequest(
  payload: ExternalServiceRequest,
  process?: (payload: ExternalServiceRequest) => Promise<void>,
): Promise<InboundProcessResult> {
  return processIncoming(payload, "SERVICE_REQUEST", process);
}

export async function handleIncomingServiceResponse(
  payload: ExternalServiceResponse,
  process?: (payload: ExternalServiceResponse) => Promise<void>,
): Promise<InboundProcessResult> {
  return processIncoming(payload, "SERVICE_RESPONSE", process);
}

export function handleIncomingProjectInvitation(
  payload: ExternalProjectInvitation,
  process?: (payload: ExternalProjectInvitation) => Promise<void>,
) {
  return processIncomingInvitation(payload, "PROJECT_INVITATION", process);
}

export function handleIncomingProjectInvitationResponse(
  payload: ExternalProjectInvitationResponse,
  process?: (payload: ExternalProjectInvitationResponse) => Promise<void>,
) {
  return processIncomingInvitation(payload, "PROJECT_INVITATION_RESPONSE", process);
}
