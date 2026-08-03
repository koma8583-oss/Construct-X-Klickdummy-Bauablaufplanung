/**
 * Task 81 — Unified TaktRequest creation + Response API with transactional processing.
 *
 * Tests:
 *   Legacy create route (POST /projects/:id/takt-requests):
 *     [1]  Creates a TaktRequest AND snapshot atomically (via createTaktRequestWithSnapshot)
 *     [2]  requestNumber auto-generated when omitted
 *     [3]  Returns snapshotId in response body
 *     [4]  Rejects when Takt not found / NU not a contractor
 *
 *   Send handler — no-snapshot guard:
 *     [5]  Sending a request that was inserted directly without a snapshot → 422 clear error
 *
 *   /response (singular — legacy flat format) → unified service:
 *     [6]  ACCEPTED via flat acceptedStart/acceptedEnd → 201, stored canonically
 *     [7]  Idempotent: same payload hash → 200, no duplicate row
 *     [8]  Different time window after first response → 409
 *     [9]  ALTERNATIVES_PROPOSED via flat proposedStart/proposedEnd → 201
 *
 *   /responses (plural — canonical format) → hash-based idempotency:
 *     [10] Same full payload (including time window + alternatives) → 200 idempotent
 *     [11] Same decision, different comment → 409 (different payload hash)
 *     [12] Same decision, different time window → 409
 *     [13] Different decision → 409 DIFFERENT_DECISION
 *     [14] UNKNOWN transportStatus when outbox row missing (bug fix)
 *
 *   Transaction atomicity:
 *     [15] Response + alternatives + request status update in single transaction
 *          (verify request row has correct status after /responses call)
 *
 * Fixture prefix: "t81-"
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import { db } from "@workspace/db";
import {
  organizationsTable,
  usersTable,
  projectsTable,
  takteTable,
  taktRequestsTable,
  taktRequestSnapshotsTable,
  taktResponsesTable,
  taktResponseAlternativesTable,
  projectContractorsTable,
  messageOutboxTable,
  messageInboxTable,
  taktRequestAuditEventsTable,
} from "@workspace/db";
import { eq, and } from "drizzle-orm";
import app from "../app";

// ── JWT ───────────────────────────────────────────────────────────────────────

const JWT_SECRET = process.env.JWT_SECRET ?? "taktkoord-jwt-dev-secret-change-in-prod";

function signToken(p: {
  userId: string;
  orgId: string | null;
  orgType: "AG" | "AN" | null;
  hubAdmin?: boolean;
}): string {
  return jwt.sign({ ...p, hubAdmin: p.hubAdmin ?? false }, JWT_SECRET, { expiresIn: "1h" });
}

// ── Fixture IDs ───────────────────────────────────────────────────────────────

const GU_ORG   = "t81-gu-org";
const NU_ORG   = "t81-nu-org";
const NU_ORG_B = "t81-nu-org-b";
const GU_USER  = "t81-gu-user";
const NU_USER  = "t81-nu-user";
const PROJECT  = "t81-project";
const TAKT_BASE = "t81-takt";

let guToken:  string;
let nuToken:  string;
let hubToken: string;

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Insert a bare TaktRequest row WITHOUT a snapshot (for send-guard test). */
async function insertBareRequest(suffix: string): Promise<{ reqId: string; taktId: string }> {
  const taktId = `${TAKT_BASE}-bare-${suffix}`;
  const reqId  = `t81-req-bare-${suffix}`;

  await db.insert(takteTable).values({
    id: taktId, projectId: PROJECT,
    taktBezeichnung: `T81 Bare Takt ${suffix}`, zone: "Z1", gewerk: "TRK",
    plannedStart: "2026-10-01", plannedEnd: "2026-10-05",
  }).onConflictDoNothing();

  await db.insert(taktRequestsTable).values({
    id: reqId, taktId, taktVersion: 1,
    guOrgId: GU_ORG, nuOrgId: NU_ORG,
    requestNumber: `TKR-T81-BARE-${suffix}`,
    status: "DRAFT" as const,
    createdByUserId: GU_USER,
  }).onConflictDoNothing();

  return { reqId, taktId };
}

