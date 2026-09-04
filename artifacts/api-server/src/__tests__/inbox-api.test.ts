/**
 * Task 3.7 — API integration tests for NU inbox endpoints.
 *
 * Tests:
 *   GET  /messages/inbox
 *   GET  /messages/inbox/:messageId
 *   POST /messages/inbox/:messageId/read
 *
 * Fixture prefix: "t37-"
 * JWT signed with process.env.JWT_SECRET (falls back to dev constant).
 *
 * Setup: creates a GU + NU org, sends a TaktRequest via the Sprint 3 endpoint
 * so that a real inbox row exists, then exercises all inbox scenarios.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import { hubDb as db } from "@workspace/db";
import {
  organizationsTable,
  projectsTable,
  projectContractorsTable,
  projectMembershipsTable,
  coordinationPoliciesTable,
  takteTable,
  taktRequestsTable,
  taktRequestSnapshotsTable,
  usersTable,
} from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import app from "../app";

// ── JWT helper ────────────────────────────────────────────────────────────────

const JWT_SECRET =
  process.env.JWT_SECRET ?? "taktkoord-jwt-dev-secret-change-in-prod";

function signToken(payload: {
  userId: string;
  orgId: string | null;
  orgType: "AG" | "AN" | null;
  hubAdmin?: boolean;
  roles?: string[];
}): string {
  const roles = payload.roles ?? (payload.orgType === "AG" ? ["AG_ADMIN"] : payload.orgType === "AN" ? ["AN_ADMIN"] : []);
  return jwt.sign(
    { ...payload, hubAdmin: payload.hubAdmin ?? false, roles },
    JWT_SECRET,
    { expiresIn: "1h" },
  );
}

// ── Fixture IDs ───────────────────────────────────────────────────────────────

const GU_ORG     = "t37-org-gu";
const NU_ORG     = "t37-org-nu";
const NU_ORG_2   = "t37-org-nu2";   // second NU — must not see NU_ORG messages
const PROJECT_ID = "t37-project-001";
const TAKT_ID    = "t37-takt-001";
const GU_USER    = "t37-user-gu";
const NU_USER    = "t37-user-nu";
const NU_USER_2  = "t37-user-nu2";

let guToken:   string;
let nuToken:   string;
let nu2Token:  string;
let hubToken:  string;   // hub admin — no org
let messageId: string;   // message_outbox messageId after first send
let requestId: string;   // TaktRequest id

// ── Setup / teardown ──────────────────────────────────────────────────────────

async function cleanupFixtures() {
  const orgIds = [GU_ORG, NU_ORG, NU_ORG_2];
  const orgSql = orgIds.map(id => `'${id}'`).join(",");

  await db.execute(sql`DELETE FROM dataspace_exchanges
    WHERE sender_org_id = ANY(ARRAY[${sql.raw(orgSql)}])
       OR receiver_org_id = ANY(ARRAY[${sql.raw(orgSql)}])`);
  await db.execute(sql`DELETE FROM message_inbox WHERE recipient_org_id = ANY(ARRAY[${sql.raw(orgSql)}])`);
  await db.execute(sql`DELETE FROM message_outbox WHERE sender_org_id = ANY(ARRAY[${sql.raw(orgSql)}])`);
  await db.execute(sql`DELETE FROM leistungsanfrage_snapshots WHERE leistungsanfrage_id IN (
    SELECT id FROM leistungsanfragen WHERE gu_org_id = ANY(ARRAY[${sql.raw(orgSql)}])
  )`);
  await db.execute(sql`DELETE FROM leistungsanfragen WHERE gu_org_id = ANY(ARRAY[${sql.raw(orgSql)}])`);
  await db.execute(sql`DELETE FROM leistungen WHERE id = '${sql.raw(TAKT_ID)}'`);
  await db.execute(sql`DELETE FROM project_contractors WHERE project_id = '${sql.raw(PROJECT_ID)}'`);
  await db.execute(sql`DELETE FROM project_memberships WHERE project_id = '${sql.raw(PROJECT_ID)}'`);
  await db.delete(coordinationPoliciesTable).where(eq(coordinationPoliciesTable.projectId, PROJECT_ID));
  await db.execute(sql`DELETE FROM projects WHERE id = '${sql.raw(PROJECT_ID)}'`);
  await db.execute(sql`DELETE FROM users WHERE id = ANY(ARRAY['${sql.raw(GU_USER)}','${sql.raw(NU_USER)}','${sql.raw(NU_USER_2)}'])`);
  await db.execute(sql`DELETE FROM organizations WHERE id = ANY(ARRAY[${sql.raw(orgSql)}])`);
}

beforeAll(async () => {
  await cleanupFixtures();
  await db.insert(organizationsTable).values([
    { id: GU_ORG,   name: "T37 GU Org",  type: "AG" },
    { id: NU_ORG,   name: "T37 NU Org",  type: "AN" },
    { id: NU_ORG_2, name: "T37 NU Org2", type: "AN" },
  ]).onConflictDoNothing();

  await db.insert(usersTable).values([
    { id: GU_USER,   name: "GU",   email: "t37-gu@example.com",   passwordHash: "x" },
    { id: NU_USER,   name: "NU",   email: "t37-nu@example.com",   passwordHash: "x" },
    { id: NU_USER_2, name: "NU2",  email: "t37-nu2@example.com",  passwordHash: "x" },
  ]).onConflictDoNothing();

  await db.insert(projectsTable).values({
    id: PROJECT_ID, agOrgId: GU_ORG, name: "T37 Project",
  }).onConflictDoNothing();

  await db.insert(projectContractorsTable).values({
    projectId: PROJECT_ID, anOrgId: NU_ORG, assignmentStatus: "ACTIVE",
  }).onConflictDoNothing();
  const agreementId = "t37-agreement";
  await db.insert(coordinationPoliciesTable).values({
    id: agreementId,
    policyKey: agreementId,
    version: 1,
    kind: "PROJECT_AGREEMENT",
    projectId: PROJECT_ID,
    providerOrgId: GU_ORG,
    recipientOrgId: NU_ORG,
    lifecycleStatus: "ACCEPTED",
    policySnapshot: {
      policyId: agreementId,
      templateId: "PROJECT_MEMBERSHIP",
      templateVersion: 1,
      code: "PROJECT_MEMBERSHIP",
      name: "Project Membership",
      description: "Accepted project coordination agreement",
      permissions: ["READ", "DOWNLOAD", "USE_FOR_PERFORMANCE_COORDINATION", "USE_FOR_SCHEDULE_COORDINATION", "USE_FOR_RESOURCE_COORDINATION", "USE_FOR_EXECUTION_COORDINATION"],
      prohibitions: [],
      provider: { organizationId: GU_ORG, userId: null },
      recipientOrganizationId: NU_ORG,
      purpose: "PROJECT_MEMBERSHIP",
      projectReference: PROJECT_ID,
      workPackageReference: null,
      validFrom: null,
      validUntil: null,
      createdAt: "2026-11-01T00:00:00.000Z",
    },
    effectivePolicy: {
      policyId: agreementId,
      templateId: "PROJECT_MEMBERSHIP",
      templateVersion: 1,
      code: "PROJECT_MEMBERSHIP",
      name: "Project Membership",
      description: "Accepted project coordination agreement",
      permissions: ["READ", "DOWNLOAD", "USE_FOR_PERFORMANCE_COORDINATION", "USE_FOR_SCHEDULE_COORDINATION", "USE_FOR_RESOURCE_COORDINATION", "USE_FOR_EXECUTION_COORDINATION"],
      prohibitions: [],
      provider: { organizationId: GU_ORG, userId: null },
      policyType: "PROJECT_AGREEMENT",
      recipientOrganizationId: NU_ORG,
      purpose: "PROJECT_MEMBERSHIP",
      projectReference: PROJECT_ID,
      workPackageReference: null,
      validFrom: null,
      validUntil: null,
      createdAt: "2026-11-01T00:00:00.000Z",
      childPolicyTypes: ["PERFORMANCE_REQUEST", "SCHEDULE_CHANGE", "DATA_OFFER"],
      childPermissions: ["READ", "DOWNLOAD", "USE_FOR_PERFORMANCE_COORDINATION", "USE_FOR_SCHEDULE_COORDINATION", "USE_FOR_RESOURCE_COORDINATION", "USE_FOR_EXECUTION_COORDINATION"],
    },
  }).onConflictDoNothing();
  await db.insert(projectMembershipsTable).values({
    id: "t37-membership",
    projectId: PROJECT_ID,
    agOrgId: GU_ORG,
    anOrgId: NU_ORG,
    status: "ACTIVE",
    invitationId: "t37-invitation",
    correlationId: "t37-correlation",
    projectAgreementPolicyId: agreementId,
  }).onConflictDoNothing();

  await db.insert(takteTable).values({
    id: TAKT_ID, projectId: PROJECT_ID,
    taktBezeichnung: "T37 Takt Alpha",
    zone: "Block A", gewerk: "Rohbau",
    plannedStart: "2026-11-01", plannedEnd: "2026-11-14",
    version: 1,
  }).onConflictDoNothing();

  guToken  = signToken({ userId: GU_USER,   orgId: GU_ORG,   orgType: "AG" });
  nuToken  = signToken({ userId: NU_USER,   orgId: NU_ORG,   orgType: "AN" });
  nu2Token = signToken({ userId: NU_USER_2, orgId: NU_ORG_2, orgType: "AN" });
  hubToken = signToken({ userId: GU_USER,   orgId: null,      orgType: null, hubAdmin: true });

  // Create a DRAFT request using the Sprint 3 endpoint
  const createRes = await request(app)
    .post("/api/takt-requests")
    .set("Authorization", `Bearer ${guToken}`)
    .send({
      taktId: TAKT_ID,
      nuOrgId: NU_ORG,
      responseRequiredBy: "2026-11-07T10:00:00Z",
      subject: "T37 Anfrage",
      message: "Bitte prüfen.",
    });
  expect(createRes.status).toBe(201);
  requestId = createRes.body.id;

  // Send the request so inbox rows are created
  const sendRes = await request(app)
    .post(`/api/takt-requests/${requestId}/send`)
    .set("Authorization", `Bearer ${guToken}`);
  expect(sendRes.status).toBe(200);
  messageId = sendRes.body.messageId;
});

afterAll(async () => {
  await cleanupFixtures();
});

// ── A. GET /messages/inbox ────────────────────────────────────────────────────

describe("GET /messages/inbox", () => {
  it("NU sees their own inbox messages", async () => {
    const res = await request(app)
      .get("/api/messages/inbox")
      .set("Authorization", `Bearer ${nuToken}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    const msg = res.body.find((m: { messageId: string }) => m.messageId === messageId);
    expect(msg).toBeDefined();
    expect(msg.recipientOrgId).toBe(NU_ORG);
    expect(msg.senderOrgId).toBe(GU_ORG);
    expect(msg.messageType).toBe("TAKT_REQUEST_NOTIFICATION");
  });

  it("NU2 sees no messages — org isolation", async () => {
    const res = await request(app)
      .get("/api/messages/inbox")
      .set("Authorization", `Bearer ${nu2Token}`);

    expect(res.status).toBe(200);
    // NU2 has no messages for T37 fixtures
    const t37Msg = res.body.find((m: { messageId: string }) => m.messageId === messageId);
    expect(t37Msg).toBeUndefined();
  });

  it("GU can read their own inbox (org-neutral) — returns 200", async () => {
    const res = await request(app)
      .get("/api/messages/inbox")
      .set("Authorization", `Bearer ${guToken}`);
    expect(res.status).toBe(200);
    // GU should not see messages that belong to NU
    const nuMsg = res.body.find((m: { messageId: string }) => m.messageId === messageId);
    expect(nuMsg).toBeUndefined();
  });

  it("hub admin cannot read NU inbox — returns 403", async () => {
    const res = await request(app)
      .get("/api/messages/inbox")
      .set("Authorization", `Bearer ${hubToken}`);
    expect(res.status).toBe(403);
  });

  it("returns 401 without auth", async () => {
    const res = await request(app).get("/api/messages/inbox");
    expect(res.status).toBe(401);
  });

  it("notification payload does not contain full snapshot data", async () => {
    const res = await request(app)
      .get("/api/messages/inbox")
      .set("Authorization", `Bearer ${nuToken}`);

    expect(res.status).toBe(200);
    const msg = res.body.find((m: { messageId: string }) => m.messageId === messageId);
    expect(msg).toBeDefined();

    const payload = msg.payload as Record<string, unknown>;
    // Must contain minimal fields
    expect(payload.taktRequestId).toBe(requestId);
    expect(payload.leistungReference).toBe(TAKT_ID);
    // The local hub adapter keeps its internal compatibility field; the
    // external connector contract uses requestVersion instead.
    expect(payload.taktVersion).toBe(1);
    // Must NOT contain full snapshot fields
    expect(payload.trade).toBeUndefined();
    expect(payload.workPackage).toBeUndefined();
    expect(payload.resourceRequirements).toEqual([]);
    expect(payload.documentReferences).toBeUndefined();
    expect(payload.predecessors).toBeUndefined();
  });

  it("filters by messageType", async () => {
    const res = await request(app)
      .get("/api/messages/inbox?messageType=TAKT_REQUEST_NOTIFICATION")
      .set("Authorization", `Bearer ${nuToken}`);

    expect(res.status).toBe(200);
    for (const msg of res.body) {
      expect(msg.messageType).toBe("TAKT_REQUEST_NOTIFICATION");
    }
  });

  it("filters by status", async () => {
    const res = await request(app)
      .get("/api/messages/inbox?status=DELIVERED")
      .set("Authorization", `Bearer ${nuToken}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    for (const msg of res.body) {
      expect(msg.status).toBe("DELIVERED");
    }
  });

  it("filters by correlationId", async () => {
    const res = await request(app)
      .get(`/api/messages/inbox?correlationId=${requestId}`)
      .set("Authorization", `Bearer ${nuToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].correlationId).toBe(requestId);
  });

  it("pagination — limit and offset work", async () => {
    const resAll = await request(app)
      .get("/api/messages/inbox?limit=100&offset=0")
      .set("Authorization", `Bearer ${nuToken}`);
    const resFirst = await request(app)
      .get("/api/messages/inbox?limit=1&offset=0")
      .set("Authorization", `Bearer ${nuToken}`);
    const resSecond = await request(app)
      .get(`/api/messages/inbox?limit=1&offset=${resAll.body.length}`)
      .set("Authorization", `Bearer ${nuToken}`);

    expect(resAll.status).toBe(200);
    expect(resFirst.body).toHaveLength(1);
    // Offset past the end → empty array
    expect(resSecond.body).toHaveLength(0);
  });

  it("returns messages newest first (descending receivedAt)", async () => {
    const res = await request(app)
      .get("/api/messages/inbox")
      .set("Authorization", `Bearer ${nuToken}`);

    expect(res.status).toBe(200);
    if (res.body.length > 1) {
      const dates = res.body.map((m: { receivedAt: string }) => new Date(m.receivedAt).getTime());
      for (let i = 1; i < dates.length; i++) {
        expect(dates[i - 1]).toBeGreaterThanOrEqual(dates[i]);
      }
    }
  });
});

// ── B. GET /messages/inbox/:messageId ─────────────────────────────────────────

describe("GET /messages/inbox/:messageId", () => {
  it("NU retrieves a single message by messageId", async () => {
    const res = await request(app)
      .get(`/api/messages/inbox/${messageId}`)
      .set("Authorization", `Bearer ${nuToken}`);

    expect(res.status).toBe(200);
    expect(res.body.messageId).toBe(messageId);
    expect(res.body.recipientOrgId).toBe(NU_ORG);
  });

  it("returns 404 for a non-existent messageId", async () => {
    const res = await request(app)
      .get("/api/messages/inbox/non-existent-message-id")
      .set("Authorization", `Bearer ${nuToken}`);
    expect(res.status).toBe(404);
  });

  it("returns 404 when NU2 tries to access NU's message", async () => {
    // Safe behaviour: always 404 for cross-org access (no oracle attack)
    const res = await request(app)
      .get(`/api/messages/inbox/${messageId}`)
      .set("Authorization", `Bearer ${nu2Token}`);
    expect(res.status).toBe(404);
  });

  it("GU gets 404 attempting to read a NU inbox message", async () => {
    const res = await request(app)
      .get(`/api/messages/inbox/${messageId}`)
      .set("Authorization", `Bearer ${guToken}`);
    // Message was delivered to NU's inbox; GU's org cannot see it → 404
    expect(res.status).toBe(404);
  });
});

// ── C. POST /messages/inbox/:messageId/read ───────────────────────────────────

describe("POST /messages/inbox/:messageId/read", () => {
  it("marks a DELIVERED message as READ and sets readAt", async () => {
    const res = await request(app)
      .post(`/api/messages/inbox/${messageId}/read`)
      .set("Authorization", `Bearer ${nuToken}`);

    expect(res.status).toBe(200);
    expect(res.body.messageId).toBe(messageId);
    expect(res.body.status).toBe("READ");
    expect(res.body.readAt).toBeTruthy();
  });

  it("repeated markAsRead is idempotent — same result, no error", async () => {
    const res1 = await request(app)
      .post(`/api/messages/inbox/${messageId}/read`)
      .set("Authorization", `Bearer ${nuToken}`);
    const res2 = await request(app)
      .post(`/api/messages/inbox/${messageId}/read`)
      .set("Authorization", `Bearer ${nuToken}`);

    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
    expect(res2.body.status).toBe("READ");
  });

  it("markAsRead does NOT change TaktRequest status", async () => {
    // Reload the TaktRequest and confirm its status is still DELIVERED
    const res = await request(app)
      .get("/api/takt-requests")
      .set("Authorization", `Bearer ${guToken}`);

    expect(res.status).toBe(200);
    const req = res.body.find((r: { id: string }) => r.id === requestId);
    expect(req).toBeDefined();
    // Status should remain DELIVERED — not changed to DETAILS_RETRIEVED
    expect(req.status).toBe("DELIVERED");
  });

  it("returns 404 for a non-existent messageId", async () => {
    const res = await request(app)
      .post("/api/messages/inbox/non-existent-id/read")
      .set("Authorization", `Bearer ${nuToken}`);
    expect(res.status).toBe(404);
  });

  it("NU2 cannot mark NU's message as read — returns 403", async () => {
    const res = await request(app)
      .post(`/api/messages/inbox/${messageId}/read`)
      .set("Authorization", `Bearer ${nu2Token}`);
    expect(res.status).toBe(403);
  });

  it("GU cannot mark a NU inbox message as read — returns 403", async () => {
    const res = await request(app)
      .post(`/api/messages/inbox/${messageId}/read`)
      .set("Authorization", `Bearer ${guToken}`);
    // Message belongs to NU; GU org triggers RecipientForbiddenError → 403
    expect(res.status).toBe(403);
  });

  it("returns 401 without auth", async () => {
    const res = await request(app)
      .post(`/api/messages/inbox/${messageId}/read`);
    expect(res.status).toBe(401);
  });
});
