import type { DataspaceExchange, ExchangeReference } from "./dataspace-exchange";
import { hubDb as db, messageOutboxTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import type { ExternalProjectInvitation, ExternalProjectInvitationResponse, ExternalServiceRequest, ExternalServiceResponse } from "./external-contracts";
import {
  handleIncomingServiceRequest,
  handleIncomingServiceResponse,
  handleIncomingProjectInvitation,
  handleIncomingProjectInvitationResponse,
} from "./inbound-exchange-service";

export class TractusXEdcExchange implements DataspaceExchange {
  private async publish(payload: ExternalProjectInvitation | ExternalProjectInvitationResponse | ExternalServiceRequest | ExternalServiceResponse, messageType: string): Promise<ExchangeReference> {
    const endpoint = process.env.DATASPACE_CONNECTOR_URL;
    if (!endpoint) throw new Error("Tractus-X EDC adapter not configured: DATASPACE_CONNECTOR_URL is required");
    const response = await fetch(`${endpoint.replace(/\/$/, "")}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(process.env.DATASPACE_CONNECTOR_TOKEN ? { authorization: `Bearer ${process.env.DATASPACE_CONNECTOR_TOKEN}` } : {}) },
      body: JSON.stringify({ messageType, payload }),
    });
    if (!response.ok) throw new Error(`Dataspace connector returned HTTP ${response.status}`);
    const body = await response.json().catch(() => ({})) as { messageId?: string; externalReference?: string };
    const messageId = body.messageId ?? payload.metadata.messageId;
    return { exchangeId: messageId, externalReference: body.externalReference ?? messageId, status: "DELIVERED", sentAt: new Date(), deliveredAt: new Date(), attemptCount: 1 };
  }

  private async publishProjectMessage(
    payload: ExternalProjectInvitation | ExternalProjectInvitationResponse,
    messageType: "PROJECT_INVITATION" | "PROJECT_INVITATION_RESPONSE",
  ): Promise<ExchangeReference> {
    const messageId = payload.metadata.messageId;
    const [existing] = await db.select().from(messageOutboxTable)
      .where(eq(messageOutboxTable.messageId, messageId)).limit(1);
    if (existing?.status === "DELIVERED") {
      return { exchangeId: messageId, externalReference: messageId, status: "DELIVERED",
        sentAt: existing.sentAt, deliveredAt: existing.deliveredAt, attemptCount: existing.attemptCount };
    }
    if (!existing) {
      await db.insert(messageOutboxTable).values({
        messageId, schemaVersion: payload.metadata.schemaVersion,
        messageType, senderOrgId: payload.metadata.senderOrgId,
        recipientOrgId: payload.metadata.receiverOrgId,
        correlationId: payload.metadata.correlationId, causationId: null,
        payload: payload as unknown as Record<string, unknown>, status: "PENDING",
      });
    }
    return this.sendProjectMessage(messageId, messageType, payload as unknown as Record<string, unknown>);
  }

  private async sendProjectMessage(
    messageId: string,
    messageType: "PROJECT_INVITATION" | "PROJECT_INVITATION_RESPONSE",
    payload: Record<string, unknown>,
  ): Promise<ExchangeReference> {
    const endpoint = process.env.DATASPACE_CONNECTOR_URL;
    if (!endpoint) throw new Error("Tractus-X EDC adapter not configured: DATASPACE_CONNECTOR_URL is required");
    const now = new Date();
    try {
      const response = await fetch(`${endpoint.replace(/\/$/, "")}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json", ...(process.env.DATASPACE_CONNECTOR_TOKEN ? { authorization: `Bearer ${process.env.DATASPACE_CONNECTOR_TOKEN}` } : {}) },
        body: JSON.stringify({ messageType, payload }),
      });
      if (!response.ok) throw new Error(`Dataspace connector returned HTTP ${response.status}`);
      const body = await response.json().catch(() => ({})) as { messageId?: string; externalReference?: string };
      const [row] = await db.update(messageOutboxTable).set({
        status: "DELIVERED", attemptCount: 1, sentAt: now, lastAttemptAt: now,
        deliveredAt: new Date(), failureReason: null,
      }).where(eq(messageOutboxTable.messageId, messageId)).returning();
      return { exchangeId: body.messageId ?? messageId, externalReference: body.externalReference ?? messageId,
        status: "DELIVERED", sentAt: row.sentAt, deliveredAt: row.deliveredAt, attemptCount: row.attemptCount };
    } catch (error) {
      await db.update(messageOutboxTable).set({
        status: "FAILED", attemptCount: 1, lastAttemptAt: now,
        failureReason: error instanceof Error ? error.message : String(error),
      }).where(eq(messageOutboxTable.messageId, messageId));
      throw error;
    }
  }

  publishProjectInvitation(payload: ExternalProjectInvitation) {
    return this.publishProjectMessage(payload, "PROJECT_INVITATION");
  }
  publishProjectInvitationResponse(payload: ExternalProjectInvitationResponse) {
    return this.publishProjectMessage(payload, "PROJECT_INVITATION_RESPONSE");
  }
  async retryProjectInvitation(messageId: string): Promise<ExchangeReference> {
    const [row] = await db.select().from(messageOutboxTable)
      .where(eq(messageOutboxTable.messageId, messageId)).limit(1);
    if (!row) throw new Error(`Project invitation delivery not found: ${messageId}`);
    if (row.status !== "FAILED") throw new Error(`Message ${messageId} cannot be retried — current status is ${row.status}`);
    const now = new Date();
    const attemptCount = row.attemptCount + 1;
    await db.update(messageOutboxTable).set({
      status: "SENT", attemptCount, sentAt: now, lastAttemptAt: now, failureReason: null,
    }).where(eq(messageOutboxTable.id, row.id));
    try {
      const endpoint = process.env.DATASPACE_CONNECTOR_URL;
      if (!endpoint) throw new Error("Tractus-X EDC adapter not configured: DATASPACE_CONNECTOR_URL is required");
      const response = await fetch(`${endpoint.replace(/\/$/, "")}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json", ...(process.env.DATASPACE_CONNECTOR_TOKEN ? { authorization: `Bearer ${process.env.DATASPACE_CONNECTOR_TOKEN}` } : {}) },
        body: JSON.stringify({ messageType: row.messageType, payload: row.payload }),
      });
      if (!response.ok) throw new Error(`Dataspace connector returned HTTP ${response.status}`);
      const body = await response.json().catch(() => ({})) as { externalReference?: string };
      const [updated] = await db.update(messageOutboxTable).set({
        status: "DELIVERED", deliveredAt: new Date(),
      }).where(eq(messageOutboxTable.id, row.id)).returning();
      return { exchangeId: messageId, externalReference: body.externalReference ?? messageId,
        status: "DELIVERED", sentAt: updated.sentAt, deliveredAt: updated.deliveredAt, attemptCount: updated.attemptCount };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      const [updated] = await db.update(messageOutboxTable).set({
        status: "FAILED", failureReason: reason,
      }).where(eq(messageOutboxTable.id, row.id)).returning();
      return { exchangeId: messageId, status: "FAILED", sentAt: updated.sentAt,
        deliveredAt: updated.deliveredAt, attemptCount: updated.attemptCount,
        error: { code: "TRANSPORT_FAILURE", message: reason } };
    }
  }
  async publishServiceRequest(payload: ExternalServiceRequest): Promise<ExchangeReference> {
    return this.publish(payload, "SERVICE_REQUEST");
  }

  async publishServiceResponse(payload: ExternalServiceResponse): Promise<ExchangeReference> {
    return this.publish(payload, "SERVICE_RESPONSE");
  }

  receiveProjectInvitation(payload: ExternalProjectInvitation, process?: (payload: ExternalProjectInvitation) => Promise<void>) {
    return handleIncomingProjectInvitation(payload, process);
  }
  receiveProjectInvitationResponse(payload: ExternalProjectInvitationResponse, process?: (payload: ExternalProjectInvitationResponse) => Promise<void>) {
    return handleIncomingProjectInvitationResponse(payload, process);
  }

  async receiveServiceRequest(
    payload: ExternalServiceRequest,
    process?: (payload: ExternalServiceRequest) => Promise<void>,
  ): Promise<import("./inbound-exchange-service").InboundProcessResult> {
    return handleIncomingServiceRequest(payload, process);
  }

  async receiveServiceResponse(
    payload: ExternalServiceResponse,
    process?: (payload: ExternalServiceResponse) => Promise<void>,
  ): Promise<import("./inbound-exchange-service").InboundProcessResult> {
    return handleIncomingServiceResponse(payload, process);
  }
}