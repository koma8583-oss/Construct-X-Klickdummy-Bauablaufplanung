import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { eq, sql } from "drizzle-orm";
import { agDb as db } from "@workspace/db";
import {
  coordinationPoliciesTable,
  organizationsTable,
  projectsTable,
} from "@workspace/db";
import {
  createConstructXPolicy,
  resolvePolicyDelta,
} from "../services/construct-x-policy-service";
import {
  backfillHistoricalProjectAgreementBaselines,
  listAcceptedProjectAgreementsMissingBaseline,
} from "../services/project-membership-service";
import { hasExplicitLeistungsfreigabeScope } from "../lib/leistungsfreigabe-policy";

const PREFIX = "scope-backfill";
const AG_ID = `${PREFIX}-ag`;
const PROJECT_ID = `${PREFIX}-project`;
const LEGACY_ID = `${PREFIX}-legacy`;
const RESTRICTED_ID = `${PREFIX}-restricted`;
const SPLIT_ID = `${PREFIX}-split`;
const V2_ID = `${PREFIX}-v2`;
const MISMATCH_ID = `${PREFIX}-mismatch`;

const migrationSql = readFileSync(
  fileURLToPath(new URL("../../../../lib/db/migrations/0029_project_agreement_scope_backfill.sql", import.meta.url)),
  "utf8",
);

const canonicalPurposes = [
  "RAHMENTERMINE",
  "LEISTUNGSKOORDINATION",
  "AUSFUEHRUNGSINFORMATIONEN",
  "INDIVIDUELLE_FREIGABE",
];
const canonicalFields = [
  "trade",
  "workPackage",
  "kurzbezeichnung",
  "location",
  "plannedTimeWindow",
  "bufferTimeWindow",
  "predecessors",
  "successors",
  "taktReference",
  "taktVersion",
  "requiredOutput",
  "resourceRequirements",
  "constraints",
  "documentReferences",
];

beforeAll(async () => {
  await db.delete(coordinationPoliciesTable).where(
    sql`${coordinationPoliciesTable.id} IN (${LEGACY_ID}, ${RESTRICTED_ID}, ${SPLIT_ID}, ${V2_ID}, ${MISMATCH_ID})`,
  ).catch(() => {});
  await db.delete(projectsTable).where(eq(projectsTable.id, PROJECT_ID)).catch(() => {});
  await db.delete(organizationsTable).where(eq(organizationsTable.id, AG_ID)).catch(() => {});

  await db.insert(organizationsTable).values({ id: AG_ID, name: "Scope Backfill AG", type: "AG" });
  await db.insert(projectsTable).values({ id: PROJECT_ID, agOrgId: AG_ID, name: "Scope Backfill Project" });
  await db.insert(coordinationPoliciesTable).values([
    {
      id: LEGACY_ID,
      policyKey: LEGACY_ID,
      version: 1,
      kind: "PROJECT_AGREEMENT",
      projectId: PROJECT_ID,
      providerOrgId: AG_ID,
      recipientOrgId: `${PREFIX}-legacy-an`,
      lifecycleStatus: "ACCEPTED",
      policySnapshot: { policyType: "PROJECT_AGREEMENT" },
      effectivePolicy: { policyType: "PROJECT_AGREEMENT" },
    },
    {
      id: RESTRICTED_ID,
      policyKey: RESTRICTED_ID,
      version: 1,
      kind: "PROJECT_AGREEMENT",
      projectId: PROJECT_ID,
      providerOrgId: AG_ID,
      recipientOrgId: `${PREFIX}-restricted-an`,
      lifecycleStatus: "ACCEPTED",
      policySnapshot: {
        policyType: "PROJECT_AGREEMENT",
        allowedPurposes: ["RAHMENTERMINE"],
        allowedFieldScope: ["plannedTimeWindow"],
      },
      effectivePolicy: {
        policyType: "PROJECT_AGREEMENT",
        allowedPurposes: ["RAHMENTERMINE"],
        allowedFieldScope: ["plannedTimeWindow"],
      },
    },
    {
      id: SPLIT_ID,
      policyKey: SPLIT_ID,
      version: 1,
      kind: "PROJECT_AGREEMENT",
      projectId: PROJECT_ID,
      providerOrgId: AG_ID,
      recipientOrgId: `${PREFIX}-split-an`,
      lifecycleStatus: "ACCEPTED",
      policySnapshot: {
        policyType: "PROJECT_AGREEMENT",
        allowedFieldScope: ["plannedTimeWindow"],
      },
      effectivePolicy: {
        policyType: "PROJECT_AGREEMENT",
        allowedPurposes: ["RAHMENTERMINE"],
      },
    },
    {
      id: V2_ID,
      policyKey: V2_ID,
      version: 2,
      kind: "PROJECT_AGREEMENT",
      projectId: PROJECT_ID,
      providerOrgId: AG_ID,
      recipientOrgId: `${PREFIX}-v2-an`,
      lifecycleStatus: "ACCEPTED",
      policySnapshot: {
        policyType: "PROJECT_AGREEMENT",
        templateVersion: 2,
      },
      effectivePolicy: {
        policyType: "PROJECT_AGREEMENT",
        templateVersion: 2,
      },
    },
  ]);
});

