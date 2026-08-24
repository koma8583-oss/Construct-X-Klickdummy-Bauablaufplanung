import { DataspaceMessageType } from "@workspace/api-zod";
import { db, dataspaceExchangesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { LocalHubTransport } from "../../lib/transport/local-hub-transport";
import type { DataspaceExchange, ExchangeReference } from "./dataspace-exchange";
import type {
  ExternalProjectInvitation,
  ExternalProjectInvitationResponse,
  ExternalServiceRequest,
  ExternalServiceResponse,
} from "./external-contracts";
import {
  handleIncomingServiceRequest,
  handleIncomingServiceResponse,
  handleIncomingProjectInvitation,
  handleIncomingProjectInvitationResponse,
} from "./inbound-exchange-service";

export class RestDataspaceExchange implements DataspaceExchange {
  constructor(private readonly transport = new LocalHubTransport()) {}

  /**
   * REST/webhook adapters call these entry points for inbound deliveries.
   * Keeping the state machine in inbound-exchange-service prevents REST from
   * accidentally bypassing idempotency and the RECEIVED → PROCESSED/FAILED
   * audit trail.
   */
  async receiveServiceRequest(
    payload: ExternalServiceRequest,
    process?: (payload: ExternalServiceRequest) => Promise<void>,
  ): Promise<import("./inbound-exchange-service").InboundProcessResult> {
    return handleIncomingServiceRequest(payload, process);
  }

  async receiveProjectInvitation(payload: ExternalProjectInvitation, process?: (payload: ExternalProjectInvitation) => Promise<void>) {
    return handleIncomingProjectInvitation(payload, process);
  }

  async receiveProjectInvitationResponse(payload: ExternalProjectInvitationResponse, process?: (payload: ExternalProjectInvitationResponse) => Promise<void>) {
    return handleIncomingProjectInvitationResponse(payload, process);
  }

  private async publishInvitation(
    payload: ExternalProjectInvitation | ExternalProjectInvitationResponse,
    messageType: "PROJECT_INVITATION" | "PROJECT_INVITATION_RESPONSE",
  ): Promise<ExchangeReference> {
    const [existing] = await db.select().from(dataspaceExchangesTable)
      .where(eq(dataspaceExchangesTable.messageId, payload.metadata.messageId)).limit(1);
    if (existing?.status === "PUBLISHED") {
      return { exchangeId: existing.messageId, externalReference: existing.externalReference ?? existing.messageId, status: "DELIVERED" };
    }
    await db.insert(dataspaceExchangesTable).values({
      direction: "OUTBOUND", messageType, messageId: payload.metadata.messageId,
      correlationId: payload.metadata.correlationId, senderOrgId: payload.metadata.senderOrgId,
      receiverOrgId: payload.metadata.receiverOrgId, businessObjectId: payload.invitationId,
      businessObjectVersion: 1, status: "CREATED",
    }).onConflictDoNothing();
    try {
      const result = await this.transport.send({
        messageId: payload.metadata.messageId,
        schemaVersion: payload.metadata.schemaVersion,
        messageType: messageType as DataspaceMessageType,
        senderOrgId: payload.metadata.senderOrgId,
        recipientOrgId: payload.metadata.receiverOrgId,
        correlationId: payload.metadata.correlationId,
        createdAt: new Date(payload.metadata.createdAt),
        causationId: null,
        payload: payload as unknown as Record<string, unknown>,
      });
      await db.update(dataspaceExchangesTable).set({
        status: result.status === "DELIVERED" ? "PUBLISHED" : "FAILED",
        externalReference: result.messageId, updatedAt: new Date(),
      }).where(eq(dataspaceExchangesTable.messageId, payload.metadata.messageId));
      return { exchangeId: result.messageId, externalReference: result.messageId, ...result };
    } catch (error) {
      await db.update(dataspaceExchangesTable).set({
        status: "FAILED", errorCode: error instanceof Error ? error.name : "TRANSPORT_FAILURE", updatedAt: new Date(),
      }).where(eq(dataspaceExchangesTable.messageId, payload.metadata.messageId));
      throw error;
    }
  }

  publishProjectInvitation(payload: ExternalProjectInvitation) {
    return this.publishInvitation(payload, "PROJECT_INVITATION");
  }

  publishProjectInvitationResponse(payload: ExternalProjectInvitationResponse) {
    return this.publishInvitation(payload, "PROJECT_INVITATION_RESPONSE");
  }

  async receiveServiceResponse(
    payload: ExternalServiceResponse,
    process?: (payload: ExternalServiceResponse) => Promise<void>,
  ): Promise<import("./inbound-exchange-service").InboundProcessResult> {
    return handleIncomingServiceResponse(payload, process);
  }

  private requestPayload(payload: ExternalServiceRequest): Record<string, unknown> {
    return {
      taktRequestId: payload.requestId,
      leistungsanfrageId: payload.requestId,
      // Legacy inbox consumers use the Takt reference while Dataspace payloads
      // call the same identifier projectReference. Keep both public aliases.
      taktReference: payload.taktReference ?? payload.projectReference,
      projectReference: payload.projectReference,
      taktVersion: payload.requestVersion,
      responseRequiredBy: null,
      plannedStart: payload.plannedStart,
      plannedEnd: payload.plannedEnd,
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
    const [existing] = await db.select().from(dataspaceExchangesTable).where(eq(dataspaceExchangesTable.messageId, payload.metadata.messageId)).limit(1);
    if (existing?.status === "PUBLISHED") {
      return { exchangeId: existing.messageId, externalReference: existing.externalReference ?? existing.messageId, status: "DELIVERED" };
    }
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
    const [existing] = await db.select().from(dataspaceExchangesTable).where(eq(dataspaceExchangesTable.messageId, payload.metadata.messageId)).limit(1);
    if (existing?.status === "PUBLISHED") {
      return { exchangeId: existing.messageId, externalReference: existing.externalReference ?? existing.messageId, status: "DELIVERED" };
    }
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