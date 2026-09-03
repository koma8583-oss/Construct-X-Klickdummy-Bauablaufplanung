import type {
  CoordinationPolicyDeltaClass,
  CoordinationPolicyKind,
  CoordinationPolicyLifecycle,
} from "@workspace/db";
import type { PolicySnapshot } from "./policy-snapshot-service";

export type PolicyDiff = {
  changed: string[];
  addedPermissions: string[];
  removedPermissions: string[];
  summary: string[];
};

export type ConstructXPolicy = PolicySnapshot & {
  policyType: CoordinationPolicyKind;
  policyVersion: number;
  parentPolicyId: string | null;
  inheritFrom: string | null;
  lifecycleStatus: CoordinationPolicyLifecycle;
  deltaClass: CoordinationPolicyDeltaClass | null;
  diff: PolicyDiff | null;
  effectivePolicy: Record<string, unknown>;
};

export type PolicyResolution = {
  deltaClass: CoordinationPolicyDeltaClass;
  diff: PolicyDiff;
  effectivePolicy: Record<string, unknown>;
};

type PolicyComparable = {
  policyType?: CoordinationPolicyKind | string | null;
  templateId?: string | null;
  recipientOrganizationId?: string | null;
  projectReference?: string | null;
  permissions?: readonly string[];
  childPermissions?: readonly string[];
  prohibitions?: readonly string[];
  validFrom?: string | null;
  validUntil?: string | null;
  purpose?: string | null;
  workPackageReference?: string | null;
  selectedFields?: readonly string[];
};

function asComparable(value: unknown): PolicyComparable {
  return value && typeof value === "object" ? value as PolicyComparable : {};
}

