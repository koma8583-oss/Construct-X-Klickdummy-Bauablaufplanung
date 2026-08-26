import type { PolicySnapshot } from "./policy-snapshot-service";

type LegacyPolicy = {
  readonly id: string;
  readonly validityRule: string;
  readonly retentionRule: string | null;
};

/**
 * Converts the canonical snapshot into the two legacy-compatible policy
 * presentations in a project invitation. Rights and identity always come from
 * the snapshot; the database row is retained only for its stable compatibility
 * id and human-readable lifecycle text.
 */
export function toInvitationPolicy(
  snapshot: PolicySnapshot,
  participantId: string,
) {
  return {
    usagePurpose: "PROJECT_MEMBERSHIP" as const,
    allowedConsumerParticipantId: participantId,
    templateId: snapshot.templateId,
    templateVersion: snapshot.templateVersion,
    templateCode: snapshot.code,
    templateName: snapshot.name,
    purpose: snapshot.purpose,
    permissions: [...snapshot.permissions],
    prohibitions: [...snapshot.prohibitions],
  };
}

export function toDataOfferPolicy(
  snapshot: PolicySnapshot,
  legacyPolicy: LegacyPolicy,
) {
  return {
    id: legacyPolicy.id,
    templateId: snapshot.templateId,
    templateVersion: snapshot.templateVersion,
    code: snapshot.code,
    name: snapshot.name,
    purpose: snapshot.purpose,
    permissions: [...snapshot.permissions],
    prohibitions: [...snapshot.prohibitions],
    validityRule: legacyPolicy.validityRule,
    retentionRule: legacyPolicy.retentionRule,
  };
}