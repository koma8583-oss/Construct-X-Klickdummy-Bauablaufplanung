import { z } from "zod";
import { TaktRequestSnapshotPayloadSchema } from "@workspace/api-zod";

const nonEmpty = (max = 512) => z.string().trim().min(1).max(max);
const externalDate = nonEmpty(80).refine((value) => {
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  return dateOnly ? !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) : !Number.isNaN(Date.parse(value));
}, "Must be a valid ISO date or datetime");
const metadataSchema = z.object({
  // Metadata is an internal projection used before the connector boundary.
  // The external connector receives only NotificationEnvelope.header.
  messageId: nonEmpty(200),
  correlationId: nonEmpty(200),
  schemaVersion: z.literal("1.0"),
  senderOrgId: nonEmpty(200),
  receiverOrgId: nonEmpty(200),
  createdAt: z.string().datetime({ offset: true }),
  causationId: z.string().uuid().nullable().optional(),
  expectedResponseBy: z.string().datetime({ offset: true }).optional(),
}).strict();

const policySchema = z.object({
  allowedConsumerOrgId: nonEmpty(200),
  usagePurpose: nonEmpty(200),
  validUntil: externalDate.optional(),
}).strict();

const policySnapshotSchema = z.object({
  policyId: nonEmpty(200),
  templateId: nonEmpty(200),
  templateVersion: z.number().int().positive(),
  code: nonEmpty(200),
  name: nonEmpty(500),
  description: nonEmpty(4000),
  permissions: z.array(nonEmpty(500)).max(100),
  prohibitions: z.array(nonEmpty(500)).max(100),
  provider: z.object({
    organizationId: nonEmpty(200),
    userId: nonEmpty(200).nullable(),
  }).strict(),
  recipientOrganizationId: nonEmpty(200),
  purpose: nonEmpty(2000),
  projectReference: nonEmpty(200).nullable(),
  workPackageReference: nonEmpty(200).nullable(),
  validFrom: externalDate.nullable(),
  validUntil: externalDate.nullable(),
  createdAt: z.string().datetime({ offset: true }),
  policyType: z.enum(["PROJECT_AGREEMENT", "PERFORMANCE_REQUEST", "SCHEDULE_CHANGE", "DATA_OFFER"]).optional(),
  policyVersion: z.number().int().positive().optional(),
  parentPolicyId: nonEmpty(200).nullable().optional(),
  inheritFrom: nonEmpty(200).nullable().optional(),
  lifecycleStatus: z.enum([
    "DRAFT", "PUBLISHED", "CONSENT_REQUIRED", "ACCEPTED",
    "REJECTED", "SUPERSEDED", "REVOKED",
  ]).optional(),
  deltaClass: z.enum(["WITHIN_BASELINE", "REQUIRES_CONSENT", "NOT_PERMITTED"]).nullable().optional(),
  diff: z.record(z.string(), z.unknown()).nullable().optional(),
  effectivePolicy: z.record(z.string(), z.unknown()).optional(),
}).strict();

type PolicySnapshotParticipantInput = {
  metadata: {
    senderOrgId: string;
    receiverOrgId: string;
  };
  policySnapshot?: {
    provider: {
      organizationId: string;
    };
    recipientOrganizationId: string;
  };
};
const invitationPolicySchema = z.object({
  usagePurpose: z.literal("PROJECT_MEMBERSHIP"),
  allowedConsumerParticipantId: nonEmpty(200),
  templateId: nonEmpty(200).optional(),
  templateVersion: z.number().int().positive().optional(),
  templateCode: nonEmpty(200).optional(),
  templateName: nonEmpty(500).optional(),
  purpose: nonEmpty(2000).optional(),
  permissions: z.array(nonEmpty(500)).max(100).optional(),
  prohibitions: z.array(nonEmpty(500)).max(100).optional(),
}).strict();

const dataOfferPolicySnapshotSchema = z.object({
  id: nonEmpty(200),
  templateId: nonEmpty(200).optional(),
  templateVersion: z.number().int().positive().optional(),
  code: nonEmpty(200),
  name: nonEmpty(500),
  purpose: nonEmpty(2000),
  permissions: z.array(nonEmpty(500)).max(100),
  prohibitions: z.array(nonEmpty(500)).max(100),
  validityRule: nonEmpty(2000),
  retentionRule: z.string().trim().max(2000).nullable(),
}).strict();

