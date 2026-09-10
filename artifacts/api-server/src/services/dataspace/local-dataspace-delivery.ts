import type { DataspaceExchange, ExchangeReference } from "./dataspace-exchange";
import { hubDb, messageOutboxTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { createDataspaceExchange } from "./dataspace-exchange-factory";
import {
  processIncomingCoordinationDecision,
  processIncomingProjectInvitation,
  processIncomingProjectInvitationResponse,
  processIncomingServiceRequest,
  processIncomingServiceResponse,
} from "./inbound-domain-service";
import type {
  ExternalCoordinationDecision,
  ExternalDataOffer,
  ExternalDataOfferResponse,
  ExternalProjectInvitation,
  ExternalProjectInvitationResponse,
  ExternalServiceRequest,
  ExternalServiceResponse,
} from "./external-contracts";
import { handleIncomingCoordinationDecision } from "./inbound-exchange-service";
import {
  processIncomingDataOffer,
  processIncomingDataOfferResponse,
} from "./inbound-domain-service";
import { getHubOutboxMessage } from "../hub-transport-service";

/**
 * `rest` (and the unset value) is the local in-process PoC transport in
 * non-production environments.
 * The Tractus-X adapter represents a real external delivery and must not loop
 * back into this process after publishing.
 */
export function isLocalDataspaceTransport(): boolean {
  return process.env.NODE_ENV !== "production" && (
    !process.env.DATASPACE_TRANSPORT ||
    process.env.DATASPACE_TRANSPORT === "local" ||
    process.env.DATASPACE_TRANSPORT === "rest"
  );
}

function wasTechnicallyDelivered(reference: ExchangeReference): boolean {
  return reference.status === "DELIVERED";
}

async function markLocalDeliveryFailed(messageId: string, error: unknown): Promise<void> {
  await hubDb.update(messageOutboxTable).set({
    status: "FAILED",
    failureReason: error instanceof Error ? error.message : String(error),
  }).where(eq(messageOutboxTable.messageId, messageId));
}

export async function deliverLocalServiceRequest(
  payload: ExternalServiceRequest,
  exchange: DataspaceExchange = createDataspaceExchange(),
): Promise<ExchangeReference> {
  const delivery = await exchange.publishServiceRequest(payload);
  if (isLocalDataspaceTransport() && wasTechnicallyDelivered(delivery)) {
    await exchange.receiveServiceRequest(
      payload,
      (incoming) => processIncomingServiceRequest(incoming, undefined, { automaticResponse: false }),
    );
  }
  return delivery;
}

export async function deliverLocalServiceResponse(
  payload: ExternalServiceResponse,
  exchange: DataspaceExchange = createDataspaceExchange(),
): Promise<ExchangeReference> {
  const delivery = await exchange.publishServiceResponse(payload);
  if (isLocalDataspaceTransport() && wasTechnicallyDelivered(delivery)) {
    await exchange.receiveServiceResponse(payload, processIncomingServiceResponse);
  }
  return delivery;
}

/**
 * Publish an AG decision through the same Dataspace abstraction as service
 * requests. Only local adapters re-enter the AN inbound processor.
 */
export async function deliverLocalCoordinationDecision(
  payload: ExternalCoordinationDecision,
  exchange: DataspaceExchange = createDataspaceExchange(),
): Promise<ExchangeReference> {
  const delivery = await exchange.publishCoordinationDecision(payload);
  if (isLocalDataspaceTransport() && wasTechnicallyDelivered(delivery)) {
    await exchange.receiveCoordinationDecision(payload, processIncomingCoordinationDecision);
  }
  return delivery;
}

/**
 * Retry a coordination decision without creating another domain decision.
 *
 * Local transports also re-enter the AN processor after a successful retry so
 * a failed first delivery has the same behavior as the original delivery.
 * The caller must supply the original public envelope; the exchange itself
 * uses the persisted outbox payload when it claims the retry.
 */
export async function retryLocalCoordinationDecision(
  payload: ExternalCoordinationDecision,
  exchange: DataspaceExchange = createDataspaceExchange(),
): Promise<ExchangeReference> {
  const delivery = await exchange.retryCoordinationDecision(payload.metadata.messageId);
  if (isLocalDataspaceTransport() && wasTechnicallyDelivered(delivery)) {
    // The exchange claims the persisted outbox row. Use that same public
    // envelope for the local inbound handoff instead of rebuilding a possibly
    // changed time window from current AG/AN rows.
    const persisted = await getHubOutboxMessage(payload.metadata.messageId);
    const persistedPayload = persisted?.payload;
    const inboundPayload = persistedPayload
      ? mergePersistedCoordinationPayload(payload, persistedPayload)
      : payload;
    await exchange.receiveCoordinationDecision(inboundPayload, processIncomingCoordinationDecision);
  }
  return delivery;
}

function mergePersistedCoordinationPayload(
  fallback: ExternalCoordinationDecision,
  persisted: Record<string, unknown>,
): ExternalCoordinationDecision {
  const payload = { ...fallback };
  if (typeof persisted.taktRequestId === "string") {
    payload.requestId = persisted.taktRequestId;
  }
  if (typeof persisted.decisionType === "string") {
    payload.decisionType = persisted.decisionType as ExternalCoordinationDecision["decisionType"];
  }
  if (Object.prototype.hasOwnProperty.call(persisted, "acceptedAlternativeId")) {
    payload.acceptedAlternativeId =
      typeof persisted.acceptedAlternativeId === "string"
        ? persisted.acceptedAlternativeId
        : null;
  }
  if (Object.prototype.hasOwnProperty.call(persisted, "confirmedTimeWindow")) {
    payload.confirmedTimeWindow =
      persisted.confirmedTimeWindow && typeof persisted.confirmedTimeWindow === "object"
        ? persisted.confirmedTimeWindow as { start: string; end: string }
        : null;
  }
  if (typeof persisted.taktVersion === "number") {
    payload.taktVersion = persisted.taktVersion;
  }
  if (Object.prototype.hasOwnProperty.call(persisted, "comment")) {
    payload.comment = typeof persisted.comment === "string" ? persisted.comment : null;
  }
  if (typeof persisted.closedAt === "string") {
    payload.closedAt = persisted.closedAt;
  }
  return payload;
}

export async function deliverLocalProjectInvitation(
  payload: ExternalProjectInvitation,
  exchange: DataspaceExchange = createDataspaceExchange(),
): Promise<ExchangeReference> {
  const delivery = await exchange.publishProjectInvitation(payload);
  if (isLocalDataspaceTransport() && wasTechnicallyDelivered(delivery)) {
    await exchange.receiveProjectInvitation(payload, processIncomingProjectInvitation);
  }
  return delivery;
}

export async function deliverLocalProjectInvitationResponse(
  payload: ExternalProjectInvitationResponse,
  exchange: DataspaceExchange = createDataspaceExchange(),
): Promise<ExchangeReference> {
  const delivery = await exchange.publishProjectInvitationResponse(payload);
  if (isLocalDataspaceTransport() && wasTechnicallyDelivered(delivery)) {
    await exchange.receiveProjectInvitationResponse(
      payload,
      processIncomingProjectInvitationResponse,
    );
  }
  return delivery;
}

export async function deliverLocalDataOffer(
  payload: ExternalDataOffer,
  exchange: DataspaceExchange = createDataspaceExchange(),
  localContentSnapshot?: Record<string, unknown>,
): Promise<ExchangeReference> {
  const delivery = await exchange.publishDataOffer(payload);
  if (isLocalDataspaceTransport() && wasTechnicallyDelivered(delivery)) {
    const localPayload = localContentSnapshot
      ? { ...payload, contentSnapshot: localContentSnapshot }
      : payload;
    try {
      await exchange.receiveDataOffer(localPayload, processIncomingDataOffer);
    } catch (error) {
      // Technical transport delivery and domain projection are separate
      // concerns. A rejected projection must leave the outbox retryable.
      await markLocalDeliveryFailed(payload.metadata.messageId, error);
      throw error;
    }
  }
  return delivery;
}

export async function deliverLocalDataOfferResponse(
  payload: ExternalDataOfferResponse,
  exchange: DataspaceExchange = createDataspaceExchange(),
): Promise<ExchangeReference> {
  const delivery = await exchange.publishDataOfferResponse(payload);
  if (isLocalDataspaceTransport() && wasTechnicallyDelivered(delivery)) {
    await exchange.receiveDataOfferResponse(payload, processIncomingDataOfferResponse);
  }
  return delivery;
}