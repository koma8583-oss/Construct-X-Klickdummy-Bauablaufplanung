import { describe, expect, it } from "vitest";
import {
  getPolicyTemplateRegistryEntry,
  listPolicyTemplateRegistry,
} from "../lib/policy-template-registry";
import {
  createPolicySnapshot,
  PolicySnapshotError,
} from "../services/policy-snapshot-service";

const providerContext = {
  organizationId: "ag-provider-1",
  userId: "user-1",
  organizationType: "AG" as const,
};

describe("policy template registry", () => {
  it("looks up the three fixed templates by id and code", () => {
    const templates = listPolicyTemplateRegistry();
    expect(templates).toHaveLength(3);
    expect(templates.map((template) => template.version)).toEqual([1, 1, 1]);
    expect(getPolicyTemplateRegistryEntry("PROJECT_COORDINATION")?.templateId)
      .toBe("tk-policy-project-coordination");
    expect(getPolicyTemplateRegistryEntry("tk-policy-performance-coordination")?.code)
      .toBe("PERFORMANCE_COORDINATION");
    expect(getPolicyTemplateRegistryEntry("missing-template")).toBeNull();
  });

  it("rejects mutation of registry metadata", () => {
    const template = getPolicyTemplateRegistryEntry("STANDARD_DATA_EXCHANGE")!;
    expect(Object.isFrozen(template)).toBe(true);
    expect(Object.isFrozen(template.allowedOverrides)).toBe(true);
    expect(() => Object.defineProperty(template, "version", { value: 2 })).toThrow();
  });
});

describe("policy snapshot builder", () => {
  it("creates a versioned immutable snapshot with allowed overrides", () => {
    const snapshot = createPolicySnapshot({
      templateId: "PROJECT_COORDINATION",
      providerContext,
      overrides: {
        recipientOrganizationId: "an-recipient-1",
        purpose: "projectCoordination",
        projectReference: "project-1",
        validFrom: "2026-08-25T00:00:00.000Z",
      },
    });

    expect(snapshot).toMatchObject({
      templateId: "tk-policy-project-coordination",
      templateVersion: 1,
      provider: { organizationId: "ag-provider-1", userId: "user-1" },
      recipientOrganizationId: "an-recipient-1",
      purpose: "projectCoordination",
      projectReference: "project-1",
      validUntil: null,
    });
    expect(snapshot.policyId).toMatch(/^tk-policy-/);
    expect(snapshot.createdAt).toBeTruthy();
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.provider)).toBe(true);
    expect(() => Object.defineProperty(snapshot, "purpose", { value: "spoofed" })).toThrow();
  });

  it("rejects unknown templates and missing required parameters", () => {
    expect(() => createPolicySnapshot({
      templateId: "not-registered",
      providerContext,
    })).toThrowError(PolicySnapshotError);

    expect(() => createPolicySnapshot({
      templateId: "PROJECT_COORDINATION",
      providerContext,
      overrides: { recipientOrganizationId: "an-recipient-1", purpose: "projectCoordination" },
    })).toThrowError(/projectReference/);
  });

  it("allows only template-declared overrides", () => {
    expect(() => createPolicySnapshot({
      templateId: "STANDARD_DATA_EXCHANGE",
      providerContext,
      overrides: {
        recipientOrganizationId: "an-recipient-1",
        purpose: "standardDataExchange",
        projectReference: "not-allowed",
      },
    })).toThrowError(/not allowed/);
  });

  it("rejects provider spoofing and never takes identity from overrides", () => {
    expect(() => createPolicySnapshot({
      templateId: "STANDARD_DATA_EXCHANGE",
      providerContext,
      providerOrganizationId: "attacker-org",
      overrides: {
        recipientOrganizationId: "an-recipient-1",
        purpose: "standardDataExchange",
      },
    })).toThrowError(/Provider organisation/);

    expect(() => createPolicySnapshot({
      templateId: "STANDARD_DATA_EXCHANGE",
      providerContext,
      overrides: {
        recipientOrganizationId: "an-recipient-1",
        purpose: "standardDataExchange",
        providerOrganizationId: "attacker-org",
      } as never,
    })).toThrowError(/not allowed/);
  });
});