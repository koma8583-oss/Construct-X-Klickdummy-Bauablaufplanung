/**
 * Code-owned, read-only policy template registry.
 *
 * The database policy_templates rows remain the compatibility representation
 * used by the existing publication UI. Their code is resolved here, so policy
 * creation has one canonical source and can address an exact version.
 */
export type PolicyTemplateParameter =
  | "recipientOrganizationId"
  | "purpose"
  | "projectReference"
  | "validFrom"
  | "validUntil"
  | "workPackageReference";

export interface PolicyTemplateRegistryEntry {
  readonly templateId: string;
  readonly version: number;
  readonly code: string;
  readonly name: string;
  readonly description: string;
  readonly purpose: string;
  readonly requiredParameters: readonly PolicyTemplateParameter[];
  readonly allowedOverrides: readonly PolicyTemplateParameter[];
  readonly permissions: readonly string[];
  readonly prohibitions: readonly string[];
  readonly validityRule: string;
  readonly retentionRule: string | null;
  readonly allowedPublicationFields?: readonly string[];
}

/**
 * Policy choices supported by the AG data-publication wizard.
 *
 * These are intentionally separate from the broader registry above. The
 * registry also contains templates used by other Dataspace flows, while this
 * catalog is the public contract for creating data publications.
 */
const RAHMENTERMIN_PUBLICATION_FIELDS = [
  "projectReference",
  "projectName",
  "projectStatus",
  "startDate",
  "endDate",
  "projectLocation",
  "projectDescription",
  "kurzbezeichnung",
  "workPackage",
  "trade",
  "plannedTimeWindow",
  "bufferTimeWindow",
  "location",
  "executionNotes",
  "predecessors",
  "successors",
] as const;

const LEISTUNGSFREIGABE_PUBLICATION_FIELDS = [
  ...RAHMENTERMIN_PUBLICATION_FIELDS,
  "resourceRequirements",
] as const;

const PROJECT_MEMBERSHIP_FIELDS = [
  "projectReference",
  "projectName",
  "projectStatus",
  "projectLocation",
] as const;

const PUBLICATION_ENTRIES: readonly PolicyTemplateRegistryEntry[] = [
  {
    templateId: "tk-policy-schedule-coordination",
    version: 4,
    code: "SCHEDULE_COORDINATION",
    name: "Abstimmung von Rahmenterminen",
    description:
      "Allgemeine Projektinformationen und konkrete Angaben zur angefragten Leistung für die Abstimmung von Rahmenterminen.",
    purpose: "scheduleCoordination",
    requiredParameters: ["recipientOrganizationId", "purpose", "projectReference"],
    allowedOverrides: ["recipientOrganizationId", "purpose", "projectReference", "validFrom", "validUntil"],
    allowedPublicationFields: RAHMENTERMIN_PUBLICATION_FIELDS,
    permissions: ["READ", "USE_FOR_SCHEDULE_COORDINATION"],
    prohibitions: [
      "REDISTRIBUTE",
      "SHARE_OUTSIDE_PROJECT_TEAM",
      "DERIVE",
      "MODIFY",
      "COMMERCIAL_REUSE",
      "AI_TRAINING",
    ],
    validityRule: "Ausschließlich für die Rahmentermin-Abstimmung im konkreten Projekt.",
    retentionRule: null,
  },
  {
    templateId: "tk-policy-performance-coordination",
    version: 1,
    code: "PERFORMANCE_COORDINATION",
    name: "Leistungsfreigabe",
    description:
      "Leistungsbezogene Freigabe der wesentlichen Informationen zu einer konkret vergebenen Leistung einschließlich ihrer Vor- und Nachfolger.",
    purpose: "performanceCoordination",
    requiredParameters: ["recipientOrganizationId", "purpose", "projectReference", "workPackageReference"],
    allowedOverrides: [
      "recipientOrganizationId", "purpose", "projectReference",
      "workPackageReference", "validFrom", "validUntil",
    ],
    allowedPublicationFields: LEISTUNGSFREIGABE_PUBLICATION_FIELDS,
    permissions: ["READ", "DOWNLOAD", "USE_FOR_PERFORMANCE_COORDINATION"],
    prohibitions: ["REDISTRIBUTE", "SHARE_OUTSIDE_PROJECT_TEAM", "COMMERCIAL_REUSE", "AI_TRAINING"],
    validityRule: "Gilt nur für die konkret vergebene Leistung im konkreten Projekt.",
    retentionRule: "Nur so lange speichern, wie die Leistungskoordination dies erfordert.",
  },
];

