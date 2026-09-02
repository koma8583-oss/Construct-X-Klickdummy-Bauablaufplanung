import { DataspaceMessageType } from "@workspace/api-zod";
import {
  hubDb as db,
  dataspaceExchangesTable,
  messageOutboxTable,
} from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { LocalHubTransport } from "../../lib/transport/local-hub-transport";
import type { DataspaceExchange, ExchangeReference } from "./dataspace-exchange";
import type {
  ExternalCoordinationDecision,
  ExternalDataOffer,
  ExternalDataOfferResponse,
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
  handleIncomingCoordinationDecision,
  handleIncomingDataOffer,
  handleIncomingDataOfferResponse,
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
      .where(and(
        eq(dataspaceExchangesTable.direction, "OUTBOUND"),
        eq(dataspaceExchangesTable.messageId, payload.metadata.messageId),
      )).limit(1);
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
      }).where(and(
        eq(dataspaceExchangesTable.direction, "OUTBOUND"),
        eq(dataspaceExchangesTable.messageId, payload.metadata.messageId),
      ));
      return { exchangeId: result.messageId, externalReference: result.messageId, ...result };
    } catch (error) {
      await db.update(dataspaceExchangesTable).set({
        status: "FAILED", errorCode: error instanceof Error ? error.name : "TRANSPORT_FAILURE", updatedAt: new Date(),
      }).where(and(
        eq(dataspaceExchangesTable.direction, "OUTBOUND"),
        eq(dataspaceExchangesTable.messageId, payload.metadata.messageId),
      ));
      throw error;
    }
  }

  async retryProjectInvitation(messageId: string): Promise<ExchangeReference> {
    const [exchange] = await db.select().from(dataspaceExchangesTable)
      .where(and(
        eq(dataspaceExchangesTable.direction, "OUTBOUND"),
        eq(dataspaceExchangesTable.messageId, messageId),
      )).limit(1);
    if (!exchange || exchange.direction !== "OUTBOUND" ||
        !["PROJECT_INVITATION", "PROJECT_INVITATION_RESPONSE"].includes(exchange.messageType)) {
      throw new Error(`Project invitation delivery not found: ${messageId}`);
    }
    const result = await this.transport.retry(messageId);
    await db.update(dataspaceExchangesTable).set({
      status: result.status === "DELIVERED" ? "PUBLISHED" : "FAILED",
      externalReference: result.messageId,
      errorCode: result.error?.code ?? null,
      updatedAt: new Date(),
    }).where(and(
      eq(dataspaceExchangesTable.direction, "OUTBOUND"),
      eq(dataspaceExchangesTable.messageId, messageId),
    ));
    return {
      exchangeId: result.messageId,
      externalReference: result.messageId,
      status: result.status,
      sentAt: result.sentAt,
      deliveredAt: result.deliveredAt,
      attemptCount: result.attemptCount,
      error: result.error,
    };
  }

  async retryDataOffer(messageId: string): Promise<ExchangeReference> {
    const [outbox] = await db.select().from(messageOutboxTable)
      .where(eq(messageOutboxTable.messageId, messageId)).limit(1);
    if (!outbox || outbox.messageType !== "DATA_OFFER_PUBLISHED") {
      throw new Error(`Data offer delivery not found: ${messageId}`);
    }

    const result = await this.transport.retry(messageId);
    return {
      exchangeId: result.messageId,
      externalReference: result.messageId,
      status: result.status,
      sentAt: result.sentAt,
      deliveredAt: result.deliveredAt,
      attemptCount: result.attemptCount,
      error: result.error,
    };
  }

  async retryDataOfferResponse(messageId: string): Promise<ExchangeReference> {
    const [outbox] = await db.select().from(messageOutboxTable)
      .where(eq(messageOutboxTable.messageId, messageId)).limit(1);
    if (!outbox || outbox.messageType !== "DATA_OFFER_RESPONSE") {
      throw new Error(`Data offer response delivery not found: ${messageId}`);
    }
    const result = await this.transport.retry(messageId);
    return {
      exchangeId: result.messageId,
      externalReference: result.messageId,
      status: result.status,
      sentAt: result.sentAt,
      deliveredAt: result.deliveredAt,
      attemptCount: result.attemptCount,
      error: result.error,
    };
  }

  async publishDataOffer(payload: ExternalDataOffer): Promise<ExchangeReference> {
    const result = await this.transport.send({
      messageId: payload.metadata.messageId,
      schemaVersion: payload.metadata.schemaVersion,
      messageType: DataspaceMessageType.DATA_OFFER_PUBLISHED,
      senderOrgId: payload.metadata.senderOrgId,
      recipientOrgId: payload.metadata.receiverOrgId,
      correlationId: payload.metadata.correlationId,
      createdAt: new Date(payload.metadata.createdAt),
      causationId: null,
      payload: payload as unknown as Record<string, unknown>,
    });
    return {
      exchangeId: result.messageId,
      externalReference: result.messageId,
      status: result.status,
      sentAt: result.sentAt,
      deliveredAt: result.deliveredAt,
      attemptCount: result.attemptCount,
      error: result.error,
    };
  }

  async publishDataOfferResponse(payload: ExternalDataOfferResponse): Promise<ExchangeReference> {
    const result = await this.transport.send({
      messageId: payload.metadata.messageId,
      schemaVersion: payload.metadata.schemaVersion,
      messageType: DataspaceMessageType.DATA_OFFER_RESPONSE,
      senderOrgId: payload.metadata.senderOrgId,
      recipientOrgId: payload.metadata.receiverOrgId,
      correlationId: payload.metadata.correlationId,
      createdAt: new Date(payload.metadata.createdAt),
      causationId: null,
      payload: payload as unknown as Record<string, unknown>,
    });
    return {
      exchangeId: result.messageId,
      externalReference: result.messageId,
      status: result.status,
      sentAt: result.sentAt,
      deliveredAt: result.deliveredAt,
      attemptCount: result.attemptCount,
      error: result.error,
    };
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

  async receiveCoordinationDecision(
    payload: ExternalCoordinationDecision,
    process?: (payload: ExternalCoordinationDecision) => Promise<void>,
  ): Promise<import("./inbound-exchange-service").InboundProcessResult> {
    return handleIncomingCoordinationDecision(payload, process);
  }

  async receiveDataOffer(
    payload: ExternalDataOffer,
    process?: (payload: ExternalDataOffer) => Promise<void>,
  ) {
    return handleIncomingDataOffer(payload, process);
  }

  async receiveDataOfferResponse(
    payload: ExternalDataOfferResponse,
    process?: (payload: ExternalDataOfferResponse) => Promise<void>,
  ) {
    return handleIncomingDataOfferResponse(payload, process);
  }

  private requestPayload(payload: ExternalServiceRequest): Record<string, unknown> {
    return {
      taktRequestId: payload.requestId,
      leistungsanfrageId: payload.requestId,
      ...(payload.senderOrganizationName ? { senderOrganizationName: payload.senderOrganizationName } : {}),
      ...(payload.senderUserId ? { senderUserId: payload.senderUserId } : {}),
      ...(payload.comment ? { comment: payload.comment } : {}),
      // Legacy inbox consumers use the Takt reference while Dataspace payloads
      // call the same identifier projectReference. Keep both public aliases.
      taktReference: payload.taktReference ?? payload.projectReference,
      projectReference: payload.projectReference,
      ...(payload.projectName ? { projectName: payload.projectName } : {}),
      ...(payload.leistungReference ? { leistungReference: payload.leistungReference } : {}),
      taktVersion: payload.requestVersion,
      ...(payload.requestKind ? { requestKind: payload.requestKind } : {}),
      ...(payload.sourceRequestId ? { sourceRequestId: payload.sourceRequestId } : {}),
      ...(payload.changeProposalId ? { changeProposalId: payload.changeProposalId } : {}),
      ...(payload.baseTimeWindow ? { baseTimeWindow: payload.baseTimeWindow } : {}),
      responseRequiredBy: null,
      plannedStart: payload.plannedStart,
      plannedEnd: payload.plannedEnd,
      resourceRequirements: payload.resourceRequirements,
      ...(payload.publicSnapshot ? { publicSnapshot: payload.publicSnapshot } : {}),
      policy: payload.policy ?? null,
      ...(payload.policySnapshot ? { policySnapshot: payload.policySnapshot } : {}),
    };
  }

  private responsePayload(payload: ExternalServiceResponse): Record<string, unknown> {
    return {
      taktRequestId: payload.requestId,
      leistungsanfrageId: payload.requestId,
      taktVersion: payload.requestVersion,
      ...(payload.requestKind ? { requestKind: payload.requestKind } : {}),
      ...(payload.sourceRequestId ? { sourceRequestId: payload.sourceRequestId } : {}),
      ...(payload.changeProposalId ? { changeProposalId: payload.changeProposalId } : {}),
      decision: payload.decision,
      ...(payload.acceptedTimeWindow ? { acceptedTimeWindow: payload.acceptedTimeWindow } : {}),
      ...(payload.reasonCode ? { reasonCode: payload.reasonCode } : {}),
      ...(payload.comment ? { comment: payload.comment } : {}),
      alternatives: payload.alternatives ?? null,
      ...(payload.nextAvailableDate ? { nextAvailableDate: payload.nextAvailableDate } : {}),
    };
  }

  private coordinationDecisionPayload(payload: ExternalCoordinationDecision): Record<string, unknown> {
    if (payload.decisionType === "CLOSE_WITHOUT_AGREEMENT") {
      return {
        taktRequestId: payload.requestId,
        comment: payload.comment ?? null,
        closedAt: payload.closedAt,
      };
    }
    return {
      taktRequestId: payload.requestId,
      decisionType: payload.decisionType,
      acceptedAlternativeId: payload.acceptedAlternativeId ?? null,
      confirmedTimeWindow: payload.confirmedTimeWindow ?? null,
      taktVersion: payload.taktVersion,
      comment: payload.comment ?? null,
      ...(payload.closedAt ? { closedAt: payload.closedAt } : {}),
    };
  }

  async publishServiceRequest(payload: ExternalServiceRequest): Promise<ExchangeReference> {
    const [existing] = await db.select().from(dataspaceExchangesTable).where(and(
      eq(dataspaceExchangesTable.direction, "OUTBOUND"),
      eq(dataspaceExchangesTable.messageId, payload.metadata.messageId),
    )).limit(1);
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
      }).where(and(
        eq(dataspaceExchangesTable.direction, "OUTBOUND"),
        eq(dataspaceExchangesTable.messageId, payload.metadata.messageId),
      ));
    } catch (error) {
      await db.update(dataspaceExchangesTable).set({
        status: "FAILED", errorCode: error instanceof Error ? error.name : "TRANSPORT_FAILURE",
        updatedAt: new Date(),
      }).where(and(
        eq(dataspaceExchangesTable.direction, "OUTBOUND"),
        eq(dataspaceExchangesTable.messageId, payload.metadata.messageId),
      ));
      throw error;
    }
    return { exchangeId: result.messageId, externalReference: result.messageId, ...result };
  }

  async publishServiceResponse(payload: ExternalServiceResponse): Promise<ExchangeReference> {
    const [existing] = await db.select().from(dataspaceExchangesTable).where(and(
      eq(dataspaceExchangesTable.direction, "OUTBOUND"),
      eq(dataspaceExchangesTable.messageId, payload.metadata.messageId),
    )).limit(1);
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
      }).where(and(
        eq(dataspaceExchangesTable.direction, "OUTBOUND"),
        eq(dataspaceExchangesTable.messageId, payload.metadata.messageId),
      ));
    } catch (error) {
      await db.update(dataspaceExchangesTable).set({
        status: "FAILED", errorCode: error instanceof Error ? error.name : "TRANSPORT_FAILURE",
        updatedAt: new Date(),
      }).where(and(
        eq(dataspaceExchangesTable.direction, "OUTBOUND"),
        eq(dataspaceExchangesTable.messageId, payload.metadata.messageId),
      ));
      throw error;
    }
    return { exchangeId: result.messageId, externalReference: result.messageId, ...result };
  }

  async publishCoordinationDecision(payload: ExternalCoordinationDecision): Promise<ExchangeReference> {
    const messageType = payload.decisionType === "CLOSE_WITHOUT_AGREEMENT"
      ? "TAKT_REQUEST_CANCELLED" as const
      : payload.decisionType === "REQUEST_REVISION"
        ? "TAKT_RESPONSE_REVISION_REQUESTED" as const
        : "TAKT_RESPONSE_ACCEPTED" as const;
    const [existing] = await db.select().from(dataspaceExchangesTable).where(and(
      eq(dataspaceExchangesTable.direction, "OUTBOUND"),
      eq(dataspaceExchangesTable.messageId, payload.metadata.messageId),
    )).limit(1);
    if (existing?.status === "PUBLISHED") {
      return { exchangeId: existing.messageId, externalReference: existing.externalReference ?? existing.messageId, status: "DELIVERED" };
    }
    await db.insert(dataspaceExchangesTable).values({
      direction: "OUTBOUND", messageType,
      messageId: payload.metadata.messageId, correlationId: payload.metadata.correlationId,
      senderOrgId: payload.metadata.senderOrgId, receiverOrgId: payload.metadata.receiverOrgId,
      businessObjectId: payload.requestId, businessObjectVersion: payload.requestVersion,
      status: "CREATED",
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
        payload: this.coordinationDecisionPayload(payload),
      });
      await db.update(dataspaceExchangesTable).set({
        status: result.status === "DELIVERED" ? "PUBLISHED" : "FAILED",
        externalReference: result.messageId,
        errorCode: result.error?.code ?? null,
        updatedAt: new Date(),
      }).where(and(
        eq(dataspaceExchangesTable.direction, "OUTBOUND"),
        eq(dataspaceExchangesTable.messageId, payload.metadata.messageId),
      ));
      return { exchangeId: result.messageId, externalReference: result.messageId, ...result };
    } catch (error) {
      await db.update(dataspaceExchangesTable).set({
        status: "FAILED", errorCode: error instanceof Error ? error.name : "TRANSPORT_FAILURE", updatedAt: new Date(),
      }).where(and(
        eq(dataspaceExchangesTable.direction, "OUTBOUND"),
        eq(dataspaceExchangesTable.messageId, payload.metadata.messageId),
      ));
      throw error;
    }
  }

  async retryCoordinationDecision(messageId: string): Promise<ExchangeReference> {
    const [exchange] = await db.select().from(dataspaceExchangesTable).where(and(
      eq(dataspaceExchangesTable.direction, "OUTBOUND"),
      eq(dataspaceExchangesTable.messageId, messageId),
    )).limit(1);
    if (!exchange || ![
      "TAKT_RESPONSE_ACCEPTED",
      "TAKT_RESPONSE_REVISION_REQUESTED",
      "TAKT_REQUEST_CANCELLED",
    ].includes(exchange.messageType)) {
      throw new Error(`Coordination decision delivery not found: ${messageId}`);
    }
    if (exchange.status !== "FAILED") {
      throw new Error(`Message ${messageId} cannot be retried — current status is ${exchange.status}`);
    }
    const result = await this.transport.retry(messageId);
    await db.update(dataspaceExchangesTable).set({
      status: result.status === "DELIVERED" ? "PUBLISHED" : "FAILED",
      externalReference: result.messageId,
      errorCode: result.error?.code ?? null,
      updatedAt: new Date(),
    }).where(and(
      eq(dataspaceExchangesTable.direction, "OUTBOUND"),
      eq(dataspaceExchangesTable.messageId, messageId),
    ));
    return {
      exchangeId: result.messageId,
      externalReference: result.messageId,
      ...result,
    };
  }
}