import type {
  ExternalAlternativeProposal,
  ExternalServiceRequest,
  ExternalServiceResponse,
  ExchangeMetadata,
  ExternalResourceRequirement,
  ExternalPolicySnapshot,
} from "./external-contracts";
import {
  TAKT_REQUEST_SNAPSHOT_PUBLIC_FIELDS,
  TaktRequestSnapshotPayloadSchema,
  type TaktRequestSnapshotPayload,
} from "@workspace/api-zod";
import type { MessageEnvelope } from "../../lib/transport/message-transport";

const SCHEMA_VERSION = "1.0";
export const CONSTRUCTION_SERVICE_COORDINATION_PURPOSE = "construction-service-coordination";
const newMessageId = () => crypto.randomUUID();
const SNAPSHOT_RESOURCE_TYPE_METADATA = {
  CREW: { code: "CREW", name: "Crew", capacityUnit: "PERSONS" },
  EQUIPMENT: { code: "EQUIPMENT", name: "Equipment", capacityUnit: "UNITS" },
  OTHER: { code: "OTHER", name: "Other", capacityUnit: "UNITS" },
} as const;

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

/**
 * Convert the public snapshot resource requirements into the complete
 * SERVICE_REQUEST contract without resolving AN-local catalog data.
 *
 * The snapshot intentionally stores only a public type and free-text note.
 * The external contract still requires capacity, unit, and deployment dates,
 * so type-based requirements use one requested unit across the snapshot
 * window.  Detailed AN-owned requirements are never read on the AG side.
 */
export function toExternalResourceRequirementsFromSnapshot(
  rows: unknown,
  plannedTimeWindow: { start: string; end: string },
): ExternalResourceRequirement[] {
  if (!Array.isArray(rows)) return [];

  return rows.map((row) => {
    if (
      !row ||
      typeof row !== "object" ||
      typeof (row as Record<string, unknown>).resourceType !== "string" ||
      typeof (row as Record<string, unknown>).notes !== "string"
    ) {
      throw new Error("Snapshot resource requirement is incomplete");
    }

    const resourceType = (row as Record<string, string>).resourceType.trim().toUpperCase();
    const metadata = SNAPSHOT_RESOURCE_TYPE_METADATA[
      resourceType as keyof typeof SNAPSHOT_RESOURCE_TYPE_METADATA
    ];
    if (!metadata) throw new Error("Snapshot resource requirement has an unsupported type");

    return {
      resourceTypeCode: metadata.code,
      resourceTypeName: metadata.name,
      requiredCapacity: 1,
      capacityUnit: metadata.capacityUnit,
      utilizationPercent: 100,
      periodStart: plannedTimeWindow.start,
      periodEnd: plannedTimeWindow.end,
      requiredQualification: null,
    };
  });
}

export function toExternalServiceRequest(input: {
  requestId: string;
  requestVersion: number;
  requestKind?: ExternalServiceRequest["requestKind"];
  sourceRequestId?: string;
  changeProposalId?: string;
  comment?: string | null;
  baseTimeWindow?: { start: string; end: string };
  revisionContext?: ExternalServiceRequest["revisionContext"];
  projectReference: string;
  projectName?: string;
  leistungReference?: string;
  taktReference?: string;
  plannedStart: string;
  plannedEnd: string;
  senderOrgId: string;
  senderOrganizationName?: string;
  senderUserId?: string;
  receiverOrgId: string;
  correlationId?: string;
  messageId?: string;
  resourceRequirements?: ExternalResourceRequirement[];
  publicSnapshot?: TaktRequestSnapshotPayload;
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
    senderOrganizationName: input.senderOrganizationName,
    senderUserId: input.senderUserId,
    requestKind: input.requestKind,
    sourceRequestId: input.sourceRequestId,
    changeProposalId: input.changeProposalId,
    comment: input.comment,
    baseTimeWindow: input.baseTimeWindow,
    revisionContext: input.revisionContext,
    projectReference: input.projectReference,
    projectName: input.projectName,
    leistungReference: input.leistungReference,
    taktReference: input.taktReference,
    plannedStart: input.plannedStart,
    plannedEnd: input.plannedEnd,
    resourceRequirements: input.resourceRequirements ?? [],
    ...(input.publicSnapshot ? { publicSnapshot: input.publicSnapshot } : {}),
    policy: { allowedConsumerOrgId: input.receiverOrgId, usagePurpose: CONSTRUCTION_SERVICE_COORDINATION_PURPOSE },
    ...(input.policySnapshot ? { policySnapshot: input.policySnapshot } : {}),
  };
}

/**
 * Keep the public snapshot separate from notification metadata and coordination
 * context. This is the only snapshot shape allowed onto the Dataspace wire.
 */
export function publicSnapshotFromRecord(value: Record<string, unknown>): TaktRequestSnapshotPayload {
  const candidate = Object.fromEntries(
    TAKT_REQUEST_SNAPSHOT_PUBLIC_FIELDS
      .filter((field) => Object.prototype.hasOwnProperty.call(value, field))
      .map((field) => [field, value[field]]),
  );
  const parsed = TaktRequestSnapshotPayloadSchema.safeParse(candidate);
  if (!parsed.success) {
    throw new Error("The released Takt snapshot is incomplete or malformed");
  }
  return parsed.data;
}

export function toExternalServiceResponse(input: {
  requestId: string;
  requestVersion: number;
  requestKind?: ExternalServiceResponse["requestKind"];
  sourceRequestId?: string;
  changeProposalId?: string;
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
    requestKind: input.requestKind,
    sourceRequestId: input.sourceRequestId,
    changeProposalId: input.changeProposalId,
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
    requestKind: payload.requestKind === "SCHEDULE_CHANGE" ? "SCHEDULE_CHANGE" : "INITIAL",
    sourceRequestId: typeof payload.sourceRequestId === "string" ? payload.sourceRequestId : undefined,
    changeProposalId: typeof payload.changeProposalId === "string" ? payload.changeProposalId : undefined,
    baseTimeWindow: payload.baseTimeWindow as { start: string; end: string } | undefined,
    projectReference: String(payload.projectReference ?? payload.taktReference ?? ""),
    leistungReference: typeof payload.leistungReference === "string" ? payload.leistungReference : undefined,
    plannedStart: payload.plannedStart,
    plannedEnd: payload.plannedEnd,
    senderOrgId: envelope.senderOrgId,
    receiverOrgId: envelope.recipientOrgId,
    correlationId: envelope.correlationId,
    messageId: envelope.messageId,
    resourceRequirements: Array.isArray(payload.resourceRequirements)
      ? payload.resourceRequirements as ExternalResourceRequirement[]
      : undefined,
  });
}

/** Converts the legacy response envelope to the public response whitelist. */
export function toExternalServiceResponseFromEnvelope(envelope: MessageEnvelope): ExternalServiceResponse {
  const payload = envelope.payload as Record<string, any>;
  return toExternalServiceResponse({
    requestId: String(payload.taktRequestId ?? payload.leistungsanfrageId ?? payload.requestId ?? envelope.correlationId),
    requestVersion: Number(payload.taktVersion ?? payload.leistungVersion ?? payload.requestVersion ?? 1),
    requestKind: payload.requestKind === "SCHEDULE_CHANGE" ? "SCHEDULE_CHANGE" : "INITIAL",
    sourceRequestId: typeof payload.sourceRequestId === "string" ? payload.sourceRequestId : undefined,
    changeProposalId: typeof payload.changeProposalId === "string" ? payload.changeProposalId : undefined,
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