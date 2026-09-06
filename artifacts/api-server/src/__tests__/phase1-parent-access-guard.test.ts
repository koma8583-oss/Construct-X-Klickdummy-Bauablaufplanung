import { describe, expect, it } from "vitest";
import {
  LeistungsanfragePolicyAccessError,
  assertLeistungsanfragePolicyAccess,
  policyAccessDecision,
} from "../services/leistungsanfrage-policy-guard";

// AVAILABILITY is also the domain gate used before an AN schedule-change
// proposal is created.
const protectedActions = ["DETAILS", "REVIEW", "RESOURCE", "AVAILABILITY", "ANSWER"] as const;

describe("Phase 1 synchronized parent access gate", () => {
  it("keeps metadata but denies every protected action after membership revocation", () => {
    const policy = {
      policyDeltaClass: "WITHIN_BASELINE" as const,
      policyConsentStatus: "NOT_REQUIRED" as const,
      parentMembershipStatus: "REVOKED" as const,
      parentAgreementStatus: "ACCEPTED",
    };
    expect(policyAccessDecision(policy, "METADATA").allowed).toBe(true);
    for (const action of protectedActions) {
      expect(() => assertLeistungsanfragePolicyAccess(policy, action)).toThrow(LeistungsanfragePolicyAccessError);
    }
  });

  it("denies a delivered request when its synchronized PROJECT_AGREEMENT is revoked", () => {
    const policy = {
      policyDeltaClass: "WITHIN_BASELINE" as const,
      policyConsentStatus: "NOT_REQUIRED" as const,
      parentMembershipStatus: "ACTIVE" as const,
      parentAgreementStatus: "REVOKED",
    };
    expect(policyAccessDecision(policy, "METADATA").allowed).toBe(true);
    for (const action of protectedActions) {
      expect(policyAccessDecision(policy, action).allowed).toBe(false);
    }
  });

  it("evaluates synchronized parent expiry at access time without hiding metadata", () => {
    const policy = {
      policyDeltaClass: "WITHIN_BASELINE" as const,
      policyConsentStatus: "NOT_REQUIRED" as const,
      parentMembershipStatus: "ACTIVE" as const,
      parentAgreementStatus: "ACCEPTED",
      validUntil: "2025-01-01T00:00:00.000Z",
    };
    const afterExpiry = new Date("2025-01-01T00:00:01.000Z");
    expect(policyAccessDecision(policy, "METADATA", afterExpiry).allowed).toBe(true);
    for (const action of protectedActions) {
      expect(policyAccessDecision(policy, action, afterExpiry).allowed).toBe(false);
    }
  });

  it("denies each synchronized membership status other than ACTIVE", () => {
    for (const parentMembershipStatus of ["INVITED", "REJECTED", "REVOKED"] as const) {
      expect(policyAccessDecision({
        policyDeltaClass: "WITHIN_BASELINE",
        policyConsentStatus: "NOT_REQUIRED",
        parentMembershipStatus,
        parentAgreementStatus: "ACCEPTED",
      }, "DETAILS").allowed).toBe(false);
    }
  });
});