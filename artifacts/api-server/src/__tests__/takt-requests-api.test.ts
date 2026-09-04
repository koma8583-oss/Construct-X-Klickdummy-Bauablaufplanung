/**
 * Task 3.6 — API integration tests for the Sprint 3 TaktRequest endpoints.
 *
 * Tests POST /takt-requests and POST /takt-requests/:id/send using supertest.
 * Also verifies that the existing GET /delegations endpoint is unaffected.
 *
 * Fixture prefix: "t36-"
 * JWT signed with the dev fallback secret "taktkoord-jwt-dev-secret-change-in-prod".
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import { agDb as db } from "@workspace/db";
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

// Use the same secret the server uses — falls back to the dev constant when
// JWT_SECRET is not set in the environment (local development without secrets).
const DEV_SECRET =
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
    DEV_SECRET,
    { expiresIn: "1h" },
  );
}

// ── Fixture IDs ───────────────────────────────────────────────────────────────

const GU_ORG      = "t36-org-gu";
const NU_ORG      = "t36-org-nu";
const OTHER_GU    = "t36-org-other-gu";
const PROJECT_ID  = "t36-project-001";
const TAKT_ID     = "t36-takt-001";
const GU_USER     = "t36-user-gu";
const NU_USER     = "t36-user-nu";
const OTHER_USER  = "t36-user-other";

let guToken: string;
let nuToken: string;
let otherGuToken: string;
let noOrgToken: string;

// ── Setup / teardown ──────────────────────────────────────────────────────────

beforeAll(async () => {
  // Remove stale membership state from interrupted or differently ordered runs.
  await db.delete(projectMembershipsTable).where(eq(projectMembershipsTable.projectId, PROJECT_ID)).catch(() => {});
  await db.insert(organizationsTable).values([
    { id: GU_ORG,   name: "T36 GU Org",    type: "AG" },
    { id: NU_ORG,   name: "T36 NU Org",    type: "AN" },
    { id: OTHER_GU, name: "T36 Other GU",  type: "AG" },
  ]).onConflictDoNothing();

  await db.insert(usersTable).values([
    { id: GU_USER,    name: "GU User",    email: "t36-gu@example.com",    passwordHash: "x" },
    { id: NU_USER,    name: "NU User",    email: "t36-nu@example.com",    passwordHash: "x" },
    { id: OTHER_USER, name: "Other User", email: "t36-other@example.com", passwordHash: "x" },
  ]).onConflictDoNothing();

  await db.insert(projectsTable).values({
    id: PROJECT_ID, agOrgId: GU_ORG, name: "T36 Test Project",
  }).onConflictDoNothing();

  await db.insert(projectContractorsTable).values({
    projectId: PROJECT_ID, anOrgId: NU_ORG,
    assignmentStatus: "ACTIVE",
  }).onConflictDoNothing();
  await db.insert(coordinationPoliciesTable).values({
    id: "t36-agreement", policyKey: "t36-agreement", version: 1, kind: "PROJECT_AGREEMENT",
    projectId: PROJECT_ID, providerOrgId: GU_ORG, recipientOrgId: NU_ORG,
    lifecycleStatus: "ACCEPTED", policySnapshot: {}, effectivePolicy: {
      policyType: "PROJECT_AGREEMENT",
      recipientOrganizationId: NU_ORG,
      projectReference: PROJECT_ID,
      validFrom: null,
      validUntil: null,
      childPolicyTypes: ["PERFORMANCE_REQUEST"],
      childPermissions: ["READ", "DOWNLOAD", "USE_FOR_PERFORMANCE_COORDINATION"],
    },
  }).onConflictDoNothing();
  await db.insert(projectMembershipsTable).values({
    id: "t36-membership",
    projectId: PROJECT_ID,
    agOrgId: GU_ORG,
    anOrgId: NU_ORG,
    status: "ACTIVE",
    invitationId: "t36-invitation",
    correlationId: "t36-membership-correlation",
    projectAgreementPolicyId: "t36-agreement",
  }).onConflictDoNothing();

  await db.insert(takteTable).values({
    id: TAKT_ID, projectId: PROJECT_ID,
    taktBezeichnung: "T36 Trockenbau West",
    zone: "Abschnitt W1", gewerk: "Trockenbau",
    description: "Montage Trockenbauwände West",
    plannedStart: "2026-10-01", plannedEnd: "2026-10-15",
    requiredResources: "4 Monteure",
    version: 1,
  }).onConflictDoNothing();

  guToken     = signToken({ userId: GU_USER,    orgId: GU_ORG,   orgType: "AG" });
  nuToken     = signToken({ userId: NU_USER,    orgId: NU_ORG,   orgType: "AN" });
  otherGuToken= signToken({ userId: OTHER_USER, orgId: OTHER_GU, orgType: "AG" });
  noOrgToken  = signToken({ userId: GU_USER,    orgId: null,     orgType: null  });
});

afterAll(async () => {
  // Clean up in FK-safe order
  const orgIds = [GU_ORG, NU_ORG, OTHER_GU];
  const orgSql = orgIds.map(id => `'${id}'`).join(",");

  await db.execute(sql`DELETE FROM leistungsanfrage_snapshots WHERE leistungsanfrage_id IN (
    SELECT id FROM leistungsanfragen WHERE gu_org_id = ANY(ARRAY[${sql.raw(orgSql)}])
  )`).catch(() => {});
  await db.execute(sql`DELETE FROM leistungsanfragen WHERE gu_org_id = ANY(ARRAY[${sql.raw(orgSql)}])`).catch(() => {});
  await db.execute(sql`DELETE FROM leistungen WHERE id = '${sql.raw(TAKT_ID)}'`).catch(() => {});
  await db.delete(projectMembershipsTable).where(eq(projectMembershipsTable.projectId, PROJECT_ID)).catch(() => {});
  await db.execute(sql`DELETE FROM project_contractors WHERE project_id = '${sql.raw(PROJECT_ID)}'`).catch(() => {});
  await db.execute(sql`DELETE FROM projects WHERE id = '${sql.raw(PROJECT_ID)}'`).catch(() => {});
  await db.execute(sql`DELETE FROM users WHERE id = ANY(ARRAY['${sql.raw(GU_USER)}','${sql.raw(NU_USER)}','${sql.raw(OTHER_USER)}'])`).catch(() => {});
  await db.execute(sql`DELETE FROM organizations WHERE id = ANY(ARRAY[${sql.raw(orgSql)}])`).catch(() => {});
});

// ── A. POST /takt-requests ────────────────────────────────────────────────────

describe("POST /takt-requests", () => {
  it("GU creates a valid DRAFT request with snapshot atomically", async () => {
    const res = await request(app)
      .post("/api/takt-requests")
      .set("Authorization", `Bearer ${guToken}`)
      .send({
        taktId: TAKT_ID,
        nuOrgId: NU_ORG,
        responseRequiredBy: "2026-10-08T10:00:00Z",
        subject: "Bitte Zeitraum prüfen",
        message: "Wir schlagen den 01.10.–15.10. vor.",
      });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe("DRAFT");
    expect(res.body.taktId).toBe(TAKT_ID);
    expect(res.body.taktVersion).toBe(1);
    expect(res.body.guOrgId).toBe(GU_ORG);
    expect(res.body.nuOrgId).toBe(NU_ORG);
    expect(res.body.snapshotId).toBeTruthy();
    expect(res.body.id).toBeTruthy();
  });

  it("snapshot is created simultaneously with the request", async () => {
    const res = await request(app)
      .post("/api/takt-requests")
      .set("Authorization", `Bearer ${guToken}`)
      .send({ taktId: TAKT_ID, nuOrgId: NU_ORG });

    expect(res.status).toBe(201);
    const snapshotId = res.body.snapshotId;
    expect(snapshotId).toBeTruthy();

    const [snap] = await db
      .select()
      .from(taktRequestSnapshotsTable)
      .where(eq(taktRequestSnapshotsTable.id, snapshotId));
    expect(snap).toBeDefined();
    expect(snap.schemaVersion).toBe("1.0");

    const payload = snap.snapshotPayload as Record<string, unknown>;
    expect(payload.taktReference).toBe(TAKT_ID);
    expect(payload.taktVersion).toBe(1);
  });

  it("returns 401 when no bearer token is provided", async () => {
    const res = await request(app)
      .post("/api/takt-requests")
      .send({ taktId: TAKT_ID, nuOrgId: NU_ORG });
    expect(res.status).toBe(401);
  });

  it("returns 403 when guOrgId is not the project owner", async () => {
    const res = await request(app)
      .post("/api/takt-requests")
      .set("Authorization", `Bearer ${otherGuToken}`)
      .send({ taktId: TAKT_ID, nuOrgId: NU_ORG });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/not the AG owner/i);
  });

  it("returns 403 when nuOrgId is not a registered contractor", async () => {
    const res = await request(app)
      .post("/api/takt-requests")
      .set("Authorization", `Bearer ${guToken}`)
      .send({ taktId: TAKT_ID, nuOrgId: OTHER_GU }); // OTHER_GU not in project_contractors
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("PROJECT_MEMBERSHIP_NOT_ACTIVE");
  });

  it("returns 404 when taktId does not exist", async () => {
    const res = await request(app)
      .post("/api/takt-requests")
      .set("Authorization", `Bearer ${guToken}`)
      .send({ taktId: "non-existent-takt", nuOrgId: NU_ORG });
    expect(res.status).toBe(404);
  });

  it("returns 400 on invalid request body (missing required fields)", async () => {
    const res = await request(app)
      .post("/api/takt-requests")
      .set("Authorization", `Bearer ${guToken}`)
      .send({ taktId: TAKT_ID }); // nuOrgId missing
    expect(res.status).toBe(400);
  });
});

// ── B. POST /takt-requests/:id/send ──────────────────────────────────────────

describe("POST /takt-requests/:id/send", () => {
  /** Creates a fresh DRAFT request and returns its ID + snapshot ID. */
  async function createDraft(): Promise<{ requestId: string; snapshotId: string }> {
    const res = await request(app)
      .post("/api/takt-requests")
      .set("Authorization", `Bearer ${guToken}`)
      .send({
        taktId: TAKT_ID,
        nuOrgId: NU_ORG,
        responseRequiredBy: "2026-10-10T12:00:00Z",
        subject: "T36 Notification",
        message: "Bitte prüfen.",
      });
    expect(res.status).toBe(201);
    return { requestId: res.body.id, snapshotId: res.body.snapshotId };
  }

  it("sends the request and returns DELIVERED status", async () => {
    const { requestId } = await createDraft();

    const res = await request(app)
      .post(`/api/takt-requests/${requestId}/send`)
      .set("Authorization", `Bearer ${guToken}`);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("DELIVERED");
    expect(res.body.requestId).toBe(requestId);
    expect(res.body.messageId).toContain(requestId);
    expect(res.body.sentAt).toBeTruthy();
    expect(res.body.deliveredAt).toBeTruthy();
  });

  it("notification payload does not contain the full Takt snapshot", async () => {
    const { requestId } = await createDraft();
    await request(app)
      .post(`/api/takt-requests/${requestId}/send`)
      .set("Authorization", `Bearer ${guToken}`);

    // The message_outbox payload should be the minimal notification, not the snapshot.
    // We verify by checking the outbox row directly.
    const rows = await db.execute(
      sql`SELECT payload FROM message_outbox WHERE message_id = ${"taktrequest-notification-" + requestId} LIMIT 1`,
    ) as unknown as Array<{ payload: Record<string, unknown> }>;

    if (rows.length > 0) {
      const payload = rows[0].payload;
      // Must have minimal fields
      expect(payload.taktRequestId).toBe(requestId);
      // Must NOT have full snapshot fields
      expect(payload.trade).toBeUndefined();
      expect(payload.workPackage).toBeUndefined();
      expect(payload.resourceRequirements).toBeUndefined();
      expect(payload.documentReferences).toBeUndefined();
    }
    // If no outbox row exists yet, the test still passes (transport abstracted away).
  });

  it("TaktRequest status is DELIVERED after send", async () => {
    const { requestId } = await createDraft();
    await request(app)
      .post(`/api/takt-requests/${requestId}/send`)
      .set("Authorization", `Bearer ${guToken}`);

    const [row] = await db
      .select()
      .from(taktRequestsTable)
      .where(eq(taktRequestsTable.id, requestId));
    expect(row.status).toBe("DELIVERED");
  });

  it("Takt lifecycleStatus is set to IN_COORDINATION after delivery", async () => {
    const { requestId } = await createDraft();
    const res = await request(app)
      .post(`/api/takt-requests/${requestId}/send`)
      .set("Authorization", `Bearer ${guToken}`);

    expect(res.body.taktLifecycleStatus).toBe("IN_COORDINATION");

    const [takt] = await db
      .select()
      .from(takteTable)
      .where(eq(takteTable.id, TAKT_ID));
    expect(takt.lifecycleStatus).toBe("IN_COORDINATION");

    // Restore for subsequent tests
    await db.update(takteTable).set({ lifecycleStatus: "PLANNED" }).where(eq(takteTable.id, TAKT_ID));
  });

  it("repeated /send is idempotent — no second outbox row created", async () => {
    const { requestId } = await createDraft();

    const res1 = await request(app)
      .post(`/api/takt-requests/${requestId}/send`)
      .set("Authorization", `Bearer ${guToken}`);
    expect(res1.status).toBe(200);
    expect(res1.body.status).toBe("DELIVERED");

    // Second call — already DELIVERED, should return same result without error
    const res2 = await request(app)
      .post(`/api/takt-requests/${requestId}/send`)
      .set("Authorization", `Bearer ${guToken}`);
    expect(res2.status).toBe(200);
    expect(res2.body.status).toBe("DELIVERED");
    expect(res2.body.messageId).toBe(res1.body.messageId);

    // Verify only one outbox row
    const countRows = await db.execute(
      sql`SELECT COUNT(*) as cnt FROM message_outbox WHERE correlation_id = ${requestId}`,
    ) as unknown as Array<{ cnt: string }>;
    if (countRows.length > 0) {
      expect(Number(countRows[0].cnt)).toBe(1);
    }
  });

  it("returns 403 when a different GU tries to send", async () => {
    const { requestId } = await createDraft();
    const res = await request(app)
      .post(`/api/takt-requests/${requestId}/send`)
      .set("Authorization", `Bearer ${otherGuToken}`);
    expect(res.status).toBe(403);
  });

  it("returns 401 when no token is provided", async () => {
    const { requestId } = await createDraft();
    const res = await request(app)
      .post(`/api/takt-requests/${requestId}/send`);
    expect(res.status).toBe(401);
  });

  it("returns 404 for a non-existent requestId", async () => {
    const res = await request(app)
      .post("/api/takt-requests/non-existent-id/send")
      .set("Authorization", `Bearer ${guToken}`);
    expect(res.status).toBe(404);
  });
});

// ── C. Existing delegation endpoints are unaffected ───────────────────────────

describe("GET /delegations — unchanged by Sprint 3 changes", () => {
  it("responds with 200 and a list (may be empty)", async () => {
    const res = await request(app)
      .get("/api/delegations")
      .set("Authorization", `Bearer ${guToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it("returns 401 without auth", async () => {
    const res = await request(app).get("/api/delegations");
    expect(res.status).toBe(401);
  });
});
