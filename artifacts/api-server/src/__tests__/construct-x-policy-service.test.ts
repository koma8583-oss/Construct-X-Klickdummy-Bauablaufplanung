import { describe, expect, it } from "vitest";
import { createConstructXPolicy, resolvePolicyDelta } from "../services/construct-x-policy-service";

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

  it("rejects a child policy that expands the agreed validity", () => {
    const result = resolvePolicyDelta(base, {
      ...candidate,
      validUntil: "2029-01-15T23:59:59.000Z",
    });

    expect(result.deltaClass).toBe("NOT_PERMITTED");
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

  it("rejects child policy types and purposes outside an explicit agreement allowance", () => {
    expect(resolvePolicyDelta(
      { ...base, childPolicyTypes: ["PERFORMANCE_REQUEST"], allowedPurposes: ["approved-purpose"] },
      { ...candidate, policyType: "DATA_OFFER", purpose: "other-purpose" },
    ).deltaClass).toBe("NOT_PERMITTED");
  });

  it("inherits prohibitions even when a child does not repeat them", () => {
    const result = resolvePolicyDelta(
      { ...base, prohibitions: ["COMMERCIAL_REUSE"] },
      candidate,
    );
    expect(result.effectivePolicy.prohibitions).toEqual(["COMMERCIAL_REUSE"]);
  });

  it("rejects explicit removal of one or more parent prohibitions", () => {
    const result = resolvePolicyDelta(
      { ...base, prohibitions: ["NO_EXPORT", "NO_REUSE"] },
      { ...candidate, prohibitions: ["NO_EXPORT"] },
    );

    expect(result.deltaClass).toBe("NOT_PERMITTED");
    expect(result.diff.changed).toContain("prohibitions");
    expect(result.effectivePolicy.prohibitions).toEqual(["NO_EXPORT", "NO_REUSE"]);
  });

  it("rejects an explicitly empty prohibition list but preserves omitted prohibitions", () => {
    const parent = { ...base, prohibitions: ["NO_EXPORT", "NO_REUSE"] };

    expect(resolvePolicyDelta(parent, { ...candidate, prohibitions: [] }).deltaClass)
      .toBe("NOT_PERMITTED");
    expect(resolvePolicyDelta(parent, candidate).deltaClass)
      .toBe("WITHIN_BASELINE");
  });

  it("rejects every parent prohibition that is converted into a permission", () => {
    const result = resolvePolicyDelta(
      { ...base, prohibitions: ["NO_EXPORT", "NO_REUSE"] },
      {
        ...candidate,
        permissions: [...candidate.permissions, "NO_EXPORT", "NO_REUSE"],
      },
    );

    expect(result.deltaClass).toBe("NOT_PERMITTED");
  });

  it("serializes inherited restrictive terms and never converts a prohibition into a permission", () => {
    const parent = {
      ...base,
      retentionUntil: "2028-11-30T23:59:59.000Z",
      prohibitions: ["COMMERCIAL_REUSE"],
      duties: [{ action: "DELETE", target: "after-retention" }],
      constraints: [{ leftOperand: "purpose", operator: "eq", rightOperand: "construction-service-coordination" }],
    };
    const result = resolvePolicyDelta(parent, {
      ...candidate,
      validFrom: "2028-02-01T00:00:00.000Z",
      validUntil: "2028-10-31T23:59:59.000Z",
    });
    expect(result.deltaClass).toBe("WITHIN_BASELINE");
    expect(result.effectivePolicy).toMatchObject({
      prohibitions: ["COMMERCIAL_REUSE"],
      duties: parent.duties,
      constraints: parent.constraints,
      retentionUntil: parent.retentionUntil,
    });

    const serialized = createConstructXPolicy({
      baseSnapshot: {
        policyId: "child", templateId: "performance", templateVersion: 1, code: "PERFORMANCE",
        name: "Performance", description: "", permissions: candidate.permissions, prohibitions: [],
        provider: { organizationId: "ag", userId: null }, recipientOrganizationId: "an-1",
        purpose: candidate.purpose, projectReference: "project-1", workPackageReference: "work-package-1",
        validFrom: null, validUntil: null, createdAt: "2028-01-01T00:00:00.000Z",
      },
      policyType: "PERFORMANCE_REQUEST",
      parentPolicyId: "parent",
      effectivePolicy: result.effectivePolicy,
    });
    expect(serialized).toMatchObject({
      parentPolicyId: "parent",
      inheritFrom: "parent",
      prohibitions: parent.prohibitions,
      duties: parent.duties,
      constraints: parent.constraints,
      validFrom: "2028-02-01T00:00:00.000Z",
      validUntil: "2028-10-31T23:59:59.000Z",
      retentionUntil: parent.retentionUntil,
    });
    expect(resolvePolicyDelta(parent, {
      ...candidate,
      permissions: [...candidate.permissions, "COMMERCIAL_REUSE"],
    }).deltaClass).toBe("NOT_PERMITTED");
  });

  it("rejects field selections outside the explicit parent field scope", () => {
    const result = resolvePolicyDelta(
      { ...base, allowedFieldScope: ["plannedTimeWindow"] },
      { ...candidate, selectedFields: ["plannedTimeWindow", "projectDescription"] },
    );
    expect(result.deltaClass).toBe("NOT_PERMITTED");
  });
});