import type {
  ExternalProjectInvitation,
  ExternalProjectInvitationResponse,
  ExternalServiceRequest,
  ExternalServiceResponse,
} from "./external-contracts";
import type { InboundProcessResult } from "./inbound-exchange-service";
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
  publishProjectInvitation(payload: ExternalProjectInvitation): Promise<ExchangeReference>;
  publishProjectInvitationResponse(payload: ExternalProjectInvitationResponse): Promise<ExchangeReference>;
  receiveProjectInvitation(
    payload: ExternalProjectInvitation,
    process?: (payload: ExternalProjectInvitation) => Promise<void>,
  ): Promise<InboundProcessResult>;
  receiveProjectInvitationResponse(
    payload: ExternalProjectInvitationResponse,
    process?: (payload: ExternalProjectInvitationResponse) => Promise<void>,
  ): Promise<InboundProcessResult>;
  publishServiceRequest(payload: ExternalServiceRequest): Promise<ExchangeReference>;
  publishServiceResponse(payload: ExternalServiceResponse): Promise<ExchangeReference>;
  receiveServiceRequest(
    payload: ExternalServiceRequest,
    process?: (payload: ExternalServiceRequest) => Promise<void>,
  ): Promise<InboundProcessResult>;
  receiveServiceResponse(
    payload: ExternalServiceResponse,
    process?: (payload: ExternalServiceResponse) => Promise<void>,
  ): Promise<InboundProcessResult>;
}