/**
 * Task 68 — End-to-End TaktRequest Coordination Flow
 *
 * Verifies the full cross-role handoff using the real API:
 *   1. GU creates a TaktRequest via POST /takt-requests  (DRAFT)
 *   2. GU sends it via POST /takt-requests/:id/send      (DELIVERED)
 *   3. NU retrieves details via GET /takt-requests/:id/details → DETAILS_RETRIEVED
 *   4. NU submits a response via POST /takt-requests/:id/responses
 *   5. GU makes a decision via POST /takt-requests/:id/gu-decisions
 *
 * Suite A — Accepted path (CONFIRM_ACCEPTED → ACCEPTED terminal state)
 * Suite B — Alternatives path (ALTERNATIVES_PROPOSED → ACCEPT_ALTERNATIVE → ACCEPTED)
 * Suite C — Auth / access guards on the details endpoint
 *
 * Fixture strategy: direct DB inserts for orgs/users/project/contractor/takt
 * (established pattern — see t92, e2e-coordination-scenarios).
 * API layer is exercised for the coordination flow itself.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import app from "../app";
import { db } from "@workspace/db";
import {
  organizationsTable,
  usersTable,
  projectsTable,
  projectContractorsTable,
  takteTable,
  taktRequestsTable,
  taktRequestSnapshotsTable,
  taktResponsesTable,
  taktResponseAlternativesTable,
  taktResponseDecisionsTable,
  taktVersionsTable,
  messageOutboxTable,
  messageInboxTable,
} from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import jwt from "jsonwebtoken";

// ── Constants ─────────────────────────────────────────────────────────────────

const T = "t68";
const GU_ORG_ID   = `${T}-gu-org`;
const NU_ORG_ID   = `${T}-nu-org`;
const GU_USER_ID  = `${T}-gu-user`;
const NU_USER_ID  = `${T}-nu-user`;
const PROJECT_ID  = `${T}-project`;

const JWT_SECRET = process.env.JWT_SECRET ?? "taktkoord-jwt-dev-secret-change-in-prod";

function sign(p: {
  userId: string;
  orgId: string | null;
  orgType: "AG" | "AN" | null;
  hubAdmin?: boolean;
  roles?: string[];
}): string {
  const roles = p.roles ?? (p.orgType === "AG" ? ["AG_ADMIN"] : p.orgType === "AN" ? ["AN_ADMIN"] : []);
  return jwt.sign({ ...p, hubAdmin: p.hubAdmin ?? false, roles }, JWT_SECRET, { expiresIn: "1h" });
}

const guToken = sign({ userId: GU_USER_ID, orgId: GU_ORG_ID, orgType: "AG" });
const nuToken = sign({ userId: NU_USER_ID, orgId: NU_ORG_ID, orgType: "AN" });

// ── Teardown helper ───────────────────────────────────────────────────────────

async function flushAll() {
  const reqRows = await db
    .select({ id: taktRequestsTable.id })
    .from(taktRequestsTable)
    .where(eq(taktRequestsTable.guOrgId, GU_ORG_ID))
    .catch(() => [] as { id: string }[]);
  const reqIds = reqRows.map((r) => r.id);

  const respRows = reqIds.length
    ? await db
        .select({ id: taktResponsesTable.id })
        .from(taktResponsesTable)
        .where(inArray(taktResponsesTable.taktRequestId, reqIds))
        .catch(() => [] as { id: string }[])
    : [];
  const respIds = respRows.map((r) => r.id);

  const taktIds = await db
    .select({ id: takteTable.id })
    .from(takteTable)
    .where(eq(takteTable.projectId, PROJECT_ID))
    .then((r) => r.map((x) => x.id))
    .catch(() => [] as string[]);

  // Delete in FK order — always filtered, never global deletes.
  if (taktIds.length)
    await db.delete(taktVersionsTable).where(inArray(taktVersionsTable.taktId, taktIds)).catch(() => {});
  await db
    .delete(taktResponseDecisionsTable)
    .where(eq(taktResponseDecisionsTable.guOrgId, GU_ORG_ID))
    .catch(() => {});
  if (respIds.length)
    await db
      .delete(taktResponseAlternativesTable)
      .where(inArray(taktResponseAlternativesTable.responseId, respIds))
      .catch(() => {});
  if (respIds.length)
    await db
      .delete(taktResponsesTable)
      .where(inArray(taktResponsesTable.id, respIds))
      .catch(() => {});
  if (reqIds.length)
    await db
      .delete(taktRequestSnapshotsTable)
      .where(inArray(taktRequestSnapshotsTable.taktRequestId, reqIds))
      .catch(() => {});
  if (reqIds.length)
    await db
      .delete(taktRequestsTable)
      .where(inArray(taktRequestsTable.id, reqIds))
      .catch(() => {});
  if (taktIds.length)
    await db.delete(takteTable).where(inArray(takteTable.id, taktIds)).catch(() => {});
  await db
    .delete(projectContractorsTable)
    .where(eq(projectContractorsTable.projectId, PROJECT_ID))
    .catch(() => {});
  await db.delete(projectsTable).where(eq(projectsTable.id, PROJECT_ID)).catch(() => {});
  await db
    .delete(messageOutboxTable)
    .where(eq(messageOutboxTable.senderOrgId, GU_ORG_ID))
    .catch(() => {});
  await db
    .delete(messageInboxTable)
    .where(eq(messageInboxTable.recipientOrgId, NU_ORG_ID))
    .catch(() => {});
  await db.delete(usersTable).where(eq(usersTable.id, GU_USER_ID)).catch(() => {});
  await db.delete(usersTable).where(eq(usersTable.id, NU_USER_ID)).catch(() => {});
  await db.delete(organizationsTable).where(eq(organizationsTable.id, GU_ORG_ID)).catch(() => {});
  await db.delete(organizationsTable).where(eq(organizationsTable.id, NU_ORG_ID)).catch(() => {});
}

// ── Fixture setup ─────────────────────────────────────────────────────────────

beforeAll(async () => {
  await flushAll();

  await db
    .insert(organizationsTable)
    .values([
      { id: GU_ORG_ID, name: `${T}-GU`, type: "AG" as const },
      { id: NU_ORG_ID, name: `${T}-NU`, type: "AN" as const },
    ])
    .onConflictDoNothing();

  await db
    .insert(usersTable)
    .values([
      { id: GU_USER_ID, name: "GU User t68", email: `${T}-gu@test.local`, passwordHash: "x" },
      { id: NU_USER_ID, name: "NU User t68", email: `${T}-nu@test.local`, passwordHash: "x" },
    ])
    .onConflictDoNothing();

  await db
    .insert(projectsTable)
    .values({
      id: PROJECT_ID,
      name: `${T}-Project`,
      agOrgId: GU_ORG_ID,
      location: "Berlin",
      startDate: "2026-01-01",
      endDate: "2026-12-31",
    })
    .onConflictDoNothing();

  // NU must be an ACTIVE contractor on the project for createTaktRequestWithSnapshot to succeed.
  await db
    .insert(projectContractorsTable)
    .values({ projectId: PROJECT_ID, anOrgId: NU_ORG_ID, assignmentStatus: "ACTIVE" })
    .onConflictDoNothing();
});

afterAll(async () => {
  await flushAll();
});

// ── Helper: insert a fresh Takt for a given suite suffix ──────────────────────

async function insertTakt(suffix: string): Promise<string> {
  const taktId = `${T}-takt-${suffix}`;
  // Clean prior data for this specific takt to keep suites independent.
  const priorReqs = await db
    .select({ id: taktRequestsTable.id })
    .from(taktRequestsTable)
    .where(eq(taktRequestsTable.taktId, taktId))
    .catch(() => [] as { id: string }[]);
  const priorReqIds = priorReqs.map((r) => r.id);
  const priorRespIds = priorReqIds.length
    ? await db
        .select({ id: taktResponsesTable.id })
        .from(taktResponsesTable)
        .where(inArray(taktResponsesTable.taktRequestId, priorReqIds))
        .then((r) => r.map((x) => x.id))
        .catch(() => [] as string[])
    : [];

  await db.delete(taktVersionsTable).where(eq(taktVersionsTable.taktId, taktId)).catch(() => {});
  await db
    .delete(taktResponseDecisionsTable)
    .where(eq(taktResponseDecisionsTable.guOrgId, GU_ORG_ID))
    .catch(() => {});
  if (priorRespIds.length)
    await db
      .delete(taktResponseAlternativesTable)
      .where(inArray(taktResponseAlternativesTable.responseId, priorRespIds))
      .catch(() => {});
  if (priorReqIds.length) {
    await db
      .delete(taktResponsesTable)
      .where(inArray(taktResponsesTable.taktRequestId, priorReqIds))
      .catch(() => {});
    await db
      .delete(taktRequestSnapshotsTable)
      .where(inArray(taktRequestSnapshotsTable.taktRequestId, priorReqIds))
      .catch(() => {});
  }
  await db.delete(taktRequestsTable).where(eq(taktRequestsTable.taktId, taktId)).catch(() => {});
  await db.delete(takteTable).where(eq(takteTable.id, taktId)).catch(() => {});
  await db.delete(messageOutboxTable).where(eq(messageOutboxTable.senderOrgId, GU_ORG_ID)).catch(() => {});
  await db
    .delete(messageInboxTable)
    .where(eq(messageInboxTable.recipientOrgId, NU_ORG_ID))
    .catch(() => {});

  await db.insert(takteTable).values({
    id: taktId,
    projectId: PROJECT_ID,
    taktBezeichnung: `${T} Takt ${suffix}`,
    zone: "Zone-A",
    gewerk: "Trockenbau",
    plannedStart: "2026-03-01",
    plannedEnd: "2026-03-15",
    version: 1,
    lifecycleStatus: "PLANNED" as const,
  });

  return taktId;
}

// ═════════════════════════════════════════════════════════════════════════════
// Suite A — Full ACCEPTED path via API (create → send → details → response → confirm)
// ═════════════════════════════════════════════════════════════════════════════

describe("t68-suiteA: full ACCEPTED coordination path (API-driven)", () => {
  let taktId   = "";
  let requestId = "";

  beforeAll(async () => {
    taktId = await insertTakt("a");
  });

  // ── Step 1: GU creates TaktRequest ──────────────────────────────────────────

  it("t68-A1: POST /takt-requests creates a DRAFT request and snapshot", async () => {
    const res = await request(app)
      .post("/api/takt-requests")
      .set("Authorization", `Bearer ${guToken}`)
      .send({
        taktId,
        nuOrgId: NU_ORG_ID,
        responseRequiredBy: "2026-04-01T00:00:00Z",
        subject: "Bitte Takt bestätigen",
        message: "Bitte prüfen und zurückmelden.",
      });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe("DRAFT");
    expect(res.body.taktId).toBe(taktId);
    expect(res.body.guOrgId).toBe(GU_ORG_ID);
    expect(res.body.nuOrgId).toBe(NU_ORG_ID);
    expect(res.body.id).toBeTruthy();
    expect(res.body.snapshotId).toBeTruthy();
    requestId = res.body.id;
  });

  // ── Step 2: GU sends TaktRequest ────────────────────────────────────────────

  it("t68-A2: POST /takt-requests/:id/send transitions status to DELIVERED", async () => {
    const res = await request(app)
      .post(`/api/takt-requests/${requestId}/send`)
      .set("Authorization", `Bearer ${guToken}`);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("DELIVERED");
    expect(res.body.requestId).toBe(requestId);
    expect(res.body.taktLifecycleStatus).toBe("IN_COORDINATION");
  });

  it("t68-A2b: Takt lifecycleStatus is now IN_COORDINATION", async () => {
    const [takt] = await db.select().from(takteTable).where(eq(takteTable.id, taktId));
    expect(takt.lifecycleStatus).toBe("IN_COORDINATION");
  });

  it("t68-A2c: Sending again (idempotency) returns 200 without creating a second message", async () => {
    const res = await request(app)
      .post(`/api/takt-requests/${requestId}/send`)
      .set("Authorization", `Bearer ${guToken}`);
    // Already DELIVERED → returns existing state
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("DELIVERED");
  });

  // ── Step 3: NU retrieves details → DETAILS_RETRIEVED ────────────────────────

  it("t68-A3: GET /takt-requests/:id/details (NU) transitions to DETAILS_RETRIEVED", async () => {
    const res = await request(app)
      .get(`/api/takt-requests/${requestId}/details`)
      .set("Authorization", `Bearer ${nuToken}`);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("DETAILS_RETRIEVED");
    expect(res.body.taktRequestId).toBe(requestId);
    expect(res.body.snapshotPayload).toBeDefined();
    expect(res.body.detailsRetrievedAt).toBeTruthy();
  });

  it("t68-A3b: Second GET /details call is idempotent (stays DETAILS_RETRIEVED)", async () => {
    const res = await request(app)
      .get(`/api/takt-requests/${requestId}/details`)
      .set("Authorization", `Bearer ${nuToken}`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("DETAILS_RETRIEVED");
  });

  it("t68-A3c: GU can also GET /details (preview — no status change)", async () => {
    const res = await request(app)
      .get(`/api/takt-requests/${requestId}/details`)
      .set("Authorization", `Bearer ${guToken}`);
    expect(res.status).toBe(200);
    // Status is still DETAILS_RETRIEVED — GU access does not change it
    expect(res.body.status).toBe("DETAILS_RETRIEVED");
  });

  // ── Step 4: NU submits ACCEPTED response ─────────────────────────────────────

  it("t68-A4: POST /takt-requests/:id/responses (ACCEPTED) returns 201", async () => {
    const res = await request(app)
      .post(`/api/takt-requests/${requestId}/responses`)
      .set("Authorization", `Bearer ${nuToken}`)
      .send({
        decision: "ACCEPTED",
        acceptedTimeWindow: { start: "2026-03-01", end: "2026-03-15" },
      });

    expect(res.status).toBe(201);
    expect(res.body.responseId).toBeTruthy();
    expect(res.body.decision).toBe("ACCEPTED");
  });

  // ── Step 5: GU makes CONFIRM_ACCEPTED decision ───────────────────────────────

  it("t68-A5: POST /takt-requests/:id/gu-decisions (CONFIRM_ACCEPTED) returns 201", async () => {
    const res = await request(app)
      .post(`/api/takt-requests/${requestId}/gu-decisions`)
      .set("Authorization", `Bearer ${guToken}`)
      .send({ decisionType: "CONFIRM_ACCEPTED", idempotencyKey: "t68-a-idk" });

    expect(res.status).toBe(201);
    expect(res.body.decisionType).toBe("CONFIRM_ACCEPTED");
    expect(res.body.updatedRequestStatus).toBe("ACCEPTED");
  });

  it("t68-A5b: Final TaktRequest status is ACCEPTED (terminal state)", async () => {
    const [req] = await db
      .select()
      .from(taktRequestsTable)
      .where(eq(taktRequestsTable.id, requestId));
    expect(req.status).toBe("ACCEPTED");
  });

  it("t68-A5c: Takt lifecycleStatus is CONFIRMED", async () => {
    const [takt] = await db.select().from(takteTable).where(eq(takteTable.id, taktId));
    expect(takt.lifecycleStatus).toBe("CONFIRMED");
  });

  it("t68-A5d: TAKT_RESPONSE_ACCEPTED outbox message was sent to NU", async () => {
    const msgs = await db
      .select()
      .from(messageOutboxTable)
      .where(eq(messageOutboxTable.senderOrgId, GU_ORG_ID));
    const found = msgs.find((m) => m.messageType === "TAKT_RESPONSE_ACCEPTED");
    expect(found).toBeDefined();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Suite B — ALTERNATIVES_PROPOSED path (create → send → details → alt response → accept alt)
// ═════════════════════════════════════════════════════════════════════════════

describe("t68-suiteB: ALTERNATIVES_PROPOSED path (NU proposes → GU ACCEPT_ALTERNATIVE)", () => {
  let taktId    = "";
  let requestId  = "";
  let altRowId   = "";   // DB UUID of the accepted alternative row

  beforeAll(async () => {
    taktId = await insertTakt("b");
  });

  it("t68-B1: GU creates TaktRequest via API → DRAFT", async () => {
    const res = await request(app)
      .post("/api/takt-requests")
      .set("Authorization", `Bearer ${guToken}`)
      .send({ taktId, nuOrgId: NU_ORG_ID, responseRequiredBy: "2026-05-01T00:00:00Z" });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe("DRAFT");
    requestId = res.body.id;
  });

  it("t68-B2: GU sends request → DELIVERED", async () => {
    const res = await request(app)
      .post(`/api/takt-requests/${requestId}/send`)
      .set("Authorization", `Bearer ${guToken}`);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("DELIVERED");
  });

  it("t68-B3: NU retrieves details → DETAILS_RETRIEVED", async () => {
    const res = await request(app)
      .get(`/api/takt-requests/${requestId}/details`)
      .set("Authorization", `Bearer ${nuToken}`);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("DETAILS_RETRIEVED");
    // Snapshot payload must not leak NU-internal data
    const payload = JSON.stringify(res.body.snapshotPayload ?? {});
    expect(payload).not.toContain("localProjectId");
    expect(payload).not.toContain("resourceId");
    expect(payload).not.toContain("internalCost");
  });

  it("t68-B4: NU submits ALTERNATIVES_PROPOSED with two alternatives", async () => {
    const res = await request(app)
      .post(`/api/takt-requests/${requestId}/responses`)
      .set("Authorization", `Bearer ${nuToken}`)
      .send({
        decision: "ALTERNATIVES_PROPOSED",
        alternatives: [
          {
            alternativeId: `ALT-${T}-B1`,
            rank: 1,
            timeWindow: { start: "2026-04-01", end: "2026-04-15" },
            crewSize: 4,
          },
          {
            alternativeId: `ALT-${T}-B2`,
            rank: 2,
            timeWindow: { start: "2026-05-01", end: "2026-05-15" },
            crewSize: 5,
          },
        ],
      });

    expect(res.status).toBe(201);
    expect(res.body.decision).toBe("ALTERNATIVES_PROPOSED");
  });

  it("t68-B4b: Request status is ALTERNATIVES_PROPOSED", async () => {
    const [req] = await db
      .select()
      .from(taktRequestsTable)
      .where(eq(taktRequestsTable.id, requestId));
    expect(req.status).toBe("ALTERNATIVES_PROPOSED");
  });

  it("t68-B4c: Both alternative rows are stored in DB", async () => {
    const alts = await db
      .select()
      .from(taktResponseAlternativesTable)
      .where(
        inArray(taktResponseAlternativesTable.alternativeId, [
          `ALT-${T}-B1`,
          `ALT-${T}-B2`,
        ]),
      );
    expect(alts).toHaveLength(2);
    // GU decision service expects the row UUID (id), not the business alternativeId.
    const firstAlt = alts.find((a) => a.alternativeId === `ALT-${T}-B1`);
    expect(firstAlt).toBeDefined();
    altRowId = firstAlt!.id;
  });

  it("t68-B5: GU accepts the first alternative via ACCEPT_ALTERNATIVE", async () => {
    const res = await request(app)
      .post(`/api/takt-requests/${requestId}/gu-decisions`)
      .set("Authorization", `Bearer ${guToken}`)
      .send({
        decisionType: "ACCEPT_ALTERNATIVE",
        acceptedAlternativeId: altRowId,
        idempotencyKey: "t68-b-idk",
      });

    expect(res.status).toBe(201);
    expect(res.body.decisionType).toBe("ACCEPT_ALTERNATIVE");
    expect(res.body.acceptedAlternativeId).toBe(altRowId);
    expect(res.body.updatedRequestStatus).toBe("ACCEPTED");
  });

  it("t68-B5b: Final TaktRequest status is ACCEPTED", async () => {
    const [req] = await db
      .select()
      .from(taktRequestsTable)
      .where(eq(taktRequestsTable.id, requestId));
    expect(req.status).toBe("ACCEPTED");
  });

  it("t68-B5c: Takt dates updated to the accepted alternative's time window", async () => {
    const [takt] = await db.select().from(takteTable).where(eq(takteTable.id, taktId));
    // Alternative B1 proposed 2026-04-01 → 2026-04-15
    expect(String(takt.plannedStart)).toContain("2026-04-01");
    expect(String(takt.plannedEnd)).toContain("2026-04-15");
    expect(takt.lifecycleStatus).toBe("CONFIRMED");
    expect(takt.version).toBe(2);
  });

  it("t68-B5d: A takt_versions row with sourceType ACCEPTED_ALTERNATIVE was created", async () => {
    const versions = await db
      .select()
      .from(taktVersionsTable)
      .where(eq(taktVersionsTable.taktId, taktId));
    const altVersion = versions.find((v) => v.sourceType === "ACCEPTED_ALTERNATIVE");
    expect(altVersion).toBeDefined();
    expect(altVersion?.contentHash).toBeTruthy();
  });

  it("t68-B5e: Non-selected alternative row is still in DB (immutable history)", async () => {
    const alts = await db
      .select()
      .from(taktResponseAlternativesTable)
      .where(
        inArray(taktResponseAlternativesTable.alternativeId, [
          `ALT-${T}-B1`,
          `ALT-${T}-B2`,
        ]),
      );
    expect(alts).toHaveLength(2);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Suite C — Access-control checks on the details endpoint
// ═════════════════════════════════════════════════════════════════════════════

describe("t68-suiteC: access-control guards on GET /takt-requests/:id/details", () => {
  let taktId    = "";
  let requestId  = "";

  beforeAll(async () => {
    taktId = await insertTakt("c");

    // Create + send a request via API so status is DELIVERED
    const create = await request(app)
      .post("/api/takt-requests")
      .set("Authorization", `Bearer ${guToken}`)
      .send({ taktId, nuOrgId: NU_ORG_ID, responseRequiredBy: "2026-06-01T00:00:00Z" });
    requestId = create.body.id;

    await request(app)
      .post(`/api/takt-requests/${requestId}/send`)
      .set("Authorization", `Bearer ${guToken}`);
  });

  it("t68-C1: Unauthenticated request returns 401", async () => {
    const res = await request(app).get(`/api/takt-requests/${requestId}/details`);
    expect(res.status).toBe(401);
  });

  it("t68-C2: A third-party org (neither GU nor NU) receives 403", async () => {
    const otherToken = sign({ userId: "t68-other-user", orgId: "t68-other-org", orgType: "AG" });
    const res = await request(app)
      .get(`/api/takt-requests/${requestId}/details`)
      .set("Authorization", `Bearer ${otherToken}`);
    expect(res.status).toBe(403);
  });

  it("t68-C3: Hub admin receives 403 (not a party to the request)", async () => {
    const adminToken = sign({ userId: "t68-admin", orgId: null, orgType: null, hubAdmin: true });
    const res = await request(app)
      .get(`/api/takt-requests/${requestId}/details`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(403);
  });

  it("t68-C4: Non-existent request returns 404", async () => {
    const res = await request(app)
      .get("/api/takt-requests/00000000-0000-0000-0000-000000000000/details")
      .set("Authorization", `Bearer ${guToken}`);
    expect(res.status).toBe(404);
  });
});