/** Insert a TaktRequest + snapshot in UNDER_REVIEW status, return reqId. */
async function insertReviewRequest(suffix: string): Promise<string> {
  const taktId = `${TAKT_BASE}-rev-${suffix}`;
  const reqId  = `t81-req-rev-${suffix}`;

  await db.insert(takteTable).values({
    id: taktId, projectId: PROJECT,
    taktBezeichnung: `T81 Review Takt ${suffix}`, zone: "Z2", gewerk: "STC",
    plannedStart: "2026-10-10", plannedEnd: "2026-10-15",
  }).onConflictDoNothing();

  await db.insert(taktRequestsTable).values({
    id: reqId, taktId, taktVersion: 1,
    guOrgId: GU_ORG, nuOrgId: NU_ORG,
    requestNumber: `TKR-T81-REV-${suffix}`,
    status: "UNDER_REVIEW" as const,
    createdByUserId: GU_USER,
  }).onConflictDoNothing();

  await db.insert(taktRequestSnapshotsTable).values({
    id: `t81-snap-rev-${suffix}`,
    taktRequestId: reqId,
    schemaVersion: "1.0",
    snapshotPayload: {
      schemaVersion: "1.0",
      taktReference: taktId,
      taktVersion: 1,
      trade: "STC",
      workPackage: "T81 review",
      plannedTimeWindow: { start: "2026-10-10", end: "2026-10-15" },
    },
  }).onConflictDoNothing();

  return reqId;
}

// ── Setup / Teardown ──────────────────────────────────────────────────────────

beforeAll(async () => {
  // Orgs
  await db.insert(organizationsTable).values([
    { id: GU_ORG,   name: "T81 GU Org",   type: "AG" },
    { id: NU_ORG,   name: "T81 NU Org",   type: "AN" },
    { id: NU_ORG_B, name: "T81 NU Org B", type: "AN" },
  ]).onConflictDoNothing();

  // Users
  await db.insert(usersTable).values([
    { id: GU_USER, name: "T81 GU User", email: "t81-gu@example.com", passwordHash: "x" },
    { id: NU_USER, name: "T81 NU User", email: "t81-nu@example.com", passwordHash: "x" },
  ]).onConflictDoNothing();

  // Project
  await db.insert(projectsTable).values([
    { id: PROJECT, agOrgId: GU_ORG, name: "T81 Project", status: "ACTIVE" },
  ]).onConflictDoNothing();

  // Base takt for legacy create tests
  await db.insert(takteTable).values({
    id: TAKT_BASE, projectId: PROJECT,
    taktBezeichnung: "T81 Base Takt", zone: "Z0", gewerk: "STB",
    plannedStart: "2026-09-01", plannedEnd: "2026-09-05",
  }).onConflictDoNothing();

  // NU is a contractor on the project
  await db.insert(projectContractorsTable).values([
    {
      id:             "t81-contractor",
      projectId:      PROJECT,
      anOrgId:        NU_ORG,
      assignmentStatus: "ACTIVE",
    },
  ]).onConflictDoNothing();

  // Tokens
  guToken  = signToken({ userId: GU_USER, orgId: GU_ORG,   orgType: "AG" });
  nuToken  = signToken({ userId: NU_USER, orgId: NU_ORG,   orgType: "AN" });
  hubToken = signToken({ userId: "t81-hub-user", orgId: null, orgType: null, hubAdmin: true });
});

afterAll(async () => {
  // Delete in FK-safe order.
  // The transport delivers to message_inbox (GU org) and writes message_outbox.
  // Audit events also reference requests.
  const ourRequests = await db.select({ id: taktRequestsTable.id })
    .from(taktRequestsTable)
    .where(eq(taktRequestsTable.guOrgId, GU_ORG));

  for (const { id } of ourRequests) {
    // Audit events
    await db.delete(taktRequestAuditEventsTable)
      .where(eq(taktRequestAuditEventsTable.requestId, id));

    // Inbox messages delivered to GU org
    await db.delete(messageInboxTable)
      .where(eq(messageInboxTable.correlationId, id));

    // Outbox entries
    await db.delete(messageOutboxTable)
      .where(eq(messageOutboxTable.correlationId, id));

    // Response alternatives + responses
    const resp = await db.select({ id: taktResponsesTable.id })
      .from(taktResponsesTable)
      .where(eq(taktResponsesTable.taktRequestId, id));
    for (const { id: rid } of resp) {
      await db.delete(taktResponseAlternativesTable)
        .where(eq(taktResponseAlternativesTable.responseId, rid));
    }
    await db.delete(taktResponsesTable)
      .where(eq(taktResponsesTable.taktRequestId, id));

    // Snapshots
    await db.delete(taktRequestSnapshotsTable)
      .where(eq(taktRequestSnapshotsTable.taktRequestId, id));
  }

  await db.delete(taktRequestsTable).where(eq(taktRequestsTable.guOrgId, GU_ORG));
  await db.delete(takteTable).where(eq(takteTable.projectId, PROJECT));
  await db.delete(projectContractorsTable).where(eq(projectContractorsTable.projectId, PROJECT));
  await db.delete(projectsTable).where(eq(projectsTable.id, PROJECT));
  await db.delete(usersTable).where(eq(usersTable.id, GU_USER));
  await db.delete(usersTable).where(eq(usersTable.id, NU_USER));
  await db.delete(organizationsTable).where(eq(organizationsTable.id, GU_ORG));
  await db.delete(organizationsTable).where(eq(organizationsTable.id, NU_ORG));
  await db.delete(organizationsTable).where(eq(organizationsTable.id, NU_ORG_B));
});

