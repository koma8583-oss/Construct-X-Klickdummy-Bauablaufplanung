import type {
  ExternalAlternativeProposal,
  ExternalTaktRequest,
  ExternalTaktResponse,
  ExchangeMetadata,
  ExternalResourceRequirement,
} from "./external-contracts";

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