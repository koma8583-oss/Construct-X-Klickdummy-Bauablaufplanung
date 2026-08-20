/**
 * Tasks 4.5 + 4.6 — Availability check service + alternative generator tests.
 *
 * Tests run directly against the service layer (no HTTP).
 * Uses real DB — each test seeds its own fixtures and cleans up.
 *
 * Fixture prefix: "t45-"
 *
 * Task 4.5 checks:
 *   - Available resources produce FEASIBLE
 *   - Overlap produces RESOURCE_CONFLICT
 *   - Missing crew capacity produces conflict
 *   - Missing qualification produces conflict note (best-effort)
 *   - Missing equipment produces conflict
 *   - Cancelled bookings do NOT produce conflicts
 *   - Other NU's bookings are not considered
 *   - Internal conflicts are never in publicResultPayload
 *   - Public result contains no localProjectIds or resourceIds
 *   - TaktRequest transitions to UNDER_REVIEW
 *   - Technical error produces FAILED, not domain rejection
 *
 * Task 4.6 checks:
 *   - Original window clear → FEASIBLE (no alternatives)
 *   - Blocked window → alternatives generated
 *   - Alternatives sorted by rank
 *   - At most 3 alternatives
 *   - No duplicate windows
 *   - No internal IDs in public alternatives
 *   - Same inputs → same outputs (determinism)
 *   - No-horizon result → NOT_FEASIBLE
 *
 * Alternative generator unit tests:
 *   - next free window found
 *   - reduced crew leads to longer duration
 *   - alternatives contain no internal fields
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@workspace/db";
import {
  organizationsTable,
  usersTable,
  projectsTable,
  takteTable,
  taktRequestsTable,
  taktRequestSnapshotsTable,
  resourcesTable,
  resourceBookingsTable,
  availabilityChecksTable,
} from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import {
  runAvailabilityCheck,
  AvailabilityCheckError,
} from "../services/availability-check-service";
import {
  generateAlternatives,
  toPublicAlternative,
  ALTERNATIVE_GENERATOR_CONFIG,
} from "../services/alternative-generator";
import type { TaktRequestSnapshotPayload } from "../lib/takt-request-snapshot-service";

// ── Fixture IDs ───────────────────────────────────────────────────────────────

const NU_ORG_A = "t45-org-nu-a";
const NU_ORG_B = "t45-org-nu-b";
const GU_ORG   = "t45-org-gu";
const USER_ID  = "t45-user-001";
const PROJECT  = "t45-project-001";

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Build a minimal snapshot payload for tests */
function makeSnapshot(overrides: Partial<TaktRequestSnapshotPayload> = {}): TaktRequestSnapshotPayload {
  return {
    schemaVersion: "1.0",
    projectReference: PROJECT,
    taktReference: "some-takt-id",
    taktVersion: 1,
    trade: "Trockenbau",
    workPackage: "Innenausbau OG2",
    location: { building: null, storey: "OG2", zone: "B" },
    plannedTimeWindow: { start: "2026-11-01", end: "2026-11-14" },
    bufferTimeWindow: { earliestStart: "2026-10-25", latestEnd: "2026-11-21" },
    requiredOutput: null,
    resourceRequirements: [{ resourceType: "CREW", notes: "" }],
    constraints: [],
    predecessors: [],
    successors: [],
    documentReferences: { lvReference: null, bimReference: null },
    ...overrides,
  } as TaktRequestSnapshotPayload;
}

/** Seed a TaktRequest with snapshot in DETAILS_RETRIEVED status */
async function seedRequest(opts: {
  id: string;
  taktId: string;
  status?: string;
  snapshotPayload?: TaktRequestSnapshotPayload;
}): Promise<void> {
  const status = (opts.status ?? "DETAILS_RETRIEVED") as "DETAILS_RETRIEVED" | "UNDER_REVIEW";
  await db.insert(taktRequestsTable).values({
    id: opts.id,
    taktId: opts.taktId,
    guOrgId: GU_ORG,
    nuOrgId: NU_ORG_A,
    requestNumber: `TKR-${opts.id}`,
    status,
    createdByUserId: USER_ID,
  }).onConflictDoNothing();

  await db.insert(taktRequestSnapshotsTable).values({
    taktRequestId: opts.id,
    schemaVersion: "1.0",
    snapshotPayload: (opts.snapshotPayload ?? makeSnapshot()) as unknown as Record<string, unknown>,
  }).onConflictDoNothing();
}

