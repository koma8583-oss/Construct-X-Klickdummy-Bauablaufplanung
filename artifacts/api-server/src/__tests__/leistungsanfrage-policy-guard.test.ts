import { describe, expect, it } from "vitest";
import {
  assertLeistungsanfragePolicyAccess,
  LeistungsanfragePolicyAccessError,
  policyAccessDecision,
} from "../services/leistungsanfrage-policy-guard";
import { externalProjectInvitationResponseSchema } from "../services/dataspace/external-contracts";

describe("Leistungsanfrage domain policy guard", () => {
  it("allows all work actions within the accepted baseline without second consent", () => {
    for (const action of ["DETAILS", "REVIEW", "RESOURCE", "AVAILABILITY", "ANSWER"] as const) {
      expect(policyAccessDecision({
        policyDeltaClass: "WITHIN_BASELINE",
        policyConsentStatus: "NOT_REQUIRED",
      }, action).allowed).toBe(true);
    }
  });

  it("keeps consent-pending requests metadata-only", () => {
    expect(policyAccessDecision({
      policyDeltaClass: "REQUIRES_CONSENT",
      policyConsentStatus: "PENDING",
    }, "METADATA").allowed).toBe(true);
    expect(() => assertLeistungsanfragePolicyAccess({
      policyDeltaClass: "REQUIRES_CONSENT",
      policyConsentStatus: "PENDING",
    }, "RESOURCE")).toThrow(LeistungsanfragePolicyAccessError);
  });

  it("blocks processing for NOT_PERMITTED", () => {
    expect(() => assertLeistungsanfragePolicyAccess({
      policyDeltaClass: "NOT_PERMITTED",
      policyConsentStatus: "NOT_REQUIRED",
    }, "ANSWER")).toThrow(/NOT_PERMITTED/);
  });

  it("blocks protected work outside effective validity or retention windows", () => {
    const now = new Date("2030-01-15T12:00:00.000Z");
    for (const policy of [
      { validFrom: "2030-01-16T00:00:00.000Z" },
      { validUntil: "2030-01-14T23:59:59.000Z" },
      { retentionUntil: "2030-01-14T23:59:59.000Z" },
    ]) {
      expect(policyAccessDecision({
        policyDeltaClass: "WITHIN_BASELINE",
        policyConsentStatus: "NOT_REQUIRED",
        ...policy,
      }, "DETAILS", now)).toEqual({ allowed: false, code: "NOT_PERMITTED" });
      expect(policyAccessDecision({
        policyDeltaClass: "WITHIN_BASELINE",
        policyConsentStatus: "NOT_REQUIRED",
        ...policy,
      }, "METADATA", now).allowed).toBe(true);
    }
  });

  it("carries a child-policy decision on the established response transport", () => {
    const parsed = externalProjectInvitationResponseSchema.parse({
      metadata: {
        messageId: "performance-policy-consent:policy-1:ACCEPT",
        correlationId: "request-1",
        schemaVersion: "1.0",
        senderOrgId: "an-1",
        receiverOrgId: "ag-1",
        createdAt: "2028-01-01T00:00:00.000Z",
      },
      invitationId: "policy-1",
      performancePolicyId: "policy-1",
      projectReference: "project-1",
      decision: "ACCEPTED",
      policyAccepted: true,
      respondedAt: "2028-01-01T00:00:00.000Z",
    });
    expect(parsed.performancePolicyId).toBe("policy-1");
    expect(parsed.dataPublicationId).toBeUndefined();
  });
});