// ── [1–4] Legacy create route ────────────────────────────────────────────────

describe("POST /projects/:id/takt-requests — legacy create via createTaktRequestWithSnapshot", () => {
  it("[1] creates both TaktRequest and snapshot atomically", async () => {
    const res = await request(app)
      .post(`/api/projects/${PROJECT}/takt-requests`)
      .set("Authorization", `Bearer ${guToken}`)
      .send({
        taktId:        TAKT_BASE,
        nuOrgId:       NU_ORG,
        requestNumber: "TKR-T81-LEGACY-001",
      });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      taktId:  TAKT_BASE,
      nuOrgId: NU_ORG,
      guOrgId: GU_ORG,
      status:  "DRAFT",
    });
    // Must include snapshotId (created atomically)
    expect(res.body.snapshotId).toBeTruthy();

    // Verify snapshot actually exists in DB
    const snap = await db.select()
      .from(taktRequestSnapshotsTable)
      .where(eq(taktRequestSnapshotsTable.taktRequestId, res.body.id))
      .limit(1);
    expect(snap).toHaveLength(1);
  });

  it("[2] auto-generates requestNumber when omitted", async () => {
    const res = await request(app)
      .post(`/api/projects/${PROJECT}/takt-requests`)
      .set("Authorization", `Bearer ${guToken}`)
      .send({ taktId: TAKT_BASE, nuOrgId: NU_ORG });

    expect(res.status).toBe(201);
    expect(typeof res.body.requestNumber).toBe("string");
    expect(res.body.requestNumber.length).toBeGreaterThan(0);
    // Snapshot created
    expect(res.body.snapshotId).toBeTruthy();
  });

  it("[3] returns 403 when NU is not an active contractor", async () => {
    const res = await request(app)
      .post(`/api/projects/${PROJECT}/takt-requests`)
      .set("Authorization", `Bearer ${guToken}`)
      .send({ taktId: TAKT_BASE, nuOrgId: NU_ORG_B });

    // NU_ORG_B has no project_contractors entry
    expect(res.status).toBe(403);
    expect(res.body.error).toBeTruthy();
  });

  it("[4] returns 404 when Takt does not exist", async () => {
    const res = await request(app)
      .post(`/api/projects/${PROJECT}/takt-requests`)
      .set("Authorization", `Bearer ${guToken}`)
      .send({ taktId: "nonexistent-takt-t81", nuOrgId: NU_ORG });

    expect(res.status).toBe(404);
  });
});

// ── [5] Send handler — no-snapshot guard ────────────────────────────────────

describe("POST /takt-requests/:id/send — no-snapshot guard", () => {
  it("[5] returns 422 with clear message when no snapshot exists", async () => {
    const { reqId } = await insertBareRequest("send-guard");

    // Manually advance to DRAFT so send is applicable (DRAFT → SENT transition)
    // Actually DRAFT is the send start state per the state machine
    const res = await request(app)
      .post(`/api/takt-requests/${reqId}/send`)
      .set("Authorization", `Bearer ${guToken}`);

    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/no snapshot exists/i);
    expect(res.body.error).toMatch(/atomically/i);
  });
});

// ── [6–9] /response (singular legacy endpoint) ──────────────────────────────

