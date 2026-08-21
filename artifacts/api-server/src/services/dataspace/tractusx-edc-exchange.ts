import type { DataspaceExchange, ExchangeReference } from "./dataspace-exchange";
import type { ExternalServiceRequest, ExternalServiceResponse } from "./external-contracts";

export class TractusXEdcExchange implements DataspaceExchange {
  async publishServiceRequest(_payload: ExternalServiceRequest): Promise<ExchangeReference> {
    throw new Error("Tractus-X EDC adapter not configured");
  }

  async publishServiceResponse(_payload: ExternalServiceResponse): Promise<ExchangeReference> {
    throw new Error("Tractus-X EDC adapter not configured");
  }
}