const timeWindowSchema = z.object({
  start: externalDate,
  end: externalDate,
}).strict().refine((value) => Date.parse(value.end) > Date.parse(value.start), {
  message: "end must be after start",
});

const resourceRequirementSchema = z.object({
  resourceTypeCode: nonEmpty(120),
  resourceTypeName: nonEmpty(240),
  requiredCapacity: z.number().finite().positive(),
  capacityUnit: nonEmpty(40),
  utilizationPercent: z.number().finite().min(0).max(100),
  periodStart: externalDate,
  periodEnd: externalDate,
  requiredQualification: z.string().trim().max(500).nullable().optional(),
}).strict().refine((value) => Date.parse(value.periodEnd) >= Date.parse(value.periodStart), {
  message: "periodEnd must not be before periodStart",
});

const alternativeSchema = z.object({
  alternativeId: nonEmpty(200),
  rank: z.number().int().min(1).max(1000),
  timeWindow: timeWindowSchema,
  crewSize: z.number().int().positive().nullable().optional(),
  conditions: z.string().trim().max(2000).nullable().optional(),
}).strict();

export const externalProjectInvitationSchema = z.object({
  metadata: metadataSchema,
  invitationId: nonEmpty(200),
  senderOrganizationName: nonEmpty(500).optional(),
  project: z.object({
    projectReference: nonEmpty(200),
    projectName: nonEmpty(500),
    status: z.enum(["ACTIVE", "COMPLETED", "ARCHIVED"]).optional(),
    description: z.string().trim().max(4000).optional(),
    location: z.string().trim().max(1000).optional(),
  }).strict(),
  requestedRole: z.literal("CONTRACTOR"),
  purpose: z.literal("PROJECT_COLLABORATION"),
  invitationMessage: z.string().trim().max(4000).optional(),
  validUntil: externalDate.optional(),
  policy: invitationPolicySchema,
  policySnapshot: policySnapshotSchema.optional(),
  dataspacePreparation: z.object({
    mode: z.literal("LOCAL_PREPARED"),
    participantId: nonEmpty(200),
    bpnl: z.null(),
    did: z.null(),
    participantDiscovery: z.literal("NOT_CONFIGURED"),
    connectorDiscovery: z.literal("NOT_CONFIGURED"),
  }).strict().optional(),
  dataOffer: z.object({
    publicationId: nonEmpty(200),
    title: nonEmpty(500),
    // These fields keep the earlier onboarding transport compatible while the
    // invitation-package transport uses the policy embedded in `policy`.
    dataProductType: z.enum([
      "PROJECT_OVERVIEW",
      "PROJECT_COORDINATION_PACKAGE",
      "PROJECT_MEMBERSHIP",
      "TAKT_INFORMATION_PACKAGE",
    ]).optional(),
    publicationVersion: z.number().int().positive().optional(),
    status: z.enum(["PUBLISHED", "SUSPENDED", "WITHDRAWN"]).optional(),
    contentHash: nonEmpty(200).optional(),
    contentSnapshot: z.record(z.string(), z.unknown()).optional(),
    selectedFields: z.array(nonEmpty(200)).min(1).max(100),
    policy: dataOfferPolicySnapshotSchema.optional(),
    validFrom: externalDate.optional(),
    validUntil: externalDate.optional(),
  }).strict().optional(),
}).strict().superRefine((value, ctx) => {
  for (const issue of policySnapshotParticipantIssues(value)) {
    ctx.addIssue({ code: "custom", path: issue.path, message: issue.message });
  }
});

export const externalProjectInvitationResponseSchema = z.object({
  metadata: metadataSchema,
  invitationId: nonEmpty(200),
  projectReference: nonEmpty(200),
  dataPublicationId: nonEmpty(200).optional(),
  decision: z.enum(["ACCEPTED", "REJECTED"]),
  policyAccepted: z.boolean().optional(),
  message: z.string().trim().max(4000).optional(),
  respondedAt: z.string().datetime({ offset: true }),
}).strict().superRefine((value, ctx) => {
  if (value.decision === "ACCEPTED" && value.policyAccepted !== true) {
    ctx.addIssue({
      code: "custom",
      path: ["policyAccepted"],
      message: "policyAccepted=true is required when accepting a project invitation",
    });
  }
});

