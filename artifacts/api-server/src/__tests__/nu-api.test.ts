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
import { db } from "@workspace/db";
import {
  organizationsTable,
  usersTable,
  resourcesTable,
  nuLocalProjectsTable,
  resourceBookingsTable,
} from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import app from "../app";

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
