import { z } from "zod";

const nonEmpty = (max = 512) => z.string().trim().min(1).max(max);
const externalDate = nonEmpty(80).refine((value) => {
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  return dateOnly ? !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) : !Number.isNaN(Date.parse(value));
}, "Must be a valid ISO date or datetime");
const metadataSchema = z.object({
  messageId: nonEmpty(200),
  correlationId: nonEmpty(200),
  schemaVersion: z.literal("1.0"),
  senderOrgId: nonEmpty(200),
  receiverOrgId: nonEmpty(200),
  createdAt: z.string().datetime({ offset: true }),
}).strict();

const policySchema = z.object({
  allowedConsumerOrgId: nonEmpty(200),
  usagePurpose: nonEmpty(200),
  validUntil: externalDate.optional(),
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
  project: z.object({
    projectReference: nonEmpty(200),
    projectName: nonEmpty(500),
    description: z.string().trim().max(4000).optional(),
    location: z.string().trim().max(1000).optional(),
  }).strict(),
  requestedRole: z.literal("CONTRACTOR"),
  purpose: z.literal("PROJECT_COLLABORATION"),
  invitationMessage: z.string().trim().max(4000).optional(),
  validUntil: externalDate.optional(),
  policy: z.object({
    usagePurpose: z.literal("PROJECT_MEMBERSHIP"),
    allowedConsumerParticipantId: nonEmpty(200),
  }).strict(),
  dataOffer: z.object({
    publicationId: nonEmpty(200),
    title: nonEmpty(500),
    dataProductType: z.literal("TAKT_INFORMATION_PACKAGE"),
    selectedFields: z.array(nonEmpty(120)).min(1).max(100),
    policy: z.object({
      id: nonEmpty(200),
      code: nonEmpty(200),
      name: nonEmpty(500),
      purpose: nonEmpty(2000),
      permissions: z.array(nonEmpty(500)).max(100),
      prohibitions: z.array(nonEmpty(500)).max(100),
      validityRule: nonEmpty(2000),
      retentionRule: z.string().trim().max(2000).nullable(),
    }).strict(),
  }).strict().optional(),
}).strict();

export const externalProjectInvitationResponseSchema = z.object({
  metadata: metadataSchema,
  invitationId: nonEmpty(200),
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
      message: "policyAccepted=true is required when accepting a project invitation",
    });
  }
});

export const externalServiceRequestSchema = z.object({
  metadata: metadataSchema,
  requestId: nonEmpty(200),
  requestVersion: z.number().int().min(1),
  projectReference: nonEmpty(200),
  taktReference: nonEmpty(200).optional(),
  plannedStart: externalDate,
  plannedEnd: externalDate,
  resourceRequirements: z.array(resourceRequirementSchema).max(100),
  policy: policySchema.optional(),
}).strict().refine((value) => Date.parse(value.plannedEnd) >= Date.parse(value.plannedStart), {
  message: "plannedEnd must not be before plannedStart",
});

export const externalServiceResponseSchema = z.object({
  metadata: metadataSchema,
  requestId: nonEmpty(200),
  requestVersion: z.number().int().min(1),
  decision: z.enum(["ACCEPTED", "REJECTED", "ALTERNATIVES_PROPOSED"]),
  alternatives: z.array(alternativeSchema).max(3).optional(),
}).strict().superRefine((value, ctx) => {
  if (value.decision === "ALTERNATIVES_PROPOSED" && (!value.alternatives || value.alternatives.length === 0)) {
    ctx.addIssue({ code: "custom", path: ["alternatives"], message: "alternatives are required for ALTERNATIVES_PROPOSED" });
  }
});

export type ExchangeMetadata = {
  messageId: string;
  correlationId: string;
  schemaVersion: string;
  senderOrgId: string;
  receiverOrgId: string;
  createdAt: string;
};

export type ExchangePolicy = {
  allowedConsumerOrgId: string;
  usagePurpose: string;
  validUntil?: string;
};

export type DataspaceParticipant = {
  localOrgId?: string;
  participantId: string;
  organizationName: string;
  organizationType: "AG" | "AN";
  identityStatus: "VERIFIED" | "UNVERIFIED" | "SUSPENDED";
  connectorEndpoint?: string;
  connectorStatus: "AVAILABLE" | "UNAVAILABLE" | "UNKNOWN";
  capabilities?: string[];
};

export type ExternalProjectInvitation = {
  metadata: ExchangeMetadata;
  invitationId: string;
  project: {
    projectReference: string;
    projectName: string;
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
  };
  dataOffer?: {
    publicationId: string;
    title: string;
    dataProductType: "TAKT_INFORMATION_PACKAGE";
    selectedFields: string[];
    policy: {
      id: string;
      code: string;
      name: string;
      purpose: string;
      permissions: string[];
      prohibitions: string[];
      validityRule: string;
      retentionRule: string | null;
    };
  };
};

export type ExternalProjectInvitationResponse = {
  metadata: ExchangeMetadata;
  invitationId: string;
  projectReference: string;
  decision: "ACCEPTED" | "REJECTED";
  policyAccepted?: boolean;
  message?: string;
  respondedAt: string;
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
  projectReference: string;
  taktReference?: string;
  plannedStart: string;
  plannedEnd: string;
  resourceRequirements: ExternalResourceRequirement[];
  policy?: ExchangePolicy;
};

export type ExternalServiceResponse = {
  metadata: ExchangeMetadata;
  requestId: string;
  requestVersion: number;
  decision: "ACCEPTED" | "REJECTED" | "ALTERNATIVES_PROPOSED";
  alternatives?: ExternalAlternativeProposal[];
};