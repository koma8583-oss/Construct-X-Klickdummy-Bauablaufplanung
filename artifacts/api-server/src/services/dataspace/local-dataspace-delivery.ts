import type { DataspaceExchange, ExchangeReference } from "./dataspace-exchange";
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
    await exchange.receiveDataOffer(localPayload, processIncomingDataOffer);
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