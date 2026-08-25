import type { DataspaceExchange, ExchangeReference } from "./dataspace-exchange";
import { createDataspaceExchange } from "./dataspace-exchange-factory";
import {
  processIncomingProjectInvitation,
  processIncomingProjectInvitationResponse,
  processIncomingServiceRequest,
  processIncomingServiceResponse,
} from "./inbound-domain-service";
import type {
  ExternalProjectInvitation,
  ExternalProjectInvitationResponse,
  ExternalServiceRequest,
  ExternalServiceResponse,
} from "./external-contracts";

/**
 * `rest` (and the unset value) is the local in-process PoC transport.
 * The Tractus-X adapter represents a real external delivery and must not loop
 * back into this process after publishing.
 */
export function isLocalDataspaceTransport(): boolean {
  return !process.env.DATASPACE_TRANSPORT ||
    process.env.DATASPACE_TRANSPORT === "local" ||
    process.env.DATASPACE_TRANSPORT === "rest";
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
    await exchange.receiveServiceRequest(payload, processIncomingServiceRequest);
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