import type { DataspaceExchange, ExchangeReference } from "./dataspace-exchange";
import {
  hubDb as db,
  messageDeliveryAttemptsTable,
  messageOutboxTable,
} from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import {
  serializeExternalProjectInvitation,
  type ExternalCoordinationDecision,
  type ExternalProjectInvitation,
  type ExternalProjectInvitationResponse,
  type ExternalServiceRequest,
  type ExternalServiceResponse,
} from "./external-contracts";
import {
  handleIncomingServiceRequest,
  handleIncomingServiceResponse,
  handleIncomingProjectInvitation,
  handleIncomingProjectInvitationResponse,
  handleIncomingCoordinationDecision,
} from "./inbound-exchange-service";

type CoordinationDecisionMessageType =
  | "TAKT_RESPONSE_ACCEPTED"
  | "TAKT_RESPONSE_REVISION_REQUESTED"
  | "TAKT_REQUEST_CANCELLED";

export class TractusXEdcExchange implements DataspaceExchange {
  private async publish(payload: ExternalProjectInvitation | ExternalProjectInvitationResponse | ExternalServiceRequest | ExternalServiceResponse | ExternalCoordinationDecision, messageType: string): Promise<ExchangeReference> {
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
    return this.sendProjectMessage(
      messageId,
      messageType,
      payload as unknown as Record<string, unknown>,
      existing?.status === "FAILED" ? "FAILED" : "PENDING",
    );
  }

  private async claimDeliveryAttempt(
    rowId: string,
    expectedStatus: "PENDING" | "FAILED",
    now: Date,
  ): Promise<typeof messageOutboxTable.$inferSelect> {
    const [claimed] = await db.update(messageOutboxTable).set({
      status: "SENT",
      attemptCount: sql<number>`${messageOutboxTable.attemptCount} + 1`,
      sentAt: now,
      lastAttemptAt: now,
      failureReason: null,
    }).where(and(
      eq(messageOutboxTable.id, rowId),
      eq(messageOutboxTable.status, expectedStatus),
    )).returning();

    if (claimed) return claimed;

    const [current] = await db.select().from(messageOutboxTable)
      .where(eq(messageOutboxTable.id, rowId)).limit(1);
    if (!current) throw new Error(`Message delivery not found: ${rowId}`);
    throw new Error(
      `Message ${current.messageId} cannot be retried — current status is ${current.status}`,
    );
  }

