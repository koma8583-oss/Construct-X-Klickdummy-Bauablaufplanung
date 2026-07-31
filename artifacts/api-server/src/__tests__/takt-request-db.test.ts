/**
 * Task 2.4 — DB integration tests for takt_requests and takt_request_snapshots.
 *
 * These tests exercise the actual database to verify:
 *   - FK constraints (taktId, orgId)
 *   - UNIQUE constraints (requestNumber, snapshot per request)
 *   - Default values (status = DRAFT)
 *   - Write-once snapshot semantics via DuplicateSnapshotError
 *   - taktVersion domain rule via inline Zod (DB has no CHECK constraint)
 *
 * Fixtures are created in beforeAll and deleted in afterAll using
 * deterministic IDs to avoid collision with real data.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { z } from "zod";
import { db } from "@workspace/db";
import {
  organizationsTable,
  usersTable,
  projectsTable,
  takteTable,
  taktRequestsTable,
  taktRequestSnapshotsTable,
} from "@workspace/db";
import { eq, like } from "drizzle-orm";
import {
  createTaktRequestDraft,
  createTaktRequestSnapshot,
  DuplicateSnapshotError,
} from "../lib/takt-request-repository";

// ── Fixture IDs ───────────────────────────────────────────────────────────────

const P = "t24-"; // short prefix; avoids collision with real data

const FX = {
  guOrgId: `${P}gu-org-id`,
  nuOrgId: `${P}nu-org-id`,
  userId: `${P}user-id-00`,
  projectId: `${P}proj-id-00`,
  taktId: `${P}takt-id-00`,
};

// Track request IDs created during tests so afterAll can clean them up
const createdRequestIds: string[] = [];

// ── Fixture setup / teardown ──────────────────────────────────────────────────

beforeAll(async () => {
  // Insert in FK dependency order; ignore conflicts in case of retry
  await db
    .insert(usersTable)
    .values({
      id: FX.userId,
      name: "Task-2.4 Test User",
      email: `task-2-4@test.invalid`,
      passwordHash: "not-a-real-hash",
    })
    .onConflictDoNothing();

  await db
    .insert(organizationsTable)
    .values([
      { id: FX.guOrgId, name: "Test GU Org 2.4", type: "AG" },
      { id: FX.nuOrgId, name: "Test NU Org 2.4", type: "AN" },
    ])
    .onConflictDoNothing();

  await db
    .insert(projectsTable)
    .values({
      id: FX.projectId,
      agOrgId: FX.guOrgId,
      name: "Test Project 2.4",
      status: "ACTIVE",
    })
    .onConflictDoNothing();

  await db
    .insert(takteTable)
    .values({
      id: FX.taktId,
      projectId: FX.projectId,
      taktBezeichnung: "T1 – Task2.4 Test",
      zone: "A",
      gewerk: "Rohbau",
      plannedStart: "2026-04-01",
      plannedEnd: "2026-04-14",
      status: "GEPLANT",
    })
    .onConflictDoNothing();
});

afterAll(async () => {
  // Snapshots cascade from takt_requests (ON DELETE CASCADE)
  // Delete requests first, then the fixtures — FK-safe order
  if (createdRequestIds.length > 0) {
    for (const id of createdRequestIds) {
      await db
        .delete(taktRequestsTable)
        .where(eq(taktRequestsTable.id, id))
        .catch(() => {/* already gone */});
    }
  }
  // Also catch any requests inserted directly (bypass-repo tests)
  await db
    .delete(taktRequestsTable)
    .where(like(taktRequestsTable.requestNumber, `${P}%`))
    .catch(() => {});

  await db.delete(takteTable).where(eq(takteTable.id, FX.taktId)).catch(() => {});
  await db.delete(projectsTable).where(eq(projectsTable.id, FX.projectId)).catch(() => {});
  await db.delete(organizationsTable).where(eq(organizationsTable.id, FX.guOrgId)).catch(() => {});
  await db.delete(organizationsTable).where(eq(organizationsTable.id, FX.nuOrgId)).catch(() => {});
  await db.delete(usersTable).where(eq(usersTable.id, FX.userId)).catch(() => {});
});

// ── Helper ────────────────────────────────────────────────────────────────────

let reqCounter = 0;
function nextRequestNumber() {
  return `${P}REQ-${String(++reqCounter).padStart(4, "0")}`;
}