function toTime(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function unique(values: readonly string[] | undefined): string[] {
  return [...new Set((values ?? []).filter((value): value is string => typeof value === "string"))];
}

function makeDiff(base: PolicyComparable | null, candidate: PolicyComparable): PolicyDiff {
  const changed: string[] = [];
  const summary: string[] = [];
  const basePermissions = unique(base?.permissions);
  const candidatePermissions = unique(candidate.permissions);
  const addedPermissions = candidatePermissions.filter((value) => !basePermissions.includes(value));
  const removedPermissions = basePermissions.filter((value) => !candidatePermissions.includes(value));

  if (base?.recipientOrganizationId !== candidate.recipientOrganizationId) changed.push("recipientOrganizationId");
  if (base?.projectReference !== candidate.projectReference) changed.push("projectReference");
  if (base?.purpose !== candidate.purpose) changed.push("purpose");
  if (base?.workPackageReference !== candidate.workPackageReference) changed.push("workPackageReference");
  if (JSON.stringify(unique(base?.selectedFields)) !== JSON.stringify(unique(candidate.selectedFields))) {
    changed.push("selectedFields");
  }
  const candidateValidFrom = candidate.validFrom ?? base?.validFrom;
  const candidateValidUntil = candidate.validUntil ?? base?.validUntil;
  if (base?.validFrom !== candidateValidFrom) changed.push("validFrom");
  if (base?.validUntil !== candidateValidUntil) changed.push("validUntil");
  if (addedPermissions.length > 0) changed.push("permissions");
  if (removedPermissions.length > 0) changed.push("permissions");

  if (addedPermissions.length > 0) summary.push(`Zusätzliche Berechtigungen: ${addedPermissions.join(", ")}`);
  if (removedPermissions.length > 0) summary.push(`Eingeschränkte Berechtigungen: ${removedPermissions.join(", ")}`);
  if (base?.validFrom !== candidateValidFrom || base?.validUntil !== candidateValidUntil) {
    summary.push("Der zulässige Zeitraum wurde geändert.");
  }
  if (base?.purpose !== candidate.purpose) summary.push("Der Verwendungszweck wurde geändert.");
  if (base?.workPackageReference !== candidate.workPackageReference) {
    summary.push("Der Arbeitsabschnitt wurde geändert.");
  }

  return { changed, addedPermissions, removedPermissions, summary };
}

/**
 * Resolve a child policy against the accepted Project Agreement.
 *
 * Only the three business outcomes below are returned.  A missing baseline,
 * recipient/project escape, or a permission outside the agreement is never
 * downgraded to a consent prompt.
 */
export function resolvePolicyDelta(
  baseline: PolicyComparable | null | undefined,
  candidate: PolicyComparable,
): PolicyResolution {
  const base = baseline ? asComparable(baseline) : null;
  const diff = makeDiff(base, candidate);
  const candidatePermissions = unique(candidate.permissions);
  const basePermissions = unique(base?.childPermissions ?? base?.permissions);
  const identityMismatch =
    !base ||
    (base.projectReference != null && candidate.projectReference !== base.projectReference) ||
    (base.recipientOrganizationId != null && candidate.recipientOrganizationId !== base.recipientOrganizationId);
  const permissionNotGranted = candidatePermissions.some((permission) => !basePermissions.includes(permission));
  const candidateStart = toTime(candidate.validFrom);
  const candidateEnd = toTime(candidate.validUntil);
  const baseStart = toTime(base?.validFrom);
  const baseEnd = toTime(base?.validUntil);
  const outsideValidity =
    (candidateStart != null && baseStart != null && candidateStart < baseStart) ||
    (candidateEnd != null && baseEnd != null && candidateEnd > baseEnd);

  let deltaClass: CoordinationPolicyDeltaClass;
  if (identityMismatch || permissionNotGranted) {
    deltaClass = "NOT_PERMITTED";
    diff.summary.unshift("Die Anfrage verlässt den vereinbarten Projekt- oder Berechtigungsrahmen.");
  } else {
    const projectAgreementAllowsChildRefinement =
      base?.policyType === "PROJECT_AGREEMENT" ||
      base?.templateId === "PROJECT_MEMBERSHIP" ||
      base?.templateId === "tk-policy-project-membership";
    const meaningfulChanges = projectAgreementAllowsChildRefinement
      // A business purpose, the concrete Leistung and its whitelisted field
      // subset are refinements of the accepted project agreement, not a new
      // grant. Validity/identity/permission expansion remains consent-gated.
      ? diff.changed.filter((field) => !["purpose", "workPackageReference", "selectedFields", "permissions"].includes(field))
      : diff.changed;
    if (outsideValidity || meaningfulChanges.length > 0) {
      deltaClass = "REQUIRES_CONSENT";
    } else {
      deltaClass = "WITHIN_BASELINE";
    }
  }

  return {
    deltaClass,
    diff,
      effectivePolicy: {
        ...(base ?? {}),
        ...candidate,
        validFrom: candidate.validFrom ?? base?.validFrom ?? null,
        validUntil: candidate.validUntil ?? base?.validUntil ?? null,
      },
  };
}

export function createConstructXPolicy(input: {
  baseSnapshot: PolicySnapshot;
  policyType: CoordinationPolicyKind;
  policyVersion?: number;
  parentPolicyId?: string | null;
  lifecycleStatus?: CoordinationPolicyLifecycle;
  deltaClass?: CoordinationPolicyDeltaClass | null;
  diff?: PolicyDiff | null;
  effectivePolicy?: Record<string, unknown>;
}): ConstructXPolicy {
  const policyVersion = input.policyVersion ?? 1;
  return {
    ...input.baseSnapshot,
    policyType: input.policyType,
    policyVersion,
    parentPolicyId: input.parentPolicyId ?? null,
    inheritFrom: input.parentPolicyId ?? null,
    lifecycleStatus: input.lifecycleStatus ?? "PUBLISHED",
    deltaClass: input.deltaClass ?? null,
    diff: input.diff ?? null,
    effectivePolicy: input.effectivePolicy ?? { ...input.baseSnapshot },
  };
}