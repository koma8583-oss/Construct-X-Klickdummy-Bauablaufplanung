import type { DataspaceExchange, ExchangeReference } from "./dataspace-exchange";
import {
  hubDb as db,
  messageDeliveryAttemptsTable,
  messageOutboxTable,
} from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import {
  type ExternalCoordinationDecision,
  type ExternalDataOffer,
  type ExternalDataOfferResponse,
  type ExternalProjectInvitation,
  type ExternalProjectInvitationResponse,
  type ExternalServiceRequest,
  type ExternalServiceResponse,
  serializeExternalProjectInvitation,
} from "./external-contracts";
import {
  handleIncomingServiceRequest,
  handleIncomingServiceResponse,
  handleIncomingProjectInvitation,
  handleIncomingProjectInvitationResponse,
  handleIncomingDataOffer,
  handleIncomingDataOfferResponse,
  handleIncomingCoordinationDecision,
} from "./inbound-exchange-service";
import { notificationTypeForMessageType } from "./notification-envelope";
import {
  notificationEnvelopeForConnector,
  sendNotificationOverTractusX,
} from "./tractusx-notification-client";

type CoordinationDecisionMessageType =
  | "TAKT_RESPONSE_ACCEPTED"
  | "TAKT_RESPONSE_REVISION_REQUESTED"
  | "TAKT_REQUEST_CANCELLED";