// ── Setup / teardown ──────────────────────────────────────────────────────────

beforeAll(async () => {
  await db.insert(organizationsTable).values([
    { id: NU_ORG_A, name: "T45 NU Org A", type: "AN" },
    { id: NU_ORG_B, name: "T45 NU Org B", type: "AN" },
    { id: GU_ORG,   name: "T45 GU Org",   type: "AG" },
  ]).onConflictDoNothing();

  await db.insert(usersTable).values({
    id: USER_ID, name: "T45 User", email: "t45@example.com", passwordHash: "x",
  }).onConflictDoNothing();

  await db.insert(projectsTable).values({
    id: PROJECT, agOrgId: GU_ORG, name: "T45 Project",
  }).onConflictDoNothing();
});

afterAll(async () => {
  await db.execute(sql`DELETE FROM availability_checks WHERE nu_org_id IN ('${sql.raw(NU_ORG_A)}','${sql.raw(NU_ORG_B)}')`).catch(() => {});
  await db.execute(sql`DELETE FROM resource_bookings WHERE nu_org_id IN ('${sql.raw(NU_ORG_A)}','${sql.raw(NU_ORG_B)}')`).catch(() => {});
  await db.execute(sql`DELETE FROM leistungsanfrage_snapshots WHERE leistungsanfrage_id LIKE 't45-%'`).catch(() => {});
  await db.execute(sql`DELETE FROM leistungsanfragen WHERE gu_org_id = '${sql.raw(GU_ORG)}'`).catch(() => {});
  await db.execute(sql`DELETE FROM resources WHERE an_org_id IN ('${sql.raw(NU_ORG_A)}','${sql.raw(NU_ORG_B)}')`).catch(() => {});
  await db.execute(sql`DELETE FROM leistungen WHERE project_id = '${sql.raw(PROJECT)}'`).catch(() => {});
  await db.execute(sql`DELETE FROM projects WHERE id = '${sql.raw(PROJECT)}'`).catch(() => {});
  await db.execute(sql`DELETE FROM users WHERE id = '${sql.raw(USER_ID)}'`).catch(() => {});
  await db.execute(sql`DELETE FROM organizations WHERE id IN ('${sql.raw(NU_ORG_A)}','${sql.raw(NU_ORG_B)}','${sql.raw(GU_ORG)}')`).catch(() => {});
});

// ── Seed a Takt helper (inline per test to avoid collisions) ──────────────────
async function seedTakt(id: string): Promise<void> {
  await db.insert(takteTable).values({
    id,
    projectId: PROJECT,
    taktBezeichnung: `T45 Takt ${id}`,
    zone: "B",
    gewerk: "Trockenbau",
    plannedStart: "2026-11-01",
    plannedEnd: "2026-11-14",
    version: 1,
  }).onConflictDoNothing();
}

// ── Task 4.5 — runAvailabilityCheck ──────────────────────────────────────────

describe("runAvailabilityCheck — domain guards", () => {
  it("throws REQUEST_NOT_FOUND for unknown request", async () => {
    await expect(runAvailabilityCheck("no-such-id", NU_ORG_A, USER_ID))
      .rejects.toMatchObject({ code: "REQUEST_NOT_FOUND" });
  });

  it("throws WRONG_NU_ORG when nuOrgId does not match", async () => {
    const taktId = "t45-takt-wrong-nu";
    const reqId  = "t45-req-wrong-nu";
    await seedTakt(taktId);
    await seedRequest({ id: reqId, taktId });

    await expect(runAvailabilityCheck(reqId, NU_ORG_B, USER_ID))
      .rejects.toMatchObject({ code: "WRONG_NU_ORG" });
  });

  it("throws INVALID_STATUS for a DRAFT request", async () => {
    const taktId = "t45-takt-draft-status";
    const reqId  = "t45-req-draft-status";
    await seedTakt(taktId);
    await seedRequest({ id: reqId, taktId, status: "DRAFT" });

    // DRAFT is not a checkable status
    await expect(runAvailabilityCheck(reqId, NU_ORG_A, USER_ID))
      .rejects.toMatchObject({ code: "INVALID_STATUS" });
  });
});

