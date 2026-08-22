import type { DataspaceExchange, ExchangeReference } from "./dataspace-exchange";
import type { ExternalServiceRequest, ExternalServiceResponse } from "./external-contracts";
import {
  handleIncomingServiceRequest,
  handleIncomingServiceResponse,
} from "./inbound-exchange-service";

export class TractusXEdcExchange implements DataspaceExchange {
  async publishServiceRequest(_payload: ExternalServiceRequest): Promise<ExchangeReference> {
    throw new Error("Tractus-X EDC adapter not configured");
  }

  async publishServiceResponse(_payload: ExternalServiceResponse): Promise<ExchangeReference> {
    throw new Error("Tractus-X EDC adapter not configured");
  }

  async receiveServiceRequest(
    payload: ExternalServiceRequest,
    process?: (payload: ExternalServiceRequest) => Promise<void>,
  ): Promise<void> {
    return handleIncomingServiceRequest(payload, process);
  }

  async receiveServiceResponse(
    payload: ExternalServiceResponse,
    process?: (payload: ExternalServiceResponse) => Promise<void>,
  ): Promise<void> {
    return handleIncomingServiceResponse(payload, process);
  }
}