/**
 * A data offer is deliberately not a project invitation. It references an
 * already published immutable snapshot and carries the access and usage
 * policies that govern that publication. The optional contentSnapshot is only
 * used by the local PoC loopback; connector payloads must omit it.
 */
export const externalDataOfferSchema = z.object({
  metadata: metadataSchema,
  publicationId: nonEmpty(200),
  projectReference: nonEmpty(200),
  projectName: nonEmpty(500),
  title: nonEmpty(500),
  dataProductType: z.enum([
    "PROJECT_OVERVIEW",
    "PROJECT_COORDINATION_PACKAGE",
    "PROJECT_MEMBERSHIP",
    "TAKT_INFORMATION_PACKAGE",
  ]),
  publicationVersion: z.number().int().positive(),
  status: z.enum(["PUBLISHED", "SUSPENDED", "WITHDRAWN"]),
  contentHash: nonEmpty(200).optional(),
  selectedFields: z.array(nonEmpty(200)).min(1).max(100),
  detailsRef: nonEmpty(1000),
  validFrom: externalDate,
  validUntil: externalDate.optional(),
  accessPolicy: policySnapshotSchema,
  usagePolicy: dataOfferPolicySnapshotSchema,
  contentSnapshot: z.record(z.string(), z.unknown()).optional(),
}).strict().superRefine((value, ctx) => {
  for (const issue of policySnapshotParticipantIssues({
    metadata: value.metadata,
    policySnapshot: value.accessPolicy,
  })) {
    ctx.addIssue({ code: "custom", path: issue.path, message: issue.message });
  }
});

/**
 * A data-offer response is deliberately independent from project invitations.
 * It changes only the publication recipient decision and never carries an
 * invitation identifier or membership decision.
 */
export const externalDataOfferResponseSchema = z.object({
  metadata: metadataSchema,
  publicationId: nonEmpty(200),
  projectReference: nonEmpty(200),
  decision: z.enum(["ACCEPTED", "REJECTED"]),
  policyAccepted: z.boolean().optional(),
  message: z.string().trim().max(4000).optional(),
  respondedAt: z.string().datetime({ offset: true }),
}).strict().superRefine((value, ctx) => {
  if (value.decision === "ACCEPTED" && value.policyAccepted !== true) {
    ctx.addIssue({
      code: "custom",
      path: ["policyAccepted"],
      message: "policyAccepted=true is required when accepting a data offer",
    });
  }
});

export const externalServiceRequestSchema = z.object({
  metadata: metadataSchema,
  requestId: nonEmpty(200),
  requestVersion: z.number().int().min(1),
  senderOrganizationName: nonEmpty(500).optional(),
  senderUserId: nonEmpty(200).optional(),
  requestKind: z.enum(["INITIAL", "SCHEDULE_CHANGE"]).optional(),
  sourceRequestId: nonEmpty(200).optional(),
  changeProposalId: nonEmpty(200).optional(),
  comment: z.string().trim().max(2000).nullable().optional(),
  baseTimeWindow: timeWindowSchema.optional(),
  revisionContext: z.object({
    revisionNumber: z.number().int().positive(),
    previousRequestId: nonEmpty(200),
    previousTimeWindow: timeWindowSchema,
    proposedTimeWindow: timeWindowSchema,
    reasonCode: z.string().trim().max(120).nullable().optional(),
    comment: z.string().trim().max(2000).nullable().optional(),
    createdAt: z.string().datetime({ offset: true }),
  }).strict().optional(),
  projectReference: nonEmpty(200),
  projectName: nonEmpty(500).optional(),
  leistungReference: nonEmpty(200).optional(),
  plannedStart: externalDate,
  plannedEnd: externalDate,
  resourceRequirements: z.array(resourceRequirementSchema).max(100),
  /** Public, immutable coordination data; never contains AN-local resources. */
  publicSnapshot: TaktRequestSnapshotPayloadSchema.optional(),
  policy: policySchema.optional(),
  policySnapshot: policySnapshotSchema.optional(),
}).strict()
  .refine((value) => Date.parse(value.plannedEnd) >= Date.parse(value.plannedStart), {
    message: "plannedEnd must not be before plannedStart",
  })
  .superRefine((value, ctx) => {
    for (const issue of policySnapshotParticipantIssues(value)) {
      ctx.addIssue({ code: "custom", path: issue.path, message: issue.message });
    }
    if (value.requestKind === "SCHEDULE_CHANGE") {
      if (!value.sourceRequestId) ctx.addIssue({ code: "custom", path: ["sourceRequestId"], message: "sourceRequestId is required for schedule changes" });
      if (!value.changeProposalId) ctx.addIssue({ code: "custom", path: ["changeProposalId"], message: "changeProposalId is required for schedule changes" });
      if (!value.baseTimeWindow) ctx.addIssue({ code: "custom", path: ["baseTimeWindow"], message: "baseTimeWindow is required for schedule changes" });
    }
  });

