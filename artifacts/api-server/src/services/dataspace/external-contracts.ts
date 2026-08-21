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
  localOrgId: string;
  participantId?: string;
  connectorEndpoint?: string;
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