describe("POST /takt-requests/:id/response — legacy flat format adapter", () => {
  it("[6] ACCEPTED via flat acceptedStart/End → 201, stored canonically", async () => {
    const reqId = await insertReviewRequest("resp-acc");

    const res = await request(app)
      .post(`/api/takt-requests/${reqId}/response`)
      .set("Authorization", `Bearer ${nuToken}`)
      .send({
        decision:      "ACCEPTED",
        acceptedStart: "2026-10-10T08:00:00Z",
        acceptedEnd:   "2026-10-15T17:00:00Z",
      });

    expect(res.status).toBe(201);
    expect(res.body.decision).toBe("ACCEPTED");

    // DB row stores the time window in the DB columns
    const [row] = await db.select()
      .from(taktResponsesTable)
      .where(eq(taktResponsesTable.taktRequestId, reqId))
      .limit(1);

    expect(row).toBeTruthy();
    expect(row!.decision).toBe("ACCEPTED");
    expect(row!.acceptedStart).toBeTruthy();
    // Hash was stored
    expect(row!.responsePayloadHash).toBeTruthy();
  });

  it("[7] identical payload retried → 200 (idempotent, no duplicate row)", async () => {
    const reqId = await insertReviewRequest("resp-idem-sing");

    const body = {
      decision:      "REJECTED",
      reasonCode:    "NO_CAPACITY",
      comment:       "Fully booked",
    };

    const first = await request(app)
      .post(`/api/takt-requests/${reqId}/response`)
      .set("Authorization", `Bearer ${nuToken}`)
      .send(body);
    expect(first.status).toBe(201);

    const second = await request(app)
      .post(`/api/takt-requests/${reqId}/response`)
      .set("Authorization", `Bearer ${nuToken}`)
      .send(body);
    expect(second.status).toBe(200);

    // Only ONE response row
    const rows = await db.select()
      .from(taktResponsesTable)
      .where(eq(taktResponsesTable.taktRequestId, reqId));
    expect(rows).toHaveLength(1);
  });

  it("[8] different time window after first response → 409", async () => {
    const reqId = await insertReviewRequest("resp-conflict-sing");

    await request(app)
      .post(`/api/takt-requests/${reqId}/response`)
      .set("Authorization", `Bearer ${nuToken}`)
      .send({ decision: "ACCEPTED", acceptedStart: "2026-10-10T08:00:00Z", acceptedEnd: "2026-10-15T17:00:00Z" });

    const res = await request(app)
      .post(`/api/takt-requests/${reqId}/response`)
      .set("Authorization", `Bearer ${nuToken}`)
      .send({ decision: "ACCEPTED", acceptedStart: "2026-10-11T08:00:00Z", acceptedEnd: "2026-10-16T17:00:00Z" });

    expect(res.status).toBe(409);
  });

  it("[9] ALTERNATIVES_PROPOSED via flat proposedStart/End → 201", async () => {
    const reqId = await insertReviewRequest("resp-alt-sing");

    const res = await request(app)
      .post(`/api/takt-requests/${reqId}/response`)
      .set("Authorization", `Bearer ${nuToken}`)
      .send({
        decision:    "ALTERNATIVES_PROPOSED",
        alternatives: [
          { alternativeId: "alt-1", rank: 1, proposedStart: "2026-10-17T08:00:00Z", proposedEnd: "2026-10-22T17:00:00Z" },
          { alternativeId: "alt-2", rank: 2, proposedStart: "2026-10-24T08:00:00Z", proposedEnd: "2026-10-29T17:00:00Z" },
        ],
      });

    expect(res.status).toBe(201);
    expect(res.body.decision).toBe("ALTERNATIVES_PROPOSED");

    // Verify alternatives stored
    const [row] = await db.select()
      .from(taktResponsesTable)
      .where(eq(taktResponsesTable.taktRequestId, reqId))
      .limit(1);
    const alts = await db.select()
      .from(taktResponseAlternativesTable)
      .where(eq(taktResponseAlternativesTable.responseId, row!.id));
    expect(alts).toHaveLength(2);
  });
});

// ── [10–14] /responses (plural canonical endpoint) — hash-based idempotency ─

