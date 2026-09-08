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
  duties?: readonly unknown[];
  constraints?: readonly unknown[];
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

/** Preserve restrictive ODRL terms from every ancestor without relying on object identity. */
function inheritedTerms(
  parent: readonly unknown[] | undefined,
  child: readonly unknown[] | undefined,
): unknown[] {
  const result: unknown[] = [];
  const seen = new Set<string>();
  for (const term of [...(parent ?? []), ...(child ?? [])]) {
    const serialized = JSON.stringify(term);
    if (!seen.has(serialized)) {
      seen.add(serialized);
      result.push(term);
    }
  }
  return result;
}

function inheritedPolicy(base: PolicyComparable | null, candidate: PolicyComparable, candidateType: string) {
  return {
    ...(base ?? {}),
    ...candidate,
    policyType: candidateType,
    // A child can add a restriction but can never discard an ancestor's
    // prohibition, duty, or constraint.
    prohibitions: unique([...unique(base?.prohibitions), ...unique(candidate.prohibitions)]),
    duties: inheritedTerms(base?.duties, candidate.duties),
    constraints: inheritedTerms(base?.constraints, candidate.constraints),
    validFrom: candidate.validFrom ?? base?.validFrom ?? null,
    validUntil: candidate.validUntil ?? base?.validUntil ?? null,
    retentionUntil: candidate.retentionUntil ?? base?.retentionUntil ?? null,
  };
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
  const prohibitionConvertedToPermission = candidatePermissions.some((permission) =>
    baseProhibitions.includes(permission),
  );
  // Prohibitions are inherited, never replaced.  A candidate may repeat them
  // (recommended for a self-contained wire snapshot) or omit them; omission
  // cannot remove them from the effective policy below.
  // A generated child template carries its own restrictive terms, but that
  // list is not a replacement for the parent's terms.  Explicit hand-authored
  // prohibition lists remain authoritative for removal detection.
  const generatedTemplateChild =
    typeof candidate.templateId === "string" &&
    candidate.templateId.startsWith("tk-policy-");
  const removedProhibitions = baseProhibitions.filter((prohibition) =>
    !generatedTemplateChild &&
    Object.prototype.hasOwnProperty.call(candidate, "prohibitions") &&
    !candidateProhibitions.includes(prohibition),
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
  const allowedPurposes = Array.isArray(base?.allowedPurposes)
    ? unique(base.allowedPurposes)
    : undefined;
  const purposeNotAllowed = allowedPurposes !== undefined &&
    (!candidate.purpose || !allowedPurposes.includes(candidate.purpose));
  const allowedFieldScope = Array.isArray(base?.allowedFieldScope)
    ? unique(base.allowedFieldScope)
    : undefined;
  const fieldScopeNotAllowed = allowedFieldScope !== undefined &&
    unique(candidate.selectedFields).some((field) => !allowedFieldScope.includes(field));

  let deltaClass: CoordinationPolicyDeltaClass;
  if (
    identityMismatch || typeNotGranted || permissionNotGranted || prohibitionConvertedToPermission ||
    removedProhibitions.length > 0 ||
    outsideValidity || broadenedRetention ||
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
      // The concrete Leistung, field subset and narrower validity interval are
      // refinements, not new grants. Leistungskoordination is the baseline
      // child purpose; another allowed purpose is a deliberate per-request
      // delta and therefore needs the AN's explicit consent.
      ? diff.changed.filter((field) => ![
        ...(
          allowedPurposes === undefined ||
          candidate.purpose === "LEISTUNGSKOORDINATION"
            ? ["purpose"]
            : []
        ),
        "workPackageReference", "selectedFields", "permissions", "prohibitions",
        // A child may narrow its capability window. Escaping the parent
        // interval is rejected above for every child type.
        "validFrom", "validUntil",
      ].includes(field))
      : diff.changed;
    if (removedProhibitions.length > 0 || meaningfulChanges.length > 0) {
      deltaClass = "REQUIRES_CONSENT";
    } else {
      deltaClass = "WITHIN_BASELINE";
    }
  }

  return {
    deltaClass,
    diff,
    effectivePolicy: inheritedPolicy(base, candidate, candidateType),
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
  // policySnapshot is the Dataspace wire representation.  It must remain
  // self-contained, rather than requiring receivers to recover restrictions
  // by following parentPolicyId in a different Dataspace.
  const effectivePolicy = input.effectivePolicy ?? { ...input.baseSnapshot };
  const inheritedSnapshot = {
    ...input.baseSnapshot,
    ...Object.fromEntries(
      [
        "permissions", "childPermissions", "childPolicyTypes", "allowedPurposes", "allowedFieldScope",
        "prohibitions", "duties", "constraints", "validFrom", "validUntil", "retentionUntil",
      ]
        .filter((key) => key in effectivePolicy)
        .map((key) => [key, effectivePolicy[key]]),
    ),
  };
  return {
    ...inheritedSnapshot,
    policyType: input.policyType,
    policyVersion,
    parentPolicyId: input.parentPolicyId ?? null,
    inheritFrom: input.parentPolicyId ?? null,
    lifecycleStatus: input.lifecycleStatus ?? "PUBLISHED",
    deltaClass: input.deltaClass ?? null,
    diff: input.diff ?? null,
    effectivePolicy,
  };
}