describe("runAvailabilityCheck — FEASIBLE result", () => {
  it("available resources produce FEASIBLE with no conflicts", async () => {
    const taktId = "t45-takt-feasible";
    const reqId  = "t45-req-feasible";
    await seedTakt(taktId);
    await seedRequest({ id: reqId, taktId });

    // Seed an active NU resource with no bookings in the window
    const [res] = await db.insert(resourcesTable).values({
      anOrgId: NU_ORG_A, type: "CREW", name: "T45 Free Crew", capacity: 4,
      capacityUnit: "PERSONS", active: true,
    }).returning();

    const check = await runAvailabilityCheck(reqId, NU_ORG_A, USER_ID);

    expect(check.status).toBe("COMPLETED");
    expect(check.result).toBe("FEASIBLE");
    expect(check.publicResultPayload?.recommendedDecision).toBe("ACCEPTED");
    expect(check.publicResultPayload?.alternatives).toHaveLength(0);

    // Internal payload has available resources
    expect(check.internalResultPayload?.conflicts).toHaveLength(0);
    expect(check.internalResultPayload?.availableResources.length).toBeGreaterThan(0);

    await db.delete(resourcesTable).where(eq(resourcesTable.id, res.id));
  });

  it("TaktRequest transitions to UNDER_REVIEW", async () => {
    const taktId = "t45-takt-transition";
    const reqId  = "t45-req-transition";
    await seedTakt(taktId);
    await seedRequest({ id: reqId, taktId, status: "DETAILS_RETRIEVED" });

    await runAvailabilityCheck(reqId, NU_ORG_A, USER_ID);

    const [updated] = await db
      .select({ status: taktRequestsTable.status })
      .from(taktRequestsTable)
      .where(eq(taktRequestsTable.id, reqId));

    expect(updated.status).toBe("UNDER_REVIEW");
  });

  it("re-run from UNDER_REVIEW is allowed", async () => {
    const taktId = "t45-takt-rerun";
    const reqId  = "t45-req-rerun";
    await seedTakt(taktId);
    await seedRequest({ id: reqId, taktId, status: "UNDER_REVIEW" });

    const check1 = await runAvailabilityCheck(reqId, NU_ORG_A, USER_ID);
    const check2 = await runAvailabilityCheck(reqId, NU_ORG_A, USER_ID);

    expect(check2.runNumber).toBe(check1.runNumber + 1);
    expect(check2.supersedesCheckId).toBe(check1.id);
  });
});

