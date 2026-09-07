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