describe("POST /takt-requests/:id/responses — hash-based idempotency", () => {
  it("[10] identical full payload → 200 idempotent, no second response row", async () => {
    const reqId = await insertReviewRequest("resp-hash-idem");

    const body = {
      decision:          "ALTERNATIVES_PROPOSED",
      reasonCode:        "NO_CAPACITY",
      comment:           "Two windows possible",
      alternatives: [
        { alternativeId: "w1", rank: 1, timeWindow: { start: "2026-10-17T08:00:00Z", end: "2026-10-22T17:00:00Z" } },
        { alternativeId: "w2", rank: 2, timeWindow: { start: "2026-10-24T08:00:00Z", end: "2026-10-29T17:00:00Z" } },
      ],
      nextAvailableDate: "2026-10-17",
    };

    const first = await request(app)
      .post(`/api/takt-requests/${reqId}/responses`)
      .set("Authorization", `Bearer ${nuToken}`)
      .send(body);
    expect(first.status).toBe(201);

    const second = await request(app)
      .post(`/api/takt-requests/${reqId}/responses`)
      .set("Authorization", `Bearer ${nuToken}`)
      .send(body);
    expect(second.status).toBe(200);
    expect(second.body.responseId).toBe(first.body.responseId);

    // Only ONE response row
    const rows = await db.select()
      .from(taktResponsesTable)
      .where(eq(taktResponsesTable.taktRequestId, reqId));
    expect(rows).toHaveLength(1);
  });

  it("[11] same decision, different comment → 409 (different hash)", async () => {
    const reqId = await insertReviewRequest("resp-hash-diff-comment");

    await request(app)
      .post(`/api/takt-requests/${reqId}/responses`)
      .set("Authorization", `Bearer ${nuToken}`)
      .send({ decision: "REJECTED", reasonCode: "NO_CAPACITY", comment: "First comment" });

    const res = await request(app)
      .post(`/api/takt-requests/${reqId}/responses`)
      .set("Authorization", `Bearer ${nuToken}`)
      .send({ decision: "REJECTED", reasonCode: "NO_CAPACITY", comment: "Different comment" });

    expect(res.status).toBe(409);
  });

  it("[12] same decision, different time window → 409 (different hash)", async () => {
    const reqId = await insertReviewRequest("resp-hash-diff-tw");

    await request(app)
      .post(`/api/takt-requests/${reqId}/responses`)
      .set("Authorization", `Bearer ${nuToken}`)
      .send({ decision: "ACCEPTED", acceptedTimeWindow: { start: "2026-10-10T08:00:00Z", end: "2026-10-15T17:00:00Z" } });

    const res = await request(app)
      .post(`/api/takt-requests/${reqId}/responses`)
      .set("Authorization", `Bearer ${nuToken}`)
      .send({ decision: "ACCEPTED", acceptedTimeWindow: { start: "2026-10-11T08:00:00Z", end: "2026-10-16T17:00:00Z" } });

    expect(res.status).toBe(409);
  });

  it("[13] completely different decision → 409 DIFFERENT_DECISION", async () => {
    const reqId = await insertReviewRequest("resp-diff-decision");

    await request(app)
      .post(`/api/takt-requests/${reqId}/responses`)
      .set("Authorization", `Bearer ${nuToken}`)
      .send({ decision: "REJECTED", reasonCode: "NO_CAPACITY" });

    const res = await request(app)
      .post(`/api/takt-requests/${reqId}/responses`)
      .set("Authorization", `Bearer ${nuToken}`)
      .send({ decision: "ACCEPTED", acceptedTimeWindow: { start: "2026-10-10T08:00:00Z", end: "2026-10-15T17:00:00Z" } });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/REJECTED/);
  });

  it("[14] idempotent response shows UNKNOWN transportStatus when no outbox row", async () => {
    const reqId = await insertReviewRequest("resp-unknown-outbox");

    // First submission
    await request(app)
      .post(`/api/takt-requests/${reqId}/responses`)
      .set("Authorization", `Bearer ${nuToken}`)
      .send({ decision: "REJECTED", reasonCode: "NO_CAPACITY" });

    // Delete the outbox row to simulate missing row
    await db.delete(messageOutboxTable)
      .where(eq(messageOutboxTable.messageId, `taktresponse-${reqId}`));

    // Retry: should return 200, transportStatus = UNKNOWN (not DELIVERED)
    const res = await request(app)
      .post(`/api/takt-requests/${reqId}/responses`)
      .set("Authorization", `Bearer ${nuToken}`)
      .send({ decision: "REJECTED", reasonCode: "NO_CAPACITY" });

    expect(res.status).toBe(200);
    expect(res.body.transportStatus).toBe("UNKNOWN");
  });
});

// ── [15] Transaction atomicity ───────────────────────────────────────────────

describe("Transaction atomicity — response + status in one commit", () => {
  it("[15] request status updated atomically with response insert", async () => {
    const reqId = await insertReviewRequest("resp-atomic");

    const res = await request(app)
      .post(`/api/takt-requests/${reqId}/responses`)
      .set("Authorization", `Bearer ${nuToken}`)
      .send({ decision: "REJECTED", reasonCode: "RESOURCE_CONFLICT" });

    expect(res.status).toBe(201);
    expect(res.body.requestStatus).toBe("REJECTED");

    // DB request status must also be REJECTED
    const [row] = await db.select()
      .from(taktRequestsTable)
      .where(eq(taktRequestsTable.id, reqId))
      .limit(1);

    expect(row!.status).toBe("REJECTED");

    // Response row must have the hash
    const [resp] = await db.select()
      .from(taktResponsesTable)
      .where(eq(taktResponsesTable.taktRequestId, reqId))
      .limit(1);
    expect(resp!.responsePayloadHash).toBeTruthy();
    expect(resp!.responsePayloadHash!.length).toBe(64); // SHA-256 hex
  });
});