const ENTRIES: readonly PolicyTemplateRegistryEntry[] = [
  {
    templateId: "tk-policy-project-membership",
    version: 1,
    code: "PROJECT_MEMBERSHIP",
    name: "Projektaufnahme",
    description:
      "Schlanke Projektaufnahme mit wenigen grundlegenden Projektinformationen. Diese Policy begründet nach Annahme die Projektmitgliedschaft.",
    purpose: "projectMembership",
    requiredParameters: ["recipientOrganizationId", "purpose", "projectReference"],
    allowedOverrides: ["recipientOrganizationId", "purpose", "projectReference", "validFrom", "validUntil"],
    allowedPublicationFields: PROJECT_MEMBERSHIP_FIELDS,
    permissions: ["READ", "USE_AS_PROJECT_PARTNER"],
    prohibitions: [
      "REDISTRIBUTE",
      "SHARE_OUTSIDE_PROJECT_TEAM",
      "DERIVE",
      "MODIFY",
      "COMMERCIAL_REUSE",
      "AI_TRAINING",
    ],
    validityRule: "Ausschließlich für die Aufnahme der Organisation in das konkrete Projekt.",
    retentionRule: null,
  },
  {
    templateId: "tk-policy-standard-data-exchange",
    version: 1,
    code: "STANDARD_DATA_EXCHANGE",
    name: "Standard-Datenaustausch",
    description: "Begrenzter Austausch freigegebener Informationen zwischen Organisationen.",
    purpose: "standardDataExchange",
    requiredParameters: ["recipientOrganizationId", "purpose"],
    allowedOverrides: ["recipientOrganizationId", "purpose", "validFrom", "validUntil"],
    permissions: ["READ", "DOWNLOAD"],
    prohibitions: ["REDISTRIBUTE", "DERIVE", "MODIFY"],
    validityRule: "Gilt für den freigegebenen Datenaustausch.",
    retentionRule: "Nach Ende der Gültigkeit nicht mehr benötigte Kopien löschen.",
  },
  {
    templateId: "tk-policy-project-coordination",
    version: 1,
    code: "PROJECT_COORDINATION",
    name: "Projektkoordination",
    description: "Projektbezogene Nutzung für die gemeinsame Ablaufkoordination.",
    purpose: "projectCoordination",
    requiredParameters: ["recipientOrganizationId", "purpose", "projectReference"],
    allowedOverrides: ["recipientOrganizationId", "purpose", "projectReference", "validFrom", "validUntil"],
    permissions: ["READ", "DOWNLOAD", "USE_FOR_PROJECT_COORDINATION"],
    prohibitions: ["REDISTRIBUTE", "COMMERCIALIZE", "AI_TRAINING"],
    validityRule: "Gilt ausschließlich für das konkrete Projekt und die Projektkoordination.",
    retentionRule: "Nur so lange speichern, wie die Projektkoordination dies erfordert.",
  },
  {
    templateId: "tk-policy-project-coordination",
    version: 2,
    code: "PROJECT_COORDINATION",
    name: "Projektkoordination",
    description: "Versionierte projektbezogene Nutzung für die gemeinsame Ablaufkoordination.",
    purpose: "projectCoordination",
    requiredParameters: ["recipientOrganizationId", "purpose", "projectReference"],
    allowedOverrides: ["recipientOrganizationId", "purpose", "projectReference", "validFrom", "validUntil"],
    permissions: ["READ", "DOWNLOAD", "USE_FOR_PROJECT_COORDINATION"],
    prohibitions: ["REDISTRIBUTE", "COMMERCIALIZE", "AI_TRAINING"],
    validityRule: "Gilt ausschließlich für das konkrete Projekt und die Projektkoordination.",
    retentionRule: "Nur so lange speichern, wie die Projektkoordination dies erfordert.",
  },
  {
    templateId: "tk-policy-schedule-coordination",
    version: 1,
    code: "SCHEDULE_COORDINATION",
    name: "Projektkoordination",
    description: "Projektbezogene Nutzung für die gemeinsame Ablaufkoordination.",
    purpose: "projectCoordination",
    requiredParameters: ["recipientOrganizationId", "purpose", "projectReference"],
    allowedOverrides: ["recipientOrganizationId", "purpose", "projectReference", "validFrom", "validUntil"],
    permissions: ["READ", "DOWNLOAD", "USE_FOR_PROJECT_COORDINATION"],
    prohibitions: ["REDISTRIBUTE", "COMMERCIALIZE", "AI_TRAINING"],
    validityRule: "Gilt ausschließlich für das konkrete Projekt und die Projektkoordination.",
    retentionRule: "Nur so lange speichern, wie die Projektkoordination dies erfordert.",
  },
  {
    templateId: "tk-policy-schedule-coordination",
    version: 2,
    code: "SCHEDULE_COORDINATION",
    name: "Projektkoordination",
    description: "Versionierte projektbezogene Nutzung für die gemeinsame Ablaufkoordination.",
    purpose: "projectCoordination",
    requiredParameters: ["recipientOrganizationId", "purpose", "projectReference"],
    allowedOverrides: ["recipientOrganizationId", "purpose", "projectReference", "validFrom", "validUntil"],
    permissions: ["READ", "DOWNLOAD", "USE_FOR_PROJECT_COORDINATION"],
    prohibitions: ["REDISTRIBUTE", "COMMERCIALIZE", "AI_TRAINING"],
    validityRule: "Gilt ausschließlich für das konkrete Projekt und die Projektkoordination.",
    retentionRule: "Nur so lange speichern, wie die Projektkoordination dies erfordert.",
  },
  {
    templateId: "tk-policy-schedule-coordination",
    version: 3,
    code: "SCHEDULE_COORDINATION",
    name: "Rahmentermin-Abstimmung – interne Nutzung",
    description:
      "Allgemeine Projektinformationen und konkrete Angaben zur angefragten Leistung für die Abstimmung von Rahmenterminen.",
    purpose: "scheduleCoordination",
    requiredParameters: ["recipientOrganizationId", "purpose", "projectReference"],
    allowedOverrides: ["recipientOrganizationId", "purpose", "projectReference", "validFrom", "validUntil"],
    allowedPublicationFields: RAHMENTERMIN_PUBLICATION_FIELDS,
    permissions: ["READ", "USE_FOR_SCHEDULE_COORDINATION"],
    prohibitions: [
      "REDISTRIBUTE",
      "SHARE_OUTSIDE_PROJECT_TEAM",
      "DERIVE",
      "MODIFY",
      "COMMERCIAL_REUSE",
      "AI_TRAINING",
    ],
    validityRule: "Ausschließlich für die Rahmentermin-Abstimmung im konkreten Projekt.",
    retentionRule: "Löschung spätestens 30 Tage nach Abschluss der Abstimmung oder nach Projektende.",
  },
  {
    templateId: "tk-policy-schedule-coordination",
    version: 4,
    code: "SCHEDULE_COORDINATION",
    name: "Abstimmung von Rahmenterminen",
    description:
      "Allgemeine Projektinformationen und konkrete Angaben zur angefragten Leistung für die Abstimmung von Rahmenterminen.",
    purpose: "scheduleCoordination",
    requiredParameters: ["recipientOrganizationId", "purpose", "projectReference"],
    allowedOverrides: ["recipientOrganizationId", "purpose", "projectReference", "validFrom", "validUntil"],
    allowedPublicationFields: RAHMENTERMIN_PUBLICATION_FIELDS,
    permissions: ["READ", "USE_FOR_SCHEDULE_COORDINATION"],
    prohibitions: [
      "REDISTRIBUTE",
      "SHARE_OUTSIDE_PROJECT_TEAM",
      "DERIVE",
      "MODIFY",
      "COMMERCIAL_REUSE",
      "AI_TRAINING",
    ],
    validityRule: "Ausschließlich für die Rahmentermin-Abstimmung im konkreten Projekt.",
    retentionRule: null,
  },
  {
    templateId: "tk-policy-performance-coordination",
    version: 1,
    code: "PERFORMANCE_COORDINATION",
    name: "Leistungskoordination",
    description: "Leistungsbezogene Nutzung für Arbeitspakete und Zeitfenster.",
    purpose: "performanceCoordination",
    requiredParameters: ["recipientOrganizationId", "purpose", "projectReference", "workPackageReference"],
    allowedOverrides: [
      "recipientOrganizationId", "purpose", "projectReference",
      "workPackageReference", "validFrom", "validUntil",
    ],
    permissions: ["READ", "DOWNLOAD", "USE_FOR_PERFORMANCE_COORDINATION"],
    prohibitions: ["REDISTRIBUTE", "COMMERCIALIZE", "AI_TRAINING"],
    validityRule: "Gilt für das konkrete Projekt und Arbeitspaket.",
    retentionRule: "Nur so lange speichern, wie die Leistungskoordination dies erfordert.",
  },
];

