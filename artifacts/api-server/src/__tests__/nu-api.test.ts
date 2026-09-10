/**
 * Task 4.4 — NU-internal API tests.
 *
 * Covers:
 *   - NU can create a local project
 *   - NU can list their own projects (not other NU's)
 *   - GU receives 403 on all /nu/* endpoints
 *   - Resource booking can be created
 *   - Time-window filter (overlap) works
 *   - Resource from another org is rejected
 *   - Booking can be cancelled
 *   - Cancelled booking persists (history preserved)
 *   - Existing /resources endpoints still work
 *
 * Fixture prefix: "t44-"
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import { anDb as db } from "@workspace/db";
import {
  anLeistungsanfrageResourceRequirementsTable,
  anLeistungsanfragenTable,
  organizationsTable,
  usersTable,
  resourcesTable,
  nuLocalProjectsTable,
  resourceBookingsTable,
  resourceTypesTable,
} from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import app from "../app";
import { applyAcceptedAnScheduleChange } from "../services/an-schedule-change-booking-service";
import { lockAnConfirmedCapacity } from "../services/an-capacity-lock-service";

// ── JWT ───────────────────────────────────────────────────────────────────────

const JWT_SECRET =
  process.env.JWT_SECRET ?? "taktkoord-jwt-dev-secret-change-in-prod";

function signToken(p: {
  userId: string;
  orgId: string | null;
  orgType: "AG" | "AN" | null;
  hubAdmin?: boolean;
}): string {
  return jwt.sign({ ...p, hubAdmin: p.hubAdmin ?? false }, JWT_SECRET, { expiresIn: "1h" });
}

// ── Fixture IDs ───────────────────────────────────────────────────────────────

const NU_ORG_A = "t44-org-nu-a";
const NU_ORG_B = "t44-org-nu-b";
const GU_ORG   = "t44-org-gu";
const NU_USER  = "t44-user-nu";
const GU_USER  = "t44-user-gu";
const RES_A    = "t44-resource-a"; // belongs to NU_ORG_A
const RES_B    = "t44-resource-b"; // belongs to NU_ORG_B
const RACE_TYPE = "t437-resource-type";
const RACE_RESOURCE = "t437-resource-pool";
const RACE_MANUAL_BOOKING = "t437-manual-booking";
const RACE_SCHEDULE_BOOKING = "t437-schedule-booking";
const RACE_SCHEDULE_REQUEST = "t437-schedule-request";
const RACE_SCHEDULE_REQUIREMENT = "t437-schedule-requirement";
const CONCRETE_RACE_TYPE = "t464-concrete-resource-type";
const CONCRETE_RACE_RESOURCE = "t464-concrete-resource";
const CONCRETE_RACE_PRIOR_RESOURCE = "t464-prior-resource";
const CONCRETE_RACE_MANUAL_BOOKING = "t464-concrete-manual-booking";
const CONCRETE_RACE_SCHEDULE_BOOKING = "t464-concrete-schedule-booking";
const CONCRETE_RACE_SCHEDULE_REQUEST = "t464-concrete-schedule-request";
const CONCRETE_RACE_SCHEDULE_REQUIREMENT = "t464-concrete-schedule-requirement";
const MULTI_CONCRETE_TYPE = "t476-multi-concrete-resource-type";
const MULTI_CONCRETE_RESOURCE_A = "t476-multi-concrete-resource-a";
const MULTI_CONCRETE_RESOURCE_B = "t476-multi-concrete-resource-b";
const MULTI_CONCRETE_CONFLICT_RESOURCE = "t476-multi-concrete-conflict-resource";
const MULTI_CONCRETE_MANUAL_BOOKING = "t476-multi-concrete-manual-booking";
const MULTI_CONCRETE_SCHEDULE_BOOKING_A = "t476-multi-concrete-schedule-booking-a";
const MULTI_CONCRETE_SCHEDULE_BOOKING_B = "t476-multi-concrete-schedule-booking-b";
const MULTI_CONCRETE_SCHEDULE_REQUEST = "t476-multi-concrete-schedule-request";
const MULTI_CONCRETE_SCHEDULE_REQUIREMENT_A = "t476-multi-concrete-schedule-requirement-a";
const MULTI_CONCRETE_SCHEDULE_REQUIREMENT_B = "t476-multi-concrete-schedule-requirement-b";
const DUAL_EDIT_TYPE = "t465-dual-edit-resource-type";
const DUAL_EDIT_RESOURCE = "t465-dual-edit-resource";
const DUAL_EDIT_BOOKING_A = "t465-dual-edit-booking-a";
const DUAL_EDIT_BOOKING_B = "t465-dual-edit-booking-b";
const CANCEL_EDIT_BOOKING = "t477-cancel-edit-booking";

let nuTokenA: string;
let nuTokenB: string;
let guToken:  string;
let hubToken: string;

// ── Setup / teardown ──────────────────────────────────────────────────────────

beforeAll(async () => {
  await db.insert(organizationsTable).values([
    { id: NU_ORG_A, name: "T44 NU Org A", type: "AN" },
    { id: NU_ORG_B, name: "T44 NU Org B", type: "AN" },
    { id: GU_ORG,   name: "T44 GU Org",   type: "AG" },
  ]).onConflictDoNothing();

  await db.insert(usersTable).values([
    { id: NU_USER, name: "T44 NU", email: "t44-nu@example.com", passwordHash: "x" },
    { id: GU_USER, name: "T44 GU", email: "t44-gu@example.com", passwordHash: "x" },
  ]).onConflictDoNothing();

  await db.insert(resourcesTable).values([
    { id: RES_A, anOrgId: NU_ORG_A, type: "EMPLOYEE", name: "T44 Worker A", active: true },
    { id: RES_B, anOrgId: NU_ORG_B, type: "EMPLOYEE", name: "T44 Worker B", active: true },
  ]).onConflictDoNothing();

  nuTokenA = signToken({ userId: NU_USER, orgId: NU_ORG_A, orgType: "AN" });
  nuTokenB = signToken({ userId: NU_USER, orgId: NU_ORG_B, orgType: "AN" });
  guToken  = signToken({ userId: GU_USER, orgId: GU_ORG,   orgType: "AG" });
  hubToken = signToken({ userId: NU_USER, orgId: null,      orgType: null, hubAdmin: true });
});

afterAll(async () => {
  await db.execute(sql`DELETE FROM resource_bookings WHERE nu_org_id IN ('${sql.raw(NU_ORG_A)}','${sql.raw(NU_ORG_B)}')`).catch(() => {});
  await db.execute(sql`DELETE FROM nu_local_projects WHERE nu_org_id IN ('${sql.raw(NU_ORG_A)}','${sql.raw(NU_ORG_B)}')`).catch(() => {});
  await db.execute(sql`DELETE FROM resources WHERE id IN ('${sql.raw(RES_A)}','${sql.raw(RES_B)}')`).catch(() => {});
  await db.execute(sql`DELETE FROM users WHERE id IN ('${sql.raw(NU_USER)}','${sql.raw(GU_USER)}')`).catch(() => {});
  await db.execute(sql`DELETE FROM organizations WHERE id IN ('${sql.raw(NU_ORG_A)}','${sql.raw(NU_ORG_B)}','${sql.raw(GU_ORG)}')`).catch(() => {});
});

// ── A. Local projects ─────────────────────────────────────────────────────────

describe("POST /api/nu/local-projects", () => {
  it("NU can create a local project", async () => {
    const res = await request(app)
      .post("/api/nu/local-projects")
      .set("Authorization", `Bearer ${nuTokenA}`)
      .send({
        localProjectCode: "T44-P-001",
        displayName: "Innenausbau Projekt West",
        customerAlias: "Kunde B",
        startDate: "2026-08-01",
        endDate: "2026-12-15",
        status: "ACTIVE",
      });

    expect(res.status).toBe(201);
    expect(res.body.nuOrgId).toBe(NU_ORG_A);
    expect(res.body.localProjectCode).toBe("T44-P-001");
    expect(res.body.customerAlias).toBe("Kunde B");
    expect(res.body.status).toBe("ACTIVE");

    await db.delete(nuLocalProjectsTable).where(eq(nuLocalProjectsTable.id, res.body.id));
  });

  it("GU receives 403", async () => {
    const res = await request(app)
      .post("/api/nu/local-projects")
      .set("Authorization", `Bearer ${guToken}`)
      .send({ localProjectCode: "X", displayName: "X" });
    expect(res.status).toBe(403);
  });

  it("hub admin receives 403", async () => {
    const res = await request(app)
      .post("/api/nu/local-projects")
      .set("Authorization", `Bearer ${hubToken}`)
      .send({ localProjectCode: "X", displayName: "X" });
    expect(res.status).toBe(403);
  });

  it("no auth returns 401", async () => {
    const res = await request(app).post("/api/nu/local-projects").send({ localProjectCode: "X", displayName: "X" });
    expect(res.status).toBe(401);
  });

  it("duplicate localProjectCode for same org → 409", async () => {
    await request(app)
      .post("/api/nu/local-projects")
      .set("Authorization", `Bearer ${nuTokenA}`)
      .send({ localProjectCode: "T44-DUP", displayName: "First" });

    const res = await request(app)
      .post("/api/nu/local-projects")
      .set("Authorization", `Bearer ${nuTokenA}`)
      .send({ localProjectCode: "T44-DUP", displayName: "Second" });
    expect(res.status).toBe(409);

    await db.execute(sql`DELETE FROM nu_local_projects WHERE nu_org_id='${sql.raw(NU_ORG_A)}' AND local_project_code='T44-DUP'`);
  });

  it("endDate before startDate → 400", async () => {
    const res = await request(app)
      .post("/api/nu/local-projects")
      .set("Authorization", `Bearer ${nuTokenA}`)
      .send({ localProjectCode: "T44-DATE-BAD", displayName: "Bad dates", startDate: "2026-12-01", endDate: "2026-08-01" });
    expect(res.status).toBe(400);
  });
});

describe("GET /api/nu/local-projects", () => {
  let projAId: string;
  let projBId: string;

  beforeAll(async () => {
    const resA = await request(app)
      .post("/api/nu/local-projects")
      .set("Authorization", `Bearer ${nuTokenA}`)
      .send({ localProjectCode: "T44-LIST-A", displayName: "List Test Org A" });
    projAId = resA.body.id;

    const resB = await request(app)
      .post("/api/nu/local-projects")
      .set("Authorization", `Bearer ${nuTokenB}`)
      .send({ localProjectCode: "T44-LIST-B", displayName: "List Test Org B" });
    projBId = resB.body.id;
  });

  afterAll(async () => {
    await db.delete(nuLocalProjectsTable).where(eq(nuLocalProjectsTable.id, projAId));
    await db.delete(nuLocalProjectsTable).where(eq(nuLocalProjectsTable.id, projBId));
  });

  it("NU sees only their own projects", async () => {
    const res = await request(app)
      .get("/api/nu/local-projects")
      .set("Authorization", `Bearer ${nuTokenA}`);

    expect(res.status).toBe(200);
    const ids = res.body.items.map((p: { id: string }) => p.id);
    expect(ids).toContain(projAId);
    expect(ids).not.toContain(projBId);
  });

  it("GU cannot list NU projects → 403", async () => {
    const res = await request(app)
      .get("/api/nu/local-projects")
      .set("Authorization", `Bearer ${guToken}`);
    expect(res.status).toBe(403);
  });
});

describe("GET /api/nu/local-projects/:projectId", () => {
  let projId: string;

  beforeAll(async () => {
    const res = await request(app)
      .post("/api/nu/local-projects")
      .set("Authorization", `Bearer ${nuTokenA}`)
      .send({ localProjectCode: "T44-SINGLE", displayName: "Single get test" });
    projId = res.body.id;
  });

  afterAll(async () => {
    await db.delete(nuLocalProjectsTable).where(eq(nuLocalProjectsTable.id, projId));
  });

  it("NU can get their own project", async () => {
    const res = await request(app)
      .get(`/api/nu/local-projects/${projId}`)
      .set("Authorization", `Bearer ${nuTokenA}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(projId);
  });

  it("different NU gets 404 (not 403 — no oracle leak)", async () => {
    const res = await request(app)
      .get(`/api/nu/local-projects/${projId}`)
      .set("Authorization", `Bearer ${nuTokenB}`);
    expect(res.status).toBe(404);
  });
});

// ── B. Resource bookings ──────────────────────────────────────────────────────

describe("POST /api/nu/resource-bookings", () => {
  it("NU can create a booking for their own resource", async () => {
    const res = await request(app)
      .post("/api/nu/resource-bookings")
      .set("Authorization", `Bearer ${nuTokenA}`)
      .send({
        resourceId: RES_A,
        sourceType: "MANUAL_BLOCK",
        startAt: "2026-09-14T05:00:00Z",
        endAt:   "2026-09-18T14:00:00Z",
        utilizationPercent: 100,
        status: "CONFIRMED",
        note: "Interne Planung",
      });

    expect(res.status).toBe(201);
    expect(res.body.nuOrgId).toBe(NU_ORG_A);
    expect(res.body.resourceId).toBe(RES_A);
    expect(res.body.status).toBe("CONFIRMED");

    await db.delete(resourceBookingsTable).where(eq(resourceBookingsTable.id, res.body.id));
  });

  it("resource from another org is rejected → 403", async () => {
    const res = await request(app)
      .post("/api/nu/resource-bookings")
      .set("Authorization", `Bearer ${nuTokenA}`)
      .send({
        resourceId: RES_B, // belongs to NU_ORG_B
        sourceType: "MANUAL_BLOCK",
        startAt: "2026-09-14T05:00:00Z",
        endAt:   "2026-09-18T14:00:00Z",
      });
    expect(res.status).toBe(403);
  });

  it("non-existent resource → 404", async () => {
    const res = await request(app)
      .post("/api/nu/resource-bookings")
      .set("Authorization", `Bearer ${nuTokenA}`)
      .send({
        resourceId: "no-such-resource",
        sourceType: "MANUAL_BLOCK",
        startAt: "2026-09-14T05:00:00Z",
        endAt:   "2026-09-18T14:00:00Z",
      });
    expect(res.status).toBe(404);
  });

  it("endAt before startAt → 400", async () => {
    const res = await request(app)
      .post("/api/nu/resource-bookings")
      .set("Authorization", `Bearer ${nuTokenA}`)
      .send({
        resourceId: RES_A,
        sourceType: "MANUAL_BLOCK",
        startAt: "2026-09-18T14:00:00Z",
        endAt:   "2026-09-14T05:00:00Z",
      });
    expect(res.status).toBe(400);
  });

  it("GU receives 403", async () => {
    const res = await request(app)
      .post("/api/nu/resource-bookings")
      .set("Authorization", `Bearer ${guToken}`)
      .send({ resourceId: RES_A, sourceType: "MANUAL_BLOCK", startAt: "2026-09-14T05:00:00Z", endAt: "2026-09-18T14:00:00Z" });
    expect(res.status).toBe(403);
  });
});

describe("GET /api/nu/resource-bookings — overlap filter", () => {
  let bookingId: string;

  beforeAll(async () => {
    const res = await request(app)
      .post("/api/nu/resource-bookings")
      .set("Authorization", `Bearer ${nuTokenA}`)
      .send({
        resourceId: RES_A,
        sourceType: "MANUAL_BLOCK",
        startAt: "2026-11-10T08:00:00Z",
        endAt:   "2026-11-20T17:00:00Z",
        status: "CONFIRMED",
      });
    bookingId = res.body.id;
  });

  afterAll(async () => {
    await db.delete(resourceBookingsTable).where(eq(resourceBookingsTable.id, bookingId));
  });

  it("overlap filter returns booking that overlaps the window", async () => {
    // Query window: 2026-11-15 to 2026-11-25 — overlaps the booking (2026-11-10 to 2026-11-20)
    const res = await request(app)
      .get("/api/nu/resource-bookings?startFrom=2026-11-15T00:00:00Z&endTo=2026-11-25T00:00:00Z")
      .set("Authorization", `Bearer ${nuTokenA}`);

    expect(res.status).toBe(200);
    const ids = res.body.items.map((b: { id: string }) => b.id);
    expect(ids).toContain(bookingId);
  });

  it("overlap filter excludes booking outside the window", async () => {
    // Query window: 2026-12-01 to 2026-12-31 — no overlap with 2026-11-10 to 2026-11-20
    const res = await request(app)
      .get("/api/nu/resource-bookings?startFrom=2026-12-01T00:00:00Z&endTo=2026-12-31T00:00:00Z")
      .set("Authorization", `Bearer ${nuTokenA}`);

    expect(res.status).toBe(200);
    const ids = res.body.items.map((b: { id: string }) => b.id);
    expect(ids).not.toContain(bookingId);
  });
});

describe("POST /api/nu/resource-bookings/:bookingId/cancel", () => {
  let bookingId: string;

  beforeAll(async () => {
    const res = await request(app)
      .post("/api/nu/resource-bookings")
      .set("Authorization", `Bearer ${nuTokenA}`)
      .send({
        resourceId: RES_A,
        sourceType: "MANUAL_BLOCK",
        startAt: "2026-12-01T08:00:00Z",
        endAt:   "2026-12-05T17:00:00Z",
        status: "CONFIRMED",
      });
    bookingId = res.body.id;
  });

  afterAll(async () => {
    // Don't delete — test verifies cancelled booking remains
    await db.delete(resourceBookingsTable).where(eq(resourceBookingsTable.id, bookingId));
  });

  it("booking can be cancelled", async () => {
    const res = await request(app)
      .post(`/api/nu/resource-bookings/${bookingId}/cancel`)
      .set("Authorization", `Bearer ${nuTokenA}`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("CANCELLED");
  });

  it("cancelled booking persists in history (GET still works)", async () => {
    const res = await request(app)
      .get(`/api/nu/resource-bookings/${bookingId}`)
      .set("Authorization", `Bearer ${nuTokenA}`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("CANCELLED");
  });

  it("cancelling an already-cancelled booking is idempotent (200)", async () => {
    const res = await request(app)
      .post(`/api/nu/resource-bookings/${bookingId}/cancel`)
      .set("Authorization", `Bearer ${nuTokenA}`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("CANCELLED");
  });

  it("different NU cannot cancel → 404 (no oracle leak)", async () => {
    const res = await request(app)
      .post(`/api/nu/resource-bookings/${bookingId}/cancel`)
      .set("Authorization", `Bearer ${nuTokenB}`);
    expect(res.status).toBe(404);
  });
});

describe("PATCH confirmed booking vs accepted schedule", () => {
  let scheduleProjectionId: string;

  beforeAll(async () => {
    await db.delete(resourceBookingsTable).where(eq(resourceBookingsTable.id, RACE_MANUAL_BOOKING));
    await db.delete(resourceBookingsTable).where(eq(resourceBookingsTable.id, RACE_SCHEDULE_BOOKING));
    await db.delete(anLeistungsanfrageResourceRequirementsTable)
      .where(eq(anLeistungsanfrageResourceRequirementsTable.id, RACE_SCHEDULE_REQUIREMENT));
    await db.delete(anLeistungsanfragenTable)
      .where(eq(anLeistungsanfragenTable.externalLeistungsanfrageId, RACE_SCHEDULE_REQUEST));
    await db.delete(resourcesTable).where(eq(resourcesTable.id, RACE_RESOURCE));
    await db.delete(resourceTypesTable).where(eq(resourceTypesTable.id, RACE_TYPE));

    await db.insert(resourceTypesTable).values({
      id: RACE_TYPE,
      anOrgId: NU_ORG_A,
      name: "T437 shared capacity",
      category: "PERSONNEL",
      active: true,
    });
    await db.insert(resourcesTable).values({
      id: RACE_RESOURCE,
      anOrgId: NU_ORG_A,
      resourceTypeId: RACE_TYPE,
      type: "EMPLOYEE",
      name: "T437 shared capacity pool",
      capacity: 2,
      capacityUnit: "PERSONS",
      active: true,
    });

    const [projection] = await db.insert(anLeistungsanfragenTable).values({
      externalLeistungsanfrageId: RACE_SCHEDULE_REQUEST,
      externalRequestVersion: 1,
      sourceMessageId: `${RACE_SCHEDULE_REQUEST}-message`,
      payloadHash: `${RACE_SCHEDULE_REQUEST}-hash`,
      correlationId: RACE_SCHEDULE_REQUEST,
      senderAgOrgId: GU_ORG,
      receiverAnOrgId: NU_ORG_A,
      projectReference: "t437-project",
      leistungReference: "t437-leistung",
      plannedStart: "2026-11-01",
      plannedEnd: "2026-11-09",
      payloadSnapshot: {
        requestKind: "SCHEDULE_CHANGE",
        sourceRequestId: "t437-root-request",
        baseTimeWindow: {
          start: "2026-11-01T00:00:00.000Z",
          end: "2026-11-10T00:00:00.000Z",
        },
      },
      status: "UNDER_REVIEW",
    }).returning();
    scheduleProjectionId = projection.id;

    await db.insert(anLeistungsanfrageResourceRequirementsTable).values({
      id: RACE_SCHEDULE_REQUIREMENT,
      anLeistungsanfrageId: scheduleProjectionId,
      externalResourceTypeCode: "WORKER",
      externalResourceTypeName: "Worker",
      localResourceTypeId: RACE_TYPE,
      requiredCapacity: "1",
      capacityUnit: "PERSONS",
      utilizationPercent: 100,
      periodStart: "2026-11-10",
      periodEnd: "2026-11-18",
    });

    await db.insert(resourceBookingsTable).values([
      {
        id: RACE_MANUAL_BOOKING,
        nuOrgId: NU_ORG_A,
        resourceTypeId: RACE_TYPE,
        quantity: 1,
        sourceType: "MANUAL_BLOCK",
        sourceReferenceId: RACE_MANUAL_BOOKING,
        startAt: new Date("2026-11-10T00:00:00.000Z"),
        endAt: new Date("2026-11-19T00:00:00.000Z"),
        utilizationPercent: 100,
        status: "CONFIRMED",
        note: "Original manual booking",
      },
      {
        id: RACE_SCHEDULE_BOOKING,
        nuOrgId: NU_ORG_A,
        resourceTypeId: RACE_TYPE,
        quantity: 1,
        sourceType: "TAKT_REQUEST",
        sourceReferenceId: scheduleProjectionId,
        startAt: new Date("2026-11-01T00:00:00.000Z"),
        endAt: new Date("2026-11-10T00:00:00.000Z"),
        utilizationPercent: 100,
        status: "CONFIRMED",
        note: "Original schedule booking",
      },
    ]);
  });

  afterAll(async () => {
    await db.delete(resourceBookingsTable).where(eq(resourceBookingsTable.id, RACE_MANUAL_BOOKING));
    await db.delete(resourceBookingsTable).where(eq(resourceBookingsTable.id, RACE_SCHEDULE_BOOKING));
    if (scheduleProjectionId) {
      await db.delete(anLeistungsanfrageResourceRequirementsTable)
        .where(eq(anLeistungsanfrageResourceRequirementsTable.anLeistungsanfrageId, scheduleProjectionId));
      await db.delete(anLeistungsanfragenTable).where(eq(anLeistungsanfragenTable.id, scheduleProjectionId));
    }
    await db.delete(resourcesTable).where(eq(resourcesTable.id, RACE_RESOURCE));
    await db.delete(resourceTypesTable).where(eq(resourceTypesTable.id, RACE_TYPE));
  });

  it("serializes an in-place capacity increase against accepted schedule processing", async () => {
    let releaseScheduleLock!: () => void;
    const scheduleLockHeld = new Promise<void>((resolve) => {
      releaseScheduleLock = resolve;
    });
    let scheduleHasLock!: () => void;
    const scheduleLockReady = new Promise<void>((resolve) => {
      scheduleHasLock = resolve;
    });

    const schedulePromise = db.transaction(async (tx) => {
      await lockAnConfirmedCapacity(tx, NU_ORG_A);
      scheduleHasLock();
      await scheduleLockHeld;
      return applyAcceptedAnScheduleChange(tx, {
        projectionId: scheduleProjectionId,
        targetStart: new Date("2026-11-10T00:00:00.000Z"),
        targetEnd: new Date("2026-11-19T00:00:00.000Z"),
        note: "T437 accepted schedule",
        useRequirementPeriods: true,
      });
    });

    await scheduleLockReady;
    const patchPromise = request(app)
      .patch(`/api/nu/resource-bookings/${RACE_MANUAL_BOOKING}`)
      .set("Authorization", `Bearer ${nuTokenA}`)
      .send({ quantity: 2, status: "CONFIRMED" });
    releaseScheduleLock();

    const [scheduleResult, patchResult] = await Promise.all([
      schedulePromise.then(() => ({ succeeded: true as const }))
        .catch((error) => ({ succeeded: false as const, error })),
      patchPromise.then((response) => ({ succeeded: response.status === 200, response })),
    ]);

    expect([scheduleResult.succeeded, patchResult.succeeded].filter(Boolean)).toHaveLength(1);
    expect(patchResult.succeeded).toBe(false);
    expect(patchResult.response.status).toBe(409);
    expect(scheduleResult.succeeded).toBe(true);

    const [manualBooking] = await db.select({
      quantity: resourceBookingsTable.quantity,
      startAt: resourceBookingsTable.startAt,
      endAt: resourceBookingsTable.endAt,
      note: resourceBookingsTable.note,
    }).from(resourceBookingsTable)
      .where(eq(resourceBookingsTable.id, RACE_MANUAL_BOOKING));
    expect(manualBooking).toMatchObject({
      quantity: "1.00",
      note: "Original manual booking",
    });
    expect(manualBooking.startAt.toISOString()).toBe("2026-11-10T00:00:00.000Z");
    expect(manualBooking.endAt.toISOString()).toBe("2026-11-19T00:00:00.000Z");

    const acceptedBookings = await db.select().from(resourceBookingsTable).where(
      eq(resourceBookingsTable.sourceReferenceId, scheduleProjectionId),
    );
    expect(acceptedBookings).toHaveLength(1);
    expect(acceptedBookings[0]).toMatchObject({
      quantity: "1.00",
      status: "CONFIRMED",
    });
    expect(acceptedBookings[0].startAt.toISOString()).toBe("2026-11-10T00:00:00.000Z");
    expect(acceptedBookings[0].endAt.toISOString()).toBe("2026-11-19T00:00:00.000Z");
  });
});

describe("PATCH concrete resource assignment vs accepted schedule", () => {
  let scheduleProjectionId: string;

  beforeAll(async () => {
    await db.delete(resourceBookingsTable).where(
      eq(resourceBookingsTable.id, CONCRETE_RACE_MANUAL_BOOKING),
    );
    await db.delete(resourceBookingsTable).where(
      eq(resourceBookingsTable.id, CONCRETE_RACE_SCHEDULE_BOOKING),
    );
    await db.delete(anLeistungsanfrageResourceRequirementsTable).where(
      eq(anLeistungsanfrageResourceRequirementsTable.id, CONCRETE_RACE_SCHEDULE_REQUIREMENT),
    );
    await db.delete(anLeistungsanfragenTable).where(
      eq(anLeistungsanfragenTable.externalLeistungsanfrageId, CONCRETE_RACE_SCHEDULE_REQUEST),
    );
    await db.delete(resourcesTable).where(
      eq(resourcesTable.id, CONCRETE_RACE_RESOURCE),
    );
    await db.delete(resourcesTable).where(
      eq(resourcesTable.id, CONCRETE_RACE_PRIOR_RESOURCE),
    );
    await db.delete(resourceTypesTable).where(eq(resourceTypesTable.id, CONCRETE_RACE_TYPE));

    await db.insert(resourceTypesTable).values({
      id: CONCRETE_RACE_TYPE,
      anOrgId: NU_ORG_A,
      name: "T464 concrete resource",
      category: "PERSONNEL",
      active: true,
    });
    await db.insert(resourcesTable).values([
      {
        id: CONCRETE_RACE_RESOURCE,
        anOrgId: NU_ORG_A,
        resourceTypeId: CONCRETE_RACE_TYPE,
        type: "EMPLOYEE",
        name: "T464 shared concrete resource",
        capacity: 1,
        capacityUnit: "PERSONS",
        active: true,
      },
      {
        id: CONCRETE_RACE_PRIOR_RESOURCE,
        anOrgId: NU_ORG_A,
        resourceTypeId: CONCRETE_RACE_TYPE,
        type: "EMPLOYEE",
        name: "T464 prior concrete resource",
        capacity: 1,
        capacityUnit: "PERSONS",
        active: false,
      },
    ]);

    const [projection] = await db.insert(anLeistungsanfragenTable).values({
      externalLeistungsanfrageId: CONCRETE_RACE_SCHEDULE_REQUEST,
      externalRequestVersion: 1,
      sourceMessageId: `${CONCRETE_RACE_SCHEDULE_REQUEST}-message`,
      payloadHash: `${CONCRETE_RACE_SCHEDULE_REQUEST}-hash`,
      correlationId: CONCRETE_RACE_SCHEDULE_REQUEST,
      senderAgOrgId: GU_ORG,
      receiverAnOrgId: NU_ORG_A,
      projectReference: "t464-project",
      leistungReference: "t464-leistung",
      plannedStart: "2026-12-01",
      plannedEnd: "2026-12-10",
      payloadSnapshot: {
        requestKind: "SCHEDULE_CHANGE",
        sourceRequestId: "t464-root-request",
        baseTimeWindow: {
          start: "2026-12-01T00:00:00.000Z",
          end: "2026-12-10T00:00:00.000Z",
        },
      },
      status: "UNDER_REVIEW",
    }).returning();
    scheduleProjectionId = projection.id;

    await db.insert(anLeistungsanfrageResourceRequirementsTable).values({
      id: CONCRETE_RACE_SCHEDULE_REQUIREMENT,
      anLeistungsanfrageId: scheduleProjectionId,
      externalResourceTypeCode: "WORKER",
      externalResourceTypeName: "Worker",
      localResourceTypeId: CONCRETE_RACE_TYPE,
      requiredCapacity: "1",
      capacityUnit: "PERSONS",
      utilizationPercent: 100,
      periodStart: "2026-12-10",
      periodEnd: "2026-12-18",
    });

    await db.insert(resourceBookingsTable).values([
      {
        id: CONCRETE_RACE_MANUAL_BOOKING,
        nuOrgId: NU_ORG_A,
        resourceId: CONCRETE_RACE_PRIOR_RESOURCE,
        resourceTypeId: CONCRETE_RACE_TYPE,
        sourceType: "MANUAL_BLOCK",
        sourceReferenceId: CONCRETE_RACE_MANUAL_BOOKING,
        startAt: new Date("2026-12-10T00:00:00.000Z"),
        endAt: new Date("2026-12-19T00:00:00.000Z"),
        utilizationPercent: 100,
        status: "CONFIRMED",
        note: "Prior concrete assignment",
      },
      {
        id: CONCRETE_RACE_SCHEDULE_BOOKING,
        nuOrgId: NU_ORG_A,
        resourceId: CONCRETE_RACE_RESOURCE,
        resourceTypeId: CONCRETE_RACE_TYPE,
        sourceType: "TAKT_REQUEST",
        sourceReferenceId: scheduleProjectionId,
        startAt: new Date("2026-12-01T00:00:00.000Z"),
        endAt: new Date("2026-12-10T00:00:00.000Z"),
        utilizationPercent: 100,
        status: "CONFIRMED",
        note: "Prior schedule assignment",
      },
    ]);
  });

  afterAll(async () => {
    await db.delete(resourceBookingsTable).where(
      eq(resourceBookingsTable.id, CONCRETE_RACE_MANUAL_BOOKING),
    );
    await db.delete(resourceBookingsTable).where(
      eq(resourceBookingsTable.id, CONCRETE_RACE_SCHEDULE_BOOKING),
    );
    if (scheduleProjectionId) {
      await db.delete(anLeistungsanfrageResourceRequirementsTable).where(
        eq(
          anLeistungsanfrageResourceRequirementsTable.anLeistungsanfrageId,
          scheduleProjectionId,
        ),
      );
      await db.delete(anLeistungsanfragenTable).where(
        eq(anLeistungsanfragenTable.id, scheduleProjectionId),
      );
    }
    await db.delete(resourcesTable).where(eq(resourcesTable.id, CONCRETE_RACE_RESOURCE));
    await db.delete(resourcesTable).where(eq(resourcesTable.id, CONCRETE_RACE_PRIOR_RESOURCE));
    await db.delete(resourceTypesTable).where(eq(resourceTypesTable.id, CONCRETE_RACE_TYPE));
  });

  it("serializes a concrete assignment change against accepted schedule processing", async () => {
    let releaseScheduleLock!: () => void;
    const scheduleLockHeld = new Promise<void>((resolve) => {
      releaseScheduleLock = resolve;
    });
    let scheduleHasLock!: () => void;
    const scheduleLockReady = new Promise<void>((resolve) => {
      scheduleHasLock = resolve;
    });

    const schedulePromise = db.transaction(async (tx) => {
      await lockAnConfirmedCapacity(tx, NU_ORG_A);
      scheduleHasLock();
      await scheduleLockHeld;
      return applyAcceptedAnScheduleChange(tx, {
        projectionId: scheduleProjectionId,
        targetStart: new Date("2026-12-10T00:00:00.000Z"),
        targetEnd: new Date("2026-12-19T00:00:00.000Z"),
        note: "T464 accepted schedule",
        useRequirementPeriods: true,
      });
    });

    await scheduleLockReady;
    const patchPromise = request(app)
      .patch(`/api/nu/resource-bookings/${CONCRETE_RACE_MANUAL_BOOKING}`)
      .set("Authorization", `Bearer ${nuTokenA}`)
      .send({
        resourceId: CONCRETE_RACE_RESOURCE,
        status: "CONFIRMED",
      });
    releaseScheduleLock();

    const [scheduleResult, patchResult] = await Promise.all([
      schedulePromise.then(() => ({ succeeded: true as const }))
        .catch((error) => ({ succeeded: false as const, error })),
      patchPromise.then((response) => ({ succeeded: response.status === 200, response })),
    ]);

    expect([scheduleResult.succeeded, patchResult.succeeded].filter(Boolean)).toHaveLength(1);
    expect(scheduleResult.succeeded).toBe(true);
    expect(patchResult.succeeded).toBe(false);
    expect(patchResult.response.status).toBe(409);

    const [manualBooking] = await db.select({
      resourceId: resourceBookingsTable.resourceId,
      resourceTypeId: resourceBookingsTable.resourceTypeId,
      startAt: resourceBookingsTable.startAt,
      endAt: resourceBookingsTable.endAt,
      note: resourceBookingsTable.note,
    }).from(resourceBookingsTable)
      .where(eq(resourceBookingsTable.id, CONCRETE_RACE_MANUAL_BOOKING));
    expect(manualBooking).toMatchObject({
      resourceId: CONCRETE_RACE_PRIOR_RESOURCE,
      resourceTypeId: CONCRETE_RACE_TYPE,
      note: "Prior concrete assignment",
    });
    expect(manualBooking.startAt.toISOString()).toBe("2026-12-10T00:00:00.000Z");
    expect(manualBooking.endAt.toISOString()).toBe("2026-12-19T00:00:00.000Z");

    const [acceptedBooking] = await db.select({
      resourceId: resourceBookingsTable.resourceId,
      startAt: resourceBookingsTable.startAt,
      endAt: resourceBookingsTable.endAt,
      status: resourceBookingsTable.status,
    }).from(resourceBookingsTable)
      .where(eq(resourceBookingsTable.sourceReferenceId, scheduleProjectionId));
    expect(acceptedBooking).toMatchObject({
      resourceId: CONCRETE_RACE_RESOURCE,
      status: "CONFIRMED",
    });
    expect(acceptedBooking.startAt.toISOString()).toBe("2026-12-10T00:00:00.000Z");
    expect(acceptedBooking.endAt.toISOString()).toBe("2026-12-19T00:00:00.000Z");
  });
});

describe("rejected multi-resource schedule preserves prior concrete bookings", () => {
  let scheduleProjectionId: string;

  beforeAll(async () => {
    await db.delete(resourceBookingsTable).where(eq(resourceBookingsTable.id, MULTI_CONCRETE_MANUAL_BOOKING));
    await db.delete(resourceBookingsTable).where(eq(resourceBookingsTable.id, MULTI_CONCRETE_SCHEDULE_BOOKING_A));
    await db.delete(resourceBookingsTable).where(eq(resourceBookingsTable.id, MULTI_CONCRETE_SCHEDULE_BOOKING_B));
    await db.delete(anLeistungsanfrageResourceRequirementsTable).where(
      eq(anLeistungsanfrageResourceRequirementsTable.id, MULTI_CONCRETE_SCHEDULE_REQUIREMENT_A),
    );
    await db.delete(anLeistungsanfrageResourceRequirementsTable).where(
      eq(anLeistungsanfrageResourceRequirementsTable.id, MULTI_CONCRETE_SCHEDULE_REQUIREMENT_B),
    );
    await db.delete(anLeistungsanfragenTable).where(
      eq(anLeistungsanfragenTable.externalLeistungsanfrageId, MULTI_CONCRETE_SCHEDULE_REQUEST),
    );
    await db.delete(resourcesTable).where(eq(resourcesTable.id, MULTI_CONCRETE_RESOURCE_A));
    await db.delete(resourcesTable).where(eq(resourcesTable.id, MULTI_CONCRETE_RESOURCE_B));
    await db.delete(resourcesTable).where(eq(resourcesTable.id, MULTI_CONCRETE_CONFLICT_RESOURCE));
    await db.delete(resourceTypesTable).where(eq(resourceTypesTable.id, MULTI_CONCRETE_TYPE));

    await db.insert(resourceTypesTable).values({
      id: MULTI_CONCRETE_TYPE,
      anOrgId: NU_ORG_A,
      name: "T476 multi-resource capacity",
      category: "PERSONNEL",
      active: true,
    });
    await db.insert(resourcesTable).values([
      {
        id: MULTI_CONCRETE_RESOURCE_A,
        anOrgId: NU_ORG_A,
        resourceTypeId: MULTI_CONCRETE_TYPE,
        type: "EMPLOYEE",
        name: "T476 schedule resource A",
        capacity: 1,
        capacityUnit: "PERSONS",
        active: true,
      },
      {
        id: MULTI_CONCRETE_RESOURCE_B,
        anOrgId: NU_ORG_A,
        resourceTypeId: MULTI_CONCRETE_TYPE,
        type: "EMPLOYEE",
        name: "T476 schedule resource B",
        capacity: 1,
        capacityUnit: "PERSONS",
        active: true,
      },
      {
        id: MULTI_CONCRETE_CONFLICT_RESOURCE,
        anOrgId: NU_ORG_A,
        resourceTypeId: MULTI_CONCRETE_TYPE,
        type: "EMPLOYEE",
        name: "T476 competing resource",
        capacity: 1,
        capacityUnit: "PERSONS",
        active: false,
      },
    ]);

    const [projection] = await db.insert(anLeistungsanfragenTable).values({
      externalLeistungsanfrageId: MULTI_CONCRETE_SCHEDULE_REQUEST,
      externalRequestVersion: 1,
      sourceMessageId: `${MULTI_CONCRETE_SCHEDULE_REQUEST}-message`,
      payloadHash: `${MULTI_CONCRETE_SCHEDULE_REQUEST}-hash`,
      correlationId: MULTI_CONCRETE_SCHEDULE_REQUEST,
      senderAgOrgId: GU_ORG,
      receiverAnOrgId: NU_ORG_A,
      projectReference: "t476-project",
      leistungReference: "t476-leistung",
      plannedStart: "2026-12-01",
      plannedEnd: "2026-12-10",
      payloadSnapshot: {
        requestKind: "SCHEDULE_CHANGE",
        sourceRequestId: "t476-root-request",
        baseTimeWindow: {
          start: "2026-12-01T00:00:00.000Z",
          end: "2026-12-10T00:00:00.000Z",
        },
      },
      status: "UNDER_REVIEW",
    }).returning();
    scheduleProjectionId = projection.id;

    await db.insert(anLeistungsanfrageResourceRequirementsTable).values([
      {
        id: MULTI_CONCRETE_SCHEDULE_REQUIREMENT_A,
        anLeistungsanfrageId: scheduleProjectionId,
        externalResourceTypeCode: "WORKER",
        externalResourceTypeName: "Worker",
        localResourceTypeId: MULTI_CONCRETE_TYPE,
        requiredCapacity: "1",
        capacityUnit: "PERSONS",
        utilizationPercent: 100,
        periodStart: "2026-12-10",
        periodEnd: "2026-12-18",
      },
      {
        id: MULTI_CONCRETE_SCHEDULE_REQUIREMENT_B,
        anLeistungsanfrageId: scheduleProjectionId,
        externalResourceTypeCode: "WORKER",
        externalResourceTypeName: "Worker",
        localResourceTypeId: MULTI_CONCRETE_TYPE,
        requiredCapacity: "1",
        capacityUnit: "PERSONS",
        utilizationPercent: 100,
        periodStart: "2026-12-10",
        periodEnd: "2026-12-18",
      },
    ]);

    await db.insert(resourceBookingsTable).values([
      {
        id: MULTI_CONCRETE_MANUAL_BOOKING,
        nuOrgId: NU_ORG_A,
        resourceId: MULTI_CONCRETE_CONFLICT_RESOURCE,
        resourceTypeId: MULTI_CONCRETE_TYPE,
        sourceType: "MANUAL_BLOCK",
        sourceReferenceId: MULTI_CONCRETE_MANUAL_BOOKING,
        startAt: new Date("2026-12-20T00:00:00.000Z"),
        endAt: new Date("2026-12-21T00:00:00.000Z"),
        utilizationPercent: 100,
        status: "CONFIRMED",
        note: "Competing booking before PATCH",
      },
      {
        id: MULTI_CONCRETE_SCHEDULE_BOOKING_A,
        nuOrgId: NU_ORG_A,
        resourceId: MULTI_CONCRETE_RESOURCE_A,
        resourceTypeId: MULTI_CONCRETE_TYPE,
        sourceType: "TAKT_REQUEST",
        sourceReferenceId: scheduleProjectionId,
        startAt: new Date("2026-12-01T00:00:00.000Z"),
        endAt: new Date("2026-12-10T00:00:00.000Z"),
        utilizationPercent: 100,
        status: "CONFIRMED",
        note: "Prior schedule assignment A",
      },
      {
        id: MULTI_CONCRETE_SCHEDULE_BOOKING_B,
        nuOrgId: NU_ORG_A,
        resourceId: MULTI_CONCRETE_RESOURCE_B,
        resourceTypeId: MULTI_CONCRETE_TYPE,
        sourceType: "TAKT_REQUEST",
        sourceReferenceId: scheduleProjectionId,
        startAt: new Date("2026-12-01T00:00:00.000Z"),
        endAt: new Date("2026-12-10T00:00:00.000Z"),
        utilizationPercent: 100,
        status: "CONFIRMED",
        note: "Prior schedule assignment B",
      },
    ]);
  });

  afterAll(async () => {
    await db.delete(resourceBookingsTable).where(eq(resourceBookingsTable.id, MULTI_CONCRETE_MANUAL_BOOKING));
    await db.delete(resourceBookingsTable).where(eq(resourceBookingsTable.id, MULTI_CONCRETE_SCHEDULE_BOOKING_A));
    await db.delete(resourceBookingsTable).where(eq(resourceBookingsTable.id, MULTI_CONCRETE_SCHEDULE_BOOKING_B));
    if (scheduleProjectionId) {
      await db.delete(anLeistungsanfrageResourceRequirementsTable).where(
        eq(anLeistungsanfrageResourceRequirementsTable.anLeistungsanfrageId, scheduleProjectionId),
      );
      await db.delete(anLeistungsanfragenTable).where(eq(anLeistungsanfragenTable.id, scheduleProjectionId));
    }
    await db.delete(resourcesTable).where(eq(resourcesTable.id, MULTI_CONCRETE_RESOURCE_A));
    await db.delete(resourcesTable).where(eq(resourcesTable.id, MULTI_CONCRETE_RESOURCE_B));
    await db.delete(resourcesTable).where(eq(resourcesTable.id, MULTI_CONCRETE_CONFLICT_RESOURCE));
    await db.delete(resourceTypesTable).where(eq(resourceTypesTable.id, MULTI_CONCRETE_TYPE));
  });

  it("keeps every prior assignment when a competing PATCH rejects schedule acceptance", async () => {
    let releaseCapacityLock!: () => void;
    const capacityLockHeld = new Promise<void>((resolve) => {
      releaseCapacityLock = resolve;
    });
    let holderReady!: () => void;
    const lockHolderReady = new Promise<void>((resolve) => {
      holderReady = resolve;
    });

    const lockHolder = db.transaction(async (tx) => {
      await lockAnConfirmedCapacity(tx, NU_ORG_A);
      holderReady();
      await capacityLockHeld;
    });

    await lockHolderReady;
    const patchPromise = request(app)
      .patch(`/api/nu/resource-bookings/${MULTI_CONCRETE_MANUAL_BOOKING}`)
      .set("Authorization", `Bearer ${nuTokenA}`)
      .send({
        resourceId: MULTI_CONCRETE_RESOURCE_A,
        resourceTypeId: MULTI_CONCRETE_TYPE,
        startAt: "2026-12-10T00:00:00.000Z",
        endAt: "2026-12-19T00:00:00.000Z",
        status: "CONFIRMED",
        note: "Competing PATCH won",
      });

    for (let attempt = 0; attempt < 100; attempt += 1) {
      const waitingResult = await db.execute(sql`
        SELECT count(*)::int AS count
        FROM pg_locks
        WHERE locktype = 'advisory'
          AND NOT granted
      `);
      const waiting = waitingResult.rows[0];
      if (Number(waiting?.count ?? 0) > 0) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    releaseCapacityLock();
    const patchResult = await patchPromise.then((response) => ({
      succeeded: response.status === 200,
      response,
    }));

    const scheduleResult = await db.transaction((tx) => applyAcceptedAnScheduleChange(tx, {
      projectionId: scheduleProjectionId,
      targetStart: new Date("2026-12-10T00:00:00.000Z"),
      targetEnd: new Date("2026-12-19T00:00:00.000Z"),
      note: "Rejected multi-resource replacement",
      useRequirementPeriods: true,
    })).then(() => ({ succeeded: true as const }))
      .catch((error) => ({ succeeded: false as const, error }));
    await lockHolder;

    expect(scheduleResult.succeeded).toBe(false);
    expect(patchResult.succeeded).toBe(true);
    expect(patchResult.response.status).toBe(200);

    const scheduleBookings = await db.select({
      id: resourceBookingsTable.id,
      resourceId: resourceBookingsTable.resourceId,
      startAt: resourceBookingsTable.startAt,
      endAt: resourceBookingsTable.endAt,
      note: resourceBookingsTable.note,
      status: resourceBookingsTable.status,
    }).from(resourceBookingsTable).where(
      eq(resourceBookingsTable.sourceReferenceId, scheduleProjectionId),
    );
    expect(scheduleBookings).toHaveLength(2);
    expect(scheduleBookings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: MULTI_CONCRETE_SCHEDULE_BOOKING_A,
        resourceId: MULTI_CONCRETE_RESOURCE_A,
        note: "Prior schedule assignment A",
        status: "CONFIRMED",
        startAt: new Date("2026-12-01T00:00:00.000Z"),
        endAt: new Date("2026-12-10T00:00:00.000Z"),
      }),
      expect.objectContaining({
        id: MULTI_CONCRETE_SCHEDULE_BOOKING_B,
        resourceId: MULTI_CONCRETE_RESOURCE_B,
        note: "Prior schedule assignment B",
        status: "CONFIRMED",
        startAt: new Date("2026-12-01T00:00:00.000Z"),
        endAt: new Date("2026-12-10T00:00:00.000Z"),
      }),
    ]));
  });
});

describe("simultaneous confirmed booking edits", () => {
  const targetStart = new Date("2027-01-10T00:00:00.000Z");
  const targetEnd = new Date("2027-01-11T00:00:00.000Z");

  beforeAll(async () => {
    await db.delete(resourceBookingsTable).where(eq(resourceBookingsTable.id, DUAL_EDIT_BOOKING_A));
    await db.delete(resourceBookingsTable).where(eq(resourceBookingsTable.id, DUAL_EDIT_BOOKING_B));
    await db.delete(resourceBookingsTable).where(eq(resourceBookingsTable.id, CANCEL_EDIT_BOOKING));
    await db.delete(resourcesTable).where(eq(resourcesTable.id, DUAL_EDIT_RESOURCE));
    await db.delete(resourceTypesTable).where(eq(resourceTypesTable.id, DUAL_EDIT_TYPE));

    await db.insert(resourceTypesTable).values({
      id: DUAL_EDIT_TYPE,
      anOrgId: NU_ORG_A,
      name: "T465 one-unit capacity",
      category: "PERSONNEL",
      active: true,
    });
    await db.insert(resourcesTable).values({
      id: DUAL_EDIT_RESOURCE,
      anOrgId: NU_ORG_A,
      resourceTypeId: DUAL_EDIT_TYPE,
      type: "EMPLOYEE",
      name: "T465 one-unit capacity pool",
      capacity: 1,
      capacityUnit: "PERSONS",
      active: true,
    });
    await db.insert(resourceBookingsTable).values([
      {
        id: DUAL_EDIT_BOOKING_A,
        nuOrgId: NU_ORG_A,
        resourceTypeId: DUAL_EDIT_TYPE,
        quantity: 1,
        sourceType: "MANUAL_BLOCK",
        sourceReferenceId: DUAL_EDIT_BOOKING_A,
        startAt: new Date("2027-01-01T00:00:00.000Z"),
        endAt: new Date("2027-01-02T00:00:00.000Z"),
        utilizationPercent: 100,
        status: "CONFIRMED",
        note: "T465 booking A",
      },
      {
        id: DUAL_EDIT_BOOKING_B,
        nuOrgId: NU_ORG_A,
        resourceTypeId: DUAL_EDIT_TYPE,
        quantity: 1,
        sourceType: "MANUAL_BLOCK",
        sourceReferenceId: DUAL_EDIT_BOOKING_B,
        startAt: new Date("2027-01-03T00:00:00.000Z"),
        endAt: new Date("2027-01-04T00:00:00.000Z"),
        utilizationPercent: 100,
        status: "CONFIRMED",
        note: "T465 booking B",
      },
      {
        id: CANCEL_EDIT_BOOKING,
        nuOrgId: NU_ORG_A,
        resourceTypeId: DUAL_EDIT_TYPE,
        quantity: 1,
        sourceType: "MANUAL_BLOCK",
        sourceReferenceId: CANCEL_EDIT_BOOKING,
        startAt: new Date("2027-01-05T00:00:00.000Z"),
        endAt: new Date("2027-01-06T00:00:00.000Z"),
        utilizationPercent: 100,
        status: "CONFIRMED",
        note: "T477 cancellation race",
      },
    ]);
  });

  afterAll(async () => {
    await db.delete(resourceBookingsTable).where(eq(resourceBookingsTable.id, DUAL_EDIT_BOOKING_A));
    await db.delete(resourceBookingsTable).where(eq(resourceBookingsTable.id, DUAL_EDIT_BOOKING_B));
    await db.delete(resourceBookingsTable).where(eq(resourceBookingsTable.id, CANCEL_EDIT_BOOKING));
    await db.delete(resourcesTable).where(eq(resourcesTable.id, DUAL_EDIT_RESOURCE));
    await db.delete(resourceTypesTable).where(eq(resourceTypesTable.id, DUAL_EDIT_TYPE));
  });

  it("allows only one simultaneous edit to claim the overlapping capacity", async () => {
    const [firstResult, secondResult] = await Promise.all([
      request(app)
        .patch(`/api/nu/resource-bookings/${DUAL_EDIT_BOOKING_A}`)
        .set("Authorization", `Bearer ${nuTokenA}`)
        .send({
          startAt: targetStart.toISOString(),
          endAt: targetEnd.toISOString(),
          status: "CONFIRMED",
        }),
      request(app)
        .patch(`/api/nu/resource-bookings/${DUAL_EDIT_BOOKING_B}`)
        .set("Authorization", `Bearer ${nuTokenA}`)
        .send({
          startAt: targetStart.toISOString(),
          endAt: targetEnd.toISOString(),
          status: "CONFIRMED",
        }),
    ]);

    expect([firstResult.status, secondResult.status].sort()).toEqual([200, 409]);

    const rejectedBookingId =
      firstResult.status === 409 ? DUAL_EDIT_BOOKING_A : DUAL_EDIT_BOOKING_B;
    const rejectedWindow = rejectedBookingId === DUAL_EDIT_BOOKING_A
      ? {
        start: "2027-01-01T00:00:00.000Z",
        end: "2027-01-02T00:00:00.000Z",
        note: "T465 booking A",
      }
      : {
        start: "2027-01-03T00:00:00.000Z",
        end: "2027-01-04T00:00:00.000Z",
        note: "T465 booking B",
      };
    const [rejectedBooking] = await db.select({
      startAt: resourceBookingsTable.startAt,
      endAt: resourceBookingsTable.endAt,
      note: resourceBookingsTable.note,
    }).from(resourceBookingsTable)
      .where(eq(resourceBookingsTable.id, rejectedBookingId));
    expect(rejectedBooking).toMatchObject({
      note: rejectedWindow.note,
    });
    expect(rejectedBooking.startAt.toISOString()).toBe(rejectedWindow.start);
    expect(rejectedBooking.endAt.toISOString()).toBe(rejectedWindow.end);

    const confirmedBookings = await db.select({
      quantity: resourceBookingsTable.quantity,
      startAt: resourceBookingsTable.startAt,
      endAt: resourceBookingsTable.endAt,
      status: resourceBookingsTable.status,
    }).from(resourceBookingsTable)
      .where(eq(resourceBookingsTable.resourceTypeId, DUAL_EDIT_TYPE));
    const overlappingBookings = confirmedBookings.filter((booking) =>
      booking.status === "CONFIRMED" &&
      booking.startAt < targetEnd &&
      booking.endAt > targetStart);

    expect(overlappingBookings).toHaveLength(1);
    expect(overlappingBookings.reduce(
      (total, booking) => total + Number(booking.quantity ?? 0),
      0,
    )).toBeLessThanOrEqual(1);
  });

  it("does not allow a concurrent confirmed edit to undo cancellation", async () => {
    const [patchResult, cancelResult] = await Promise.all([
      request(app)
        .patch(`/api/nu/resource-bookings/${CANCEL_EDIT_BOOKING}`)
        .set("Authorization", `Bearer ${nuTokenA}`)
        .send({
          status: "CONFIRMED",
          note: "T477 concurrent edit",
        }),
      request(app)
        .post(`/api/nu/resource-bookings/${CANCEL_EDIT_BOOKING}/cancel`)
        .set("Authorization", `Bearer ${nuTokenA}`),
    ]);

    expect(cancelResult.status).toBe(200);
    expect([200, 409]).toContain(patchResult.status);

    const [booking] = await db
      .select({ status: resourceBookingsTable.status })
      .from(resourceBookingsTable)
      .where(eq(resourceBookingsTable.id, CANCEL_EDIT_BOOKING));
    expect(booking.status).toBe("CANCELLED");
  });
});

// ── C. Backward compat: existing resource endpoints ───────────────────────────

describe("Existing /api/resources endpoints still work", () => {
  it("GET /api/resources returns 200 for NU", async () => {
    const res = await request(app)
      .get("/api/resources")
      .set("Authorization", `Bearer ${nuTokenA}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it("POST /api/resources still accepts all resource types including CREW", async () => {
    const res = await request(app)
      .post("/api/resources")
      .set("Authorization", `Bearer ${nuTokenA}`)
      .send({ type: "CREW", name: "T44 BC Crew", capacity: 4, capacityUnit: "PERSONS" });
    expect(res.status).toBe(201);
    await db.delete(resourcesTable).where(eq(resourcesTable.id, res.body.id));
  });
});
