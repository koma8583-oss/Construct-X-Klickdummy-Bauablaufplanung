import type { ExternalServiceRequest, ExternalServiceResponse } from "./external-contracts";
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
  publishServiceRequest(payload: ExternalServiceRequest): Promise<ExchangeReference>;
  publishServiceResponse(payload: ExternalServiceResponse): Promise<ExchangeReference>;
}