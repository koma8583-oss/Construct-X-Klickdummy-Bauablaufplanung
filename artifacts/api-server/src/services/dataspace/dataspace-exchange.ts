import type { ExternalTaktRequest, ExternalTaktResponse } from "./external-contracts";

export type ExchangeReference = {
  exchangeId: string;
  externalReference?: string;
};

export interface DataspaceExchange {
  publishTaktRequest(payload: ExternalTaktRequest): Promise<ExchangeReference>;
  publishTaktResponse(payload: ExternalTaktResponse): Promise<ExchangeReference>;
}