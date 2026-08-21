import { DataspaceMessageType } from "@workspace/api-zod";
import { db, dataspaceExchangesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { LocalHubTransport } from "../../lib/transport/local-hub-transport";
import type { DataspaceExchange, ExchangeReference } from "./dataspace-exchange";
import type { ExternalServiceRequest, ExternalServiceResponse } from "./external-contracts";

export class RestDataspaceExchange implements DataspaceExchange {
  constructor(private readonly transport = new LocalHubTransport()) {}

  private requestPayload(payload: ExternalServiceRequest): Record<string, unknown> {
    return {
      taktRequestId: payload.requestId,
      leistungsanfrageId: payload.requestId,
      projectReference: payload.projectReference,
      taktVersion: payload.requestVersion,
      responseRequiredBy: null,
      plannedStart: payload.plannedStart,
      plannedEnd: payload.plannedEnd,
      resourceRequirements: payload.resourceRequirements,
      policy: payload.policy ?? null,
    };
  }

  private responsePayload(payload: ExternalServiceResponse): Record<string, unknown> {
    return {
      taktRequestId: payload.requestId,
      leistungsanfrageId: payload.requestId,
      taktVersion: payload.requestVersion,
      decision: payload.decision,
      alternatives: payload.alternatives ?? null,
    };
  }

  async publishServiceRequest(payload: ExternalServiceRequest): Promise<ExchangeReference> {
    await db.insert(dataspaceExchangesTable).values({
      direction: "OUTBOUND", messageType: "SERVICE_REQUEST",
      messageId: payload.metadata.messageId, correlationId: payload.metadata.correlationId,
      senderOrgId: payload.metadata.senderOrgId, receiverOrgId: payload.metadata.receiverOrgId,
      businessObjectId: payload.requestId, businessObjectVersion: payload.requestVersion,
      status: "CREATED",
    }).onConflictDoNothing();
    let result;
    try {
      result = await this.transport.send({
      messageId: payload.metadata.messageId,
      schemaVersion: payload.metadata.schemaVersion,
      messageType: DataspaceMessageType.TAKT_REQUEST_NOTIFICATION,
      senderOrgId: payload.metadata.senderOrgId,
      recipientOrgId: payload.metadata.receiverOrgId,
      correlationId: payload.metadata.correlationId,
      createdAt: new Date(payload.metadata.createdAt),
      causationId: null,
      payload: this.requestPayload(payload),
      });
      await db.update(dataspaceExchangesTable).set({
        status: result.status === "DELIVERED" ? "PUBLISHED" : "FAILED",
        externalReference: result.messageId, updatedAt: new Date(),
      }).where(eq(dataspaceExchangesTable.messageId, payload.metadata.messageId));
    } catch (error) {
      await db.update(dataspaceExchangesTable).set({
        status: "FAILED", errorCode: error instanceof Error ? error.name : "TRANSPORT_FAILURE",
        updatedAt: new Date(),
      }).where(eq(dataspaceExchangesTable.messageId, payload.metadata.messageId));
      throw error;
    }
    return { exchangeId: result.messageId, externalReference: result.messageId, ...result };
  }

  async publishServiceResponse(payload: ExternalServiceResponse): Promise<ExchangeReference> {
    await db.insert(dataspaceExchangesTable).values({
      direction: "OUTBOUND", messageType: "SERVICE_RESPONSE",
      messageId: payload.metadata.messageId, correlationId: payload.metadata.correlationId,
      senderOrgId: payload.metadata.senderOrgId, receiverOrgId: payload.metadata.receiverOrgId,
      businessObjectId: payload.requestId, businessObjectVersion: payload.requestVersion,
      status: "CREATED",
    }).onConflictDoNothing();
    let result;
    try {
      result = await this.transport.send({
      messageId: payload.metadata.messageId,
      schemaVersion: payload.metadata.schemaVersion,
      messageType: DataspaceMessageType.TAKT_RESPONSE_SUBMITTED,
      senderOrgId: payload.metadata.senderOrgId,
      recipientOrgId: payload.metadata.receiverOrgId,
      correlationId: payload.metadata.correlationId,
      createdAt: new Date(payload.metadata.createdAt),
      causationId: null,
      payload: this.responsePayload(payload),
      });
      await db.update(dataspaceExchangesTable).set({
        status: result.status === "DELIVERED" ? "PUBLISHED" : "FAILED",
        externalReference: result.messageId, updatedAt: new Date(),
      }).where(eq(dataspaceExchangesTable.messageId, payload.metadata.messageId));
    } catch (error) {
      await db.update(dataspaceExchangesTable).set({
        status: "FAILED", errorCode: error instanceof Error ? error.name : "TRANSPORT_FAILURE",
        updatedAt: new Date(),
      }).where(eq(dataspaceExchangesTable.messageId, payload.metadata.messageId));
      throw error;
    }
    return { exchangeId: result.messageId, externalReference: result.messageId, ...result };
  }
}