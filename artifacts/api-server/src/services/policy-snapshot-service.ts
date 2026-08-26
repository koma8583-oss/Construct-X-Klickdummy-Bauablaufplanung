import crypto from "node:crypto";
import {
  getPolicyTemplateRegistryEntry,
  type PolicyTemplateParameter,
} from "../lib/policy-template-registry";

export interface AuthenticatedProviderContext {
  readonly organizationId: string;
  readonly userId?: string;
  readonly organizationType?: "AG" | "AN";
}

export interface CreatePolicySnapshotInput {
  readonly templateId: string;
  /** Omit to resolve the newest registered version. */
  readonly templateVersion?: number;
  readonly providerContext: AuthenticatedProviderContext;
  readonly overrides?: Partial<Record<PolicyTemplateParameter, string | null>>;
  readonly providerOrganizationId?: string;
}

export interface PolicySnapshot {
  readonly policyId: string;
  readonly templateId: string;
  readonly templateVersion: number;
  readonly code: string;
  readonly name: string;
  readonly description: string;
  readonly permissions: readonly string[];
  readonly prohibitions: readonly string[];
  readonly provider: Readonly<{ organizationId: string; userId: string | null }>;
  readonly recipientOrganizationId: string;
  readonly purpose: string;
  readonly projectReference: string | null;
  readonly workPackageReference: string | null;
  readonly validFrom: string | null;
  readonly validUntil: string | null;
  readonly createdAt: string;
}

export class PolicySnapshotError extends Error {
  constructor(
    public readonly code:
      | "TEMPLATE_NOT_FOUND"
      | "REQUIRED_PARAMETER_MISSING"
      | "OVERRIDE_NOT_ALLOWED"
      | "PROVIDER_IDENTITY_FORBIDDEN",
    message: string,
  ) {
    super(message);
    this.name = "PolicySnapshotError";
  }
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

export function createPolicySnapshot(input: CreatePolicySnapshotInput): PolicySnapshot {
  const template = getPolicyTemplateRegistryEntry(input.templateId, input.templateVersion);
  if (!template) {
    throw new PolicySnapshotError(
      "TEMPLATE_NOT_FOUND",
      input.templateVersion === undefined
        ? `Policy template not found: ${input.templateId}`
        : `Policy template not found: ${input.templateId} version ${input.templateVersion}`,
    );
  }
  if (!input.providerContext.organizationId || input.providerOrganizationId !== undefined) {
    throw new PolicySnapshotError(
      "PROVIDER_IDENTITY_FORBIDDEN",
      "Provider organisation must come from the authenticated context.",
    );
  }

  const overrides = input.overrides ?? {};
  const allowed = new Set(template.allowedOverrides);
  for (const key of Object.keys(overrides)) {
    if (!allowed.has(key as PolicyTemplateParameter)) {
      throw new PolicySnapshotError("OVERRIDE_NOT_ALLOWED", `Override is not allowed by template: ${key}`);
    }
  }
  const values = overrides as Record<string, string | null | undefined>;
  for (const required of template.requiredParameters) {
    if (typeof values[required] !== "string" || values[required].trim().length === 0) {
      throw new PolicySnapshotError("REQUIRED_PARAMETER_MISSING", `Required policy parameter is missing: ${required}`);
    }
  }
  for (const [key, value] of Object.entries(values)) {
    if (value === null || value === undefined) continue;
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new PolicySnapshotError("OVERRIDE_NOT_ALLOWED", `Policy parameter must be a non-empty string: ${key}`);
    }
    if ((key === "validFrom" || key === "validUntil") && Number.isNaN(Date.parse(value))) {
      throw new PolicySnapshotError("OVERRIDE_NOT_ALLOWED", `Policy date is invalid: ${key}`);
    }
  }

  return deepFreeze({
    policyId: `tk-policy-${crypto.randomUUID()}`,
    templateId: template.templateId,
    templateVersion: template.version,
    code: template.code,
    name: template.name,
    description: template.description,
    permissions: [...template.permissions],
    prohibitions: [...template.prohibitions],
    provider: Object.freeze({
      organizationId: input.providerContext.organizationId,
      userId: input.providerContext.userId ?? null,
    }),
    recipientOrganizationId: values.recipientOrganizationId!,
    purpose: values.purpose!,
    projectReference: values.projectReference ?? null,
    workPackageReference: values.workPackageReference ?? null,
    validFrom: values.validFrom ?? null,
    validUntil: values.validUntil ?? null,
    createdAt: new Date().toISOString(),
  });
}