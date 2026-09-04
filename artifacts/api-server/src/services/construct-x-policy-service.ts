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
  childPolicyTypes?: readonly string[];
  prohibitions?: readonly string[];
  retentionUntil?: string | null;
  allowedPurposes?: readonly string[];
  allowedFieldScope?: readonly string[];
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
  if (JSON.stringify(unique(base?.prohibitions)) !== JSON.stringify(unique(candidate.prohibitions))) {
    changed.push("prohibitions");
  }
  const baseValidFrom = base?.validFrom ?? null;
  const baseValidUntil = base?.validUntil ?? null;
  const candidateValidFrom = candidate.validFrom ?? baseValidFrom;
  const candidateValidUntil = candidate.validUntil ?? baseValidUntil;
  if (baseValidFrom !== candidateValidFrom) changed.push("validFrom");
  if (baseValidUntil !== candidateValidUntil) changed.push("validUntil");
  if (addedPermissions.length > 0) changed.push("permissions");
  if (removedPermissions.length > 0) changed.push("permissions");

  if (addedPermissions.length > 0) summary.push(`Zusätzliche Berechtigungen: ${addedPermissions.join(", ")}`);
  if (removedPermissions.length > 0) summary.push(`Eingeschränkte Berechtigungen: ${removedPermissions.join(", ")}`);
  if (baseValidFrom !== candidateValidFrom || baseValidUntil !== candidateValidUntil) {
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
  const candidateType = candidate.policyType ?? "PERFORMANCE_REQUEST";
  // A Project Agreement which predates the explicit child-policy vocabulary
  // still permits the one child it was always used for.  Any explicitly
  // declared vocabulary is authoritative, however.
  const allowedChildTypes = unique(base?.childPolicyTypes);
  const typeNotGranted = !base ||
    (allowedChildTypes.length > 0
      ? !allowedChildTypes.includes(candidateType)
      : candidateType !== "PERFORMANCE_REQUEST");
  const identityMismatch =
    !base ||
    (base.projectReference != null && candidate.projectReference !== base.projectReference) ||
    (base.recipientOrganizationId != null && candidate.recipientOrganizationId !== base.recipientOrganizationId);
  const permissionNotGranted = candidatePermissions.some((permission) => !basePermissions.includes(permission));
  const baseProhibitions = unique(base?.prohibitions);
  const candidateProhibitions = unique(candidate.prohibitions);
  // Prohibitions are inherited, never replaced.  A candidate may repeat them
  // (recommended for a self-contained wire snapshot) or omit them; omission
  // cannot remove them from the effective policy below.
  const removedProhibitions = baseProhibitions.filter((prohibition) =>
    candidateProhibitions.length > 0 && !candidateProhibitions.includes(prohibition),
  );
  const candidateStart = toTime(candidate.validFrom);
  const candidateEnd = toTime(candidate.validUntil);
  const baseStart = toTime(base?.validFrom);
  const baseEnd = toTime(base?.validUntil);
  const outsideValidity =
    (candidateStart != null && baseStart != null && candidateStart < baseStart) ||
    (candidateEnd != null && baseEnd != null && candidateEnd > baseEnd);
  const candidateRetention = toTime(candidate.retentionUntil);
  const baseRetention = toTime(base?.retentionUntil);
  const broadenedRetention =
    candidateRetention != null && baseRetention != null && candidateRetention > baseRetention;
  const purposeNotAllowed = Boolean(
    base?.allowedPurposes?.length &&
    candidate.purpose &&
    !base.allowedPurposes.includes(candidate.purpose),
  );
  const allowedFieldScope = unique(base?.allowedFieldScope);
  const fieldScopeNotAllowed = allowedFieldScope.length > 0 &&
    unique(candidate.selectedFields).some((field) => !allowedFieldScope.includes(field));

  let deltaClass: CoordinationPolicyDeltaClass;
  if (
    identityMismatch || typeNotGranted || permissionNotGranted ||
    purposeNotAllowed || fieldScopeNotAllowed
  ) {
    deltaClass = "NOT_PERMITTED";
    diff.summary.unshift("Die Anfrage verlässt den vereinbarten Projekt-, Zweck- oder Berechtigungsrahmen.");
  } else {
    const projectAgreementAllowsChildRefinement =
      base?.policyType === "PROJECT_AGREEMENT" ||
      base?.templateId === "PROJECT_MEMBERSHIP" ||
      base?.templateId === "tk-policy-project-membership" ||
      // An accepted performance policy that explicitly grants schedule
      // children may refine the concrete schedule purpose/window.  It remains
      // unable to broaden identity, permissions, validity or prohibitions.
      (candidateType === "SCHEDULE_CHANGE" &&
        unique(base?.childPolicyTypes).includes("SCHEDULE_CHANGE"));
    const meaningfulChanges = projectAgreementAllowsChildRefinement
      // A business purpose, the concrete Leistung and its whitelisted field
      // subset are refinements of the accepted project agreement, not a new
      // grant. Validity/identity/permission expansion remains consent-gated.
      ? diff.changed.filter((field) => ![
        "purpose", "workPackageReference", "selectedFields", "permissions", "prohibitions",
        // Schedule-child windows are refinements; outsideValidity above still
        // rejects a window escaping an explicit parent validity interval.
        ...(candidateType === "SCHEDULE_CHANGE" ? ["validFrom", "validUntil"] : []),
      ].includes(field))
      : diff.changed;
    if (outsideValidity || broadenedRetention || removedProhibitions.length > 0 || meaningfulChanges.length > 0) {
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
        policyType: candidateType,
        prohibitions: unique([...baseProhibitions, ...candidateProhibitions]),
        validFrom: candidate.validFrom ?? base?.validFrom ?? null,
        validUntil: candidate.validUntil ?? base?.validUntil ?? null,
        retentionUntil: candidate.retentionUntil ?? base?.retentionUntil ?? null,
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