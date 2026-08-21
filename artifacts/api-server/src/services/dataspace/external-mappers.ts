import type {
  ExternalAlternativeProposal,
  ExternalTaktRequest,
  ExternalTaktResponse,
  ExchangeMetadata,
  ExternalResourceRequirement,
} from "./external-contracts";
import type { MessageEnvelope } from "../../lib/transport/message-transport";

const SCHEMA_VERSION = "1.0";
const newMessageId = () => crypto.randomUUID();

export function toExternalTaktRequest(input: {
  requestId: string;
  requestVersion: number;
  projectReference: string;
  plannedStart: string;
  plannedEnd: string;
  senderOrgId: string;
  receiverOrgId: string;
  correlationId?: string;
  resourceRequirements?: ExternalResourceRequirement[];
}): ExternalTaktRequest {
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
    policy: { allowedConsumerOrgId: input.receiverOrgId, usagePurpose: "takt-coordination" },
  };
}

export function toExternalTaktResponse(input: {
  requestId: string;
  requestVersion: number;
  decision: ExternalTaktResponse["decision"];
  senderOrgId: string;
  receiverOrgId: string;
  correlationId?: string;
  alternatives?: ExternalAlternativeProposal[];
}): ExternalTaktResponse {
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
export function toExternalTaktRequestFromEnvelope(envelope: MessageEnvelope): ExternalTaktRequest {
  const payload = envelope.payload as Record<string, unknown>;
  return toExternalTaktRequest({
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
export function toExternalTaktResponseFromEnvelope(envelope: MessageEnvelope): ExternalTaktResponse {
  const payload = envelope.payload as Record<string, any>;
  return toExternalTaktResponse({
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