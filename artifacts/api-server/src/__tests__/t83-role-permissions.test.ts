/**
 * Task 83 — Role / permission model (AG_ADMIN, GENERAL_PLANNER, AN_ADMIN, AN_DISPATCHER, HUB_ADMIN)
 *
 * Tests:
 *   AG routes — TaktRequest creation + send (AG_ADMIN / GENERAL_PLANNER):
 *   [1]  AG_ADMIN    → POST /projects/:id/takt-requests  → 201
 *   [2]  GENERAL_PLANNER → POST /takt-requests           → 201
 *   [3]  AN_ADMIN    → POST /takt-requests               → 403 (wrong role)
 *   [4]  Empty roles → POST /takt-requests               → not 403 (soft enforcement)
 *   [5]  AG_ADMIN    → POST /takt-requests/:id/send      → 200 (or 4xx from business logic, not 403)
 *   [6]  GENERAL_PLANNER → POST /takt-requests/:id/send → 200 (or 4xx from business logic, not 403)
 *   [7]  AN_DISPATCHER  → POST /takt-requests/:id/send  → 403
 *
 *   AG routes — Contractor management (AG_ADMIN only):
 *   [8]  AG_ADMIN    → POST /projects/:id/contractors    → not 403
 *   [9]  GENERAL_PLANNER → POST /projects/:id/contractors → 403
 *   [10] AG_ADMIN    → DELETE /projects/:id/contractors/:anOrgId → not 403
 *   [11] GENERAL_PLANNER → DELETE /projects/:id/contractors/:anOrgId → 403
 *
 *   AN routes — Response + availability check (AN_ADMIN / AN_DISPATCHER):
 *   [12] AN_ADMIN    → POST /takt-requests/:id/responses → not 403
 *   [13] AN_DISPATCHER → POST /takt-requests/:id/responses → not 403
 *   [14] AG_ADMIN    → POST /takt-requests/:id/responses → 403 (wrong org type, not just role)
 *   [15] AN_ADMIN    → POST /takt-requests/:id/availability-checks → not 403
 *   [16] AN_DISPATCHER → POST /takt-requests/:id/availability-checks → not 403
 *   [17] AG_ADMIN (with AN role)→ POST /takt-requests/:id/availability-checks → 403 (orgType guard)
 *
 *   Hub admin routes (HUB_ADMIN):
 *   [18] HUB_ADMIN role + hubAdmin flag → GET /hub/admin/users → 200
 *   [19] AG_ADMIN role (no hubAdmin)    → GET /hub/admin/users → 403
 *
 * Fixture prefix: "t83-"
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import { agDb as db, pool } from "@workspace/db";
import {
  organizationsTable,
  usersTable,
  projectsTable,
  takteTable,
  taktRequestsTable,
  projectContractorsTable,
  projectMembershipsTable,
  taktRequestSnapshotsTable,
  coordinationPoliciesTable,
} from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";
import app from "../app";

const JWT_SECRET = process.env.JWT_SECRET ?? "taktkoord-jwt-dev-secret-change-in-prod";

// ── Fixture IDs ────────────────────────────────────────────────────────────────

const GU_ORG      = "t83-org-gu";
const NU_ORG      = "t83-org-nu";
const HUB_USER_ID = "t83-hub-user";
// All JWT tokens use this userId — it must exist in the users table for FK checks.
const GENERIC_USER_ID = "t83-user-generic";
const PROJ_ID = "t83-proj";
const TAKT_ID = "t83-takt";

function reqId(tag: string) { return `t83-req-${tag}`; }
function reqNum(tag: string) { return `TKR-83-${tag}`; }

// ── Token factory ──────────────────────────────────────────────────────────────

function makeToken(params: {
  orgId: string | null;
  orgType: "AG" | "AN" | null;
  hubAdmin?: boolean;
  roles?: string[];
}): string {
  return jwt.sign(
    {
      userId: "t83-user-generic",
      orgId: params.orgId,
      orgType: params.orgType,
      hubAdmin: params.hubAdmin ?? false,
      roles: params.roles ?? [],
    },
    JWT_SECRET,
    { expiresIn: "1h" },
  );
}

const agAdminToken         = makeToken({ orgId: GU_ORG, orgType: "AG", roles: ["AG_ADMIN"] });
const generalPlannerToken  = makeToken({ orgId: GU_ORG, orgType: "AG", roles: ["GENERAL_PLANNER"] });
const agNoRoleToken        = makeToken({ orgId: GU_ORG, orgType: "AG", roles: [] });
const anAdminToken         = makeToken({ orgId: NU_ORG, orgType: "AN", roles: ["AN_ADMIN"] });
const anDispatcherToken    = makeToken({ orgId: NU_ORG, orgType: "AN", roles: ["AN_DISPATCHER"] });
const anNoRoleToken        = makeToken({ orgId: NU_ORG, orgType: "AN", roles: [] });
const hubAdminToken        = makeToken({ orgId: null, orgType: null, hubAdmin: true, roles: ["HUB_ADMIN"] });
// Wrong-role tokens
const agAdminWrongOrgToken = makeToken({ orgId: GU_ORG, orgType: "AG", roles: ["AN_ADMIN"] }); // AG user with AN role
const anAdminOnAgEndpoint  = makeToken({ orgId: NU_ORG, orgType: "AN", roles: ["AN_ADMIN"] }); // AN user trying AG routes

// ── Setup / Teardown ──────────────────────────────────────────────────────────

beforeAll(async () => {
  await db.insert(organizationsTable).values([
    { id: GU_ORG, name: "T83 GU", type: "AG" as const },
    { id: NU_ORG, name: "T83 NU", type: "AN" as const },
  ]).onConflictDoNothing();

  await db.insert(usersTable).values([
    { id: HUB_USER_ID,    name: "T83 Hub",     email: "t83hub@test.com",     passwordHash: "x" },
    { id: GENERIC_USER_ID, name: "T83 Generic", email: "t83generic@test.com", passwordHash: "x" },
  ]).onConflictDoNothing();

  await db.insert(projectsTable).values({
    id: PROJ_ID, name: "T83 Project", agOrgId: GU_ORG,
  }).onConflictDoNothing();

  // Ensure contractor link is ACTIVE — delete any existing rows then re-insert.
  // (A previous run may have left them INACTIVE after test [10]'s DELETE call.)
  await db.delete(projectContractorsTable)
    .where(and(
      eq(projectContractorsTable.projectId, PROJ_ID),
      eq(projectContractorsTable.anOrgId, NU_ORG),
    ));
  await db.insert(projectContractorsTable).values({ projectId: PROJ_ID, anOrgId: NU_ORG });
  await db.insert(coordinationPoliciesTable).values({
    id: "t83-agreement", policyKey: "t83-agreement", version: 1, kind: "PROJECT_AGREEMENT",
    projectId: PROJ_ID, providerOrgId: GU_ORG, recipientOrgId: NU_ORG,
    lifecycleStatus: "ACCEPTED", policySnapshot: {}, effectivePolicy: {
      policyType: "PROJECT_AGREEMENT",
      recipientOrganizationId: NU_ORG,
      projectReference: PROJ_ID,
      validFrom: null,
      validUntil: null,
      childPolicyTypes: ["PERFORMANCE_REQUEST"],
      childPermissions: ["READ", "DOWNLOAD", "USE_FOR_PERFORMANCE_COORDINATION"],
    },
  }).onConflictDoNothing();
  await db.insert(projectMembershipsTable).values({
    id: "t83-membership",
    projectId: PROJ_ID,
    agOrgId: GU_ORG,
    anOrgId: NU_ORG,
    status: "ACTIVE",
    invitationId: "t83-invitation",
    correlationId: "t83-correlation",
    projectAgreementPolicyId: "t83-agreement",
  }).onConflictDoNothing();

  // Upsert with DO UPDATE so repeated runs reset lifecycleStatus back to PLANNED
  // (a previous run may have left it as IN_COORDINATION after /send was called).
  await db.insert(takteTable).values({
    id: TAKT_ID, projectId: PROJ_ID,
    taktBezeichnung: "T83 Takt", zone: "Z1", gewerk: "Rohbau",
    plannedStart: "2026-09-01", plannedEnd: "2026-09-30",
    lifecycleStatus: "PLANNED",
  }).onConflictDoUpdate({ target: takteTable.id, set: { lifecycleStatus: "PLANNED" } });
});

afterAll(async () => {
  const reqIds = ["send-ag-admin", "send-gp", "send-an", "create-gp", "avail-admin", "avail-dispatcher"];
  await db.delete(taktRequestSnapshotsTable)
    .where(inArray(taktRequestSnapshotsTable.taktRequestId, reqIds.map(t => reqId(t))));
  await db.delete(taktRequestsTable)
    .where(inArray(taktRequestsTable.id, reqIds.map(t => reqId(t))));

  // Also clean up any leftover takt_requests referencing TAKT_ID (created during test runs)
  await db.delete(taktRequestsTable).where(eq(taktRequestsTable.taktId, TAKT_ID));

  await db.delete(projectContractorsTable)
    .where(and(eq(projectContractorsTable.projectId, PROJ_ID),
               eq(projectContractorsTable.anOrgId, NU_ORG)));
  await db.delete(projectMembershipsTable)
    .where(eq(projectMembershipsTable.projectId, PROJ_ID));
  await db.delete(takteTable).where(eq(takteTable.id, TAKT_ID));
  await db.delete(coordinationPoliciesTable).where(eq(coordinationPoliciesTable.projectId, PROJ_ID));
  await db.delete(projectsTable).where(eq(projectsTable.id, PROJ_ID));
  await db.delete(usersTable)
    .where(inArray(usersTable.id, [HUB_USER_ID, GENERIC_USER_ID]));
  await db.delete(organizationsTable)
    .where(inArray(organizationsTable.id, [GU_ORG, NU_ORG]));
});

// ── Helper: seed a pre-built TaktRequest for send tests ──────────────────────

async function seedDraftRequest(tag: string, roleToken: string): Promise<string> {
  const id = reqId(tag);
  await db.insert(taktRequestsTable).values({
    id,
    taktId: TAKT_ID,
    guOrgId: GU_ORG, nuOrgId: NU_ORG,
    requestNumber: reqNum(tag),
    status: "DRAFT" as const,
    createdByUserId: HUB_USER_ID,
    taktVersion: 1,
  }).onConflictDoNothing();

  // Create snapshot via the canonical API (uses AG role)
  await request(app)
    .post(`/api/takt-requests`)
    .set("Authorization", `Bearer ${roleToken}`)
    .send({ taktId: TAKT_ID, nuOrgId: NU_ORG });

  return id;
}

// ── [1-4] POST /takt-requests — role check ────────────────────────────────────

describe("POST /takt-requests (AG_ADMIN / GENERAL_PLANNER)", () => {
  const body = { taktId: TAKT_ID, nuOrgId: NU_ORG };

  it("[1] AG_ADMIN → 201", async () => {
    const res = await request(app)
      .post("/api/takt-requests")
      .set("Authorization", `Bearer ${agAdminToken}`)
      .send(body);
    expect(res.status).toBe(201);
  });

  it("[2] GENERAL_PLANNER → 201", async () => {
    const res = await request(app)
      .post("/api/takt-requests")
      .set("Authorization", `Bearer ${generalPlannerToken}`)
      .send(body);
    expect(res.status).toBe(201);
  });

  it("[3] AN_ADMIN (wrong role) → 403", async () => {
    const res = await request(app)
      .post("/api/takt-requests")
      .set("Authorization", `Bearer ${agAdminWrongOrgToken}`)
      .send(body);
    expect(res.status).toBe(403);
  });

  it("[4] Empty roles → 403 (fail-closed: no roles means no access)", async () => {
    const res = await request(app)
      .post("/api/takt-requests")
      .set("Authorization", `Bearer ${agNoRoleToken}`)
      .send(body);
    expect(res.status).toBe(403);
  });
});

// ── [5-7] POST /takt-requests/:id/send — role check ──────────────────────────
//
// Strategy: use a non-existent request ID for permitted-role tests.
// A 404 ("not found") proves the request got past the role-check middleware
// and into business logic.  A 403 means the role check fired.

describe("POST /takt-requests/:id/send (AG_ADMIN / GENERAL_PLANNER)", () => {
  const BOGUS_ID = "t83-nonexistent-request-id";

  it("[5] AG_ADMIN → reaches business logic (not 403)", async () => {
    const res = await request(app)
      .post(`/api/takt-requests/${BOGUS_ID}/send`)
      .set("Authorization", `Bearer ${agAdminToken}`)
      .send({});
    // 404 = passed role check, reached business-logic; 403 = blocked by role
    expect(res.status).not.toBe(403);
    expect(res.status).toBe(404); // bogus ID → not found
  });

  it("[6] GENERAL_PLANNER → reaches business logic (not 403)", async () => {
    const res = await request(app)
      .post(`/api/takt-requests/${BOGUS_ID}/send`)
      .set("Authorization", `Bearer ${generalPlannerToken}`)
      .send({});
    expect(res.status).not.toBe(403);
    expect(res.status).toBe(404);
  });

  it("[7] AN_DISPATCHER (wrong role for AG endpoint) → 403", async () => {
    const res = await request(app)
      .post(`/api/takt-requests/${BOGUS_ID}/send`)
      .set("Authorization", `Bearer ${anDispatcherToken}`)
      .send({});
    // AN user: orgType guard fires (403) regardless of whether role check fires first
    expect(res.status).toBe(403);
  });
});

// ── [8-11] Contractor management (AG_ADMIN only) ─────────────────────────────

describe("Contractor management (AG_ADMIN only)", () => {
  it("[8] AG_ADMIN → POST /projects/:id/contractors → not 403", async () => {
    const res = await request(app)
      .post(`/api/projects/${PROJ_ID}/contractors`)
      .set("Authorization", `Bearer ${agAdminToken}`)
      .send({ anOrgId: NU_ORG });
    expect(res.status).not.toBe(403);
  });

  it("[9] GENERAL_PLANNER → POST /projects/:id/contractors → 403", async () => {
    const res = await request(app)
      .post(`/api/projects/${PROJ_ID}/contractors`)
      .set("Authorization", `Bearer ${generalPlannerToken}`)
      .send({ anOrgId: NU_ORG });
    expect(res.status).toBe(403);
  });

  it("[10] AG_ADMIN → DELETE /projects/:id/contractors/:anOrgId → not 403", async () => {
    const res = await request(app)
      .delete(`/api/projects/${PROJ_ID}/contractors/${NU_ORG}`)
      .set("Authorization", `Bearer ${agAdminToken}`);
    expect(res.status).not.toBe(403);
  });

  it("[11] GENERAL_PLANNER → DELETE /projects/:id/contractors/:anOrgId → 403", async () => {
    const res = await request(app)
      .delete(`/api/projects/${PROJ_ID}/contractors/${NU_ORG}`)
      .set("Authorization", `Bearer ${generalPlannerToken}`);
    expect(res.status).toBe(403);
  });
});

// ── [12-17] AN routes — response + availability check ────────────────────────
//
// Same "bogus ID → 404 proves role passed" pattern for permitted roles.
// Forbidden roles / wrong org type → 403.

describe("AN routes — response + availability check (AN_ADMIN / AN_DISPATCHER)", () => {
  const BOGUS_ID = "t83-nonexistent-request-id";

  it("[12] AN_ADMIN → legacy POST /responses is blocked", async () => {
    const res = await request(app)
      .post(`/api/takt-requests/${BOGUS_ID}/responses`)
      .set("Authorization", `Bearer ${anAdminToken}`)
      .send({ decision: "REJECTED", reasonCode: "NO_CAPACITY" });
    expect(res.status).toBe(403);
  });

  it("[13] AN_DISPATCHER → legacy POST /responses is blocked", async () => {
    const res = await request(app)
      .post(`/api/takt-requests/${BOGUS_ID}/responses`)
      .set("Authorization", `Bearer ${anDispatcherToken}`)
      .send({ decision: "REJECTED", reasonCode: "NO_CAPACITY" });
    expect(res.status).toBe(403);
  });

  it("[14] AG_ADMIN (wrong org type) → POST /responses → 403", async () => {
    const res = await request(app)
      .post(`/api/takt-requests/${BOGUS_ID}/responses`)
      .set("Authorization", `Bearer ${agAdminToken}`)
      .send({ decision: "REJECTED", reasonCode: "NO_CAPACITY" });
    // orgType guard fires before business logic
    expect(res.status).toBe(403);
  });

  it("[15] AN_ADMIN → removed legacy availability endpoint → 403", async () => {
    const res = await request(app)
      .post(`/api/takt-requests/${BOGUS_ID}/availability-checks`)
      .set("Authorization", `Bearer ${anAdminToken}`)
      .send({});
    expect(res.status).toBe(403);
  });

  it("[16] AN_DISPATCHER → removed legacy availability endpoint → 403", async () => {
    const res = await request(app)
      .post(`/api/takt-requests/${BOGUS_ID}/availability-checks`)
      .set("Authorization", `Bearer ${anDispatcherToken}`)
      .send({});
    expect(res.status).toBe(403);
  });

  it("[17] AG user (any role) → removed legacy availability endpoint → 404", async () => {
    const res = await request(app)
      .post(`/api/takt-requests/${BOGUS_ID}/availability-checks`)
      .set("Authorization", `Bearer ${agAdminToken}`)
      .send({});
    expect(res.status).toBe(404);
  });
});

// ── [18-19] Hub admin (HUB_ADMIN) ────────────────────────────────────────────

describe("Hub admin routes (HUB_ADMIN)", () => {
  it("[18] HUB_ADMIN role + hubAdmin flag → GET /hub/admin/users → 200", async () => {
    const res = await request(app)
      .get("/api/hub/admin/users")
      .set("Authorization", `Bearer ${hubAdminToken}`);
    expect(res.status).toBe(200);
  });

  it("[19] AG_ADMIN role (no hubAdmin flag) → GET /hub/admin/users → 403", async () => {
    const res = await request(app)
      .get("/api/hub/admin/users")
      .set("Authorization", `Bearer ${agAdminToken}`);
    expect(res.status).toBe(403);
  });
});