export const externalServiceResponseSchema = z.object({
  metadata: metadataSchema,
  requestId: nonEmpty(200),
  requestVersion: z.number().int().min(1),
  requestKind: z.enum(["INITIAL", "SCHEDULE_CHANGE"]).optional(),
  sourceRequestId: nonEmpty(200).optional(),
  changeProposalId: nonEmpty(200).optional(),
  decision: z.enum(["ACCEPTED", "REJECTED", "ALTERNATIVES_PROPOSED"]),
  acceptedTimeWindow: timeWindowSchema.optional(),
  reasonCode: nonEmpty(200).optional(),
  comment: z.string().trim().max(2000).optional(),
  alternatives: z.array(alternativeSchema).max(3).optional(),
  nextAvailableDate: externalDate.optional(),
}).strict().superRefine((value, ctx) => {
  if (value.requestKind === "SCHEDULE_CHANGE") {
    if (!value.sourceRequestId) ctx.addIssue({ code: "custom", path: ["sourceRequestId"], message: "sourceRequestId is required for schedule change responses" });
    if (!value.changeProposalId) ctx.addIssue({ code: "custom", path: ["changeProposalId"], message: "changeProposalId is required for schedule change responses" });
  }
  if (value.decision === "ACCEPTED" && !value.acceptedTimeWindow) {
    ctx.addIssue({ code: "custom", path: ["acceptedTimeWindow"], message: "acceptedTimeWindow is required for ACCEPTED" });
  }
  if (value.decision === "ALTERNATIVES_PROPOSED" && (!value.alternatives || value.alternatives.length === 0)) {
    ctx.addIssue({ code: "custom", path: ["alternatives"], message: "alternatives are required for ALTERNATIVES_PROPOSED" });
  }
});

export const externalCoordinationDecisionSchema = z.object({
  metadata: metadataSchema,
  requestId: nonEmpty(200),
  requestVersion: z.number().int().min(1),
  taktVersion: z.number().int().min(1),
  decisionType: z.enum([
    "CONFIRM_ACCEPTED",
    "ACCEPT_ALTERNATIVE",
    "REQUEST_REVISION",
    "CLOSE_WITHOUT_AGREEMENT",
  ]),
  acceptedAlternativeId: nonEmpty(200).nullable().optional(),
  confirmedTimeWindow: timeWindowSchema.nullable().optional(),
  comment: z.string().trim().max(2000).nullable().optional(),
  closedAt: z.string().datetime({ offset: true }).optional(),
}).strict().superRefine((value, ctx) => {
  const acceptance =
    value.decisionType === "CONFIRM_ACCEPTED" ||
    value.decisionType === "ACCEPT_ALTERNATIVE";
  if (acceptance && !value.confirmedTimeWindow) {
    ctx.addIssue({
      code: "custom",
      path: ["confirmedTimeWindow"],
      message: "confirmedTimeWindow is required for accepted decisions",
    });
  }
  if (value.decisionType === "ACCEPT_ALTERNATIVE" && !value.acceptedAlternativeId) {
    ctx.addIssue({
      code: "custom",
      path: ["acceptedAlternativeId"],
      message: "acceptedAlternativeId is required for ACCEPT_ALTERNATIVE",
    });
  }
  if (value.decisionType === "CLOSE_WITHOUT_AGREEMENT" && !value.closedAt) {
    ctx.addIssue({
      code: "custom",
      path: ["closedAt"],
      message: "closedAt is required for CLOSE_WITHOUT_AGREEMENT",
    });
  }
});

