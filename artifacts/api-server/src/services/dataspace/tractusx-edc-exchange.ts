import type { DataspaceExchange, ExchangeReference } from "./dataspace-exchange";
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

  publishProjectInvitation(payload: ExternalProjectInvitation) {
    return this.publish(payload, "PROJECT_INVITATION");
  }
  publishProjectInvitationResponse(payload: ExternalProjectInvitationResponse) {
    return this.publish(payload, "PROJECT_INVITATION_RESPONSE");
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