/**
 * Task 85 — AN-App UI backend coverage: local projects, resource bookings, availability checks.
 *
 * Tests:
 *   NU-only guard:
 *   [1]  AG token → GET /api/nu/local-projects             → 403
 *   [2]  Hub-admin token → GET /api/nu/local-projects      → 403
 *   [3]  AG token → GET /api/nu/resource-bookings          → 403
 *
 *   Local projects CRUD:
 *   [4]  AN → POST /api/nu/local-projects                  → 201, fields correct
 *   [5]  AN → GET /api/nu/local-projects                   → 200, includes new project
 *   [6]  AN → GET /api/nu/local-projects?status=ACTIVE     → 200, status-filtered
 *   [7]  AN → GET /api/nu/local-projects/:id               → 200
 *   [8]  AN → PATCH /api/nu/local-projects/:id             → 200, status updated
 *   [9]  Duplicate localProjectCode                        → 409
 *   [10] AN-B cannot see AN-A's projects                   → empty list
 *
 *   Resource bookings:
 *   [11] AN → POST /api/nu/resource-bookings               → 201
 *   [12] AN → GET /api/nu/resource-bookings                → 200, includes new booking
 *   [13] AN → GET /api/nu/resource-bookings?status=TENTATIVE → 200
 *   [14] AN → POST /api/nu/resource-bookings/:id/cancel    → 200, status=CANCELLED
 *   [15] AN-B cannot see AN-A's bookings                   → empty list
 *
 *   Availability check access:
 *   [16] AG → POST /api/takt-requests/:id/availability-checks → 403 (handled by existing guard)
 *
 * Fixture prefix: "t85-"
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import { agDb as db } from "@workspace/db";
import {
  organizationsTable,
  usersTable,
  resourcesTable,
  nuLocalProjectsTable,
  resourceBookingsTable,
} from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";
import app from "../app";

const JWT_SECRET = process.env.JWT_SECRET ?? "taktkoord-jwt-dev-secret-change-in-prod";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const GU_ORG     = "t85-org-gu";
const NU_ORG_A   = "t85-org-nu-a";
const NU_ORG_B   = "t85-org-nu-b";
const USER_ID    = "t85-user";
const RESOURCE_ID = "t85-resource";

function makeToken(orgId: string | null, orgType: "AG" | "AN" | null, hubAdmin = false): string {
  return jwt.sign(
    { userId: USER_ID, orgId, orgType, hubAdmin, roles: [] },
    JWT_SECRET,
    { expiresIn: "1h" },
  );
}

const agToken   = makeToken(GU_ORG,   "AG");
const nuAToken  = makeToken(NU_ORG_A, "AN");
const nuBToken  = makeToken(NU_ORG_B, "AN");
const hubToken  = makeToken(null,      null, true);

// ── Setup / Teardown ──────────────────────────────────────────────────────────

let createdProjectId = "";
let createdBookingId = "";

beforeAll(async () => {
  await db.insert(organizationsTable).values([
    { id: GU_ORG,   name: "T85 GU",   type: "AG" as const },
    { id: NU_ORG_A, name: "T85 NU-A", type: "AN" as const },
    { id: NU_ORG_B, name: "T85 NU-B", type: "AN" as const },
  ]).onConflictDoNothing();

  await db.insert(usersTable).values([
    { id: USER_ID, name: "T85 User", email: "t85@test.local", passwordHash: "x" },
  ]).onConflictDoNothing();

  await db.insert(resourcesTable).values([
    {
      id: RESOURCE_ID,
      anOrgId: NU_ORG_A,
      name: "T85 Crew",
      type: "CREW" as const,
      active: true,
    },
  ]).onConflictDoNothing();
});

afterAll(async () => {
  // Delete in FK-safe order
  await db.delete(resourceBookingsTable)
    .where(eq(resourceBookingsTable.nuOrgId, NU_ORG_A));
  await db.delete(nuLocalProjectsTable)
    .where(inArray(nuLocalProjectsTable.nuOrgId, [NU_ORG_A, NU_ORG_B]));
  await db.delete(resourcesTable)
    .where(eq(resourcesTable.id, RESOURCE_ID));
  await db.delete(usersTable)
    .where(eq(usersTable.id, USER_ID));
  await db.delete(organizationsTable)
    .where(inArray(organizationsTable.id, [GU_ORG, NU_ORG_A, NU_ORG_B]));
});

// ── NU-only guard tests ────────────────────────────────────────────────────────

describe("NU-only guard", () => {
  it("[1] AG token → GET /api/nu/local-projects → 403", async () => {
    const res = await request(app)
      .get("/api/nu/local-projects")
      .set("Authorization", `Bearer ${agToken}`);
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/NU access only/i);
  });

  it("[2] Hub-admin token → GET /api/nu/local-projects → 403", async () => {
    const res = await request(app)
      .get("/api/nu/local-projects")
      .set("Authorization", `Bearer ${hubToken}`);
    expect(res.status).toBe(403);
  });

  it("[3] AG token → GET /api/nu/resource-bookings → 403", async () => {
    const res = await request(app)
      .get("/api/nu/resource-bookings")
      .set("Authorization", `Bearer ${agToken}`);
    expect(res.status).toBe(403);
  });
});

// ── Local projects CRUD ────────────────────────────────────────────────────────

describe("Local projects CRUD", () => {
  it("[4] AN → POST /api/nu/local-projects → 201, fields correct", async () => {
    const res = await request(app)
      .post("/api/nu/local-projects")
      .set("Authorization", `Bearer ${nuAToken}`)
      .send({
        localProjectCode: "T85-LP-001",
        displayName: "Testprojekt Alpha",
        customerAlias: "Kunde X",
        startDate: "2026-01-01",
        endDate: "2026-12-31",
        status: "ACTIVE",
      });
    expect(res.status).toBe(201);
    expect(res.body.localProjectCode).toBe("T85-LP-001");
    expect(res.body.displayName).toBe("Testprojekt Alpha");
    expect(res.body.customerAlias).toBe("Kunde X");
    expect(res.body.nuOrgId).toBe(NU_ORG_A);
    expect(res.body.status).toBe("ACTIVE");
    createdProjectId = res.body.id;
    expect(createdProjectId).toBeTruthy();
  });

  it("[5] AN → GET /api/nu/local-projects → 200, includes new project", async () => {
    const res = await request(app)
      .get("/api/nu/local-projects")
      .set("Authorization", `Bearer ${nuAToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.items)).toBe(true);
    const found = res.body.items.find((p: any) => p.id === createdProjectId);
    expect(found).toBeTruthy();
    expect(found.customerAlias).toBe("Kunde X");
  });

  it("[6] AN → GET /api/nu/local-projects?status=ACTIVE → only ACTIVE items", async () => {
    const res = await request(app)
      .get("/api/nu/local-projects?status=ACTIVE")
      .set("Authorization", `Bearer ${nuAToken}`);
    expect(res.status).toBe(200);
    for (const item of res.body.items) {
      expect(item.status).toBe("ACTIVE");
    }
  });

  it("[7] AN → GET /api/nu/local-projects/:id → 200, correct data", async () => {
    const res = await request(app)
      .get(`/api/nu/local-projects/${createdProjectId}`)
      .set("Authorization", `Bearer ${nuAToken}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(createdProjectId);
    expect(res.body.localProjectCode).toBe("T85-LP-001");
  });

  it("[8] AN → PATCH /api/nu/local-projects/:id → 200, status updated to COMPLETED", async () => {
    const res = await request(app)
      .patch(`/api/nu/local-projects/${createdProjectId}`)
      .set("Authorization", `Bearer ${nuAToken}`)
      .send({ status: "COMPLETED", displayName: "Testprojekt Alpha (fertig)" });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("COMPLETED");
    expect(res.body.displayName).toBe("Testprojekt Alpha (fertig)");
  });

  it("[9] Duplicate localProjectCode → 409", async () => {
    const res = await request(app)
      .post("/api/nu/local-projects")
      .set("Authorization", `Bearer ${nuAToken}`)
      .send({
        localProjectCode: "T85-LP-001", // same code as before
        displayName: "Doppelt",
      });
    expect(res.status).toBe(409);
  });

  it("[10] AN-B cannot see AN-A's projects → empty list for B", async () => {
    const res = await request(app)
      .get("/api/nu/local-projects")
      .set("Authorization", `Bearer ${nuBToken}`);
    expect(res.status).toBe(200);
    // B's projects are empty; A's project must NOT appear
    const found = res.body.items.find((p: any) => p.nuOrgId === NU_ORG_A);
    expect(found).toBeUndefined();
  });
});

// ── Resource bookings ──────────────────────────────────────────────────────────

describe("Resource bookings", () => {
  it("[11] AN → POST /api/nu/resource-bookings → 201", async () => {
    const res = await request(app)
      .post("/api/nu/resource-bookings")
      .set("Authorization", `Bearer ${nuAToken}`)
      .send({
        resourceId: RESOURCE_ID,
        sourceType: "MANUAL_BLOCK",
        startAt: "2026-09-01T08:00:00Z",
        endAt:   "2026-09-05T17:00:00Z",
        utilizationPercent: 100,
        status: "TENTATIVE",
        note: "Planung Baustelle",
      });
    expect(res.status).toBe(201);
    expect(res.body.resourceId).toBe(RESOURCE_ID);
    expect(res.body.nuOrgId).toBe(NU_ORG_A);
    expect(res.body.status).toBe("TENTATIVE");
    expect(res.body.sourceType).toBe("MANUAL_BLOCK");
    createdBookingId = res.body.id;
    expect(createdBookingId).toBeTruthy();
  });

  it("[12] AN → GET /api/nu/resource-bookings → 200, includes booking", async () => {
    const res = await request(app)
      .get("/api/nu/resource-bookings")
      .set("Authorization", `Bearer ${nuAToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.items)).toBe(true);
    const found = res.body.items.find((b: any) => b.id === createdBookingId);
    expect(found).toBeTruthy();
    expect(found.note).toBe("Planung Baustelle");
  });

  it("[13] AN → GET /api/nu/resource-bookings?status=TENTATIVE → only TENTATIVE", async () => {
    const res = await request(app)
      .get("/api/nu/resource-bookings?status=TENTATIVE")
      .set("Authorization", `Bearer ${nuAToken}`);
    expect(res.status).toBe(200);
    for (const item of res.body.items) {
      expect(item.status).toBe("TENTATIVE");
    }
  });

  it("[14] AN → POST /api/nu/resource-bookings/:id/cancel → 200, CANCELLED", async () => {
    const res = await request(app)
      .post(`/api/nu/resource-bookings/${createdBookingId}/cancel`)
      .set("Authorization", `Bearer ${nuAToken}`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("CANCELLED");
  });

  it("[15] AN-B cannot see AN-A's bookings", async () => {
    const res = await request(app)
      .get("/api/nu/resource-bookings")
      .set("Authorization", `Bearer ${nuBToken}`);
    expect(res.status).toBe(200);
    const found = res.body.items.find((b: any) => b.nuOrgId === NU_ORG_A);
    expect(found).toBeUndefined();
  });
});

// ── Availability check access guard ──────────────────────────────────────────

describe("Availability check access", () => {
  it("[16] AG → removed legacy availability endpoint → 404", async () => {
    const res = await request(app)
      .post("/api/takt-requests/does-not-exist/availability-checks")
      .set("Authorization", `Bearer ${agToken}`);
    expect(res.status).toBe(404);
  });
});