afterAll(async () => {
  await db.delete(coordinationPoliciesTable).where(
    sql`${coordinationPoliciesTable.id} IN (${LEGACY_ID}, ${RESTRICTED_ID}, ${SPLIT_ID}, ${V2_ID}, ${MISMATCH_ID})`,
  ).catch(() => {});
  await db.delete(projectsTable).where(eq(projectsTable.id, PROJECT_ID)).catch(() => {});
  await db.delete(organizationsTable).where(eq(organizationsTable.id, AG_ID)).catch(() => {});
});

describe("accepted project agreement scope backfill", () => {
  it("fills legacy agreements, preserves restrictions, and is idempotent", async () => {
    await db.execute(sql.raw(migrationSql));

    const firstRun = await db.select({
      id: coordinationPoliciesTable.id,
      policySnapshot: coordinationPoliciesTable.policySnapshot,
      effectivePolicy: coordinationPoliciesTable.effectivePolicy,
    }).from(coordinationPoliciesTable).where(
      sql`${coordinationPoliciesTable.id} IN (${LEGACY_ID}, ${RESTRICTED_ID}, ${SPLIT_ID})`,
    );
    const byId = new Map(firstRun.map((row) => [row.id, row]));

    expect(byId.get(LEGACY_ID)?.effectivePolicy).toMatchObject({
      allowedPurposes: canonicalPurposes,
      allowedFieldScope: canonicalFields,
    });
    expect(byId.get(LEGACY_ID)?.policySnapshot).toMatchObject({
      allowedPurposes: canonicalPurposes,
      allowedFieldScope: canonicalFields,
    });
    expect(byId.get(RESTRICTED_ID)?.effectivePolicy).toMatchObject({
      allowedPurposes: ["RAHMENTERMINE"],
      allowedFieldScope: ["plannedTimeWindow"],
    });
    expect(byId.get(SPLIT_ID)?.effectivePolicy).toMatchObject({
      allowedPurposes: ["RAHMENTERMINE"],
      allowedFieldScope: ["plannedTimeWindow"],
    });
    expect(hasExplicitLeistungsfreigabeScope(byId.get(LEGACY_ID)?.effectivePolicy)).toBe(true);

    const beforeSecondRun = firstRun.map(({ id, policySnapshot, effectivePolicy }) => ({
      id,
      policySnapshot,
      effectivePolicy,
    }));
    await db.execute(sql.raw(migrationSql));
    const secondRun = await db.select({
      id: coordinationPoliciesTable.id,
      policySnapshot: coordinationPoliciesTable.policySnapshot,
      effectivePolicy: coordinationPoliciesTable.effectivePolicy,
    }).from(coordinationPoliciesTable).where(
      sql`${coordinationPoliciesTable.id} IN (${LEGACY_ID}, ${RESTRICTED_ID}, ${SPLIT_ID})`,
    );
    expect(secondRun.map(({ id, policySnapshot, effectivePolicy }) => ({
      id,
      policySnapshot,
      effectivePolicy,
    }))).toEqual(beforeSecondRun);
  });

  it("backfills the historical baseline without touching version-2 agreements", async () => {
    expect(await backfillHistoricalProjectAgreementBaselines({ projectId: PROJECT_ID })).toBe(3);

    const firstRun = await db.select({
      id: coordinationPoliciesTable.id,
      baselinePurpose: coordinationPoliciesTable.baselinePurpose,
      policySnapshot: coordinationPoliciesTable.policySnapshot,
      effectivePolicy: coordinationPoliciesTable.effectivePolicy,
    }).from(coordinationPoliciesTable).where(
      sql`${coordinationPoliciesTable.id} IN (${LEGACY_ID}, ${RESTRICTED_ID}, ${SPLIT_ID}, ${V2_ID})`,
    );
    const byId = new Map(firstRun.map((row) => [row.id, row]));

    for (const id of [LEGACY_ID, RESTRICTED_ID, SPLIT_ID]) {
      expect(byId.get(id)?.baselinePurpose).toBe("LEISTUNGSKOORDINATION");
      expect(byId.get(id)?.policySnapshot).toMatchObject({
        baselinePurpose: "LEISTUNGSKOORDINATION",
      });
      expect(byId.get(id)?.effectivePolicy).toMatchObject({
        baselinePurpose: "LEISTUNGSKOORDINATION",
      });
    }
    expect(byId.get(V2_ID)?.baselinePurpose).toBeNull();
    expect(byId.get(V2_ID)?.policySnapshot).not.toHaveProperty("baselinePurpose");
    expect(byId.get(V2_ID)?.effectivePolicy).not.toHaveProperty("baselinePurpose");

    const legacyPolicy = byId.get(LEGACY_ID)?.effectivePolicy as Record<string, unknown>;
    const childPolicy = {
      policyType: "PERFORMANCE_REQUEST",
      projectReference: PROJECT_ID,
      recipientOrganizationId: `${PREFIX}-legacy-an`,
      purpose: "LEISTUNGSKOORDINATION",
      selectedFields: ["plannedTimeWindow"],
    };
    const explicitResult = resolvePolicyDelta(
      legacyPolicy,
      childPolicy,
    );
    const compatibilityResult = resolvePolicyDelta(
      { ...legacyPolicy, baselinePurpose: undefined, templateVersion: 1 },
      childPolicy,
    );
    expect(compatibilityResult.deltaClass).toBe(explicitResult.deltaClass);

    const beforeSecondRun = firstRun.map(({ id, baselinePurpose, policySnapshot, effectivePolicy }) => ({
      id,
      baselinePurpose,
      policySnapshot,
      effectivePolicy,
    }));
    expect(await backfillHistoricalProjectAgreementBaselines({ projectId: PROJECT_ID })).toBe(0);
    const secondRun = await db.select({
      id: coordinationPoliciesTable.id,
      baselinePurpose: coordinationPoliciesTable.baselinePurpose,
      policySnapshot: coordinationPoliciesTable.policySnapshot,
      effectivePolicy: coordinationPoliciesTable.effectivePolicy,
    }).from(coordinationPoliciesTable).where(
      sql`${coordinationPoliciesTable.id} IN (${LEGACY_ID}, ${RESTRICTED_ID}, ${SPLIT_ID}, ${V2_ID})`,
    );
    expect(secondRun.map(({ id, baselinePurpose, policySnapshot, effectivePolicy }) => ({
      id,
      baselinePurpose,
      policySnapshot,
      effectivePolicy,
    }))).toEqual(beforeSecondRun);
  });

  it("diagnoses accepted agreements missing a baseline without changing them", async () => {
    const before = await db.select({
      id: coordinationPoliciesTable.id,
      baselinePurpose: coordinationPoliciesTable.baselinePurpose,
      policySnapshot: coordinationPoliciesTable.policySnapshot,
      effectivePolicy: coordinationPoliciesTable.effectivePolicy,
    }).from(coordinationPoliciesTable).where(eq(coordinationPoliciesTable.id, V2_ID));

    const diagnostics = await listAcceptedProjectAgreementsMissingBaseline({ projectId: PROJECT_ID });

    expect(diagnostics).toEqual([{
      id: V2_ID,
      policyKey: V2_ID,
      version: 2,
      missingFrom: {
        databaseColumn: true,
        effectivePolicy: true,
        policySnapshot: true,
      },
    }]);

    const after = await db.select({
      id: coordinationPoliciesTable.id,
      baselinePurpose: coordinationPoliciesTable.baselinePurpose,
      policySnapshot: coordinationPoliciesTable.policySnapshot,
      effectivePolicy: coordinationPoliciesTable.effectivePolicy,
    }).from(coordinationPoliciesTable).where(eq(coordinationPoliciesTable.id, V2_ID));
    expect(after).toEqual(before);
  });

  it("rejects a child when a parent has no explicit purpose and field scope", () => {
    const result = resolvePolicyDelta(
      {
        policyType: "PROJECT_AGREEMENT",
        projectReference: PROJECT_ID,
        recipientOrganizationId: `${PREFIX}-legacy-an`,
      },
      {
        policyType: "PERFORMANCE_REQUEST",
        projectReference: PROJECT_ID,
        recipientOrganizationId: `${PREFIX}-legacy-an`,
        purpose: "LEISTUNGSKOORDINATION",
        selectedFields: ["plannedTimeWindow"],
      },
    );

    expect(result.deltaClass).toBe("NOT_PERMITTED");
    expect(result.diff.summary[0]).toContain("keinen expliziten Zweck- und Datenfeldumfang");
  });

  it("rejects baseline-purpose drift during invitation construction and accepted-agreement reads", async () => {
    const baseSnapshot = {
      policyId: `${PREFIX}-invitation-policy`,
      templateId: "PROJECT_MEMBERSHIP",
      templateVersion: 2,
      code: "PROJECT_MEMBERSHIP",
      name: "Projektaufnahme",
      description: "Test policy",
      permissions: ["READ"],
      prohibitions: [],
      provider: { organizationId: AG_ID, userId: null },
      recipientOrganizationId: `${PREFIX}-an`,
      purpose: "PROJECT_MEMBERSHIP",
      projectReference: PROJECT_ID,
      workPackageReference: null,
      validFrom: null,
      validUntil: null,
      createdAt: new Date().toISOString(),
      baselinePurpose: "LEISTUNGSKOORDINATION",
    };

    expect(() => createConstructXPolicy({
      baseSnapshot,
      policyType: "PROJECT_AGREEMENT",
      policyVersion: 2,
      effectivePolicy: {
        ...baseSnapshot,
        baselinePurpose: "RAHMENTERMINE",
      },
    })).toThrow(
      `policy ${baseSnapshot.policyId}: databaseColumn="LEISTUNGSKOORDINATION", ` +
      `policySnapshot="LEISTUNGSKOORDINATION", effectivePolicy="RAHMENTERMINE"`,
    );

    await db.insert(coordinationPoliciesTable).values({
      id: MISMATCH_ID,
      policyKey: MISMATCH_ID,
      version: 2,
      kind: "PROJECT_AGREEMENT",
      projectId: PROJECT_ID,
      providerOrgId: AG_ID,
      recipientOrgId: `${PREFIX}-mismatch-an`,
      lifecycleStatus: "ACCEPTED",
      baselinePurpose: "LEISTUNGSKOORDINATION",
      policySnapshot: {
        policyType: "PROJECT_AGREEMENT",
        baselinePurpose: "RAHMENTERMINE",
      },
      effectivePolicy: {
        policyType: "PROJECT_AGREEMENT",
        baselinePurpose: "AUSFUEHRUNGSINFORMATIONEN",
      },
    });

    await expect(listAcceptedProjectAgreementsMissingBaseline()).rejects.toThrow(
      `policy ${MISMATCH_ID}: databaseColumn="LEISTUNGSKOORDINATION", ` +
      `policySnapshot="RAHMENTERMINE", effectivePolicy="AUSFUEHRUNGSINFORMATIONEN"`,
    );
    await db.delete(coordinationPoliciesTable).where(eq(coordinationPoliciesTable.id, MISMATCH_ID));
  });
});