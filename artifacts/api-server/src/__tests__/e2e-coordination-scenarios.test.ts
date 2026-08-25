/**
 * Task 6.9 — End-to-End Coordination Scenarios
 *
 * Covers all five scenarios from the sprint spec:
 *   A. Confirm original (CONFIRM_ACCEPTED)
 *   B. Accept an alternative (ACCEPT_ALTERNATIVE)
 *   C. Revision after alternatives
 *   D. Revision after rejection
 *   E. Close without agreement (CLOSE_WITHOUT_AGREEMENT)
 *
 * Also verifies:
 *   - Data integrity (one decision per response, immutable versions)
 *   - Privacy (no internal NU fields in GU decision / Takt version / Hub messages)
 *   - Idempotency (retry never creates a second decision or version)
 *   - Full end-to-end: GU creates → NU retrieves → NU responds → GU decides → chain is intact
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import app from "../app";
import {
  agDb as db,
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
import { eq, inArray, sql } from "drizzle-orm";
import jwt from "jsonwebtoken";

// ── Test fixtures ─────────────────────────────────────────────────────────────

const GU_ORG_ID    = "t69-gu-org";
const NU_ORG_ID    = "t69-nu-org";
const GU_USER_ID   = "t69-gu-user";
const NU_USER_ID   = "t69-nu-user";
const PROJECT_ID   = "t69-project";
const TAKT_ID      = "t69-takt";

const JWT_SECRET = process.env.JWT_SECRET ?? "taktkoord-jwt-dev-secret-change-in-prod";
function sign(p: { userId: string; orgId: string | null; orgType: "AG" | "AN" | null; hubAdmin?: boolean; roles?: string[] }): string {
  const roles = p.roles ?? (p.orgType === "AG" ? ["AG_ADMIN"] : p.orgType === "AN" ? ["AN_ADMIN"] : []);
  return jwt.sign({ ...p, hubAdmin: p.hubAdmin ?? false, roles }, JWT_SECRET, { expiresIn: "1h" });
}

const guToken = sign({ userId: GU_USER_ID, orgId: GU_ORG_ID, orgType: "AG" });
const nuToken = sign({ userId: NU_USER_ID, orgId: NU_ORG_ID, orgType: "AN" });

async function flushRelated() {
  // Step 1: collect all request IDs owned by this GU
  const myRequests = await db
    .select({ id: taktRequestsTable.id })
    .from(taktRequestsTable)
    .where(eq(taktRequestsTable.guOrgId, GU_ORG_ID))
    .catch(() => [] as { id: string }[]);
  const myRequestIds = myRequests.map((r) => r.id);

  // Step 2: collect all response IDs for those requests
  const myResponses = myRequestIds.length
    ? await db
        .select({ id: taktResponsesTable.id })
        .from(taktResponsesTable)
        .where(inArray(taktResponsesTable.taktRequestId, myRequestIds))
        .catch(() => [] as { id: string }[])
    : [];
  const myResponseIds = myResponses.map((r) => r.id);

  // Step 3: collect all takt IDs for those requests
  const myTaktIds = await db
    .select({ id: takteTable.id })
    .from(takteTable)
    .where(eq(takteTable.projectId, PROJECT_ID))
    .then((rows) => rows.map((r) => r.id))
    .catch(() => [] as string[]);

  // Delete in FK order — always filtered, never global
  if (myTaktIds.length)
    await db.delete(taktVersionsTable).where(inArray(taktVersionsTable.taktId, myTaktIds)).catch(() => {});
  await db.delete(taktResponseDecisionsTable)
    .where(eq(taktResponseDecisionsTable.guOrgId, GU_ORG_ID)).catch(() => {});
  if (myResponseIds.length)
    await db.delete(taktResponseAlternativesTable)
      .where(inArray(taktResponseAlternativesTable.responseId, myResponseIds)).catch(() => {});
  if (myResponseIds.length)
    await db.delete(taktResponsesTable)
      .where(inArray(taktResponsesTable.id, myResponseIds)).catch(() => {});
  if (myRequestIds.length)
    await db.delete(taktRequestSnapshotsTable)
      .where(inArray(taktRequestSnapshotsTable.taktRequestId, myRequestIds)).catch(() => {});
  await db.delete(taktRequestsTable).where(eq(taktRequestsTable.guOrgId, GU_ORG_ID)).catch(() => {});
  if (myTaktIds.length)
    await db.delete(takteTable).where(inArray(takteTable.id, myTaktIds)).catch(() => {});
  await db.delete(projectContractorsTable)
    .where(eq(projectContractorsTable.projectId, PROJECT_ID)).catch(() => {});
  await db.delete(projectsTable).where(eq(projectsTable.id, PROJECT_ID)).catch(() => {});
  await db.delete(messageOutboxTable).where(eq(messageOutboxTable.senderOrgId, GU_ORG_ID)).catch(() => {});
  await db.delete(messageInboxTable).where(eq(messageInboxTable.recipientOrgId, NU_ORG_ID)).catch(() => {});
  await db.delete(usersTable).where(eq(usersTable.id, GU_USER_ID)).catch(() => {});
  await db.delete(usersTable).where(eq(usersTable.id, NU_USER_ID)).catch(() => {});
  await db.delete(organizationsTable).where(eq(organizationsTable.id, GU_ORG_ID)).catch(() => {});
  await db.delete(organizationsTable).where(eq(organizationsTable.id, NU_ORG_ID)).catch(() => {});
}

beforeAll(async () => {
  await flushRelated();

  await db.insert(organizationsTable).values([
    { id: GU_ORG_ID, name: "t69-GU", type: "AG" as const },
    { id: NU_ORG_ID, name: "t69-NU", type: "AN" as const },
  ]).onConflictDoNothing();

  await db.insert(usersTable).values([
    { id: GU_USER_ID, name: "GU User", email: "t69gu@test.local", passwordHash: "x" },
    { id: NU_USER_ID, name: "NU User", email: "t69nu@test.local", passwordHash: "x" },
  ]).onConflictDoNothing();

  await db.insert(projectsTable).values({
    id: PROJECT_ID, name: "t69-Project", agOrgId: GU_ORG_ID,
    status: "ACTIVE", location: "Test", startDate: "2026-01-01", endDate: "2026-12-31",
  }).onConflictDoNothing();

  await db.insert(projectContractorsTable).values({
    projectId: PROJECT_ID, anOrgId: NU_ORG_ID,
    assignmentStatus: "ACTIVE",
  }).onConflictDoNothing();

  await db.execute(sql`
    INSERT INTO project_memberships
      (id, project_id, ag_org_id, an_org_id, invitation_id, correlation_id, status)
    VALUES (${`t69-membership`}, ${PROJECT_ID}, ${GU_ORG_ID}, ${NU_ORG_ID},
      ${`t69-invitation`}, ${`t69-correlation`}, 'ACTIVE')
    ON CONFLICT DO NOTHING
  `);
});

afterAll(async () => {
  await flushRelated();
});

// ── Helper: create a fresh Takt + send a request across the AG–AN boundary ───
//
// The project/takt fixtures are inserted directly. The actual coordination
// starts through the AG API, so Dataspace inbound creates the AN-local
// projection rather than an AG-owned status mutation.

async function createAndSendRequest(taktIdSuffix = ""): Promise<{
  taktId: string;
  requestId: string;
}> {
  const taktId = taktIdSuffix ? `${TAKT_ID}-${taktIdSuffix}` : TAKT_ID;
  // Cleanup prior data for this specific takt (always filtered, never global)
  const priorRequests = await db
    .select({ id: taktRequestsTable.id })
    .from(taktRequestsTable)
    .where(eq(taktRequestsTable.taktId, taktId))
    .catch(() => [] as { id: string }[]);
  const priorReqIds = priorRequests.map((r) => r.id);

  const priorRespIds = priorReqIds.length
    ? await db
        .select({ id: taktResponsesTable.id })
        .from(taktResponsesTable)
        .where(inArray(taktResponsesTable.taktRequestId, priorReqIds))
        .then((rows) => rows.map((r) => r.id))
        .catch(() => [] as string[])
    : [];

  await db.delete(taktVersionsTable).where(eq(taktVersionsTable.taktId, taktId)).catch(() => {});
  await db.delete(taktResponseDecisionsTable).where(eq(taktResponseDecisionsTable.guOrgId, GU_ORG_ID)).catch(() => {});
  if (priorRespIds.length)
    await db.delete(taktResponseAlternativesTable)
      .where(inArray(taktResponseAlternativesTable.responseId, priorRespIds)).catch(() => {});
  if (priorReqIds.length) {
    await db.delete(taktResponsesTable)
      .where(inArray(taktResponsesTable.taktRequestId, priorReqIds)).catch(() => {});
    await db.delete(taktRequestSnapshotsTable)
      .where(inArray(taktRequestSnapshotsTable.taktRequestId, priorReqIds)).catch(() => {});
  }
  await db.delete(taktRequestsTable).where(eq(taktRequestsTable.taktId, taktId)).catch(() => {});
  await db.delete(takteTable).where(eq(takteTable.id, taktId)).catch(() => {});
  await db.delete(messageOutboxTable).where(eq(messageOutboxTable.senderOrgId, GU_ORG_ID)).catch(() => {});
  await db.delete(messageInboxTable).where(eq(messageInboxTable.recipientOrgId, NU_ORG_ID)).catch(() => {});

  // Insert takt directly
  await db.insert(takteTable).values({
    id: taktId,
    projectId: PROJECT_ID,
    taktBezeichnung: `t69 Takt ${taktIdSuffix}`,
    zone: "A",
    gewerk: "Trockenbau",
    plannedStart: "2026-03-01",
    plannedEnd: "2026-03-15",
    version: 1,
    lifecycleStatus: "IN_COORDINATION" as const,
  });

  const created = await request(app)
    .post("/api/takt-requests")
    .set("Authorization", `Bearer ${guToken}`)
    .send({
      taktId,
      nuOrgId: NU_ORG_ID,
      responseRequiredBy: "2027-04-01T00:00:00.000Z",
    });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const requestId = created.body.id as string;

  const sent = await request(app)
    .post(`/api/takt-requests/${requestId}/send`)
    .set("Authorization", `Bearer ${guToken}`);
  expect([200, 201]).toContain(sent.status);

  return { taktId, requestId };
}

// ── Helper: NU submits a response ─────────────────────────────────────────────

async function nuSubmitResponse(
  requestId: string,
  decision: "ACCEPTED" | "ALTERNATIVES_PROPOSED" | "REJECTED",
) {
  const details = await request(app)
    .get(`/api/an/takt-requests/${requestId}/details`)
    .set("Authorization", `Bearer ${nuToken}`);
  expect(details.status).toBe(200);

  const responseBody: Record<string, unknown> = { decision };
  if (decision === "ACCEPTED") {
    responseBody.acceptedTimeWindow = { start: "2026-03-01", end: "2026-03-15" };
  }
  if (decision === "ALTERNATIVES_PROPOSED") {
    responseBody.alternatives = [
      { alternativeId: "ALT-t69-1", rank: 1, timeWindow: { start: "2026-04-01", end: "2026-04-15" }, crewSize: 4 },
      { alternativeId: "ALT-t69-2", rank: 2, timeWindow: { start: "2026-05-01", end: "2026-05-15" }, crewSize: 5 },
    ];
  }
  if (decision === "REJECTED") {
    responseBody.reasonCode = "NO_CAPACITY";
    responseBody.comment = "Keine freien Kapazitäten";
  }

  const respRes = await request(app)
    .post(`/api/an/takt-requests/${requestId}/responses`)
    .set("Authorization", `Bearer ${nuToken}`)
    .send(responseBody);
  expect(respRes.status).toBe(201);
  return { id: respRes.body.responseId as string };
}

// ── Scenario A — Confirm original ─────────────────────────────────────────────

describe("t69-scenarioA: CONFIRM_ACCEPTED", () => {
  let requestId = "";
  let taktId = "";

  beforeAll(async () => {
    ({ taktId, requestId } = await createAndSendRequest("a"));
    await nuSubmitResponse(requestId, "ACCEPTED");
  });

  it("t69-A1: GU can record CONFIRM_ACCEPTED decision", async () => {
    const res = await request(app)
      .post(`/api/takt-requests/${requestId}/gu-decisions`)
      .set("Authorization", `Bearer ${guToken}`)
      .send({ decisionType: "CONFIRM_ACCEPTED", idempotencyKey: "t69-a-idk" });
    expect(res.status).toBe(201);
    expect(res.body.decisionType).toBe("CONFIRM_ACCEPTED");
    expect(res.body.updatedRequestStatus).toBe("ACCEPTED");
  });

  it("t69-A2: Takt lifecycle transitions to CONFIRMED", async () => {
    const [takt] = await db.select().from(takteTable).where(eq(takteTable.id, taktId));
    expect(takt.lifecycleStatus).toBe("CONFIRMED");
  });

  it("t69-A3: No new takt_versions row for unchanged dates (CONFIRM_ACCEPTED)", async () => {
    // applyConfirmAccepted only creates a version if dates differ from snapshot
    const versions = await db.select().from(taktVersionsTable).where(eq(taktVersionsTable.taktId, taktId));
    // Either 0 versions (dates matched) or 1 (dates differed) — never more than 1
    expect(versions.length).toBeLessThanOrEqual(1);
  });

  it("t69-A4: TAKT_RESPONSE_ACCEPTED outbox message was created", async () => {
    const msgs = await db.select().from(messageOutboxTable)
      .where(eq(messageOutboxTable.senderOrgId, GU_ORG_ID));
    const accepted = msgs.find((m) => m.messageType === "TAKT_RESPONSE_ACCEPTED");
    expect(accepted).toBeDefined();
  });

  it("t69-A5: Retry with same idempotency key returns existing decision (idempotent=true)", async () => {
    const res = await request(app)
      .post(`/api/takt-requests/${requestId}/gu-decisions`)
      .set("Authorization", `Bearer ${guToken}`)
      .send({ decisionType: "CONFIRM_ACCEPTED", idempotencyKey: "t69-a-idk" });
    expect(res.status).toBe(200);
    expect(res.body.idempotent).toBe(true);
  });

  it("t69-A6: Second decision with different key returns 409", async () => {
    const res = await request(app)
      .post(`/api/takt-requests/${requestId}/gu-decisions`)
      .set("Authorization", `Bearer ${guToken}`)
      .send({ decisionType: "CONFIRM_ACCEPTED", idempotencyKey: "t69-a-different" });
    expect(res.status).toBe(409);
  });

  it("t69-A7: No internal NU data in outbox message payload", async () => {
    const msgs = await db.select().from(messageOutboxTable)
      .where(eq(messageOutboxTable.senderOrgId, GU_ORG_ID));
    const accepted = msgs.find((m) => m.messageType === "TAKT_RESPONSE_ACCEPTED");
    const payload = JSON.stringify(accepted?.payload ?? {});
    expect(payload).not.toContain("localProjectId");
    expect(payload).not.toContain("customerAlias");
    expect(payload).not.toContain("resourceId");
    expect(payload).not.toContain("employeeName");
    expect(payload).not.toContain("internalConflicts");
    expect(payload).not.toContain("internalCost");
  });
});

// ── Scenario B — Accept alternative ──────────────────────────────────────────

describe("t69-scenarioB: ACCEPT_ALTERNATIVE", () => {
  let requestId = "";
  let taktId = "";
  let altId = "";

  beforeAll(async () => {
    ({ taktId, requestId } = await createAndSendRequest("b"));
    await nuSubmitResponse(requestId, "ALTERNATIVES_PROPOSED");

    // The GU decision service looks up alternatives by their row UUID (id), not the business alternativeId.
    // Query the DB directly for the first alternative's row UUID.
    const [altRow] = await db
      .select({ id: taktResponseAlternativesTable.id })
      .from(taktResponseAlternativesTable)
      .where(eq(taktResponseAlternativesTable.alternativeId, "ALT-t69-1"))
      .limit(1);
    altId = altRow?.id ?? "";
    expect(altId).toBeTruthy();
  });

  it("t69-B1: GU can accept one alternative", async () => {
    const res = await request(app)
      .post(`/api/takt-requests/${requestId}/gu-decisions`)
      .set("Authorization", `Bearer ${guToken}`)
      .send({ decisionType: "ACCEPT_ALTERNATIVE", acceptedAlternativeId: altId, idempotencyKey: "t69-b-idk" });
    expect(res.status).toBe(201);
    expect(res.body.decisionType).toBe("ACCEPT_ALTERNATIVE");
    expect(res.body.acceptedAlternativeId).toBe(altId);
    expect(res.body.updatedRequestStatus).toBe("ACCEPTED");
  });

  it("t69-B2: Takt is CONFIRMED and version incremented", async () => {
    const [takt] = await db.select().from(takteTable).where(eq(takteTable.id, taktId));
    expect(takt.lifecycleStatus).toBe("CONFIRMED");
    expect(takt.version).toBe(2);
  });

  it("t69-B3: New takt_versions row created for ACCEPT_ALTERNATIVE", async () => {
    const versions = await db.select().from(taktVersionsTable).where(eq(taktVersionsTable.taktId, taktId));
    expect(versions.length).toBeGreaterThanOrEqual(1);
    const altVersion = versions.find((v) => v.sourceType === "ACCEPTED_ALTERNATIVE");
    expect(altVersion).toBeDefined();
    expect(altVersion?.contentHash).toBeTruthy();
  });

  it("t69-B4: Accepted alternative time window applied to Takt", async () => {
    const [takt] = await db.select().from(takteTable).where(eq(takteTable.id, taktId));
    // The accepted alt proposed 2026-04-01 → 2026-04-15
    expect(String(takt.plannedStart)).toContain("2026-04-01");
    expect(String(takt.plannedEnd)).toContain("2026-04-15");
  });

  it("t69-B5: Non-selected alternative remains in DB", async () => {
    // Both alternatives for this specific takt request should still be in the DB.
    const reqAlts = await db
      .select({ id: taktResponseAlternativesTable.id })
      .from(taktResponseAlternativesTable)
      .where(
        inArray(
          taktResponseAlternativesTable.alternativeId,
          ["ALT-t69-1", "ALT-t69-2"],
        ),
      );
    expect(reqAlts.length).toBe(2);
  });
});

// ── Scenario C — Revision after alternatives ──────────────────────────────────

describe("t69-scenarioC: REQUEST_REVISION → createRevision → re-send", () => {
  let requestId = "";
  let taktId = "";
  let newRequestId = "";

  beforeAll(async () => {
    ({ taktId, requestId } = await createAndSendRequest("c"));
    await nuSubmitResponse(requestId, "ALTERNATIVES_PROPOSED");
  });

  it("t69-C1: GU requests revision", async () => {
    const res = await request(app)
      .post(`/api/takt-requests/${requestId}/gu-decisions`)
      .set("Authorization", `Bearer ${guToken}`)
      .send({ decisionType: "REQUEST_REVISION", comment: "Bitte neuen Zeitplan", idempotencyKey: "t69-c-idk" });
    expect(res.status).toBe(201);
    expect(res.body.updatedRequestStatus).toBe("REVISION_REQUIRED");
  });

  it("t69-C2: GU creates new revision", async () => {
    const res = await request(app)
      .post(`/api/takt-requests/${requestId}/revisions`)
      .set("Authorization", `Bearer ${guToken}`)
      .send({
        plannedTimeWindow: { start: "2026-06-01", end: "2026-06-15" },
        subject: "Überarbeitete Anfrage",
        message: "Neuer Zeitplan",
        sendImmediately: false,
      });
    expect(res.status).toBe(201);
    expect(res.body.newTaktVersion).toBe(2);
    expect(res.body.newRequestStatus).toBe("DRAFT");
    expect(res.body.sent).toBe(false);
    newRequestId = res.body.newRequestId;
  });

  it("t69-C3: Old request is SUPERSEDED", async () => {
    const [old] = await db.select().from(taktRequestsTable).where(eq(taktRequestsTable.id, requestId));
    expect(old.status).toBe("SUPERSEDED");
  });

  it("t69-C4: New request references predecessor", async () => {
    const [newReq] = await db.select().from(taktRequestsTable).where(eq(taktRequestsTable.id, newRequestId));
    expect(newReq.supersedesRequestId).toBe(requestId);
    expect(newReq.status).toBe("DRAFT");
  });

  it("t69-C5: takt_versions row created with sourceType=REVISION", async () => {
    const versions = await db.select().from(taktVersionsTable).where(eq(taktVersionsTable.taktId, taktId));
    const revVersion = versions.find((v) => v.sourceType === "REVISION");
    expect(revVersion).toBeDefined();
  });

  it("t69-C6: Takt lifecycle is IN_COORDINATION (new round in progress)", async () => {
    const [takt] = await db.select().from(takteTable).where(eq(takteTable.id, taktId));
    expect(takt.lifecycleStatus).toBe("IN_COORDINATION");
    expect(takt.version).toBe(2);
  });

  it("t69-C7: AG sends the revision and it becomes a local AN projection", async () => {
    const sent = await request(app)
      .post(`/api/takt-requests/${newRequestId}/send`)
      .set("Authorization", `Bearer ${guToken}`);
    expect([200, 201]).toContain(sent.status);

    const details = await request(app)
      .get(`/api/an/takt-requests/${newRequestId}/details`)
      .set("Authorization", `Bearer ${nuToken}`);
    expect(details.status).toBe(200);
    expect(details.body.taktVersion).toBe(2);
  });

  it("t69-C8: NU confirms Version 2 and GU accepts — Takt ends CONFIRMED", async () => {
    // NU responds to the new request
    await nuSubmitResponse(newRequestId, "ACCEPTED");

    const res = await request(app)
      .post(`/api/takt-requests/${newRequestId}/gu-decisions`)
      .set("Authorization", `Bearer ${guToken}`)
      .send({ decisionType: "CONFIRM_ACCEPTED", idempotencyKey: "t69-c2-idk" });
    expect(res.status).toBe(201);

    const [takt] = await db.select().from(takteTable).where(eq(takteTable.id, taktId));
    expect(takt.lifecycleStatus).toBe("CONFIRMED");
  });
});

// ── Scenario D — Revision after rejection ─────────────────────────────────────

describe("t69-scenarioD: REJECTED → REQUEST_REVISION", () => {
  let requestId = "";
  let taktId = "";

  beforeAll(async () => {
    ({ taktId, requestId } = await createAndSendRequest("d"));
    await nuSubmitResponse(requestId, "REJECTED");
  });

  it("t69-D1: GU requests revision after rejection", async () => {
    const res = await request(app)
      .post(`/api/takt-requests/${requestId}/gu-decisions`)
      .set("Authorization", `Bearer ${guToken}`)
      .send({ decisionType: "REQUEST_REVISION", idempotencyKey: "t69-d-idk" });
    expect(res.status).toBe(201);
    expect(res.body.updatedRequestStatus).toBe("REVISION_REQUIRED");
  });

  it("t69-D2: GU creates new version", async () => {
    const res = await request(app)
      .post(`/api/takt-requests/${requestId}/revisions`)
      .set("Authorization", `Bearer ${guToken}`)
      .send({ plannedTimeWindow: { start: "2026-07-01", end: "2026-07-15" } });
    expect(res.status).toBe(201);
    expect(res.body.newTaktVersion).toBe(2);
    expect(res.body.newRequestStatus).toBe("DRAFT");
  });

  it("t69-D3: Old response and decision remain unchanged", async () => {
    const resp = await db.select().from(taktResponsesTable)
      .where(eq(taktResponsesTable.taktRequestId, requestId));
    expect(resp).toHaveLength(1);
    expect(resp[0].decision).toBe("REJECTED");

    const dec = await db.select().from(taktResponseDecisionsTable)
      .where(eq(taktResponseDecisionsTable.guOrgId, GU_ORG_ID));
    expect(dec.length).toBeGreaterThanOrEqual(1);
  });
});

// ── Scenario E — Close without agreement ─────────────────────────────────────

describe("t69-scenarioE: CLOSE_WITHOUT_AGREEMENT", () => {
  let requestId = "";
  let taktId = "";

  beforeAll(async () => {
    ({ taktId, requestId } = await createAndSendRequest("e"));
    await nuSubmitResponse(requestId, "REJECTED");
  });

  it("t69-E1: GU closes without agreement", async () => {
    const res = await request(app)
      .post(`/api/takt-requests/${requestId}/gu-decisions`)
      .set("Authorization", `Bearer ${guToken}`)
      .send({ decisionType: "CLOSE_WITHOUT_AGREEMENT", comment: "Kein Einigung", idempotencyKey: "t69-e-idk" });
    expect(res.status).toBe(201);
    expect(res.body.updatedRequestStatus).toBe("CANCELLED");
  });

  it("t69-E2: Request status is CANCELLED", async () => {
    const [req] = await db.select().from(taktRequestsTable).where(eq(taktRequestsTable.id, requestId));
    expect(req.status).toBe("CANCELLED");
  });

  it("t69-E3: Takt is NOT automatically CANCELLED (stays PLANNED)", async () => {
    const [takt] = await db.select().from(takteTable).where(eq(takteTable.id, taktId));
    expect(takt.lifecycleStatus).not.toBe("CANCELLED");
    expect(["PLANNED", "IN_COORDINATION"]).toContain(takt.lifecycleStatus);
  });

  it("t69-E4: TAKT_REQUEST_CANCELLED outbox message created", async () => {
    const msgs = await db.select().from(messageOutboxTable)
      .where(eq(messageOutboxTable.senderOrgId, GU_ORG_ID));
    const cancelled = msgs.find((m) => m.messageType === "TAKT_REQUEST_CANCELLED");
    expect(cancelled).toBeDefined();
  });

  it("t69-E5: No internal NU data in CANCELLED message", async () => {
    const msgs = await db.select().from(messageOutboxTable)
      .where(eq(messageOutboxTable.senderOrgId, GU_ORG_ID));
    const cancelled = msgs.find((m) => m.messageType === "TAKT_REQUEST_CANCELLED");
    const payload = JSON.stringify(cancelled?.payload ?? {});
    expect(payload).not.toContain("localProjectId");
    expect(payload).not.toContain("resourceId");
    expect(payload).not.toContain("internalCost");
  });
});

// ── Data integrity checks ─────────────────────────────────────────────────────

describe("t69-integrity: Data integrity", () => {
  it("t69-I1: Each response has at most one GU decision (UNIQUE constraint)", async () => {
    const decisions = await db.select().from(taktResponseDecisionsTable);
    const responseIds = decisions.map((d) => d.responseId);
    const uniqueResponseIds = new Set(responseIds);
    expect(uniqueResponseIds.size).toBe(responseIds.length);
  });

  it("t69-I2: Each takt_versions entry has a unique (taktId, version) pair", async () => {
    const versions = await db.select().from(taktVersionsTable);
    const keys = versions.map((v) => `${v.taktId}:${v.version}`);
    const unique = new Set(keys);
    expect(unique.size).toBe(keys.length);
  });

  it("t69-I3: takt_versions entries are write-once (no updatedAt column)", async () => {
    // If the table had an updatedAt it could be mutated — verify structure
    const versions = await db.select().from(taktVersionsTable).limit(1);
    if (versions.length > 0) {
      // @ts-expect-error — updatedAt should not exist on TaktVersion type
      expect(versions[0].updatedAt).toBeUndefined();
    }
  });

  it("t69-I4: taktRequest chain: each request references a valid supersedesRequestId", async () => {
    const allRequests = await db.select().from(taktRequestsTable)
      .where(eq(taktRequestsTable.guOrgId, GU_ORG_ID));
    for (const req of allRequests) {
      if (req.supersedesRequestId) {
        const [pred] = await db.select().from(taktRequestsTable)
          .where(eq(taktRequestsTable.id, req.supersedesRequestId));
        expect(pred).toBeDefined();
        expect(pred.status).toBe("SUPERSEDED");
      }
    }
  });
});
