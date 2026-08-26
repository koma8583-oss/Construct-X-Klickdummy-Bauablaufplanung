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
}

const ENTRIES: readonly PolicyTemplateRegistryEntry[] = [
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
  });
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