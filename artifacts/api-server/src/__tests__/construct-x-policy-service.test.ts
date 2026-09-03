import { describe, expect, it } from "vitest";
import { resolvePolicyDelta } from "../services/construct-x-policy-service";

const base = {
  policyType: "PROJECT_AGREEMENT" as const,
  projectReference: "project-1",
  recipientOrganizationId: "an-1",
  childPermissions: [
    "READ",
    "DOWNLOAD",
    "USE_FOR_PERFORMANCE_COORDINATION",
  ],
  validFrom: "2028-01-01T00:00:00.000Z",
  validUntil: "2028-12-31T23:59:59.000Z",
};

const candidate = {
  projectReference: "project-1",
  recipientOrganizationId: "an-1",
  permissions: ["READ", "DOWNLOAD", "USE_FOR_PERFORMANCE_COORDINATION"],
  purpose: "construction-service-coordination",
  workPackageReference: "work-package-1",
  validFrom: null,
  validUntil: null,
};

describe("Construct-X coordination policy resolver", () => {
  it("allows a concrete performance child policy within the project baseline", () => {
    const result = resolvePolicyDelta(base, candidate);

    expect(result.deltaClass).toBe("WITHIN_BASELINE");
  });

  it("requires consent when the child policy expands the agreed validity", () => {
    const result = resolvePolicyDelta(base, {
      ...candidate,
      validUntil: "2029-01-15T23:59:59.000Z",
    });

    expect(result.deltaClass).toBe("REQUIRES_CONSENT");
    expect(result.diff.changed).toContain("validUntil");
  });

  it("rejects a child policy that changes the project recipient", () => {
    const result = resolvePolicyDelta(base, {
      ...candidate,
      recipientOrganizationId: "an-other",
    });

    expect(result.deltaClass).toBe("NOT_PERMITTED");
  });

  it("rejects permissions not granted by the project child-policy allowance", () => {
    const result = resolvePolicyDelta(base, {
      ...candidate,
      permissions: [...candidate.permissions, "COMMERCIAL_REUSE"],
    });

    expect(result.deltaClass).toBe("NOT_PERMITTED");
  });
});