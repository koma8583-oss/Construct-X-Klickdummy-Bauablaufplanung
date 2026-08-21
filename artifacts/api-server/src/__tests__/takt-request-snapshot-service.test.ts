/**
 * Task 3.5 — Tests for TaktRequestSnapshotService.
 *
 * Fixture prefix: "t35-" — no collision with other test files.
 *
 * Two test suites:
 *   A. Unit tests for buildTaktRequestSnapshot() — pure function, no DB.
 *   B. DB integration tests for createTaktRequestWithSnapshot().
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@workspace/db";
import {
  organizationsTable,
  projectsTable,
  projectContractorsTable,
  takteTable,
  taktRequestsTable,
  taktRequestSnapshotsTable,
  usersTable,
} from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import {
  buildTaktRequestSnapshot,
  createTaktRequestWithSnapshot,
  TaktNotFoundError,
  UnauthorizedSnapshotError,
  NuNotContractorError,
  InvalidTaktForSnapshotError,
} from "../lib/takt-request-snapshot-service";
import type { Takt } from "@workspace/db";
import type { TaktDependency } from "@workspace/db";

// ── Fixture IDs ───────────────────────────────────────────────────────────────

const GU_ORG = "t35-org-gu";
const NU_ORG = "t35-org-nu";
const OTHER_GU = "t35-org-other-gu";
const OTHER_NU = "t35-org-other-nu";
const PROJECT_ID = "t35-project-001";
const TAKT_ID = "t35-takt-001";
const USER_ID = "t35-user-001";

// ── Fixture data ──────────────────────────────────────────────────────────────

const TAKT_FIXTURE: Takt = {
  leistungsBezeichnung: "Test Takt",
  id: TAKT_ID,
  projectId: PROJECT_ID,
  taktBezeichnung: "T1 – Trockenbau Nord",
  zone: "Ebene EG",
  gewerk: "Trockenbau",
  description: "Montage Trockenbauwände laut Plan T-EG-001",
  plannedStart: "2026-09-14",
  plannedEnd: "2026-09-28",
  earliestStart: "2026-09-10",
  latestEnd: "2026-10-05",
  lvReference: "LV-TKB-001",
  bimReference: "BIM-MODEL-EG",
  requiredResources: "6 Monteure, Trockenbau-Kran Typ B",
  status: "GEPLANT",
  createdAt: new Date("2026-08-01T00:00:00Z"),
  updatedAt: new Date("2026-08-01T00:00:00Z"),
  version: 1,
  lifecycleStatus: "PLANNED",
  // GU-internal fields — must be null/undefined in fixture (never appear in snapshot)
  internalNote: null,
  costEstimate: null,
  procurementPriority: null,
  riskClassification: null,
  durationDays: null,
};

const PREDECESSORS: TaktDependency[] = [
  { id: "dep-01", projectId: PROJECT_ID, predecessorId: "t35-takt-000", successorId: TAKT_ID, type: "EA", lagDays: 1 },
];
const SUCCESSORS: TaktDependency[] = [
  { id: "dep-02", projectId: PROJECT_ID, predecessorId: TAKT_ID, successorId: "t35-takt-002", type: "EA", lagDays: 0 },
];

// ── Setup / teardown ──────────────────────────────────────────────────────────

beforeAll(async () => {
  await db.insert(organizationsTable).values([
    { id: GU_ORG,    name: "T35 GU Org",       type: "AG" },
    { id: NU_ORG,    name: "T35 NU Org",       type: "AN" },
    { id: OTHER_GU,  name: "T35 Other GU",     type: "AG" },
    { id: OTHER_NU,  name: "T35 Unrelated NU", type: "AN" },
  ]).onConflictDoNothing();

  await db.insert(usersTable).values({
    id: USER_ID, name: "T35 User", email: "t35-user@example.com", passwordHash: "x",
  }).onConflictDoNothing();

  await db.insert(projectsTable).values({
    id: PROJECT_ID, agOrgId: GU_ORG, name: "T35 Test Project",
  }).onConflictDoNothing();

  await db.insert(projectContractorsTable).values({
    projectId: PROJECT_ID, anOrgId: NU_ORG,
  }).onConflictDoNothing();

  await db.insert(takteTable).values({
    id: TAKT_ID, projectId: PROJECT_ID,
    taktBezeichnung: "T1 – Trockenbau Nord",
    zone: "Ebene EG", gewerk: "Trockenbau",
    description: "Montage Trockenbauwände laut Plan T-EG-001",
    plannedStart: "2026-09-14", plannedEnd: "2026-09-28",
    earliestStart: "2026-09-10", latestEnd: "2026-10-05",
    lvReference: "LV-TKB-001", bimReference: "BIM-MODEL-EG",
    requiredResources: "6 Monteure, Kran Typ B",
    version: 1,
  }).onConflictDoNothing();
});

afterAll(async () => {
  const ids = [GU_ORG, NU_ORG, OTHER_GU, OTHER_NU];
  await db.execute(sql`DELETE FROM leistungsanfrage_snapshots WHERE leistungsanfrage_id IN (SELECT id FROM leistungsanfragen WHERE gu_org_id = ANY(ARRAY[${sql.raw(ids.map(i => `'${i}'`).join(","))}]))`).catch(() => {});
  await db.execute(sql`DELETE FROM leistungsanfragen WHERE gu_org_id = ANY(ARRAY[${sql.raw(ids.map(i => `'${i}'`).join(","))}])`).catch(() => {});
  await db.execute(sql`DELETE FROM leistungen WHERE id = '${sql.raw(TAKT_ID)}'`).catch(() => {});
  await db.execute(sql`DELETE FROM project_contractors WHERE project_id = '${sql.raw(PROJECT_ID)}'`).catch(() => {});
  await db.execute(sql`DELETE FROM projects WHERE id = '${sql.raw(PROJECT_ID)}'`).catch(() => {});
  await db.execute(sql`DELETE FROM users WHERE id = '${sql.raw(USER_ID)}'`).catch(() => {});
  await db.execute(sql`DELETE FROM organizations WHERE id = ANY(ARRAY[${sql.raw(ids.map(i => `'${i}'`).join(","))}])`).catch(() => {});
});

// ── A. Unit tests for buildTaktRequestSnapshot() ──────────────────────────────

describe("buildTaktRequestSnapshot() — pure function", () => {
  it("builds a valid snapshot with all whitelisted fields", () => {
    const payload = buildTaktRequestSnapshot({
      takt: TAKT_FIXTURE,
      projectId: PROJECT_ID,
      predecessors: PREDECESSORS,
      successors: SUCCESSORS,
    });

    expect(payload.schemaVersion).toBe("1.0");
    expect(payload.taktReference).toBe(TAKT_ID);
    expect(payload.projectReference).toBe(PROJECT_ID);
    expect(payload.taktVersion).toBe(1);
    expect(payload.trade).toBe("Trockenbau");
    expect(payload.workPackage).toBe("T1 – Trockenbau Nord");
    expect(payload.location.zone).toBe("Ebene EG");
    expect(payload.plannedTimeWindow.start).toBe("2026-09-14");
    expect(payload.plannedTimeWindow.end).toBe("2026-09-28");
    expect(payload.bufferTimeWindow).toEqual({ earliestStart: "2026-09-10", latestEnd: "2026-10-05" });
    expect(payload.requiredOutput).toBe("Montage Trockenbauwände laut Plan T-EG-001");
    expect(payload.resourceRequirements).toHaveLength(1);
    expect(payload.resourceRequirements[0].resourceType).toBe("CREW");
    expect(payload.predecessors).toHaveLength(1);
    expect(payload.predecessors[0].taktId).toBe("t35-takt-000");
    expect(payload.successors).toHaveLength(1);
    expect(payload.successors[0].taktId).toBe("t35-takt-002");
    expect(payload.documentReferences.lvReference).toBe("LV-TKB-001");
    expect(payload.documentReferences.bimReference).toBe("BIM-MODEL-EG");
  });

  it("only whitelisted fields are present — no internal GU/NU data", () => {
    const payload = buildTaktRequestSnapshot({
      takt: TAKT_FIXTURE,
      projectId: PROJECT_ID,
      predecessors: [],
      successors: [],
    });

    const payloadStr = JSON.stringify(payload);
    // Internal fields that must NOT appear
    expect(payloadStr).not.toContain("agOrgId");
    expect(payloadStr).not.toContain("createdByUserId");
    expect(payloadStr).not.toContain("passwordHash");
    expect(payloadStr).not.toContain("anOrgId");
    // Status fields are internal coordination state — not in snapshot
    expect(payloadStr).not.toContain('"status"');
    expect(payloadStr).not.toContain("lifecycleStatus");
    // Timestamps are not released
    expect(payloadStr).not.toContain("createdAt");
    expect(payloadStr).not.toContain("updatedAt");
  });

  it("confidential fields are absent — no project plan, no cost data, no employees", () => {
    const payload = buildTaktRequestSnapshot({
      takt: TAKT_FIXTURE,
      projectId: PROJECT_ID,
      predecessors: [],
      successors: [],
    });
    const payloadKeys = Object.keys(payload);

    // These are the ONLY top-level keys allowed in the snapshot
    const allowedKeys = [
      "schemaVersion", "projectReference", "projectLocation", "projectDescription",
      "taktReference", "taktVersion",
      "trade", "workPackage", "location", "plannedTimeWindow", "bufferTimeWindow",
      "requiredOutput", "resourceRequirements", "constraints",
      "predecessors", "successors", "documentReferences",
    ];
    for (const key of payloadKeys) {
      expect(allowedKeys).toContain(key);
    }
  });

  it("snapshot taktVersion matches the Takt's current version", () => {
    const taktV2: Takt = { ...TAKT_FIXTURE, version: 2 };
    const payload = buildTaktRequestSnapshot({ takt: taktV2, projectId: PROJECT_ID, predecessors: [], successors: [] });
    expect(payload.taktVersion).toBe(2);
  });

  it("throws InvalidTaktForSnapshotError when plannedEnd <= plannedStart", () => {
    const badTakt: Takt = { ...TAKT_FIXTURE, plannedStart: "2026-09-28", plannedEnd: "2026-09-14" };
    expect(() =>
      buildTaktRequestSnapshot({ takt: badTakt, projectId: PROJECT_ID, predecessors: [], successors: [] }),
    ).toThrow(InvalidTaktForSnapshotError);
  });

  it("throws InvalidTaktForSnapshotError when version < 1", () => {
    const badTakt: Takt = { ...TAKT_FIXTURE, version: 0 };
    expect(() =>
      buildTaktRequestSnapshot({ takt: badTakt, projectId: PROJECT_ID, predecessors: [], successors: [] }),
    ).toThrow(InvalidTaktForSnapshotError);
  });

  it("bufferTimeWindow is null when neither earliestStart nor latestEnd is set", () => {
    const noBuffer: Takt = { ...TAKT_FIXTURE, earliestStart: null, latestEnd: null };
    const payload = buildTaktRequestSnapshot({ takt: noBuffer, projectId: PROJECT_ID, predecessors: [], successors: [] });
    expect(payload.bufferTimeWindow).toBeNull();
  });
});

// ── B. DB integration tests for createTaktRequestWithSnapshot() ───────────────

describe("createTaktRequestWithSnapshot() — DB integration", () => {
  function makeInput(overrides: Partial<Parameters<typeof createTaktRequestWithSnapshot>[0]> = {}) {
    return {
      taktId: TAKT_ID,
      guOrgId: GU_ORG,
      nuOrgId: NU_ORG,
      requestNumber: `TKR-T35-${crypto.randomUUID().slice(0, 8)}`,
      createdByUserId: USER_ID,
      ...overrides,
    };
  }

  it("creates a TaktRequest and Snapshot atomically in DRAFT status", async () => {
    const { request, snapshot } = await createTaktRequestWithSnapshot(makeInput());

    expect(request.status).toBe("DRAFT");
    expect(request.taktId).toBe(TAKT_ID);
    expect(request.taktVersion).toBe(1);
    expect(request.guOrgId).toBe(GU_ORG);
    expect(request.nuOrgId).toBe(NU_ORG);

    expect(snapshot.taktRequestId).toBe(request.id);
    expect(snapshot.schemaVersion).toBe("1.0");
    expect(snapshot.snapshotPayload.taktReference).toBe(TAKT_ID);

    // Verify rows exist in DB
    const [dbRequest] = await db.select().from(taktRequestsTable).where(eq(taktRequestsTable.id, request.id));
    const [dbSnapshot] = await db.select().from(taktRequestSnapshotsTable).where(eq(taktRequestSnapshotsTable.taktRequestId, request.id));
    expect(dbRequest.status).toBe("DRAFT");
    expect(dbSnapshot.schemaVersion).toBe("1.0");
  });

  it("snapshot and request carry the same taktVersion", async () => {
    const { request, snapshot } = await createTaktRequestWithSnapshot(makeInput());
    expect(snapshot.snapshotPayload.taktVersion).toBe(request.taktVersion);
  });

  it("changing the Takt after snapshot creation does not alter the snapshot", async () => {
    const { snapshot: before } = await createTaktRequestWithSnapshot(makeInput());

    // Simulate a Takt update
    await db.update(takteTable)
      .set({ taktBezeichnung: "CHANGED NAME", version: 2 })
      .where(eq(takteTable.id, TAKT_ID));

    const [dbSnapshot] = await db
      .select()
      .from(taktRequestSnapshotsTable)
      .where(eq(taktRequestSnapshotsTable.id, before.id));

    const payload = dbSnapshot.snapshotPayload as { workPackage: string; taktVersion: number };
    expect(payload.workPackage).toBe("T1 – Trockenbau Nord"); // original value preserved
    expect(payload.taktVersion).toBe(1);                       // original version preserved

    // Restore Takt for subsequent tests
    await db.update(takteTable)
      .set({ taktBezeichnung: "T1 – Trockenbau Nord", version: 1 })
      .where(eq(takteTable.id, TAKT_ID));
  });

  it("throws TaktNotFoundError for a non-existent taktId", async () => {
    await expect(
      createTaktRequestWithSnapshot(makeInput({ taktId: "non-existent-takt" })),
    ).rejects.toBeInstanceOf(TaktNotFoundError);
  });

  it("throws UnauthorizedSnapshotError when guOrgId is not the project owner", async () => {
    await expect(
      createTaktRequestWithSnapshot(makeInput({ guOrgId: OTHER_GU })),
    ).rejects.toBeInstanceOf(UnauthorizedSnapshotError);
  });

  it("throws NuNotContractorError when nuOrgId is not a project contractor", async () => {
    await expect(
      createTaktRequestWithSnapshot(makeInput({ nuOrgId: OTHER_NU })),
    ).rejects.toBeInstanceOf(NuNotContractorError);
  });

  it("rejects a second snapshot for the same request (immutability — DB UNIQUE)", async () => {
    const { request } = await createTaktRequestWithSnapshot(makeInput());

    // Attempt to manually insert a second snapshot for the same request
    await expect(
      db.insert(taktRequestSnapshotsTable).values({
        taktRequestId: request.id,
        schemaVersion: "1.0",
        snapshotPayload: { duplicate: true } as Record<string, unknown>,
      }),
    ).rejects.toThrow(); // DB UNIQUE constraint on takt_request_id
  });
});
