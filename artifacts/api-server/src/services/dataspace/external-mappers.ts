import type {
  ExternalAlternativeProposal,
  ExternalServiceRequest,
  ExternalServiceResponse,
  ExchangeMetadata,
  ExternalResourceRequirement,
} from "./external-contracts";
import type { MessageEnvelope } from "../../lib/transport/message-transport";

const SCHEMA_VERSION = "1.0";
export const CONSTRUCTION_SERVICE_COORDINATION_PURPOSE = "construction-service-coordination";
const newMessageId = () => crypto.randomUUID();

export function toExternalServiceRequest(input: {
  requestId: string;
  requestVersion: number;
  projectReference: string;
  plannedStart: string;
  plannedEnd: string;
  senderOrgId: string;
  receiverOrgId: string;
  correlationId?: string;
  resourceRequirements?: ExternalResourceRequirement[];
}): ExternalServiceRequest {
  const metadata: ExchangeMetadata = {
    messageId: newMessageId(),
    correlationId: input.correlationId ?? input.requestId,
    schemaVersion: SCHEMA_VERSION,
    senderOrgId: input.senderOrgId,
    receiverOrgId: input.receiverOrgId,
    createdAt: new Date().toISOString(),
  };
  return {
    metadata,
    requestId: input.requestId,
    requestVersion: input.requestVersion,
    projectReference: input.projectReference,
    plannedStart: input.plannedStart,
    plannedEnd: input.plannedEnd,
    resourceRequirements: input.resourceRequirements ?? [],
    policy: { allowedConsumerOrgId: input.receiverOrgId, usagePurpose: CONSTRUCTION_SERVICE_COORDINATION_PURPOSE },
  };
}

export function toExternalServiceResponse(input: {
  requestId: string;
  requestVersion: number;
  decision: ExternalServiceResponse["decision"];
  senderOrgId: string;
  receiverOrgId: string;
  correlationId?: string;
  alternatives?: ExternalAlternativeProposal[];
}): ExternalServiceResponse {
  return {
    metadata: {
      messageId: newMessageId(),
      correlationId: input.correlationId ?? input.requestId,
      schemaVersion: SCHEMA_VERSION,
      senderOrgId: input.senderOrgId,
      receiverOrgId: input.receiverOrgId,
      createdAt: new Date().toISOString(),
    },
    requestId: input.requestId,
    requestVersion: input.requestVersion,
    decision: input.decision,
    alternatives: input.alternatives,
  };
}

/** Converts the legacy notification envelope without leaking its payload wholesale. */
export function toExternalServiceRequestFromEnvelope(envelope: MessageEnvelope): ExternalServiceRequest {
  const payload = envelope.payload as Record<string, unknown>;
  return toExternalServiceRequest({
    requestId: String(payload.taktRequestId ?? payload.leistungsanfrageId ?? payload.requestId ?? envelope.correlationId),
    requestVersion: Number(payload.taktVersion ?? payload.leistungVersion ?? payload.requestVersion ?? 1),
    projectReference: String(payload.projectReference ?? payload.taktReference ?? ""),
    plannedStart: String(payload.plannedStart ?? new Date().toISOString()),
    plannedEnd: String(payload.plannedEnd ?? new Date().toISOString()),
    senderOrgId: envelope.senderOrgId,
    receiverOrgId: envelope.recipientOrgId,
    correlationId: envelope.correlationId,
  });
}

/** Converts the legacy response envelope to the public response whitelist. */
export function toExternalServiceResponseFromEnvelope(envelope: MessageEnvelope): ExternalServiceResponse {
  const payload = envelope.payload as Record<string, any>;
  return toExternalServiceResponse({
    requestId: String(payload.taktRequestId ?? payload.leistungsanfrageId ?? payload.requestId ?? envelope.correlationId),
    requestVersion: Number(payload.taktVersion ?? payload.leistungVersion ?? payload.requestVersion ?? 1),
    decision: payload.decision === "REJECTED" ? "REJECTED" :
      payload.decision === "ALTERNATIVES_PROPOSED" ? "ALTERNATIVES_PROPOSED" : "ACCEPTED",
    senderOrgId: envelope.senderOrgId,
    receiverOrgId: envelope.recipientOrgId,
    correlationId: envelope.correlationId,
    alternatives: Array.isArray(payload.alternatives) ? payload.alternatives : undefined,
  });
}