  private async sendProjectMessage(
    messageId: string,
    messageType: "PROJECT_INVITATION" | "PROJECT_INVITATION_RESPONSE",
    payload: Record<string, unknown>,
    expectedStatus: "PENDING" | "FAILED",
  ): Promise<ExchangeReference> {
    const endpoint = process.env.DATASPACE_CONNECTOR_URL;
    if (!endpoint) throw new Error("Tractus-X EDC adapter not configured: DATASPACE_CONNECTOR_URL is required");
    const now = new Date();
    const [outboxRow] = await db.select().from(messageOutboxTable)
      .where(eq(messageOutboxTable.messageId, messageId)).limit(1);
    if (!outboxRow) throw new Error(`Project invitation delivery not found: ${messageId}`);
    const claimed = await this.claimDeliveryAttempt(outboxRow.id, expectedStatus, now);
    const attemptCount = claimed.attemptCount;
    try {
      const outboundPayload = messageType === "PROJECT_INVITATION"
        ? serializeExternalProjectInvitation(payload as unknown as ExternalProjectInvitation)
        : payload;
      const response = await fetch(`${endpoint.replace(/\/$/, "")}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json", ...(process.env.DATASPACE_CONNECTOR_TOKEN ? { authorization: `Bearer ${process.env.DATASPACE_CONNECTOR_TOKEN}` } : {}) },
        body: JSON.stringify({ messageType, payload }),
      });
      if (!response.ok) throw new Error(`Dataspace connector returned HTTP ${response.status}`);
      const body = await response.json().catch(() => ({})) as { messageId?: string; externalReference?: string };
      const [row] = await db.update(messageOutboxTable).set({
        status: "DELIVERED", attemptCount, sentAt: now, lastAttemptAt: now,
        deliveredAt: new Date(), failureReason: null,
      }).where(eq(messageOutboxTable.messageId, messageId)).returning();
      await db.insert(messageDeliveryAttemptsTable).values({
        messageId,
        attemptNumber: attemptCount,
        status: "DELIVERED",
        attemptedAt: now,
      }).onConflictDoNothing();
      return { exchangeId: body.messageId ?? messageId, externalReference: body.externalReference ?? messageId,
        status: "DELIVERED", sentAt: row.sentAt, deliveredAt: row.deliveredAt, attemptCount: row.attemptCount };
    } catch (error) {
      const failureReason = error instanceof Error ? error.message : String(error);
      await db.update(messageOutboxTable).set({
        status: "FAILED", attemptCount, lastAttemptAt: now,
        failureReason,
      }).where(eq(messageOutboxTable.messageId, messageId));
      await db.insert(messageDeliveryAttemptsTable).values({
        messageId,
        attemptNumber: attemptCount,
        status: "FAILED",
        attemptedAt: now,
        failureReason,
      }).onConflictDoNothing();
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
    const claimed = await this.claimDeliveryAttempt(row.id, "FAILED", now);
    const attemptCount = claimed.attemptCount;
    try {
      const endpoint = process.env.DATASPACE_CONNECTOR_URL;
      if (!endpoint) throw new Error("Tractus-X EDC adapter not configured: DATASPACE_CONNECTOR_URL is required");
      const outboundPayload = row.messageType === "PROJECT_INVITATION"
        ? serializeExternalProjectInvitation(row.payload as unknown as ExternalProjectInvitation)
        : row.payload;
      const response = await fetch(`${endpoint.replace(/\/$/, "")}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json", ...(process.env.DATASPACE_CONNECTOR_TOKEN ? { authorization: `Bearer ${process.env.DATASPACE_CONNECTOR_TOKEN}` } : {}) },
        body: JSON.stringify({ messageType: row.messageType, payload: outboundPayload }),
      });
      if (!response.ok) throw new Error(`Dataspace connector returned HTTP ${response.status}`);
      const body = await response.json().catch(() => ({})) as { externalReference?: string };
      const [updated] = await db.update(messageOutboxTable).set({
        status: "DELIVERED", deliveredAt: new Date(),
      }).where(eq(messageOutboxTable.id, row.id)).returning();
      await db.insert(messageDeliveryAttemptsTable).values({
        messageId,
        attemptNumber: attemptCount,
        status: "DELIVERED",
        attemptedAt: now,
      }).onConflictDoNothing();
      return { exchangeId: messageId, externalReference: body.externalReference ?? messageId,
        status: "DELIVERED", sentAt: updated.sentAt, deliveredAt: updated.deliveredAt, attemptCount: updated.attemptCount };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      const [updated] = await db.update(messageOutboxTable).set({
        status: "FAILED", failureReason: reason,
      }).where(eq(messageOutboxTable.id, row.id)).returning();
      await db.insert(messageDeliveryAttemptsTable).values({
        messageId,
        attemptNumber: attemptCount,
        status: "FAILED",
        attemptedAt: now,
        failureReason: reason,
      }).onConflictDoNothing();
      return { exchangeId: messageId, status: "FAILED", sentAt: updated.sentAt,
        deliveredAt: updated.deliveredAt, attemptCount: updated.attemptCount,
        error: { code: "TRANSPORT_FAILURE", message: reason } };
    }
  }
  async retryDataOffer(messageId: string): Promise<ExchangeReference> {
    const [row] = await db.select().from(messageOutboxTable)
      .where(eq(messageOutboxTable.messageId, messageId)).limit(1);
    if (!row || row.messageType !== "DATA_OFFER_PUBLISHED") {
      throw new Error(`Data offer delivery not found: ${messageId}`);
    }
    return this.retryProjectInvitation(messageId);
  }

  async publishServiceRequest(payload: ExternalServiceRequest): Promise<ExchangeReference> {
    return this.publish(payload, "SERVICE_REQUEST");
  }

  async publishServiceResponse(payload: ExternalServiceResponse): Promise<ExchangeReference> {
    return this.publish(payload, "SERVICE_RESPONSE");
  }

  private coordinationDecisionMessageType(
    payload: ExternalCoordinationDecision,
  ): CoordinationDecisionMessageType {
    return payload.decisionType === "CLOSE_WITHOUT_AGREEMENT"
      ? "TAKT_REQUEST_CANCELLED"
      : payload.decisionType === "REQUEST_REVISION"
        ? "TAKT_RESPONSE_REVISION_REQUESTED"
        : "TAKT_RESPONSE_ACCEPTED";
  }

  private async sendPersistedCoordinationDecision(
    row: typeof messageOutboxTable.$inferSelect,
    throwOnFailure: boolean,
  ): Promise<ExchangeReference> {
    const now = new Date();
    const claimed = await this.claimDeliveryAttempt(
      row.id,
      row.status === "FAILED" ? "FAILED" : "PENDING",
      now,
    );
    const attemptCount = claimed.attemptCount;

    try {
      const endpoint = process.env.DATASPACE_CONNECTOR_URL;
      if (!endpoint) {
        throw new Error("Tractus-X EDC adapter not configured: DATASPACE_CONNECTOR_URL is required");
      }
      const response = await fetch(`${endpoint.replace(/\/$/, "")}/messages`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(process.env.DATASPACE_CONNECTOR_TOKEN
            ? { authorization: `Bearer ${process.env.DATASPACE_CONNECTOR_TOKEN}` }
            : {}),
        },
        // Always use the persisted public payload. A retry must not rebuild it
        // from current domain state or change its messageId.
        body: JSON.stringify({
          messageType: row.messageType,
          payload: row.payload,
        }),
      });
      if (!response.ok) {
        throw new Error(`Dataspace connector returned HTTP ${response.status}`);
      }
      const body = await response.json().catch(() => ({})) as {
        externalReference?: string;
      };
      const deliveredAt = new Date();
      const [updated] = await db.update(messageOutboxTable).set({
        status: "DELIVERED",
        deliveredAt,
        failureReason: null,
      }).where(eq(messageOutboxTable.id, row.id)).returning();
      const result: ExchangeReference = {
        exchangeId: row.messageId,
        externalReference: body.externalReference ?? row.messageId,
        status: "DELIVERED",
        sentAt: updated?.sentAt ?? now,
        deliveredAt: updated?.deliveredAt ?? deliveredAt,
        attemptCount: updated?.attemptCount ?? attemptCount,
      };
      return result;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      const [updated] = await db.update(messageOutboxTable).set({
        status: "FAILED",
        failureReason: reason,
      }).where(eq(messageOutboxTable.id, row.id)).returning();
      const result: ExchangeReference = {
        exchangeId: row.messageId,
        status: "FAILED",
        sentAt: updated?.sentAt ?? now,
        deliveredAt: updated?.deliveredAt ?? null,
        attemptCount: updated?.attemptCount ?? attemptCount,
        error: { code: "TRANSPORT_FAILURE", message: reason },
      };
      if (throwOnFailure) {
        throw error;
      }
      return result;
    }
  }

  async publishCoordinationDecision(payload: ExternalCoordinationDecision): Promise<ExchangeReference> {
    const messageType = this.coordinationDecisionMessageType(payload);
    const messageId = payload.metadata.messageId;
    let [row] = await db.select().from(messageOutboxTable)
      .where(eq(messageOutboxTable.messageId, messageId))
      .limit(1);

    if (row) {
      if (row.messageType !== messageType) {
        throw new Error(`Message ${messageId} conflicts with an existing message type`);
      }
      if (row.status === "DELIVERED") {
        return {
          exchangeId: row.messageId,
          externalReference: row.messageId,
          status: "DELIVERED",
          sentAt: row.sentAt,
          deliveredAt: row.deliveredAt,
          attemptCount: row.attemptCount,
        };
      }
      if (row.status === "FAILED") {
        return this.sendPersistedCoordinationDecision(row, false);
      }
      if (row.status === "SENT") {
        return {
          exchangeId: row.messageId,
          status: row.status,
          sentAt: row.sentAt,
          deliveredAt: row.deliveredAt,
          attemptCount: row.attemptCount,
        };
      }
    } else {
      [row] = await db.insert(messageOutboxTable).values({
        messageId,
        schemaVersion: payload.metadata.schemaVersion,
        messageType,
        senderOrgId: payload.metadata.senderOrgId,
        recipientOrgId: payload.metadata.receiverOrgId,
        correlationId: payload.metadata.correlationId,
        causationId: null,
        payload: payload as unknown as Record<string, unknown>,
        status: "PENDING",
      }).onConflictDoNothing().returning();

      // Another publisher may have inserted the same message between the
      // select and insert. Use its persisted payload rather than this call's
      // potentially reconstructed payload.
      if (!row) {
        [row] = await db.select().from(messageOutboxTable)
          .where(eq(messageOutboxTable.messageId, messageId))
          .limit(1);
      }
    }

    if (!row) {
      throw new Error(`Could not persist coordination decision message: ${messageId}`);
    }
    if (row.messageType !== messageType) {
      throw new Error(`Message ${messageId} conflicts with an existing message type`);
    }
    return this.sendPersistedCoordinationDecision(row, true);
  }

  async retryCoordinationDecision(messageId: string): Promise<ExchangeReference> {
    const [row] = await db.select().from(messageOutboxTable)
      .where(eq(messageOutboxTable.messageId, messageId))
      .limit(1);
    if (!row || ![
      "TAKT_RESPONSE_ACCEPTED",
      "TAKT_RESPONSE_REVISION_REQUESTED",
      "TAKT_REQUEST_CANCELLED",
    ].includes(row.messageType)) {
      throw new Error(`Coordination decision delivery not found: ${messageId}`);
    }
    if (row.status !== "FAILED") {
      throw new Error(`Message ${messageId} cannot be retried — current status is ${row.status}`);
    }
    return this.sendPersistedCoordinationDecision(row, false);
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
  async receiveCoordinationDecision(
    payload: ExternalCoordinationDecision,
    process?: (payload: ExternalCoordinationDecision) => Promise<void>,
  ): Promise<import("./inbound-exchange-service").InboundProcessResult> {
    return handleIncomingCoordinationDecision(payload, process);
  }
}