function cloneEntry(entry: PolicyTemplateRegistryEntry): PolicyTemplateRegistryEntry {
  return Object.freeze({
    ...entry,
    requiredParameters: Object.freeze([...entry.requiredParameters]),
    allowedOverrides: Object.freeze([...entry.allowedOverrides]),
    permissions: Object.freeze([...entry.permissions]),
    prohibitions: Object.freeze([...entry.prohibitions]),
    ...(entry.allowedPublicationFields
      ? { allowedPublicationFields: Object.freeze([...entry.allowedPublicationFields]) }
      : {}),
  });
}

export function listPublicationPolicyTemplates(): PolicyTemplateRegistryEntry[] {
  return PUBLICATION_ENTRIES.map(cloneEntry);
}

export function getPublicationPolicyTemplate(ref: string): PolicyTemplateRegistryEntry | null {
  const entry = PUBLICATION_ENTRIES.find(
    (candidate) => candidate.templateId === ref || candidate.code === ref,
  );
  return entry ? cloneEntry(entry) : null;
}

export function listPolicyTemplateRegistry(options?: {
  readonly latestOnly?: boolean;
}): PolicyTemplateRegistryEntry[] {
  const entries = options?.latestOnly
    ? [...new Set(ENTRIES.map((entry) => entry.code))].map((code) =>
        ENTRIES
          .filter((entry) => entry.code === code)
          .sort((a, b) => b.version - a.version)[0],
      )
    : ENTRIES;
  return entries.filter(Boolean).map(cloneEntry);
}

export function getPolicyTemplateRegistryEntry(
  ref: string,
  version?: number,
): PolicyTemplateRegistryEntry | null {
  const candidates = ENTRIES.filter((entry) => entry.templateId === ref || entry.code === ref);
  const entry = version === undefined
    ? candidates.sort((a, b) => b.version - a.version)[0]
    : candidates.find((candidate) => candidate.version === version);
  return entry ? cloneEntry(entry) : null;
}

export function getLatestPolicyTemplateRegistryEntry(ref: string): PolicyTemplateRegistryEntry | null {
  return getPolicyTemplateRegistryEntry(ref);
}