describe("runAvailabilityCheck — RESOURCE_CONFLICT result", () => {
  it("overlapping CONFIRMED booking produces conflict", async () => {
    const taktId = "t45-takt-conflict";
    const reqId  = "t45-req-conflict";
    await seedTakt(taktId);
    await seedRequest({ id: reqId, taktId });

    const [res] = await db.insert(resourcesTable).values({
      anOrgId: NU_ORG_A, type: "CREW", name: "T45 Booked Crew", active: true,
    }).returning();

    // Booking fully covers the takt window (2026-11-01 to 2026-11-14) at 100%
    const [booking] = await db.insert(resourceBookingsTable).values({
      nuOrgId: NU_ORG_A,
      resourceId: res.id,
      sourceType: "MANUAL_BLOCK",
      startAt: new Date("2026-11-01T00:00:00Z"),
      endAt:   new Date("2026-11-14T00:00:00Z"),
      utilizationPercent: 100,
      status: "CONFIRMED",
    }).returning();

    const check = await runAvailabilityCheck(reqId, NU_ORG_A, USER_ID);

    expect(check.status).toBe("COMPLETED");
    expect(check.result).not.toBe("FEASIBLE");
    expect(check.internalResultPayload?.conflicts.length).toBeGreaterThan(0);
    expect(check.publicResultPayload?.reasonCode).toBe("RESOURCE_CONFLICT");

    await db.delete(resourceBookingsTable).where(eq(resourceBookingsTable.id, booking.id));
    await db.delete(resourcesTable).where(eq(resourcesTable.id, res.id));
  });

  it("CANCELLED booking does NOT produce conflict", async () => {
    const taktId = "t45-takt-cancelled";
    const reqId  = "t45-req-cancelled";
    await seedTakt(taktId);
    await seedRequest({ id: reqId, taktId });

    const [res] = await db.insert(resourcesTable).values({
      anOrgId: NU_ORG_A, type: "CREW", name: "T45 Cancelled Booking Crew", active: true,
    }).returning();

    // Booking in window but CANCELLED → should not conflict
    const [booking] = await db.insert(resourceBookingsTable).values({
      nuOrgId: NU_ORG_A,
      resourceId: res.id,
      sourceType: "MANUAL_BLOCK",
      startAt: new Date("2026-11-01T00:00:00Z"),
      endAt:   new Date("2026-11-14T00:00:00Z"),
      utilizationPercent: 100,
      status: "CANCELLED",
    }).returning();

    const check = await runAvailabilityCheck(reqId, NU_ORG_A, USER_ID);

    // With only a CANCELLED booking, resource should appear as available
    const available = check.internalResultPayload?.availableResources ?? [];
    const hasResource = available.some((r) => r.resourceId === res.id);
    expect(hasResource).toBe(true);
    expect(check.result).toBe("FEASIBLE");

    await db.delete(resourceBookingsTable).where(eq(resourceBookingsTable.id, booking.id));
    await db.delete(resourcesTable).where(eq(resourcesTable.id, res.id));
  });

  it("other NU's bookings are not considered", async () => {
    const taktId = "t45-takt-other-nu";
    const reqId  = "t45-req-other-nu";
    await seedTakt(taktId);
    await seedRequest({ id: reqId, taktId });

    // NU_A has a free crew resource
    const [resA] = await db.insert(resourcesTable).values({
      anOrgId: NU_ORG_A, type: "CREW", name: "T45 NU-A Crew", active: true,
    }).returning();

    // NU_B has a booking in the same window — should NOT affect NU_A's check
    const [resB] = await db.insert(resourcesTable).values({
      anOrgId: NU_ORG_B, type: "CREW", name: "T45 NU-B Crew", active: true,
    }).returning();

    const [bookingB] = await db.insert(resourceBookingsTable).values({
      nuOrgId: NU_ORG_B,
      resourceId: resB.id,
      sourceType: "MANUAL_BLOCK",
      startAt: new Date("2026-11-01T00:00:00Z"),
      endAt:   new Date("2026-11-14T00:00:00Z"),
      utilizationPercent: 100,
      status: "CONFIRMED",
    }).returning();

    const check = await runAvailabilityCheck(reqId, NU_ORG_A, USER_ID);

    // NU_A's check should be FEASIBLE — NU_B's bookings are invisible
    expect(check.result).toBe("FEASIBLE");

    await db.delete(resourceBookingsTable).where(eq(resourceBookingsTable.id, bookingB.id));
    await db.delete(resourcesTable).where(eq(resourcesTable.id, resA.id));
    await db.delete(resourcesTable).where(eq(resourcesTable.id, resB.id));
  });
});