export type ExchangeMetadata = {
  messageId: string;
  correlationId: string;
  schemaVersion: string;
  senderOrgId: string;
  receiverOrgId: string;
  createdAt: string;
  causationId?: string | null;
  expectedResponseBy?: string;
};

export type ExchangePolicy = {
  allowedConsumerOrgId: string;
  usagePurpose: string;
  validUntil?: string;
};

export type ExternalPolicySnapshot = {
  policyId: string;
  templateId: string;
  templateVersion: number;
  code: string;
  name: string;
  description: string;
  permissions: readonly string[];
  prohibitions: readonly string[];
  provider: { organizationId: string; userId: string | null };
  recipientOrganizationId: string;
  purpose: string;
  projectReference: string | null;
  workPackageReference: string | null;
  validFrom: string | null;
  validUntil: string | null;
  createdAt: string;
  policyType?: "PROJECT_AGREEMENT" | "PERFORMANCE_REQUEST" | "SCHEDULE_CHANGE" | "DATA_OFFER";
  policyVersion?: number;
  parentPolicyId?: string | null;
  inheritFrom?: string | null;
  lifecycleStatus?: "DRAFT" | "PUBLISHED" | "CONSENT_REQUIRED" | "ACCEPTED" | "REJECTED" | "SUPERSEDED" | "REVOKED";
  deltaClass?: "WITHIN_BASELINE" | "REQUIRES_CONSENT" | "NOT_PERMITTED" | null;
  diff?: Record<string, unknown> | null;
  effectivePolicy?: Record<string, unknown>;
};

export function assertPolicySnapshotParticipants(payload: PolicySnapshotParticipantInput): void {
  const issue = policySnapshotParticipantIssues(payload)[0];
  if (issue) throw new Error(issue.message);
}
export type DataspaceParticipant = {
  localOrgId?: string;
  participantId: string;
  organizationName: string;
  organizationType: "AG" | "AN";
  identityStatus: "PREPARED" | "VERIFIED" | "UNVERIFIED" | "SUSPENDED";
  connectorEndpoint?: string;
  connectorStatus: "AVAILABLE" | "UNAVAILABLE" | "UNKNOWN";
  capabilities?: string[];
};

export type ExternalProjectInvitation = {
  metadata: ExchangeMetadata;
  invitationId: string;
  senderOrganizationName?: string;
  project: {
    projectReference: string;
    projectName: string;
    status?: "ACTIVE" | "COMPLETED" | "ARCHIVED";
    description?: string;
    location?: string;
  };
  requestedRole: "CONTRACTOR";
  purpose: "PROJECT_COLLABORATION";
  invitationMessage?: string;
  validUntil?: string;
  policy: {
    usagePurpose: "PROJECT_MEMBERSHIP";
    allowedConsumerParticipantId: string;
    templateId?: string;
    templateVersion?: number;
    templateCode?: string;
    templateName?: string;
    purpose?: string;
    permissions?: string[];
    prohibitions?: string[];
  };
  policySnapshot?: ExternalPolicySnapshot;
  dataspacePreparation?: {
    mode: "LOCAL_PREPARED";
    participantId: string;
    bpnl: null;
    did: null;
    participantDiscovery: "NOT_CONFIGURED";
    connectorDiscovery: "NOT_CONFIGURED";
  };
  dataOffer?: {
    publicationId: string;
    title: string;
    dataProductType?: "PROJECT_OVERVIEW" | "PROJECT_COORDINATION_PACKAGE" | "PROJECT_MEMBERSHIP" | "TAKT_INFORMATION_PACKAGE";
    publicationVersion?: number;
    status?: "PUBLISHED" | "SUSPENDED" | "WITHDRAWN";
    contentHash?: string;
    contentSnapshot?: Record<string, unknown>;
    selectedFields: string[];
    policy?: {
      id: string;
      templateId?: string;
      templateVersion?: number;
      code: string;
      name: string;
      purpose: string;
      permissions: string[];
      prohibitions: string[];
      validityRule: string;
      retentionRule: string | null;
    };
    validFrom?: string;
    validUntil?: string;
  };
};

