import type { ExternalTaktRequest, ExternalTaktResponse } from "./external-contracts";
import type { DataspaceMessageStatus } from "@workspace/api-zod";

export type ExchangeReference = {
  exchangeId: string;
  externalReference?: string;
  status?: DataspaceMessageStatus;
  sentAt?: Date | null;
  deliveredAt?: Date | null;
  attemptCount?: number;
};

export interface DataspaceExchange {
  publishTaktRequest(payload: ExternalTaktRequest): Promise<ExchangeReference>;
  publishTaktResponse(payload: ExternalTaktResponse): Promise<ExchangeReference>;
}