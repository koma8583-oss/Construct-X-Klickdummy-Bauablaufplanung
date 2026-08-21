import type { DataspaceExchange, ExchangeReference } from "./dataspace-exchange";
import type { ExternalTaktRequest, ExternalTaktResponse } from "./external-contracts";

export class TractusXEdcExchange implements DataspaceExchange {
  async publishTaktRequest(_payload: ExternalTaktRequest): Promise<ExchangeReference> {
    throw new Error("Tractus-X EDC adapter not configured");
  }

  async publishTaktResponse(_payload: ExternalTaktResponse): Promise<ExchangeReference> {
    throw new Error("Tractus-X EDC adapter not configured");
  }
}