type JsonRecord = Record<string, unknown>;

function formatContractIssues(
  prefix: string,
  issues: Array<{ path: PropertyKey[]; message: string }>,
): Error {
  const details = issues
    .map((issue) => {
      const path = issue.path.length > 0
        ? issue.path.map(String).join(".")
        : "payload";
      return `${path}: ${issue.message}`;
    })
    .join("; ");
  return new Error(`${prefix}: ${details}`);
}

function firstJsonDifference(
  left: unknown,
  right: unknown,
  path: string,
): string | null {
  if (Object.is(left, right)) return null;

  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right)) return path;
    if (left.length !== right.length) return path;
    for (let index = 0; index < left.length; index += 1) {
      const difference = firstJsonDifference(left[index], right[index], `${path}[${index}]`);
      if (difference) return difference;
    }
    return null;
  }

  if (
    left !== null &&
    right !== null &&
    typeof left === "object" &&
    typeof right === "object"
  ) {
    const leftRecord = left as JsonRecord;
    const rightRecord = right as JsonRecord;
    const keys = new Set([...Object.keys(leftRecord), ...Object.keys(rightRecord)]);
    for (const key of keys) {
      if (!Object.prototype.hasOwnProperty.call(leftRecord, key) ||
          !Object.prototype.hasOwnProperty.call(rightRecord, key)) {
        return `${path}.${key}`;
      }
      const difference = firstJsonDifference(leftRecord[key], rightRecord[key], `${path}.${key}`);
      if (difference) return difference;
    }
    return null;
  }

  return path;
}

/**
 * Validate and prepare the invitation payload used by the Tractus-X transport.
 *
 * The contract is checked both before and after JSON serialization. The second
 * check is intentional: JSON serialization can omit or transform values (or
 * invoke a custom toJSON implementation) even when the in-memory object
 * initially passes the schema. The policy snapshot must be byte-equivalent in
 * meaning, while object key ordering remains free to change.
 */
export function serializeExternalProjectInvitation(
  payload: ExternalProjectInvitation,
): JsonRecord {
  const inputResult = externalProjectInvitationSchema.safeParse(payload);
  if (!inputResult.success) {
    throw formatContractIssues(
      "Project invitation contract validation failed",
      inputResult.error.issues,
    );
  }

  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(payload);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Project invitation JSON serialization failed: ${reason}`);
  }
  if (serialized === undefined) {
    throw new Error("Project invitation JSON serialization failed: payload is not serializable");
  }

  let serializedPayload: unknown;
  try {
    serializedPayload = JSON.parse(serialized);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Project invitation JSON serialization produced invalid JSON: ${reason}`);
  }

  const serializedResult = externalProjectInvitationSchema.safeParse(serializedPayload);
  if (!serializedResult.success) {
    throw formatContractIssues(
      "Project invitation contract validation failed after JSON serialization",
      serializedResult.error.issues,
    );
  }

  if (payload.policySnapshot) {
    const snapshotDifference = firstJsonDifference(
      payload.policySnapshot,
      (serializedPayload as JsonRecord).policySnapshot,
      "policySnapshot",
    );
    if (snapshotDifference) {
      throw new Error(
        `Project invitation policySnapshot changed during JSON serialization at ${snapshotDifference}`,
      );
    }
  }

  return serializedPayload as JsonRecord;
}

export type ExternalProjectInvitationResponse = {
  metadata: ExchangeMetadata;
  invitationId: string;
  projectReference: string;
  dataPublicationId?: string;
  decision: "ACCEPTED" | "REJECTED";
  policyAccepted?: boolean;
  message?: string;
  respondedAt: string;
};

export type ExternalDataOfferResponse = z.infer<typeof externalDataOfferResponseSchema>;

