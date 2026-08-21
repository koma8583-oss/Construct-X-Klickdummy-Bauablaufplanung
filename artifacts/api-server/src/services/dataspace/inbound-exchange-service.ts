import { db, dataspaceExchangesTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import type { ExternalTaktRequest, ExternalTaktResponse } from "./external-contracts";

function validateMetadata(payload: { metadata: ExternalTaktRequest["metadata"] }): void {
  const metadata = payload.metadata;
  if (!metadata?.messageId || !metadata.correlationId || metadata.schemaVersion !== "1.0") {
    throw new Error("Invalid external exchange metadata");
  }
}

export async function handleIncomingTaktRequest(
  payload: ExternalTaktRequest,
  process?: (payload: ExternalTaktRequest) => Promise<void>,
): Promise<void> {
  validateMetadata(payload);
  const existing = await db.select().from(dataspaceExchangesTable)
    .where(eq(dataspaceExchangesTable.messageId, payload.metadata.messageId)).limit(1);
  if (existing[0]?.status === "PROCESSED") return;
  const [exchange] = existing.length > 0
    ? [existing[0]]
    : await db.insert(dataspaceExchangesTable).values({
        direction: "INBOUND", messageType: "TAKT_REQUEST",
        messageId: payload.metadata.messageId, correlationId: payload.metadata.correlationId,
        senderOrgId: payload.metadata.senderOrgId, receiverOrgId: payload.metadata.receiverOrgId,
        businessObjectId: payload.requestId, businessObjectVersion: payload.requestVersion,
        status: "RECEIVED",
      }).returning();
  try {
    await process?.(payload);
    await db.update(dataspaceExchangesTable).set({ status: "PROCESSED", updatedAt: new Date() })
      .where(eq(dataspaceExchangesTable.id, exchange.id));
  } catch (error) {
    await db.update(dataspaceExchangesTable).set({ status: "FAILED", errorCode: error instanceof Error ? error.name : "PROCESSING_ERROR", updatedAt: new Date() })
      .where(eq(dataspaceExchangesTable.id, exchange.id));
    throw error;
  }
}

export async function handleIncomingTaktResponse(
  payload: ExternalTaktResponse,
  process?: (payload: ExternalTaktResponse) => Promise<void>,
): Promise<void> {
  validateMetadata(payload);
  const existing = await db.select().from(dataspaceExchangesTable)
    .where(eq(dataspaceExchangesTable.messageId, payload.metadata.messageId)).limit(1);
  if (existing[0]?.status === "PROCESSED") return;
  const [exchange] = existing.length > 0
    ? [existing[0]]
    : await db.insert(dataspaceExchangesTable).values({
        direction: "INBOUND", messageType: "TAKT_RESPONSE",
        messageId: payload.metadata.messageId, correlationId: payload.metadata.correlationId,
        senderOrgId: payload.metadata.senderOrgId, receiverOrgId: payload.metadata.receiverOrgId,
        businessObjectId: payload.requestId, businessObjectVersion: payload.requestVersion,
        status: "RECEIVED",
      }).returning();
  try {
    await process?.(payload);
    await db.update(dataspaceExchangesTable).set({ status: "PROCESSED", updatedAt: new Date() })
      .where(eq(dataspaceExchangesTable.id, exchange.id));
  } catch (error) {
    await db.update(dataspaceExchangesTable).set({ status: "FAILED", errorCode: error instanceof Error ? error.name : "PROCESSING_ERROR", updatedAt: new Date() })
      .where(eq(dataspaceExchangesTable.id, exchange.id));
    throw error;
  }
}