/**
 * Code-owned, read-only policy template registry for the policy PoC.
 * Kept separate from the existing policy_templates table so current
 * Dataspace publication consumers remain unchanged.
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
  },
];

const BY_ID = new Map(ENTRIES.map((entry) => [entry.templateId, entry]));
const BY_CODE = new Map(ENTRIES.map((entry) => [entry.code, entry]));

function cloneEntry(entry: PolicyTemplateRegistryEntry): PolicyTemplateRegistryEntry {
  return Object.freeze({
    ...entry,
    requiredParameters: Object.freeze([...entry.requiredParameters]),
    allowedOverrides: Object.freeze([...entry.allowedOverrides]),
    permissions: Object.freeze([...entry.permissions]),
    prohibitions: Object.freeze([...entry.prohibitions]),
  });
}

export function listPolicyTemplateRegistry(): PolicyTemplateRegistryEntry[] {
  return ENTRIES.map(cloneEntry);
}

export function getPolicyTemplateRegistryEntry(ref: string): PolicyTemplateRegistryEntry | null {
  const entry = BY_ID.get(ref) ?? BY_CODE.get(ref);
  return entry ? cloneEntry(entry) : null;
}