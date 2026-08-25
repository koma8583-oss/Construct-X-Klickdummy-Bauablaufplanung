/**
 * Task 104 — Security hardening: resource isolation, role fail-closed,
 *            transactional registration, reminder transport status.
 *
 * Tests:
 *   Resource org isolation:
 *   [1]  AN-A reads own resources → 200
 *   [2]  AN-A cannot PATCH AN-B's resource → 404
 *   [3]  AN-A cannot DELETE (soft-deactivate) AN-B's resource → 404
 *   [4]  AN-A resource list only contains own-org resources
 *   [5]  DELETE resource is soft-delete: resource still exists in DB with active=false
 *   [5b] Soft-deleted resource does NOT appear in GET /resources
 *   [5c] POST /resource-assignments with a soft-deleted resource → 422
 *   [6]  GET /resource-assignments scoped to own org (active only)
 *   [6b] Soft-deleted assignment does NOT appear in GET /resource-assignments
 *   [7]  POST /resource-assignments with foreign resource → 403
 *   [8]  POST /resource-assignments with delegation addressed to foreign org → 403
 *
 *   Role fail-closed:
 *   [9]  User with no roles → POST /api/takt-requests → 403
 *   [10] User with no roles → GET /api/hub/admin/users → 403
 *
 *   Transactional registration:
 *   [11] Successful registration → user has AG_ADMIN role in JWT
 *   [12] Successful AN registration → user has AN_ADMIN role in JWT
 *   [13] Duplicate e-mail → 409, no partial data
 *
 *   Reminder transport status:
 *   [14] Successful transport (real) → reminder status is SENT or DELIVERED, reminderCount incremented
 *   [15] transport.send() returns { status: "FAILED" } (no throw) → reminder FAILED, reminderCount unchanged
 *   [16] transport.send() throws → reminder FAILED, reminderCount unchanged
 *
 * Fixture prefix: "t104-"
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import { agDb as db } from "@workspace/db";
import {
  organizationsTable,
  usersTable,
  resourcesTable,
  resourceAssignmentsTable,
  delegationsTable,
  projectsTable,
  takteTable,
  taktRequestsTable,
  taktRequestRemindersTable,
  messageOutboxTable,
} from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";
import app from "../app";

const JWT_SECRET = process.env.JWT_SECRET ?? "taktkoord-jwt-dev-secret-change-in-prod";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const GU_ORG    = "t104-org-gu";
const NU_ORG_A  = "t104-org-nu-a";
const NU_ORG_B  = "t104-org-nu-b";
const USER_ID   = "t104-user";
const RES_A     = "t104-res-a";
const RES_B     = "t104-res-b";
const PROJ_ID   = "t104-proj";
const TAKT_ID   = "t104-takt";
const DELEG_ID  = "t104-deleg";

function makeToken(orgId: string | null, orgType: "AG" | "AN" | null, roles: string[] = [], hubAdmin = false): string {
  return jwt.sign({ userId: USER_ID, orgId, orgType, hubAdmin, roles }, JWT_SECRET, { expiresIn: "1h" });
}

const nuAToken      = makeToken(NU_ORG_A, "AN", ["AN_ADMIN"]);
const nuBToken      = makeToken(NU_ORG_B, "AN", ["AN_ADMIN"]);
const nuNoRoleToken = makeToken(NU_ORG_A, "AN", []);
const agNoRoleToken = makeToken(GU_ORG,   "AG", []);

// ── Setup / Teardown ──────────────────────────────────────────────────────────

beforeAll(async () => {
  await db.insert(organizationsTable).values([
    { id: GU_ORG,   name: "T104 GU",   type: "AG" as const },
    { id: NU_ORG_A, name: "T104 NU-A", type: "AN" as const },
    { id: NU_ORG_B, name: "T104 NU-B", type: "AN" as const },
  ]).onConflictDoNothing();

  await db.insert(usersTable).values([
    { id: USER_ID, name: "T104 User", email: "t104@test.local", passwordHash: "x" },
  ]).onConflictDoNothing();

  await db.insert(resourcesTable).values([
    { id: RES_A, anOrgId: NU_ORG_A, name: "T104 Resource A", type: "CREW" as const, active: true },
    { id: RES_B, anOrgId: NU_ORG_B, name: "T104 Resource B", type: "CREW" as const, active: true },
  ]).onConflictDoNothing();

  await db.insert(projectsTable).values({ id: PROJ_ID, name: "T104 Proj", agOrgId: GU_ORG }).onConflictDoNothing();
  await db.insert(takteTable).values({
    id: TAKT_ID, projectId: PROJ_ID,
    taktBezeichnung: "T104", zone: "Z1", gewerk: "Rohbau",
    plannedStart: "2026-09-01", plannedEnd: "2026-09-30",
  }).onConflictDoNothing();

  await db.insert(delegationsTable).values({
    id:             DELEG_ID,
    taktId:         TAKT_ID,
    projectId:      PROJ_ID,
    agOrgId:        GU_ORG,
    anOrgId:        NU_ORG_A,   // addressed to NU_ORG_A
    requestedStart: "2026-09-01",
    requestedEnd:   "2026-09-30",
    status:         "PENDING" as const,
  }).onConflictDoNothing();
});

afterAll(async () => {
  const { messageOutboxTable, messageInboxTable } = await import("@workspace/db");

  // Flush outbox/inbox rows referencing test orgs (created by transport during reminder tests)
  await db.delete(messageOutboxTable)
    .where(inArray(messageOutboxTable.senderOrgId, [GU_ORG, NU_ORG_A, NU_ORG_B]));
  await db.delete(messageOutboxTable)
    .where(inArray(messageOutboxTable.recipientOrgId, [GU_ORG, NU_ORG_A, NU_ORG_B]));
  await db.delete(messageInboxTable)
    .where(inArray(messageInboxTable.recipientOrgId, [GU_ORG, NU_ORG_A, NU_ORG_B]));

  await db.delete(taktRequestRemindersTable)
    .where(inArray(taktRequestRemindersTable.taktRequestId, ["t104-req-reminder"]));
  await db.delete(taktRequestsTable)
    .where(eq(taktRequestsTable.id, "t104-req-reminder"));
  await db.delete(resourceAssignmentsTable)
    .where(inArray(resourceAssignmentsTable.resourceId, [RES_A, RES_B]));
  await db.delete(delegationsTable).where(eq(delegationsTable.id, DELEG_ID));
  await db.delete(resourcesTable).where(inArray(resourcesTable.id, [RES_A, RES_B]));
  await db.delete(takteTable).where(eq(takteTable.id, TAKT_ID));
  await db.delete(projectsTable).where(eq(projectsTable.id, PROJ_ID));
  await db.delete(usersTable).where(eq(usersTable.id, USER_ID));
  await db.delete(organizationsTable)
    .where(inArray(organizationsTable.id, [GU_ORG, NU_ORG_A, NU_ORG_B]));
});

// ── Resource org isolation ────────────────────────────────────────────────────

describe("Resource org isolation", () => {
  it("[1] AN-A can PATCH own resource → 200", async () => {
    const res = await request(app)
      .patch(`/api/resources/${RES_A}`)
      .set("Authorization", `Bearer ${nuAToken}`)
      .send({ name: "T104 Resource A (updated)" });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe("T104 Resource A (updated)");
  });

  it("[2] AN-A cannot PATCH AN-B's resource → 404", async () => {
    const res = await request(app)
      .patch(`/api/resources/${RES_B}`)
      .set("Authorization", `Bearer ${nuAToken}`)
      .send({ name: "Hijacked" });
    expect(res.status).toBe(404);
  });

  it("[3] AN-A cannot DELETE (deactivate) AN-B's resource → 404", async () => {
    const res = await request(app)
      .delete(`/api/resources/${RES_B}`)
      .set("Authorization", `Bearer ${nuAToken}`);
    expect(res.status).toBe(404);
    // Confirm resource B is still active
    const [b] = await db.select().from(resourcesTable).where(eq(resourcesTable.id, RES_B));
    expect(b?.active).toBe(true);
  });

  it("[4] GET /resources only returns own-org resources", async () => {
    const res = await request(app)
      .get("/api/resources")
      .set("Authorization", `Bearer ${nuAToken}`);
    expect(res.status).toBe(200);
    const ids = (res.body as any[]).map((r: any) => r.id);
    expect(ids).toContain(RES_A);
    expect(ids).not.toContain(RES_B);
  });

  it("[5] DELETE is soft-delete: resource remains in DB with active=false", async () => {
    // Create a throwaway resource to soft-delete
    const createRes = await request(app)
      .post("/api/resources")
      .set("Authorization", `Bearer ${nuAToken}`)
      .send({ type: "OTHER", name: "T104 To Delete" });
    expect(createRes.status).toBe(201);
    const newId = createRes.body.id;

    const delRes = await request(app)
      .delete(`/api/resources/${newId}`)
      .set("Authorization", `Bearer ${nuAToken}`);
    expect(delRes.status).toBe(204);

    // Row still exists, but active = false
    const [row] = await db.select().from(resourcesTable).where(eq(resourcesTable.id, newId));
    expect(row).toBeDefined();
    expect(row?.active).toBe(false);

    // Cleanup
    await db.delete(resourcesTable).where(eq(resourcesTable.id, newId));
  });

  it("[6] GET /resource-assignments only returns own-org assignments", async () => {
    // Create an assignment for NU_ORG_A
    const [asgn] = await db.insert(resourceAssignmentsTable).values({
      resourceId:   RES_A,
      delegationId: DELEG_ID,
      fromDate:     "2026-09-01",
      toDate:       "2026-09-10",
    }).returning();

    const resA = await request(app)
      .get("/api/resource-assignments")
      .set("Authorization", `Bearer ${nuAToken}`);
    expect(resA.status).toBe(200);
    const idsA = (resA.body as any[]).map((r: any) => r.id);
    expect(idsA).toContain(asgn.id);

    // NU_ORG_B should not see it
    const resB = await request(app)
      .get("/api/resource-assignments")
      .set("Authorization", `Bearer ${nuBToken}`);
    expect(resB.status).toBe(200);
    const idsB = (resB.body as any[]).map((r: any) => r.id);
    expect(idsB).not.toContain(asgn.id);

    await db.delete(resourceAssignmentsTable).where(eq(resourceAssignmentsTable.id, asgn.id));
  });

  it("[5b] Soft-deleted resource does NOT appear in GET /resources", async () => {
    // Create, then soft-delete a resource
    const createRes = await request(app)
      .post("/api/resources")
      .set("Authorization", `Bearer ${nuAToken}`)
      .send({ type: "OTHER", name: "T104 SoftDel Visibility" });
    expect(createRes.status).toBe(201);
    const newId = createRes.body.id;

    await request(app)
      .delete(`/api/resources/${newId}`)
      .set("Authorization", `Bearer ${nuAToken}`);

    // Must not appear in the list anymore
    const list = await request(app)
      .get("/api/resources")
      .set("Authorization", `Bearer ${nuAToken}`);
    expect(list.status).toBe(200);
    const ids = (list.body as any[]).map((r: any) => r.id);
    expect(ids).not.toContain(newId);

    // Cleanup
    await db.delete(resourcesTable).where(eq(resourcesTable.id, newId));
  });

  it("[5c] POST /resource-assignments with a soft-deleted resource → 422", async () => {
    // Create then deactivate a resource directly in DB
    const [sdRes] = await db.insert(resourcesTable).values({
      id: "t104-res-softdel", anOrgId: NU_ORG_A, name: "T104 SD Resource",
      type: "OTHER" as const, active: false,
    }).returning();

    const res = await request(app)
      .post("/api/resource-assignments")
      .set("Authorization", `Bearer ${nuAToken}`)
      .send({ resourceId: sdRes.id, delegationId: DELEG_ID, fromDate: "2026-09-01", toDate: "2026-09-05" });
    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/deactivated/i);

    await db.delete(resourcesTable).where(eq(resourcesTable.id, "t104-res-softdel"));
  });

  it("[6b] Soft-deleted assignment does NOT appear in GET /resource-assignments", async () => {
    // Insert then soft-delete an assignment
    const [asgn] = await db.insert(resourceAssignmentsTable).values({
      resourceId:   RES_A,
      delegationId: DELEG_ID,
      fromDate:     "2026-09-01",
      toDate:       "2026-09-10",
      active:       false,     // already deactivated
    }).returning();

    const res = await request(app)
      .get("/api/resource-assignments")
      .set("Authorization", `Bearer ${nuAToken}`);
    expect(res.status).toBe(200);
    const ids = (res.body as any[]).map((r: any) => r.id);
    expect(ids).not.toContain(asgn.id);

    await db.delete(resourceAssignmentsTable).where(eq(resourceAssignmentsTable.id, asgn.id));
  });

  it("[7] POST /resource-assignments with foreign resource → 403", async () => {
    // NU_ORG_A tries to assign NU_ORG_B's resource
    const res = await request(app)
      .post("/api/resource-assignments")
      .set("Authorization", `Bearer ${nuAToken}`)
      .send({ resourceId: RES_B, delegationId: DELEG_ID, fromDate: "2026-09-01", toDate: "2026-09-05" });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/organisation/i);
  });

  it("[8] POST /resource-assignments with delegation not addressed to caller → 403", async () => {
    // Create a delegation addressed to NU_ORG_B
    const [otherDeleg] = await db.insert(delegationsTable).values({
      id: "t104-deleg-b", taktId: TAKT_ID, projectId: PROJ_ID,
      agOrgId: GU_ORG, anOrgId: NU_ORG_B,
      requestedStart: "2026-09-01", requestedEnd: "2026-09-30",
      status: "PENDING" as const,
    }).returning();

    // NU_ORG_A (with its own resource) tries to use NU_ORG_B's delegation
    const res = await request(app)
      .post("/api/resource-assignments")
      .set("Authorization", `Bearer ${nuAToken}`)
      .send({ resourceId: RES_A, delegationId: otherDeleg.id, fromDate: "2026-09-01", toDate: "2026-09-05" });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/organisation/i);

    await db.delete(delegationsTable).where(eq(delegationsTable.id, "t104-deleg-b"));
  });
});

// ── Role fail-closed ──────────────────────────────────────────────────────────

describe("Role fail-closed", () => {
  it("[9] AG user with no roles → POST /api/takt-requests → 403", async () => {
    const res = await request(app)
      .post("/api/takt-requests")
      .set("Authorization", `Bearer ${agNoRoleToken}`)
      .send({ taktId: TAKT_ID, nuOrgId: NU_ORG_A });
    expect(res.status).toBe(403);
    expect(res.body.yourRoles).toEqual([]);
  });

  it("[10] Hub request with no roles → GET /api/hub/admin/users → 403", async () => {
    const noRoleHubToken = makeToken(null, null, [], false);
    const res = await request(app)
      .get("/api/hub/admin/users")
      .set("Authorization", `Bearer ${noRoleHubToken}`);
    expect(res.status).toBe(403);
  });
});

// ── Transactional registration ────────────────────────────────────────────────

describe("Transactional registration", () => {
  const emailAG = "t104-reg-ag@test.local";
  const emailAN = "t104-reg-an@test.local";

  afterAll(async () => {
    // Clean up registered test users by email
    const users = await db.select({ id: usersTable.id })
      .from(usersTable)
      .where(inArray(usersTable.email, [emailAG, emailAN]));
    const ids = users.map(u => u.id);
    if (ids.length > 0) {
      const { userOrganizationsTable, organizationsTable: orgs } = await import("@workspace/db");
      const memberships = await db.select({ orgId: userOrganizationsTable.orgId })
        .from(userOrganizationsTable)
        .where(inArray(userOrganizationsTable.userId, ids));
      const orgIds = memberships.map(m => m.orgId);
      await db.delete(userOrganizationsTable).where(inArray(userOrganizationsTable.userId, ids));
      if (orgIds.length > 0) {
        await db.delete(orgs).where(inArray(orgs.id, orgIds));
      }
      await db.delete(usersTable).where(inArray(usersTable.id, ids));
    }
  });

  it("[11] AG registration → access token includes AG_ADMIN role", async () => {
    const res = await request(app)
      .post("/auth-service/register")
      .send({ name: "T104 AG", email: emailAG, password: "test1234", orgType: "AG", companyName: "T104 Corp" });
    expect(res.status).toBe(201);

    const payload = jwt.decode(res.body.accessToken) as any;
    expect(payload.roles).toContain("AG_ADMIN");
    expect(res.body.user.roles).toContain("AG_ADMIN");
  });

  it("[12] AN registration → access token includes AN_ADMIN role", async () => {
    const res = await request(app)
      .post("/auth-service/register")
      .send({ name: "T104 AN", email: emailAN, password: "test1234", orgType: "AN", companyName: "T104 Bau GmbH" });
    expect(res.status).toBe(201);

    const payload = jwt.decode(res.body.accessToken) as any;
    expect(payload.roles).toContain("AN_ADMIN");
    expect(res.body.user.roles).toContain("AN_ADMIN");
  });

  it("[13] Duplicate e-mail → 409, no partial state", async () => {
    const res = await request(app)
      .post("/auth-service/register")
      .send({ name: "T104 Dup", email: emailAG, password: "test1234", orgType: "AG", companyName: "T104 Dup Co" });
    expect(res.status).toBe(409);

    // Confirm only one user with this email exists (no partial duplicate)
    const rows = await db.select().from(usersTable).where(eq(usersTable.email, emailAG));
    expect(rows.length).toBe(1);
  });
});

// ── Reminder transport status ─────────────────────────────────────────────────

describe("Reminder transport status (via evaluateTaktRequestDeadlines)", () => {
  const REQ_ID = "t104-req-reminder";

  beforeAll(async () => {
    // Seed a takt request that will trigger the overdue-reminder path
    const pastDue = new Date(Date.now() - 60 * 60 * 1000); // 1 hour in the past
    await db.insert(taktRequestsTable).values({
      id:                 REQ_ID,
      taktId:             TAKT_ID,
      guOrgId:            GU_ORG,
      nuOrgId:            NU_ORG_A,
      requestNumber:      "TKR-104-REM",
      status:             "SENT" as const,
      createdByUserId:    USER_ID,
      taktVersion:        1,
      responseRequiredBy: pastDue,
      expiresAt:          new Date(Date.now() + 24 * 60 * 60 * 1000),
    }).onConflictDoNothing();
  });

  afterEach(async () => {
    // Remove reminders between tests so each test starts clean
    await db.delete(taktRequestRemindersTable)
      .where(eq(taktRequestRemindersTable.taktRequestId, REQ_ID));
    await db.delete(messageOutboxTable)
      .where(eq(messageOutboxTable.correlationId, REQ_ID));
    // Reset reminderCount
    await db.update(taktRequestsTable)
      .set({ reminderCount: 0, lastReminderAt: null })
      .where(eq(taktRequestsTable.id, REQ_ID));
  });

  it("[14] Successful transport → reminder status SENT or DELIVERED, reminderCount incremented", async () => {
    const { evaluateTaktRequestDeadlines } = await import("../services/deadline-evaluation-service");
    const { defaultDeadlineConfig }        = await import("../services/deadline-config");

    // Trigger the overdue-reminder path (now = 2 h after due, threshold = 0)
    const now = new Date(Date.now() + 2 * 60 * 60 * 1000);
    await evaluateTaktRequestDeadlines(now, { ...defaultDeadlineConfig, overdueReminderHoursAfterDue: 0 });

    const reminders = await db.select().from(taktRequestRemindersTable)
      .where(eq(taktRequestRemindersTable.taktRequestId, REQ_ID));

    expect(reminders.length).toBeGreaterThan(0);
    for (const r of reminders) {
      expect(["SENT", "DELIVERED"]).toContain(r.status); // never PENDING or FAILED
    }

    const [req] = await db.select({ rc: taktRequestsTable.reminderCount })
      .from(taktRequestsTable).where(eq(taktRequestsTable.id, REQ_ID));
    expect(req.rc).toBeGreaterThan(0); // count was incremented
  });

  it("[15] transport.send() returns { status: 'FAILED' } (no throw) → reminder FAILED, reminderCount stays 0", async () => {
    const { LocalHubTransport }            = await import("../lib/transport/local-hub-transport");
    const { evaluateTaktRequestDeadlines } = await import("../services/deadline-evaluation-service");
    const { defaultDeadlineConfig }        = await import("../services/deadline-config");

    // Mock transport.send() to return FAILED without throwing
    const spy = vi.spyOn(LocalHubTransport.prototype, "send").mockResolvedValueOnce({
      messageId: "mock-msg-id",
      status:    "FAILED" as const,
      sentAt:    null,
      error:     { code: "DELIVERY_FAILED", message: "Simulated soft failure" },
    } as any);

    try {
      const now = new Date(Date.now() + 2 * 60 * 60 * 1000);
      await evaluateTaktRequestDeadlines(now, { ...defaultDeadlineConfig, overdueReminderHoursAfterDue: 0 });
    } finally {
      spy.mockRestore();
    }

    // Reminder must be FAILED
    const reminders = await db.select().from(taktRequestRemindersTable)
      .where(eq(taktRequestRemindersTable.taktRequestId, REQ_ID));
    expect(reminders.length).toBeGreaterThan(0);
    for (const r of reminders) {
      expect(r.status).toBe("FAILED");
    }

    // reminderCount must NOT have been incremented
    const [req] = await db.select({ rc: taktRequestsTable.reminderCount })
      .from(taktRequestsTable).where(eq(taktRequestsTable.id, REQ_ID));
    expect(req.rc).toBe(0);
  });

  it("[16] transport.send() throws → reminder FAILED, reminderCount stays 0", async () => {
    const { LocalHubTransport }            = await import("../lib/transport/local-hub-transport");
    const { evaluateTaktRequestDeadlines } = await import("../services/deadline-evaluation-service");
    const { defaultDeadlineConfig }        = await import("../services/deadline-config");

    // Mock transport.send() to throw (network/hard error)
    const spy = vi.spyOn(LocalHubTransport.prototype, "send")
      .mockRejectedValueOnce(new Error("Simulated hard transport error"));

    try {
      const now = new Date(Date.now() + 2 * 60 * 60 * 1000);
      await evaluateTaktRequestDeadlines(now, { ...defaultDeadlineConfig, overdueReminderHoursAfterDue: 0 });
    } finally {
      spy.mockRestore();
    }

    const reminders = await db.select().from(taktRequestRemindersTable)
      .where(eq(taktRequestRemindersTable.taktRequestId, REQ_ID));
    expect(reminders.length).toBeGreaterThan(0);
    for (const r of reminders) {
      expect(r.status).toBe("FAILED");
    }

    const [req] = await db.select({ rc: taktRequestsTable.reminderCount })
      .from(taktRequestsTable).where(eq(taktRequestsTable.id, REQ_ID));
    expect(req.rc).toBe(0);
  });
});