export type ExternalDataOffer = {
  metadata: ExchangeMetadata;
  publicationId: string;
  projectReference: string;
  projectName: string;
  title: string;
  dataProductType:
    | "PROJECT_OVERVIEW"
    | "PROJECT_COORDINATION_PACKAGE"
    | "PROJECT_MEMBERSHIP"
    | "TAKT_INFORMATION_PACKAGE";
  publicationVersion: number;
  status: "PUBLISHED" | "SUSPENDED" | "WITHDRAWN";
  contentHash?: string;
  selectedFields: string[];
  detailsRef: string;
  validFrom: string;
  validUntil?: string;
  accessPolicy: ExternalPolicySnapshot;
  usagePolicy: {
    id: string;
    templateId?: string;
    templateVersion?: number;
    code: string;
    name: string;
    purpose: string;
    permissions: string[];
    prohibitions: string[];
    validityRule: string;
    retentionRule: string | null;
  };
  /** Local REST-PoC enrichment; never sent to an external connector. */
  contentSnapshot?: Record<string, unknown>;
};

export type ExternalResourceRequirement = {
  resourceTypeCode: string;
  resourceTypeName: string;
  requiredCapacity: number;
  capacityUnit: string;
  utilizationPercent: number;
  periodStart: string;
  periodEnd: string;
  requiredQualification?: string | null;
};

export type ExternalAlternativeProposal = {
  alternativeId: string;
  rank: number;
  timeWindow: { start: string; end: string };
  crewSize?: number | null;
  conditions?: string | null;
};

export type ExternalServiceRequest = {
  metadata: ExchangeMetadata;
  requestId: string;
  requestVersion: number;
  senderOrganizationName?: string;
  senderUserId?: string;
  requestKind?: "INITIAL" | "SCHEDULE_CHANGE";
  sourceRequestId?: string;
  changeProposalId?: string;
  comment?: string | null;
  baseTimeWindow?: { start: string; end: string };
  revisionContext?: {
    revisionNumber: number;
    previousRequestId: string;
    previousTimeWindow: { start: string; end: string };
    proposedTimeWindow: { start: string; end: string };
    reasonCode?: string | null;
    comment?: string | null;
    createdAt: string;
  };
  projectReference: string;
  projectName?: string;
  leistungReference?: string;
  plannedStart: string;
  plannedEnd: string;
  resourceRequirements: ExternalResourceRequirement[];
  publicSnapshot?: z.infer<typeof TaktRequestSnapshotPayloadSchema>;
  policy?: ExchangePolicy;
  policySnapshot?: ExternalPolicySnapshot;
};

export type ExternalServiceResponse = {
  metadata: ExchangeMetadata;
  requestId: string;
  requestVersion: number;
  requestKind?: "INITIAL" | "SCHEDULE_CHANGE";
  sourceRequestId?: string;
  changeProposalId?: string;
  decision: "ACCEPTED" | "REJECTED" | "ALTERNATIVES_PROPOSED";
  acceptedTimeWindow?: { start: string; end: string };
  reasonCode?: string;
  comment?: string;
  alternatives?: ExternalAlternativeProposal[];
  nextAvailableDate?: string;
};

/** Public AG → AN coordination result. Never contains AN resources or availability details. */
export type ExternalCoordinationDecision = {
  metadata: ExchangeMetadata;
  requestId: string;
  requestVersion: number;
  taktVersion: number;
  decisionType: "CONFIRM_ACCEPTED" | "ACCEPT_ALTERNATIVE" | "REQUEST_REVISION" | "CLOSE_WITHOUT_AGREEMENT";
  acceptedAlternativeId?: string | null;
  confirmedTimeWindow?: { start: string; end: string } | null;
  comment?: string | null;
  closedAt?: string;
};

function policySnapshotParticipantIssues(value: PolicySnapshotParticipantInput): Array<{
  path: string[];
  message: string;
}> {
  if (!value.policySnapshot) return [];

  const issues: Array<{ path: string[]; message: string }> = [];
  if (value.policySnapshot.provider.organizationId !== value.metadata.senderOrgId) {
    issues.push({
      path: ["policySnapshot", "provider", "organizationId"],
      message: "Policy snapshot provider must match metadata.senderOrgId",
    });
  }
  if (value.policySnapshot.recipientOrganizationId !== value.metadata.receiverOrgId) {
    issues.push({
      path: ["policySnapshot", "recipientOrganizationId"],
      message: "Policy snapshot recipient must match metadata.receiverOrgId",
    });
  }
  return issues;
}
