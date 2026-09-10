/** Authoritative business-purpose and field catalog for child Leistungsfreigaben. */
export const LEISTUNGSFREIGABE_FIELD_WHITELISTS = {
  RAHMENTERMINE: [
    'trade', 'workPackage', 'kurzbezeichnung',
    'location', 'plannedTimeWindow', 'bufferTimeWindow', 'predecessors', 'successors',
  ],
  LEISTUNGSKOORDINATION: [
    'taktReference', 'taktVersion', 'trade', 'workPackage', 'kurzbezeichnung',
    'location', 'plannedTimeWindow', 'bufferTimeWindow', 'requiredOutput',
    'resourceRequirements', 'constraints', 'predecessors', 'successors', 'documentReferences',
  ],
  AUSFUEHRUNGSINFORMATIONEN: [
    'taktReference', 'taktVersion', 'trade', 'workPackage', 'kurzbezeichnung',
    'location', 'plannedTimeWindow', 'bufferTimeWindow', 'requiredOutput',
    'constraints', 'predecessors', 'successors', 'documentReferences',
  ],
  INDIVIDUELLE_FREIGABE: [
    'taktReference', 'taktVersion', 'trade', 'workPackage', 'kurzbezeichnung',
    'location', 'plannedTimeWindow', 'bufferTimeWindow', 'requiredOutput',
    'resourceRequirements', 'constraints', 'predecessors', 'successors', 'documentReferences',
  ],
} as const;

export type LeistungsfreigabePurpose = keyof typeof LEISTUNGSFREIGABE_FIELD_WHITELISTS;

export const LEISTUNGSFREIGABE_PURPOSES = Object.freeze(
  Object.keys(LEISTUNGSFREIGABE_FIELD_WHITELISTS) as LeistungsfreigabePurpose[],
);

export const LEISTUNGSFREIGABE_PARENT_FIELD_SCOPE = Object.freeze([
  ...new Set(Object.values(LEISTUNGSFREIGABE_FIELD_WHITELISTS).flat()),
]);

export const PARENT_COVERED_LEISTUNGSFREIGABE_FIELDS = new Set([
  'projectLocation',
  'projectDescription',
]);

/**
 * A project agreement can authorize child performance coordination only when
 * both dimensions of that authorization are explicit. Older agreements may
 * omit one or both lists; those records are intentionally not treated as
 * unrestricted.
 */
export function hasExplicitLeistungsfreigabeScope(
  policy: unknown,
): boolean {
  if (!policy || typeof policy !== 'object') return false;
  const candidate = policy as Record<string, unknown>;
  return [candidate.allowedPurposes, candidate.allowedFieldScope].every(
    (value) => Array.isArray(value) && value.every((item) => typeof item === 'string'),
  );
}