export class TractusXEdcExchange implements DataspaceExchange {
  private async publish(
    payload: ExternalServiceRequest | ExternalServiceResponse | ExternalDataOffer | ExternalDataOfferResponse,
    messageType: "SERVICE_REQUEST" | "SERVICE_RESPONSE" | "DATA_OFFER_PUBLISHED" | "DATA_OFFER_RESPONSE",
  ): Promise<ExchangeReference> {
    const metadata = payload.metadata;
    const storedMessageType = messageType === "SERVICE_REQUEST"
      ? "TAKT_REQUEST_NOTIFICATION"
      : messageType === "SERVICE_RESPONSE"
        ? "TAKT_RESPONSE_SUBMITTED"
        : messageType;
    const [existing] = await db.select().from(messageOutboxTable)
      .where(eq(messageOutboxTable.messageId, metadata.messageId)).limit(1);
    if (existing?.messageType && existing.messageType !== storedMessageType) {
      throw new Error(`Message ${metadata.messageId} conflicts with an existing message type`);
    }
    if (!existing) {
      await db.insert(messageOutboxTable).values({
        messageId: metadata.messageId,
        schemaVersion: metadata.schemaVersion,
        messageType: storedMessageType,
        senderOrgId: metadata.senderOrgId,
        recipientOrgId: metadata.receiverOrgId,
        correlationId: metadata.correlationId,
        causationId: metadata.causationId ?? null,
        payload: payload as unknown as Record<string, unknown>,
        status: "PENDING",
      }).onConflictDoNothing();
    }
    const [persisted] = await db.select().from(messageOutboxTable)
      .where(eq(messageOutboxTable.messageId, metadata.messageId)).limit(1);
    if (!persisted) throw new Error(`Could not persist notification message: ${metadata.messageId}`);
    if (persisted.status === "DELIVERED") {
      return {
        exchangeId: persisted.messageId,
        externalReference: persisted.messageId,
        status: "DELIVERED",
        sentAt: persisted.sentAt,
        deliveredAt: persisted.deliveredAt,
        attemptCount: persisted.attemptCount,
      };
    }
    return this.sendProjectMessage(
      metadata.messageId,
      storedMessageType,
      persisted.payload,
      persisted.status === "FAILED" ? "FAILED" : "PENDING",
    );
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
    messageType:
      | "PROJECT_INVITATION"
      | "PROJECT_INVITATION_RESPONSE"
      | "TAKT_REQUEST_NOTIFICATION"
      | "TAKT_RESPONSE_SUBMITTED"
      | "DATA_OFFER_PUBLISHED"
      | "DATA_OFFER_RESPONSE"
      | "TAKT_RESPONSE_ACCEPTED"
      | "TAKT_RESPONSE_REVISION_REQUESTED"
      | "TAKT_REQUEST_CANCELLED",
    payload: Record<string, unknown>,
    expectedStatus: "PENDING" | "FAILED",
  ): Promise<ExchangeReference> {
    const [outboxRow] = await db.select().from(messageOutboxTable)
      .where(eq(messageOutboxTable.messageId, messageId)).limit(1);
    if (!outboxRow) throw new Error(`Notification delivery not found: ${messageId}`);
    if (outboxRow.status !== expectedStatus) {
      throw new Error(`Message ${messageId} cannot be retried — current status is ${outboxRow.status}`);
    }
    const now = new Date();
    const claimed = await this.claimDeliveryAttempt(outboxRow.id, expectedStatus, now);
    const attemptCount = claimed.attemptCount;

    try {
      const outboundPayload = messageType === "PROJECT_INVITATION"
        ? serializeExternalProjectInvitation(payload as unknown as ExternalProjectInvitation)
        : payload;
      const externalPayload = { ...outboundPayload } as Record<string, unknown>;
      const metadata = externalPayload.metadata as {
        createdAt: string;
        correlationId: string;
        senderOrgId: string;
        receiverOrgId: string;
        expectedResponseBy?: string;
        causationId?: string | null;
      };
      delete externalPayload.metadata;
      const envelope = notificationEnvelopeForConnector({
        messageId,
        messageType: notificationTypeForMessageType(messageType, externalPayload),
        sentDateTime: metadata.createdAt,
        expectedResponseBy: metadata.expectedResponseBy,
        relatedMessageId: metadata.causationId ?? undefined,
        senderOrgId: metadata.senderOrgId,
        receiverOrgId: metadata.receiverOrgId,
        content: { correlationId: metadata.correlationId, ...externalPayload },
      });
      const body = await sendNotificationOverTractusX(envelope);
      const deliveredAt = new Date();
      const [updated] = await db.update(messageOutboxTable).set({
        status: "DELIVERED",
        lastAttemptAt: now,
        deliveredAt,
        failureReason: null,
      }).where(eq(messageOutboxTable.id, outboxRow.id)).returning();
      await db.insert(messageDeliveryAttemptsTable).values({
        messageId,
        attemptNumber: attemptCount,
        status: "DELIVERED",
        attemptedAt: now,
      }).onConflictDoNothing();
      return {
        exchangeId: messageId,
        externalReference: body.externalReference,
        status: "DELIVERED",
        sentAt: updated?.sentAt ?? now,
        deliveredAt: updated?.deliveredAt ?? deliveredAt,
        attemptCount: updated?.attemptCount ?? attemptCount,
      };
    } catch (error) {
      const failureReason = error instanceof Error ? error.message : String(error);
      await db.update(messageOutboxTable).set({
        status: "FAILED",
        lastAttemptAt: now,
        failureReason,
      }).where(eq(messageOutboxTable.id, outboxRow.id));
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
    if (!["PROJECT_INVITATION", "PROJECT_INVITATION_RESPONSE"].includes(row.messageType)) {
      throw new Error(`Project invitation delivery not found: ${messageId}`);
    }
    if (row.status !== "FAILED") throw new Error(`Message ${messageId} cannot be retried — current status is ${row.status}`);
    const messageType = row.messageType as "PROJECT_INVITATION" | "PROJECT_INVITATION_RESPONSE";
    return this.sendProjectMessage(
      messageId,
      messageType,
      row.payload,
      "FAILED",
    );
  }
  async retryDataOffer(messageId: string): Promise<ExchangeReference> {
    const [row] = await db.select().from(messageOutboxTable)
      .where(eq(messageOutboxTable.messageId, messageId)).limit(1);
    if (!row || row.messageType !== "DATA_OFFER_PUBLISHED") {
      throw new Error(`Data offer delivery not found: ${messageId}`);
    }
    if (row.status !== "FAILED") {
      throw new Error(`Message ${messageId} cannot be retried — current status is ${row.status}`);
    }
    return this.sendProjectMessage(messageId, "DATA_OFFER_PUBLISHED", row.payload, "FAILED");
  }

  async retryDataOfferResponse(messageId: string): Promise<ExchangeReference> {
    const [row] = await db.select().from(messageOutboxTable)
      .where(eq(messageOutboxTable.messageId, messageId)).limit(1);
    if (!row || row.messageType !== "DATA_OFFER_RESPONSE") {
      throw new Error(`Data offer response delivery not found: ${messageId}`);
    }
    if (row.status !== "FAILED") {
      throw new Error(`Message ${messageId} cannot be retried — current status is ${row.status}`);
    }
    return this.sendProjectMessage(messageId, "DATA_OFFER_RESPONSE", row.payload, "FAILED");
  }

  async publishDataOffer(payload: ExternalDataOffer): Promise<ExchangeReference> {
    return this.publish(payload, "DATA_OFFER_PUBLISHED");
  }

  async publishDataOfferResponse(payload: ExternalDataOfferResponse): Promise<ExchangeReference> {
    return this.publish(payload, "DATA_OFFER_RESPONSE");
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
        return this.sendProjectMessage(row.messageId, messageType, row.payload, "FAILED");
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
    return this.sendProjectMessage(row.messageId, messageType, row.payload, "PENDING");
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
    return this.sendProjectMessage(row.messageId, row.messageType as CoordinationDecisionMessageType, row.payload, "FAILED");
  }

  receiveProjectInvitation(payload: ExternalProjectInvitation, process?: (payload: ExternalProjectInvitation) => Promise<void>) {
    return handleIncomingProjectInvitation(payload, process);
  }
  receiveProjectInvitationResponse(payload: ExternalProjectInvitationResponse, process?: (payload: ExternalProjectInvitationResponse) => Promise<void>) {
    return handleIncomingProjectInvitationResponse(payload, process);
  }
  receiveDataOffer(payload: ExternalDataOffer, process?: (payload: ExternalDataOffer) => Promise<void>) {
    return handleIncomingDataOffer(payload, process);
  }
  receiveDataOfferResponse(payload: ExternalDataOfferResponse, process?: (payload: ExternalDataOfferResponse) => Promise<void>) {
    return handleIncomingDataOfferResponse(payload, process);
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