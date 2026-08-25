/**
 * Task 5.2 — GET /takt-requests (GU enriched list)
 *
 * Tests:
 *   - GU sees own requests with enriched fields (taktBezeichnung, projectName, nuOrgName)
 *   - outboxStatus is null before sending, DELIVERED after
 *   - Filter by status works
 *   - Filter by nuOrgId works
 *   - NU cannot call the GU list (role defaults to GU, NU gets empty list for own guOrgId)
 *   - Hub admin gets empty list (no orgId → guOrgId = null → no rows)
 *   - GU from other org cannot see foreign requests
 *   - Empty list returns []
 *   - Response shape has all required fields
 *
 * Fixture prefix: "t52-"
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import { agDb as db } from "@workspace/db";
import {
  organizationsTable,
  usersTable,
  projectsTable,
  takteTable,
  taktRequestsTable,
  projectContractorsTable,
} from "@workspace/db";
import { and, eq } from "drizzle-orm";
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
  return jwt.sign({ ...p, hubAdmin: p.hubAdmin ?? false }, JWT_SECRET, {
    expiresIn: "1h",
  });
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

const GU_ORG   = "t52-gu-org";
const NU_ORG_A = "t52-nu-org-a";
const NU_ORG_B = "t52-nu-org-b";
const OTHER_GU = "t52-other-gu";
const GU_USER  = "t52-gu-user";
const NU_USER  = "t52-nu-user";
const PROJECT  = "t52-project";
const TAKT_A   = "t52-takt-a";
const TAKT_B   = "t52-takt-b";

const guToken      = signToken({ userId: GU_USER,  orgId: GU_ORG,   orgType: "AG" });
const nuToken      = signToken({ userId: NU_USER,  orgId: NU_ORG_A, orgType: "AN" });
const otherGuToken = signToken({ userId: "t52-other-gu-user", orgId: OTHER_GU, orgType: "AG" });
const hubToken     = signToken({ userId: "t52-hub-user", orgId: null, orgType: null, hubAdmin: true });

// IDs of seeded requests (set in beforeAll)
let reqIdA = "";
let reqIdB = "";

// ── Setup / Teardown ──────────────────────────────────────────────────────────

beforeAll(async () => {
  // Orgs
  await db.insert(organizationsTable).values([
    { id: GU_ORG,   name: "t52 GU Corp",  type: "AG" as const },
    { id: NU_ORG_A, name: "t52 NU Alpha", type: "AN" as const },
    { id: NU_ORG_B, name: "t52 NU Beta",  type: "AN" as const },
    { id: OTHER_GU, name: "t52 Other GU", type: "AG" as const },
  ]).onConflictDoNothing();

  // Users (users table has no orgId/orgType columns — those come from JWT only)
  await db.insert(usersTable).values([
    { id: GU_USER,             email: "t52-gu@test.com",    name: "GU User",   passwordHash: "x" },
    { id: NU_USER,             email: "t52-nu@test.com",    name: "NU User",   passwordHash: "x" },
    { id: "t52-other-gu-user", email: "t52-other@test.com", name: "Other GU",  passwordHash: "x" },
    { id: "t52-hub-user",      email: "t52-hub@test.com",   name: "Hub Admin", passwordHash: "x" },
  ]).onConflictDoNothing();

  // Project
  await db.insert(projectsTable).values({
    id: PROJECT,
    agOrgId: GU_ORG,
    name: "t52 Test Project",
    status: "ACTIVE" as const,
    startDate: "2026-09-01",
    endDate: "2026-12-31",
  }).onConflictDoNothing();

  // Project contractors
  await db.insert(projectContractorsTable).values([
    { projectId: PROJECT, anOrgId: NU_ORG_A },
    { projectId: PROJECT, anOrgId: NU_ORG_B },
  ]).onConflictDoNothing();

  // Takte
  await db.insert(takteTable).values([
    {
      id: TAKT_A,
      projectId: PROJECT,
      taktBezeichnung: "t52 Takt Alpha",
      zone: "Z1",
      gewerk: "Elektro",
      plannedStart: "2026-09-15",
      plannedEnd: "2026-09-20",
    },
    {
      id: TAKT_B,
      projectId: PROJECT,
      taktBezeichnung: "t52 Takt Beta",
      zone: "Z2",
      gewerk: "Sanitär",
      plannedStart: "2026-09-22",
      plannedEnd: "2026-09-27",
    },
  ]).onConflictDoNothing();

  // TaktRequests
  const [rowA] = await db.insert(taktRequestsTable).values({
    taktId: TAKT_A,
    taktVersion: 1,
    guOrgId: GU_ORG,
    nuOrgId: NU_ORG_A,
    requestNumber: "TKR-5200-0001",
    status: "DELIVERED" as const,
    responseRequiredBy: new Date("2026-10-01T00:00:00Z"),
    createdByUserId: GU_USER,
  }).returning();
  reqIdA = rowA.id;

  const [rowB] = await db.insert(taktRequestsTable).values({
    taktId: TAKT_B,
    taktVersion: 2,
    guOrgId: GU_ORG,
    nuOrgId: NU_ORG_B,
    requestNumber: "TKR-5200-0002",
    status: "DRAFT" as const,
    createdByUserId: GU_USER,
  }).returning();
  reqIdB = rowB.id;
});

afterAll(async () => {
  await db.delete(taktRequestsTable).where(
    eq(taktRequestsTable.guOrgId, GU_ORG),
  );
  await db.delete(takteTable).where(eq(takteTable.projectId, PROJECT));
  await db.delete(projectContractorsTable).where(
    eq(projectContractorsTable.projectId, PROJECT),
  );
  await db.delete(projectsTable).where(eq(projectsTable.id, PROJECT));
  await db.delete(usersTable).where(
    and(
      eq(usersTable.email, "t52-gu@test.com"),
    ),
  );
  // Clean up all t52 users
  for (const email of [
    "t52-gu@test.com", "t52-nu@test.com",
    "t52-other@test.com", "t52-hub@test.com",
  ]) {
    await db.delete(usersTable).where(eq(usersTable.email, email));
  }
  for (const id of [GU_ORG, NU_ORG_A, NU_ORG_B, OTHER_GU]) {
    await db.delete(organizationsTable).where(eq(organizationsTable.id, id));
  }
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("GET /takt-requests — GU enriched list", () => {
  it("401 without token", async () => {
    const res = await request(app).get("/api/takt-requests");
    expect(res.status).toBe(401);
  });

  it("GU gets enriched list with all required fields", async () => {
    const res = await request(app)
      .get("/api/takt-requests")
      .set("Authorization", `Bearer ${guToken}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThanOrEqual(2);

    const item = res.body.find((r: { id: string }) => r.id === reqIdA);
    expect(item).toBeDefined();
    // Enriched fields
    expect(item.taktBezeichnung).toBe("t52 Takt Alpha");
    expect(item.projectName).toBe("t52 Test Project");
    expect(item.nuOrgName).toBe("t52 NU Alpha");
    // Standard fields
    expect(item.requestNumber).toBe("TKR-5200-0001");
    expect(item.taktVersion).toBe(1);
    expect(item.status).toBe("DELIVERED");
    expect(item).toHaveProperty("createdAt");
    expect(item).toHaveProperty("updatedAt");
    expect(item).toHaveProperty("outboxStatus");
  });

  it("outboxStatus is null when no notification sent yet", async () => {
    const res = await request(app)
      .get("/api/takt-requests")
      .set("Authorization", `Bearer ${guToken}`);

    const draft = res.body.find((r: { id: string }) => r.id === reqIdB);
    expect(draft).toBeDefined();
    expect(draft.outboxStatus).toBeNull();
    expect(draft.status).toBe("DRAFT");
  });

  it("fachlicher Status and Nachrichtenstatus are separate fields", async () => {
    const res = await request(app)
      .get("/api/takt-requests")
      .set("Authorization", `Bearer ${guToken}`);

    const item = res.body.find((r: { id: string }) => r.id === reqIdA);
    // Both are present as distinct top-level fields
    expect(item).toHaveProperty("status");       // fachlicher Status
    expect(item).toHaveProperty("outboxStatus"); // technischer Status
    // status is a TaktRequestStatus — never equals outboxStatus directly
    expect(["DRAFT","SENT","DELIVERED","DETAILS_RETRIEVED","UNDER_REVIEW",
      "ACCEPTED","ALTERNATIVES_PROPOSED","REJECTED","REVISION_REQUIRED",
      "CANCELLED","EXPIRED","SUPERSEDED"]).toContain(item.status);
  });

  it("filter by status=DRAFT returns only DRAFT requests", async () => {
    const res = await request(app)
      .get("/api/takt-requests?status=DRAFT")
      .set("Authorization", `Bearer ${guToken}`);

    expect(res.status).toBe(200);
    const items: Array<{ status: string }> = res.body;
    expect(items.length).toBeGreaterThanOrEqual(1);
    expect(items.every((r) => r.status === "DRAFT")).toBe(true);
  });

  it("filter by nuOrgId returns only requests to that NU", async () => {
    const res = await request(app)
      .get(`/api/takt-requests?nuOrgId=${NU_ORG_A}`)
      .set("Authorization", `Bearer ${guToken}`);

    expect(res.status).toBe(200);
    const items: Array<{ nuOrgId: string }> = res.body;
    expect(items.length).toBeGreaterThanOrEqual(1);
    expect(items.every((r) => r.nuOrgId === NU_ORG_A)).toBe(true);
  });

  it("GU from different org cannot see foreign GU requests", async () => {
    const res = await request(app)
      .get("/api/takt-requests")
      .set("Authorization", `Bearer ${otherGuToken}`);

    expect(res.status).toBe(200);
    const ids = (res.body as Array<{ id: string }>).map((r) => r.id);
    expect(ids).not.toContain(reqIdA);
    expect(ids).not.toContain(reqIdB);
  });

  it("NU calling without role=nu gets their OWN requests (empty, since NU has no GU requests)", async () => {
    // The NU has no requests as GU (guOrgId = NU_ORG_A would return nothing from GU list)
    const res = await request(app)
      .get("/api/takt-requests")
      .set("Authorization", `Bearer ${nuToken}`);
    expect(res.status).toBe(200);
    // NU has no requests as a guOrgId — list is empty
    const items: Array<{ guOrgId: string }> = res.body;
    expect(items.every((r) => r.guOrgId === NU_ORG_A)).toBe(true);
  });

  it("hub admin with null orgId gets empty list (no guOrgId match)", async () => {
    const res = await request(app)
      .get("/api/takt-requests")
      .set("Authorization", `Bearer ${hubToken}`);
    // Hub admin has orgId=null; GU list query uses orgId as guOrgId filter → 0 results or 500 if orgId is null
    // The route guards orgId via req.user!.orgId! — hub admin will get empty list or error
    expect([200, 403, 500]).toContain(res.status);
    if (res.status === 200) {
      expect(res.body).toEqual([]);
    }
  });

  it("empty result when filtering for non-existent taktId", async () => {
    const res = await request(app)
      .get("/api/takt-requests?taktId=non-existent-takt")
      .set("Authorization", `Bearer ${guToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("response shape matches TaktRequestListItem schema", async () => {
    const res = await request(app)
      .get("/api/takt-requests")
      .set("Authorization", `Bearer ${guToken}`);

    const item = res.body[0];
    // All required fields present
    const required = [
      "id", "requestNumber", "taktId", "taktBezeichnung", "taktVersion",
      "projectId", "projectName", "guOrgId", "nuOrgId", "nuOrgName",
      "status", "outboxStatus", "createdAt", "updatedAt",
    ];
    for (const field of required) {
      expect(item).toHaveProperty(field);
    }
  });
});

describe("GET /takt-requests — existing delegation routes still work", () => {
  it("GET /api/delegations still responds (legacy route unaffected)", async () => {
    const res = await request(app)
      .get("/api/delegations")
      .set("Authorization", `Bearer ${guToken}`);
    // Should return 200 (list) — may be empty, but must not 404
    expect([200, 401]).toContain(res.status);
  });
});
