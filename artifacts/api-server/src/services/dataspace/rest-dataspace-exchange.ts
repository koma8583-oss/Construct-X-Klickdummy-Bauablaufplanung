import { DataspaceMessageType } from "@workspace/api-zod";
import { db, dataspaceExchangesTable } from "@workspace/db";
import { LocalHubTransport } from "../../lib/transport/local-hub-transport";
import type { DataspaceExchange, ExchangeReference } from "./dataspace-exchange";
import type { ExternalTaktRequest, ExternalTaktResponse } from "./external-contracts";

export class RestDataspaceExchange implements DataspaceExchange {
  constructor(private readonly transport = new LocalHubTransport()) {}

  async publishTaktRequest(payload: ExternalTaktRequest): Promise<ExchangeReference> {
    const result = await this.transport.send({
      messageId: payload.metadata.messageId,
      schemaVersion: payload.metadata.schemaVersion,
      messageType: DataspaceMessageType.TAKT_REQUEST_NOTIFICATION,
      senderOrgId: payload.metadata.senderOrgId,
      recipientOrgId: payload.metadata.receiverOrgId,
      correlationId: payload.metadata.correlationId,
      createdAt: new Date(payload.metadata.createdAt),
      causationId: null,
      payload: payload as unknown as Record<string, unknown>,
    });
    await db.insert(dataspaceExchangesTable).values({
      direction: "OUTBOUND",
      messageType: "TAKT_REQUEST",
      messageId: payload.metadata.messageId,
      correlationId: payload.metadata.correlationId,
      senderOrgId: payload.metadata.senderOrgId,
      receiverOrgId: payload.metadata.receiverOrgId,
      businessObjectId: payload.requestId,
      businessObjectVersion: payload.requestVersion,
      status: result.status === "DELIVERED" ? "PUBLISHED" : "FAILED",
      externalReference: result.messageId,
    }).onConflictDoNothing();
    return { exchangeId: result.messageId, externalReference: result.messageId, ...result };
  }

  async publishTaktResponse(payload: ExternalTaktResponse): Promise<ExchangeReference> {
    const result = await this.transport.send({
      messageId: payload.metadata.messageId,
      schemaVersion: payload.metadata.schemaVersion,
      messageType: DataspaceMessageType.TAKT_RESPONSE_SUBMITTED,
      senderOrgId: payload.metadata.senderOrgId,
      recipientOrgId: payload.metadata.receiverOrgId,
      correlationId: payload.metadata.correlationId,
      createdAt: new Date(payload.metadata.createdAt),
      causationId: null,
      payload: payload as unknown as Record<string, unknown>,
    });
    await db.insert(dataspaceExchangesTable).values({
      direction: "OUTBOUND",
      messageType: "TAKT_RESPONSE",
      messageId: payload.metadata.messageId,
      correlationId: payload.metadata.correlationId,
      senderOrgId: payload.metadata.senderOrgId,
      receiverOrgId: payload.metadata.receiverOrgId,
      businessObjectId: payload.requestId,
      businessObjectVersion: payload.requestVersion,
      status: result.status === "DELIVERED" ? "PUBLISHED" : "FAILED",
      externalReference: result.messageId,
    }).onConflictDoNothing();
    return { exchangeId: result.messageId, externalReference: result.messageId, ...result };
  }
}