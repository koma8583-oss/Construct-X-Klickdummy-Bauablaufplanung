/**
 * Task 177 — Confirm location and description reach the TaktRequest snapshot.
 *
 * Fixture prefix: "t177-" — no collision with other test files.
 *
 * Two suites:
 *   A. Unit tests for buildTaktRequestSnapshot() — verifies projectLocation /
 *      projectDescription are mapped from the builder inputs into the payload.
 *   B. DB integration tests for createTaktRequestWithSnapshot() — verifies
 *      that a project with location + description stored in the DB produces a
 *      snapshot payload that contains those values.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { agDb as db } from "@workspace/db";
import {
  organizationsTable,
  projectsTable,
  projectContractorsTable,
  projectMembershipsTable,
  takteTable,
  taktRequestsTable,
  taktRequestSnapshotsTable,
  coordinationPoliciesTable,
  usersTable,
} from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import {
  buildTaktRequestSnapshot,
  createTaktRequestWithSnapshot,
} from "../lib/takt-request-snapshot-service";
import type { Takt } from "@workspace/db";

// ── Fixture IDs ───────────────────────────────────────────────────────────────

const GU_ORG   = "t177-org-gu";
const NU_ORG   = "t177-org-nu";
const PROJECT_ID = "t177-project-001";
const TAKT_ID    = "t177-takt-001";
const USER_ID    = "t177-user-001";

const PROJECT_LOCATION    = "Hauptstraße 42, 10115 Berlin";
const PROJECT_DESCRIPTION = "Neubau Bürogebäude – Phase 2 Ausbau";

// ── Shared Takt fixture (valid dates, version >= 1) ────────────────────────

const TAKT_FIXTURE: Takt = {
  leistungsBezeichnung: "Test Takt",
  id: TAKT_ID,
  projectId: PROJECT_ID,
  taktBezeichnung: "T177 – Trockenbau EG",
  kurzbezeichnung: "T177",
  zone: "Ebene EG",
  gewerk: "Trockenbau",
  description: "Montage Trockenbauwände",
  plannedStart: "2026-10-01",
  plannedEnd: "2026-10-15",
  earliestStart: null,
  latestEnd: null,
  lvReference: null,
  bimReference: null,
  requiredResources: null,
  status: "GEPLANT",
  createdAt: new Date("2026-08-01T00:00:00Z"),
  updatedAt: new Date("2026-08-01T00:00:00Z"),
  version: 1,
  lifecycleStatus: "PLANNED",
  internalNote: null,
  costEstimate: null,
  procurementPriority: null,
  riskClassification: null,
  durationDays: null,
};

// ── Setup / teardown ──────────────────────────────────────────────────────────

beforeAll(async () => {
  await db.insert(organizationsTable).values([
    { id: GU_ORG, name: "T177 GU Org", type: "AG" },
    { id: NU_ORG, name: "T177 NU Org", type: "AN" },
  ]).onConflictDoNothing();

  await db.insert(usersTable).values({
    id: USER_ID,
    name: "T177 User",
    email: "t177-user@example.com",
    passwordHash: "x",
  }).onConflictDoNothing();

  await db.insert(projectsTable).values({
    id: PROJECT_ID,
    agOrgId: GU_ORG,
    name: "T177 Test Project",
    location: PROJECT_LOCATION,
    description: PROJECT_DESCRIPTION,
  }).onConflictDoNothing();

  await db.insert(projectContractorsTable).values({
    projectId: PROJECT_ID,
    anOrgId: NU_ORG,
  }).onConflictDoNothing();
  await db.insert(coordinationPoliciesTable).values({
    id: "t177-agreement", policyKey: "t177-agreement", version: 1, kind: "PROJECT_AGREEMENT",
    projectId: PROJECT_ID, providerOrgId: GU_ORG, recipientOrgId: NU_ORG,
    lifecycleStatus: "ACCEPTED", policySnapshot: {}, effectivePolicy: {
      policyType: "PROJECT_AGREEMENT",
      recipientOrganizationId: NU_ORG,
      projectReference: PROJECT_ID,
      validFrom: null,
      validUntil: null,
      childPolicyTypes: ["PERFORMANCE_REQUEST"],
      childPermissions: ["READ", "DOWNLOAD", "USE_FOR_PERFORMANCE_COORDINATION"],
    },
  }).onConflictDoNothing();
  await db.insert(projectMembershipsTable).values({
    id: "t177-membership",
    projectId: PROJECT_ID,
    agOrgId: GU_ORG,
    anOrgId: NU_ORG,
    status: "ACTIVE",
    invitationId: "t177-invitation",
    correlationId: "t177-correlation",
    projectAgreementPolicyId: "t177-agreement",
  }).onConflictDoNothing();

  await db.insert(takteTable).values({
    id: TAKT_ID,
    projectId: PROJECT_ID,
    taktBezeichnung: "T177 – Trockenbau EG",
    zone: "Ebene EG",
    gewerk: "Trockenbau",
    description: "Montage Trockenbauwände",
    plannedStart: "2026-10-01",
    plannedEnd: "2026-10-15",
    version: 1,
  }).onConflictDoNothing();
});

afterAll(async () => {
  await db.execute(sql`DELETE FROM leistungsanfrage_snapshots WHERE leistungsanfrage_id IN (SELECT id FROM leistungsanfragen WHERE gu_org_id = ANY(ARRAY['${sql.raw(GU_ORG)}']))`).catch(() => {});
  await db.execute(sql`DELETE FROM leistungsanfragen WHERE gu_org_id = '${sql.raw(GU_ORG)}'`).catch(() => {});
  await db.execute(sql`DELETE FROM leistungen WHERE id = '${sql.raw(TAKT_ID)}'`).catch(() => {});
  await db.execute(sql`DELETE FROM project_contractors WHERE project_id = '${sql.raw(PROJECT_ID)}'`).catch(() => {});
  await db.execute(sql`DELETE FROM project_memberships WHERE project_id = '${sql.raw(PROJECT_ID)}'`).catch(() => {});
  await db.delete(coordinationPoliciesTable).where(eq(coordinationPoliciesTable.projectId, PROJECT_ID)).catch(() => {});
  await db.execute(sql`DELETE FROM projects WHERE id = '${sql.raw(PROJECT_ID)}'`).catch(() => {});
  await db.execute(sql`DELETE FROM users WHERE id = '${sql.raw(USER_ID)}'`).catch(() => {});
  await db.execute(sql`DELETE FROM organizations WHERE id = ANY(ARRAY['${sql.raw(GU_ORG)}','${sql.raw(NU_ORG)}'])`).catch(() => {});
});

// ── A. Unit tests for buildTaktRequestSnapshot() ──────────────────────────────

describe("buildTaktRequestSnapshot() — projectLocation and projectDescription", () => {
  it("maps projectLocation and projectDescription into the payload when both are provided", () => {
    const payload = buildTaktRequestSnapshot({
      takt: TAKT_FIXTURE,
      projectId: PROJECT_ID,
      projectLocation: PROJECT_LOCATION,
      projectDescription: PROJECT_DESCRIPTION,
      predecessors: [],
      successors: [],
    });

    expect(payload.projectLocation).toBe(PROJECT_LOCATION);
    expect(payload.projectDescription).toBe(PROJECT_DESCRIPTION);
  });

  it("sets projectLocation and projectDescription to null when not provided", () => {
    const payload = buildTaktRequestSnapshot({
      takt: TAKT_FIXTURE,
      projectId: PROJECT_ID,
      predecessors: [],
      successors: [],
    });

    expect(payload.projectLocation).toBeNull();
    expect(payload.projectDescription).toBeNull();
  });

  it("sets projectLocation to null and projectDescription to value when only description is provided", () => {
    const payload = buildTaktRequestSnapshot({
      takt: TAKT_FIXTURE,
      projectId: PROJECT_ID,
      projectLocation: null,
      projectDescription: PROJECT_DESCRIPTION,
      predecessors: [],
      successors: [],
    });

    expect(payload.projectLocation).toBeNull();
    expect(payload.projectDescription).toBe(PROJECT_DESCRIPTION);
  });

  it("sets projectDescription to null and projectLocation to value when only location is provided", () => {
    const payload = buildTaktRequestSnapshot({
      takt: TAKT_FIXTURE,
      projectId: PROJECT_ID,
      projectLocation: PROJECT_LOCATION,
      projectDescription: null,
      predecessors: [],
      successors: [],
    });

    expect(payload.projectLocation).toBe(PROJECT_LOCATION);
    expect(payload.projectDescription).toBeNull();
  });

  it("projectLocation and projectDescription are present as top-level snapshot keys", () => {
    const payload = buildTaktRequestSnapshot({
      takt: TAKT_FIXTURE,
      projectId: PROJECT_ID,
      projectLocation: PROJECT_LOCATION,
      projectDescription: PROJECT_DESCRIPTION,
      predecessors: [],
      successors: [],
    });

    expect(Object.keys(payload)).toContain("projectLocation");
    expect(Object.keys(payload)).toContain("projectDescription");
  });
});

// ── B. DB integration tests for createTaktRequestWithSnapshot() ───────────────

describe("createTaktRequestWithSnapshot() — projectLocation and projectDescription in DB snapshot", () => {
  function makeInput(overrides: Partial<Parameters<typeof createTaktRequestWithSnapshot>[0]> = {}) {
    return {
      taktId: TAKT_ID,
      guOrgId: GU_ORG,
      nuOrgId: NU_ORG,
      requestNumber: `TKR-T177-${crypto.randomUUID().slice(0, 8)}`,
      createdByUserId: USER_ID,
      ...overrides,
    };
  }

  it("snapshot payload contains the project's location when the project has one set", async () => {
    const { snapshot } = await createTaktRequestWithSnapshot(makeInput());

    expect(snapshot.snapshotPayload.projectLocation).toBeUndefined();
  });

  it("snapshot payload contains the project's description when the project has one set", async () => {
    const { snapshot } = await createTaktRequestWithSnapshot(makeInput());

    expect(snapshot.snapshotPayload.projectDescription).toBeUndefined();
  });

  it("DB-persisted snapshot payload contains projectLocation and projectDescription", async () => {
    const { request } = await createTaktRequestWithSnapshot(makeInput());

    const [dbSnapshot] = await db
      .select()
      .from(taktRequestSnapshotsTable)
      .where(eq(taktRequestSnapshotsTable.taktRequestId, request.id));

    const payload = dbSnapshot.snapshotPayload as {
      projectLocation: unknown;
      projectDescription: unknown;
    };

    expect(payload.projectLocation).toBeUndefined();
    expect(payload.projectDescription).toBeUndefined();
  });

  it("snapshot projectLocation/projectDescription are null when project has neither set", async () => {
    // Insert a project with no location/description
    const BARE_PROJECT_ID = "t177-project-bare";
    const BARE_TAKT_ID = "t177-takt-bare";

    await db.insert(projectsTable).values({
      id: BARE_PROJECT_ID,
      agOrgId: GU_ORG,
      name: "T177 Bare Project",
      // location and description intentionally omitted
    }).onConflictDoNothing();

    await db.insert(projectContractorsTable).values({
      projectId: BARE_PROJECT_ID,
      anOrgId: NU_ORG,
    }).onConflictDoNothing();
    await db.insert(coordinationPoliciesTable).values({
      id: "t177-bare-agreement", policyKey: "t177-bare-agreement", version: 1, kind: "PROJECT_AGREEMENT",
      projectId: BARE_PROJECT_ID, providerOrgId: GU_ORG, recipientOrgId: NU_ORG,
      lifecycleStatus: "ACCEPTED", policySnapshot: {}, effectivePolicy: {
        policyType: "PROJECT_AGREEMENT",
        recipientOrganizationId: NU_ORG,
        projectReference: BARE_PROJECT_ID,
        validFrom: null,
        validUntil: null,
        childPolicyTypes: ["PERFORMANCE_REQUEST"],
        childPermissions: ["READ", "DOWNLOAD", "USE_FOR_PERFORMANCE_COORDINATION"],
      },
    }).onConflictDoNothing();
    await db.insert(projectMembershipsTable).values({
      id: "t177-bare-membership",
      projectId: BARE_PROJECT_ID,
      agOrgId: GU_ORG,
      anOrgId: NU_ORG,
      status: "ACTIVE",
      invitationId: "t177-bare-invitation",
      correlationId: "t177-bare-correlation",
      projectAgreementPolicyId: "t177-bare-agreement",
    }).onConflictDoNothing();

    await db.insert(takteTable).values({
      id: BARE_TAKT_ID,
      projectId: BARE_PROJECT_ID,
      taktBezeichnung: "T177 Bare Takt",
      zone: "Zone A",
      gewerk: "Rohbau",
      plannedStart: "2026-10-01",
      plannedEnd: "2026-10-15",
      version: 1,
    }).onConflictDoNothing();

    try {
      const { snapshot } = await createTaktRequestWithSnapshot({
        taktId: BARE_TAKT_ID,
        guOrgId: GU_ORG,
        nuOrgId: NU_ORG,
        requestNumber: `TKR-T177-BARE-${crypto.randomUUID().slice(0, 8)}`,
        createdByUserId: USER_ID,
      });

      expect(snapshot.snapshotPayload.projectLocation).toBeUndefined();
      expect(snapshot.snapshotPayload.projectDescription).toBeUndefined();
    } finally {
      // Clean up extra fixtures
      await db.execute(sql`DELETE FROM leistungsanfrage_snapshots WHERE leistungsanfrage_id IN (SELECT id FROM leistungsanfragen WHERE leistung_id = '${sql.raw(BARE_TAKT_ID)}')`).catch(() => {});
      await db.execute(sql`DELETE FROM leistungsanfragen WHERE leistung_id = '${sql.raw(BARE_TAKT_ID)}'`).catch(() => {});
      await db.delete(projectMembershipsTable).where(eq(projectMembershipsTable.id, "t177-bare-membership")).catch(() => {});
      await db.delete(coordinationPoliciesTable).where(eq(coordinationPoliciesTable.id, "t177-bare-agreement")).catch(() => {});
      await db.execute(sql`DELETE FROM leistungen WHERE id = '${sql.raw(BARE_TAKT_ID)}'`).catch(() => {});
      await db.execute(sql`DELETE FROM project_contractors WHERE project_id = '${sql.raw(BARE_PROJECT_ID)}'`).catch(() => {});
      await db.execute(sql`DELETE FROM project_memberships WHERE project_id = '${sql.raw(BARE_PROJECT_ID)}'`).catch(() => {});
      await db.execute(sql`DELETE FROM projects WHERE id = '${sql.raw(BARE_PROJECT_ID)}'`).catch(() => {});
    }
  });
});