async function makeRequest(overrides: Partial<Parameters<typeof createTaktRequestDraft>[0]> = {}) {
  const row = await createTaktRequestDraft({
    taktId: FX.taktId,
    taktVersion: 1,
    guOrgId: FX.guOrgId,
    nuOrgId: FX.nuOrgId,
    requestNumber: nextRequestNumber(),
    createdByUserId: FX.userId,
    ...overrides,
  });
  createdRequestIds.push(row.id);
  return row;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("takt_requests — create with valid references", () => {
  it("inserts a TaktRequest and returns the new row", async () => {
    const req = await makeRequest();
    expect(req.id).toBeTruthy();
    expect(req.taktId).toBe(FX.taktId);
    expect(req.guOrgId).toBe(FX.guOrgId);
    expect(req.nuOrgId).toBe(FX.nuOrgId);
    expect(req.createdByUserId).toBe(FX.userId);
  });

  it("default status is DRAFT", async () => {
    const req = await makeRequest();
    expect(req.status).toBe("DRAFT");
  });

  it("createdAt and updatedAt are populated automatically", async () => {
    const req = await makeRequest();
    expect(req.createdAt).toBeInstanceOf(Date);
    expect(req.updatedAt).toBeInstanceOf(Date);
  });

  it("taktVersion is stored correctly", async () => {
    const req = await makeRequest({ taktVersion: 3 });
    expect(req.taktVersion).toBe(3);
  });
});

describe("takt_requests — taktVersion domain rule", () => {
  // The DB column has no CHECK constraint; the minimum-1 rule is enforced
  // by the domain/OpenAPI layer (same pattern as takt-model.test.ts).
  const taktVersionSchema = z.number().int().min(1);

  it("taktVersion 1 is valid per domain schema", () => {
    expect(taktVersionSchema.safeParse(1).success).toBe(true);
  });

  it("taktVersion 0 is rejected by domain schema (minimum is 1)", () => {
    expect(taktVersionSchema.safeParse(0).success).toBe(false);
  });

  it("taktVersion -1 is rejected by domain schema", () => {
    expect(taktVersionSchema.safeParse(-1).success).toBe(false);
  });
});

describe("takt_requests — UNIQUE constraint on requestNumber", () => {
  it("rejects a duplicate requestNumber", async () => {
    const number = nextRequestNumber();
    const first = await createTaktRequestDraft({
      taktId: FX.taktId,
      taktVersion: 1,
      guOrgId: FX.guOrgId,
      nuOrgId: FX.nuOrgId,
      requestNumber: number,
      createdByUserId: FX.userId,
    });
    createdRequestIds.push(first.id);

    await expect(
      createTaktRequestDraft({
        taktId: FX.taktId,
        taktVersion: 1,
        guOrgId: FX.guOrgId,
        nuOrgId: FX.nuOrgId,
        requestNumber: number, // same number — should fail
        createdByUserId: FX.userId,
      }),
    ).rejects.toThrow();
  });
});

describe("takt_requests — FK: non-existent taktId", () => {
  it("rejects a request referencing a non-existent Takt", async () => {
    await expect(
      createTaktRequestDraft({
        taktId: "does-not-exist-takt-id",
        taktVersion: 1,
        guOrgId: FX.guOrgId,
        nuOrgId: FX.nuOrgId,
        requestNumber: nextRequestNumber(),
        createdByUserId: FX.userId,
      }),
    ).rejects.toThrow();
  });
});

describe("takt_requests — FK: non-existent organisation", () => {
  it("rejects a request where guOrgId does not exist", async () => {
    await expect(
      createTaktRequestDraft({
        taktId: FX.taktId,
        taktVersion: 1,
        guOrgId: "does-not-exist-gu-org",
        nuOrgId: FX.nuOrgId,
        requestNumber: nextRequestNumber(),
        createdByUserId: FX.userId,
      }),
    ).rejects.toThrow();
  });

  it("rejects a request where nuOrgId does not exist", async () => {
    await expect(
      createTaktRequestDraft({
        taktId: FX.taktId,
        taktVersion: 1,
        guOrgId: FX.guOrgId,
        nuOrgId: "does-not-exist-nu-org",
        requestNumber: nextRequestNumber(),
        createdByUserId: FX.userId,
      }),
    ).rejects.toThrow();
  });
});

describe("takt_request_snapshots — create snapshot", () => {
  it("saves a snapshot for a valid TaktRequest", async () => {
    const req = await makeRequest();
    const snapshot = await createTaktRequestSnapshot({
      taktRequestId: req.id,
      snapshotPayload: {
        taktId: FX.taktId,
        taktVersion: 1,
        taktBezeichnung: "T1 – Task2.4 Test",
        plannedStart: "2026-04-01",
        plannedEnd: "2026-04-14",
      },
    });

    expect(snapshot.id).toBeTruthy();
    expect(snapshot.taktRequestId).toBe(req.id);
    expect(snapshot.schemaVersion).toBe("1.0");
    expect(snapshot.createdAt).toBeInstanceOf(Date);
  });

  it("snapshot payload is stored as JSONB and round-trips correctly", async () => {
    const req = await makeRequest();
    const payload = {
      taktId: FX.taktId,
      taktVersion: 2,
      zone: "B",
      gewerk: "Elektro",
      plannedStart: "2026-05-01",
      plannedEnd: "2026-05-14",
      conditions: ["no weekend work", "scaffold required"],
    };
    const snapshot = await createTaktRequestSnapshot({
      taktRequestId: req.id,
      snapshotPayload: payload,
    });

    // Cast JSONB result — Drizzle returns it as the original object shape
    const stored = snapshot.snapshotPayload as typeof payload;
    expect(stored.taktVersion).toBe(2);
    expect(stored.conditions).toEqual(["no weekend work", "scaffold required"]);
  });
});

describe("takt_request_snapshots — write-once constraint", () => {
  it("rejects a second snapshot for the same TaktRequest (DuplicateSnapshotError)", async () => {
    const req = await makeRequest();

    await createTaktRequestSnapshot({
      taktRequestId: req.id,
      snapshotPayload: { taktId: FX.taktId, taktVersion: 1 },
    });

    await expect(
      createTaktRequestSnapshot({
        taktRequestId: req.id,
        snapshotPayload: { taktId: FX.taktId, taktVersion: 1, note: "second attempt" },
      }),
    ).rejects.toThrow(DuplicateSnapshotError);
  });

  it("DuplicateSnapshotError message names the affected TaktRequest", async () => {
    const req = await makeRequest();

    await createTaktRequestSnapshot({
      taktRequestId: req.id,
      snapshotPayload: { taktId: FX.taktId, taktVersion: 1 },
    });

    await expect(
      createTaktRequestSnapshot({
        taktRequestId: req.id,
        snapshotPayload: { taktId: FX.taktId, taktVersion: 1 },
      }),
    ).rejects.toThrow(req.id);
  });
});
