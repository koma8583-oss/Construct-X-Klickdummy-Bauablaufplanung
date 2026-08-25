import type {
  ExternalAlternativeProposal,
  ExternalServiceRequest,
  ExternalServiceResponse,
  ExchangeMetadata,
  ExternalResourceRequirement,
  ExternalPolicySnapshot,
} from "./external-contracts";
import type { MessageEnvelope } from "../../lib/transport/message-transport";

const SCHEMA_VERSION = "1.0";
export const CONSTRUCTION_SERVICE_COORDINATION_PURPOSE = "construction-service-coordination";
const newMessageId = () => crypto.randomUUID();

export function toExternalResourceRequirements(rows: Array<{
  resourceTypeCode: string | null;
  resourceTypeName: string | null;
  requiredCapacity: string | number | null;
  capacityUnit: string | null;
  utilizationPercent: number;
  periodStart: string | null;
  periodEnd: string | null;
  requiredQualification: string | null;
}>): ExternalResourceRequirement[] {
  return rows.map((row) => {
    if (!row.resourceTypeCode || !row.resourceTypeName || row.requiredCapacity == null ||
        !row.capacityUnit || !row.periodStart || !row.periodEnd) {
      throw new Error("Service request resource requirement is incomplete");
    }
    return {
      resourceTypeCode: row.resourceTypeCode,
      resourceTypeName: row.resourceTypeName,
      requiredCapacity: Number(row.requiredCapacity),
      capacityUnit: row.capacityUnit,
      utilizationPercent: row.utilizationPercent,
      periodStart: row.periodStart,
      periodEnd: row.periodEnd,
      requiredQualification: row.requiredQualification,
    };
  });
}

export function toExternalServiceRequest(input: {
  requestId: string;
  requestVersion: number;
  projectReference: string;
  taktReference?: string;
  plannedStart: string;
  plannedEnd: string;
  senderOrgId: string;
  receiverOrgId: string;
  correlationId?: string;
  messageId?: string;
  resourceRequirements?: ExternalResourceRequirement[];
  policySnapshot?: ExternalPolicySnapshot;
}): ExternalServiceRequest {
  if (!input.plannedStart || !input.plannedEnd) {
    throw new Error("Service request cannot be published without plannedStart and plannedEnd");
  }
  const metadata: ExchangeMetadata = {
    messageId: input.messageId ?? newMessageId(),
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
    taktReference: input.taktReference,
    plannedStart: input.plannedStart,
    plannedEnd: input.plannedEnd,
    resourceRequirements: input.resourceRequirements ?? [],
    policy: { allowedConsumerOrgId: input.receiverOrgId, usagePurpose: CONSTRUCTION_SERVICE_COORDINATION_PURPOSE },
    ...(input.policySnapshot ? { policySnapshot: input.policySnapshot } : {}),
  };
}

export function toExternalServiceResponse(input: {
  requestId: string;
  requestVersion: number;
  decision: ExternalServiceResponse["decision"];
  senderOrgId: string;
  receiverOrgId: string;
  correlationId?: string;
  messageId?: string;
  acceptedTimeWindow?: { start: string; end: string };
  reasonCode?: string;
  comment?: string;
  alternatives?: ExternalAlternativeProposal[];
  nextAvailableDate?: string;
}): ExternalServiceResponse {
  return {
    metadata: {
      messageId: input.messageId ?? newMessageId(),
      correlationId: input.correlationId ?? input.requestId,
      schemaVersion: SCHEMA_VERSION,
      senderOrgId: input.senderOrgId,
      receiverOrgId: input.receiverOrgId,
      createdAt: new Date().toISOString(),
    },
    requestId: input.requestId,
    requestVersion: input.requestVersion,
    decision: input.decision,
    acceptedTimeWindow: input.acceptedTimeWindow,
    reasonCode: input.reasonCode,
    comment: input.comment,
    alternatives: input.alternatives,
    nextAvailableDate: input.nextAvailableDate,
  };
}

/** Legacy compatibility helper; productive request publishing uses direct snapshot data. */
export function toExternalServiceRequestFromEnvelope(envelope: MessageEnvelope): ExternalServiceRequest {
  const payload = envelope.payload as Record<string, unknown>;
  if (typeof payload.plannedStart !== "string" || typeof payload.plannedEnd !== "string") {
    throw new Error("Legacy service request envelope is missing plannedStart or plannedEnd");
  }
  return toExternalServiceRequest({
    requestId: String(payload.taktRequestId ?? payload.leistungsanfrageId ?? payload.requestId ?? envelope.correlationId),
    requestVersion: Number(payload.taktVersion ?? payload.leistungVersion ?? payload.requestVersion ?? 1),
    projectReference: String(payload.projectReference ?? payload.taktReference ?? ""),
    plannedStart: payload.plannedStart,
    plannedEnd: payload.plannedEnd,
    senderOrgId: envelope.senderOrgId,
    receiverOrgId: envelope.recipientOrgId,
    correlationId: envelope.correlationId,
    messageId: envelope.messageId,
  });
}

/** Converts the legacy response envelope to the public response whitelist. */
export function toExternalServiceResponseFromEnvelope(envelope: MessageEnvelope): ExternalServiceResponse {
  const payload = envelope.payload as Record<string, any>;
  return toExternalServiceResponse({
    requestId: String(payload.taktRequestId ?? payload.leistungsanfrageId ?? payload.requestId ?? envelope.correlationId),
    requestVersion: Number(payload.taktVersion ?? payload.leistungVersion ?? payload.requestVersion ?? 1),
    decision: payload.decision === "REJECTED" ? "REJECTED" :
      payload.decision === "ALTERNATIVES_PROPOSED" ? "ALTERNATIVES_PROPOSED" :
      payload.decision === "ACCEPTED" ? "ACCEPTED" :
      (() => { throw new Error("Invalid external service response decision"); })(),
    senderOrgId: envelope.senderOrgId,
    receiverOrgId: envelope.recipientOrgId,
    correlationId: envelope.correlationId,
    messageId: envelope.messageId,
    acceptedTimeWindow: payload.acceptedTimeWindow ?? undefined,
    reasonCode: typeof payload.reasonCode === "string" ? payload.reasonCode : undefined,
    comment: typeof payload.comment === "string" ? payload.comment : undefined,
    alternatives: Array.isArray(payload.alternatives)
      ? payload.alternatives.map((alternative) => {
          const candidate = alternative as Record<string, unknown>;
          return {
            ...candidate,
            conditions: Array.isArray(candidate.conditions)
              ? candidate.conditions.filter((value): value is string => typeof value === "string").join("; ")
              : candidate.conditions ?? null,
          } as ExternalAlternativeProposal;
        })
      : undefined,
    nextAvailableDate: typeof payload.nextAvailableDate === "string" ? payload.nextAvailableDate : undefined,
  });
}