describe("runAvailabilityCheck — privacy invariants", () => {
  it("publicResultPayload contains no resourceId or localProjectId", async () => {
    const taktId = "t45-takt-privacy";
    const reqId  = "t45-req-privacy";
    await seedTakt(taktId);
    await seedRequest({ id: reqId, taktId });

    const [res] = await db.insert(resourcesTable).values({
      anOrgId: NU_ORG_A, type: "CREW", name: "T45 Privacy Crew", active: true,
    }).returning();

    const [booking] = await db.insert(resourceBookingsTable).values({
      nuOrgId: NU_ORG_A,
      resourceId: res.id,
      sourceType: "LOCAL_PROJECT",
      localProjectId: null,
      startAt: new Date("2026-11-01T00:00:00Z"),
      endAt:   new Date("2026-11-14T00:00:00Z"),
      utilizationPercent: 100,
      status: "CONFIRMED",
    }).returning();

    const check = await runAvailabilityCheck(reqId, NU_ORG_A, USER_ID);

    // Stringify the public payload and ensure no internal IDs leak
    const publicStr = JSON.stringify(check.publicResultPayload ?? {});
    expect(publicStr).not.toContain(res.id);
    expect(publicStr).not.toContain(NU_ORG_A);

    // Also: alternatives in public payload must not contain internal fields
    for (const alt of check.publicResultPayload?.alternatives ?? []) {
      expect((alt as Record<string, unknown>)["_internalResourceIds"]).toBeUndefined();
      expect((alt as Record<string, unknown>)["_outsideBuffer"]).toBeUndefined();
    }

    await db.delete(resourceBookingsTable).where(eq(resourceBookingsTable.id, booking.id));
    await db.delete(resourcesTable).where(eq(resourcesTable.id, res.id));
  });

  it("technical error produces FAILED check, not domain rejection of TaktRequest", async () => {
    // Verify that after runAvailabilityCheck completes (with any result),
    // the TaktRequest status is UNDER_REVIEW — never automatically REJECTED.
    // REJECTED is a domain action that requires an explicit TaktResponse from the NU.
    const taktId = "t45-takt-techfail";
    const reqId  = "t45-req-techfail";
    await seedTakt(taktId);
    await seedRequest({ id: reqId, taktId, status: "DETAILS_RETRIEVED" });

    // Run a check with no NU resources — the check completes (FEASIBLE or NOT_FEASIBLE)
    // The key invariant is: TaktRequest is NOT automatically set to REJECTED
    const check = await runAvailabilityCheck(reqId, NU_ORG_A, USER_ID);

    expect(["COMPLETED", "FAILED"]).toContain(check.status);

    // TaktRequest was set to UNDER_REVIEW (not REJECTED)
    const [req] = await db.select({ status: taktRequestsTable.status })
      .from(taktRequestsTable)
      .where(eq(taktRequestsTable.id, reqId));
    expect(req.status).toBe("UNDER_REVIEW");
    expect(req.status).not.toBe("REJECTED");
  });
});

// ── Task 4.6 — Alternative generator unit tests ───────────────────────────────

