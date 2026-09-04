/**
 * The single domain gate for work on an AN Leistungsanfrage.  Route checks are
 * only presentation concerns; services must call this guard before exposing or
 * changing coordination data so aliases and direct callers have identical
 * policy semantics.
 */
export type LeistungsanfragePolicyAction =
  | "METADATA"
  | "DETAILS"
  | "REVIEW"
  | "RESOURCE"
  | "AVAILABILITY"
  | "ANSWER";

export type LeistungsanfragePolicyState = {
  policyDeltaClass: "WITHIN_BASELINE" | "REQUIRES_CONSENT" | "NOT_PERMITTED" | null;
  policyConsentStatus: "NOT_REQUIRED" | "PENDING" | "ACCEPTED" | "REJECTED";
  /** Effective policy window; evaluated at the point of protected access. */
  validFrom?: string | null;
  validUntil?: string | null;
  retentionUntil?: string | null;
};

export class LeistungsanfragePolicyAccessError extends Error {
  constructor(
    public readonly code: "NOT_PERMITTED" | "POLICY_CONSENT_REQUIRED",
    public readonly action: LeistungsanfragePolicyAction,
  ) {
    super(code);
    this.name = "LeistungsanfragePolicyAccessError";
  }
}

export function policyAccessDecision(
  policy: LeistungsanfragePolicyState,
  action: LeistungsanfragePolicyAction,
  now = new Date(),
): { allowed: boolean; code?: LeistungsanfragePolicyAccessError["code"] } {
  if (action === "METADATA") return { allowed: true };
  const current = now.getTime();
  const start = policy.validFrom ? Date.parse(policy.validFrom) : NaN;
  const end = policy.validUntil ? Date.parse(policy.validUntil) : NaN;
  const retention = policy.retentionUntil ? Date.parse(policy.retentionUntil) : NaN;
  if ((Number.isFinite(start) && current < start) ||
      (Number.isFinite(end) && current > end) ||
      (Number.isFinite(retention) && current > retention)) {
    return { allowed: false, code: "NOT_PERMITTED" };
  }
  if (policy.policyDeltaClass === "NOT_PERMITTED") {
    return { allowed: false, code: "NOT_PERMITTED" };
  }
  if (
    policy.policyDeltaClass === "REQUIRES_CONSENT" &&
    policy.policyConsentStatus !== "ACCEPTED"
  ) {
    return { allowed: false, code: "POLICY_CONSENT_REQUIRED" };
  }
  // WITHIN_BASELINE deliberately has no second-consent requirement. Historic
  // rows with no child policy retain their existing availability.
  return { allowed: true };
}

export function assertLeistungsanfragePolicyAccess(
  policy: LeistungsanfragePolicyState,
  action: Exclude<LeistungsanfragePolicyAction, "METADATA">,
  now?: Date,
): void {
  const decision = policyAccessDecision(policy, action, now);
  if (!decision.allowed) {
    throw new LeistungsanfragePolicyAccessError(decision.code!, action);
  }
}