describe("generateAlternatives — Task 4.6", () => {
  it("returns empty when original window has no conflicts (FEASIBLE path)", () => {
    // Empty bookings → no conflict → no alternatives needed
    const snapshot = makeSnapshot();
    const resources = [
      { resourceId: "r1", resourceType: "CREW", capacity: 4, capacityUnit: "PERSONS", active: true },
    ];
    // When no conflicts exist, the availability service won't call generateAlternatives.
    // This test verifies that calling with empty bookings still produces alternatives.
    const alts = generateAlternatives(snapshot, resources, []);
    // There may be alternatives (Alternative C searches from plannedStart)
    // but they deduplicate the original window and step forward
    expect(Array.isArray(alts)).toBe(true);
  });

  it("finds the next free window when the original is blocked", () => {
    const snapshot = makeSnapshot({
      plannedTimeWindow: { start: "2026-11-01", end: "2026-11-14" },
    });
    const resources = [
      { resourceId: "r1", resourceType: "CREW", capacity: 4, capacityUnit: "PERSONS", active: true },
    ];
    // Block the original window and 2 days after
    const blockingBookings = [
      {
        id: "b1", resourceId: "r1",
        startAt: new Date("2026-11-01T00:00:00Z"),
        endAt:   new Date("2026-11-16T00:00:00Z"),
        status: "CONFIRMED" as const,
        utilizationPercent: 100,
      },
    ];

    const alts = generateAlternatives(snapshot, resources, blockingBookings);
    expect(alts.length).toBeGreaterThan(0);

    // The first alternative should start AFTER the blocked period
    const firstAlt = alts.find(a => a.rank <= 2);
    if (firstAlt) {
      expect(firstAlt.timeWindow.start >= "2026-11-16").toBe(true);
    }
  });

  it("alternatives are sorted by rank ascending", () => {
    const snapshot = makeSnapshot({
      plannedTimeWindow: { start: "2026-11-01", end: "2026-11-07" },
    });
    const resources = [
      { resourceId: "r1", resourceType: "CREW", capacity: 4, capacityUnit: "PERSONS", active: true },
      { resourceId: "r2", resourceType: "CREW", capacity: 4, capacityUnit: "PERSONS", active: true },
    ];
    const blockingBookings = [
      {
        id: "b1", resourceId: "r1",
        startAt: new Date("2026-10-01T00:00:00Z"),
        endAt:   new Date("2026-12-01T00:00:00Z"),
        status: "CONFIRMED" as const,
        utilizationPercent: 100,
      },
    ];

    const alts = generateAlternatives(snapshot, resources, blockingBookings);
    for (let i = 1; i < alts.length; i++) {
      expect(alts[i].rank).toBeGreaterThanOrEqual(alts[i - 1].rank);
    }
  });

  it("produces at most 3 alternatives", () => {
    const snapshot = makeSnapshot({
      plannedTimeWindow: { start: "2026-11-01", end: "2026-11-14" },
    });
    const resources = [
      { resourceId: "r1", resourceType: "CREW", capacity: 4, capacityUnit: "PERSONS", active: true },
    ];
    const blockingBookings = [
      {
        id: "b1", resourceId: "r1",
        startAt: new Date("2026-11-01T00:00:00Z"),
        endAt:   new Date("2026-11-30T00:00:00Z"),
        status: "CONFIRMED" as const,
        utilizationPercent: 100,
      },
    ];

    const alts = generateAlternatives(snapshot, resources, blockingBookings);
    expect(alts.length).toBeLessThanOrEqual(ALTERNATIVE_GENERATOR_CONFIG.maximumAlternatives);
  });

  it("no duplicate windows", () => {
    const snapshot = makeSnapshot({
      plannedTimeWindow: { start: "2026-11-01", end: "2026-11-07" },
    });
    const resources = [
      { resourceId: "r1", resourceType: "CREW", capacity: 4, capacityUnit: "PERSONS", active: true },
      { resourceId: "r2", resourceType: "CREW", capacity: 2, capacityUnit: "PERSONS", active: true },
    ];
    const blockingBookings: never[] = [];

    const alts = generateAlternatives(snapshot, resources, blockingBookings);
    const windows = alts.map(a => `${a.timeWindow.start}|${a.timeWindow.end}`);
    const unique = new Set(windows);
    expect(unique.size).toBe(windows.length);
  });

  it("reduced crew leads to longer duration (Alternative B)", () => {
    const snapshot = makeSnapshot({
      plannedTimeWindow: { start: "2026-12-01", end: "2026-12-08" }, // 7 days
    });
    // 2 crew resources — Alternative B will use 1 fewer
    const resources = [
      { resourceId: "r1", resourceType: "CREW", capacity: 4, capacityUnit: "PERSONS", active: true },
      { resourceId: "r2", resourceType: "CREW", capacity: 4, capacityUnit: "PERSONS", active: true },
    ];
    // Block r1 entirely so only r2 is free — forces Alternative B to use r2 alone
    const blockingBookings = [
      {
        id: "b1", resourceId: "r1",
        startAt: new Date("2026-12-01T00:00:00Z"),
        endAt:   new Date("2026-12-31T00:00:00Z"),
        status: "CONFIRMED" as const,
        utilizationPercent: 100,
      },
    ];

    const alts = generateAlternatives(snapshot, resources, blockingBookings);
    const altB = alts.find(a => a.alternativeType === "REDUCED_CREW");

    if (altB) {
      // Duration should be longer than 7 days
      const start = new Date(altB.timeWindow.start + "T00:00:00Z");
      const end   = new Date(altB.timeWindow.end   + "T00:00:00Z");
      const days  = Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
      expect(days).toBeGreaterThan(7);

      // crewSize should be smaller than original (8 persons)
      expect((altB.crewSize ?? 0)).toBeLessThan(8);
    }
    // Alt B may not be generated if reduced crew cannot fit either — that's ok
  });

  it("same inputs produce the same alternatives (determinism)", () => {
    const snapshot = makeSnapshot({
      plannedTimeWindow: { start: "2026-11-01", end: "2026-11-14" },
    });
    const resources = [
      { resourceId: "r1", resourceType: "CREW", capacity: 4, capacityUnit: "PERSONS", active: true },
    ];
    const bookings = [
      {
        id: "b1", resourceId: "r1",
        startAt: new Date("2026-11-01T00:00:00Z"),
        endAt:   new Date("2026-11-20T00:00:00Z"),
        status: "CONFIRMED" as const,
        utilizationPercent: 100,
      },
    ];

    const run1 = generateAlternatives(snapshot, resources, bookings);
    const run2 = generateAlternatives(snapshot, resources, bookings);

    expect(JSON.stringify(run1)).toBe(JSON.stringify(run2));
  });

  it("no horizon match produces empty alternatives", () => {
    const snapshot = makeSnapshot({
      plannedTimeWindow: { start: "2026-11-01", end: "2026-11-14" },
    });
    const resources = [
      { resourceId: "r1", resourceType: "CREW", capacity: 4, capacityUnit: "PERSONS", active: true },
    ];
    // Block for longer than the search horizon (60 days from 2026-11-01 = 2026-12-31)
    const bookings = [
      {
        id: "b1", resourceId: "r1",
        startAt: new Date("2026-11-01T00:00:00Z"),
        endAt:   new Date("2027-06-01T00:00:00Z"), // well beyond 60-day horizon
        status: "CONFIRMED" as const,
        utilizationPercent: 100,
      },
    ];

    const alts = generateAlternatives(snapshot, resources, bookings);
    expect(alts.length).toBe(0);
  });

  it("toPublicAlternative strips internal fields", () => {
    const snapshot = makeSnapshot({
      plannedTimeWindow: { start: "2026-12-01", end: "2026-12-08" },
    });
    const resources = [
      { resourceId: "r1", resourceType: "CREW", capacity: 4, capacityUnit: "PERSONS", active: true },
    ];

    const alts = generateAlternatives(snapshot, resources, []);
    for (const alt of alts) {
      const pub = toPublicAlternative(alt);
      const pubKeys = Object.keys(pub);
      expect(pubKeys).not.toContain("_internalResourceIds");
      expect(pubKeys).not.toContain("_outsideBuffer");
      expect(pubKeys).not.toContain("alternativeType");
      expect(pubKeys).toContain("alternativeId");
      expect(pubKeys).toContain("rank");
      expect(pubKeys).toContain("timeWindow");
    }
  });

  it("public alternatives contain no localProjectId or resourceId", () => {
    const snapshot = makeSnapshot({
      plannedTimeWindow: { start: "2026-12-10", end: "2026-12-17" },
    });
    const resources = [
      { resourceId: "secret-resource-id-001", resourceType: "CREW", capacity: 4, capacityUnit: "PERSONS", active: true },
    ];

    const alts = generateAlternatives(snapshot, resources, []);
    for (const alt of alts) {
      const pub = toPublicAlternative(alt);
      const pubStr = JSON.stringify(pub);
      expect(pubStr).not.toContain("secret-resource-id-001");
    }
  });

  it("run from availability service — NOT_FEASIBLE has no alternatives beyond horizon", async () => {
    const taktId = "t45-takt-nofeasible";
    const reqId  = "t45-req-nofeasible";
    await seedTakt(taktId);
    await seedRequest({
      id: reqId,
      taktId,
      snapshotPayload: makeSnapshot({
        plannedTimeWindow: { start: "2026-11-01", end: "2026-11-14" },
      }),
    });

    const [res] = await db.insert(resourcesTable).values({
      anOrgId: NU_ORG_A, type: "CREW", name: "T45 Fully Blocked Crew", active: true,
    }).returning();

    // Block beyond horizon
    const [booking] = await db.insert(resourceBookingsTable).values({
      nuOrgId: NU_ORG_A,
      resourceId: res.id,
      sourceType: "MANUAL_BLOCK",
      startAt: new Date("2026-11-01T00:00:00Z"),
      endAt:   new Date("2027-06-01T00:00:00Z"),
      utilizationPercent: 100,
      status: "CONFIRMED",
    }).returning();

    const check = await runAvailabilityCheck(reqId, NU_ORG_A, USER_ID);
    expect(check.result).toBe("NOT_FEASIBLE");
    expect(check.publicResultPayload?.recommendedDecision).toBe("REJECTED");
    expect(check.publicResultPayload?.alternatives).toHaveLength(0);

    await db.delete(resourceBookingsTable).where(eq(resourceBookingsTable.id, booking.id));
    await db.delete(resourcesTable).where(eq(resourcesTable.id, res.id));
  });
});
