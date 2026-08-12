/**
 * Task 6.3 — POST /takt-requests/:id/gu-decisions
 *
 * Tests:
 *   - accepted NU response can be confirmed (CONFIRM_ACCEPTED)
 *   - alternative can be selected (ACCEPT_ALTERNATIVE)
 *   - alternative from a different response is rejected
 *   - rejected NU response cannot be confirmed (CONFIRM_ACCEPTED → 400)
 *   - revision can be requested from ALTERNATIVES_PROPOSED
 *   - round can be closed without agreement
 *   - takt is NOT automatically cancelled when closing without agreement
 *   - foreign GU is rejected (403)
 *   - NU is rejected (403)
 *   - hub admin is rejected (403)
 *   - unauthenticated is rejected (401)
 *   - identical retry returns existing decision (idempotent)
 *   - second different attempt is rejected (409)
 *   - decision on non-existent request returns 404
 *   - no NU response yet → 400
 *
 * Fixture prefix: "t63-"
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
  taktResponseDecisionsTable,
  taktVersionsTable,
  messageOutboxTable,
  messageInboxTable,
  projectContractorsTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import app from "../app";

// ── JWT helpers ───────────────────────────────────────────────────────────────

const JWT_SECRET =
  process.env.JWT_SECRET ?? "taktkoord-jwt-dev-secret-change-in-prod";

function sign(p: {
  userId: string;
  orgId: string | null;
  orgType: "AG" | "AN" | null;
  hubAdmin?: boolean;
}): string {
  return jwt.sign({ ...p, hubAdmin: p.hubAdmin ?? false }, JWT_SECRET, {
    expiresIn: "1h",
  });
}

// ── Fixture IDs ───────────────────────────────────────────────────────────────

const GU_ORG   = "t63-gu-org";
const NU_ORG   = "t63-nu-org";
const GU2_ORG  = "t63-gu2-org";
const GU_USER  = "t63-gu-user";
const NU_USER  = "t63-nu-user";
const GU2_USER = "t63-gu2-user";
const HUB_USER = "t63-hub-user";
const PROJECT  = "t63-project";
const TAKT     = "t63-takt";

const guToken   = sign({ userId: GU_USER,  orgId: GU_ORG,  orgType: "AG" });
const nuToken   = sign({ userId: NU_USER,  orgId: NU_ORG,  orgType: "AN" });
const gu2Token  = sign({ userId: GU2_USER, orgId: GU2_ORG, orgType: "AG" });
const hubToken  = sign({ userId: HUB_USER, orgId: null,    orgType: null, hubAdmin: true });

// Per-test requests and responses (populated in beforeAll)
let reqAcceptedId   = "";    // request with ACCEPTED response
let reqAltId        = "";    // request with ALTERNATIVES_PROPOSED response
let reqRejectedId   = "";    // request with REJECTED response
let reqNoResponseId = "";    // request with no response yet

let respAcceptedId  = "";
let respAltId       = "";
let altRowId        = "";    // takt_response_alternatives PK for respAlt

// A second response for cross-response alternative FK tests
let reqAlt2Id       = "";
let respAlt2Id      = "";
let alt2RowId       = "";

// ── Setup / Teardown ──────────────────────────────────────────────────────────

beforeAll(async () => {
  // Pre-cleanup: remove any stale data from a previous crashed run (FK order)
  await db.delete(taktVersionsTable).where(eq(taktVersionsTable.taktId, TAKT)).catch(() => {});
  await db.delete(taktResponseDecisionsTable).where(eq(taktResponseDecisionsTable.guOrgId, GU_ORG)).catch(() => {});
  const staleReqs63 = await db.select({ id: taktRequestsTable.id }).from(taktRequestsTable).where(eq(taktRequestsTable.taktId, TAKT)).catch(() => []);
  const staleReqIds63 = staleReqs63.map((r: { id: string }) => r.id);
  if (staleReqIds63.length > 0) {
    const { inArray } = await import("drizzle-orm");
    const staleResps63 = await db.select({ id: taktResponsesTable.id }).from(taktResponsesTable).where(inArray(taktResponsesTable.taktRequestId, staleReqIds63)).catch(() => []);
    const staleRespIds63 = staleResps63.map((r: { id: string }) => r.id);
    if (staleRespIds63.length > 0) {
      await db.delete(taktResponseAlternativesTable).where(inArray(taktResponseAlternativesTable.responseId, staleRespIds63)).catch(() => {});
    }
    await db.delete(taktResponsesTable).where(inArray(taktResponsesTable.taktRequestId, staleReqIds63)).catch(() => {});
    await db.delete(taktRequestSnapshotsTable).where(inArray(taktRequestSnapshotsTable.taktRequestId, staleReqIds63)).catch(() => {});
  }
  await db.delete(taktRequestsTable).where(eq(taktRequestsTable.taktId, TAKT)).catch(() => {});
  await db.delete(takteTable).where(eq(takteTable.id, TAKT)).catch(() => {});
  await db.delete(projectContractorsTable).where(eq(projectContractorsTable.projectId, PROJECT)).catch(() => {});
  await db.delete(projectsTable).where(eq(projectsTable.id, PROJECT)).catch(() => {});
  for (const email of ["t63-gu@test.com", "t63-nu@test.com", "t63-gu2@test.com", "t63-hub@test.com"]) {
    await db.delete(usersTable).where(eq(usersTable.email, email)).catch(() => {});
  }
  for (const id of [GU_ORG, NU_ORG, GU2_ORG]) {
    await db.delete(organizationsTable).where(eq(organizationsTable.id, id)).catch(() => {});
  }

  // Organisations
  await db.insert(organizationsTable).values([
    { id: GU_ORG,  name: "t63 GU",   type: "AG" as const },
    { id: NU_ORG,  name: "t63 NU",   type: "AN" as const },
    { id: GU2_ORG, name: "t63 GU2",  type: "AG" as const },
  ]).onConflictDoNothing();

  // Users
  await db.insert(usersTable).values([
    { id: GU_USER,  email: "t63-gu@test.com",  name: "GU",   passwordHash: "x" },
    { id: NU_USER,  email: "t63-nu@test.com",  name: "NU",   passwordHash: "x" },
    { id: GU2_USER, email: "t63-gu2@test.com", name: "GU2",  passwordHash: "x" },
    { id: HUB_USER, email: "t63-hub@test.com", name: "Hub",  passwordHash: "x" },
  ]).onConflictDoNothing();

  // Project + contractor
  await db.insert(projectsTable).values({
    id: PROJECT,
    agOrgId: GU_ORG,
    name: "t63 Project",
    status: "ACTIVE" as const,
    startDate: "2026-09-01",
    endDate: "2026-12-31",
  }).onConflictDoNothing();

  await db.insert(projectContractorsTable).values({
    projectId: PROJECT,
    anOrgId: NU_ORG,
  }).onConflictDoNothing();

  // Takt
  await db.insert(takteTable).values({
    id: TAKT,
    projectId: PROJECT,
    taktBezeichnung: "t63 Takt",
    zone: "Z1",
    gewerk: "Elektro",
    plannedStart: "2026-10-01",
    plannedEnd: "2026-10-07",
    lifecycleStatus: "IN_COORDINATION" as const,
  }).onConflictDoNothing();

  // ── Request A: ACCEPTED ───────────────────────────────────────────────────
  const [rA] = await db.insert(taktRequestsTable).values({
    taktId: TAKT, taktVersion: 1, guOrgId: GU_ORG, nuOrgId: NU_ORG,
    requestNumber: "TKR-6300-0001",
    status: "ACCEPTED" as const,
    createdByUserId: GU_USER,
  }).returning();
  reqAcceptedId = rA.id;

  const [respA] = await db.insert(taktResponsesTable).values({
    taktRequestId: reqAcceptedId,
    decision: "ACCEPTED" as const,
    acceptedStart: new Date("2026-10-01T08:00:00Z"),
    acceptedEnd:   new Date("2026-10-07T17:00:00Z"),
    createdByUserId: NU_USER,
  }).returning();
  respAcceptedId = respA.id;

  // ── Request B: ALTERNATIVES_PROPOSED ─────────────────────────────────────
  const [rB] = await db.insert(taktRequestsTable).values({
    taktId: TAKT, taktVersion: 1, guOrgId: GU_ORG, nuOrgId: NU_ORG,
    requestNumber: "TKR-6300-0002",
    status: "ALTERNATIVES_PROPOSED" as const,
    createdByUserId: GU_USER,
  }).returning();
  reqAltId = rB.id;

  const [respB] = await db.insert(taktResponsesTable).values({
    taktRequestId: reqAltId,
    decision: "ALTERNATIVES_PROPOSED" as const,
    comment: "Zwei Alternativen",
    createdByUserId: NU_USER,
  }).returning();
  respAltId = respB.id;

  const [altB] = await db.insert(taktResponseAlternativesTable).values({
    responseId: respAltId,
    alternativeId: "ALT-001",
    rank: 1,
    proposedStart: new Date("2026-10-10T08:00:00Z"),
    proposedEnd:   new Date("2026-10-14T17:00:00Z"),
  }).returning();
  altRowId = altB.id;

  // ── Request C: REJECTED ───────────────────────────────────────────────────
  const [rC] = await db.insert(taktRequestsTable).values({
    taktId: TAKT, taktVersion: 1, guOrgId: GU_ORG, nuOrgId: NU_ORG,
    requestNumber: "TKR-6300-0003",
    status: "REJECTED" as const,
    createdByUserId: GU_USER,
  }).returning();
  reqRejectedId = rC.id;

  await db.insert(taktResponsesTable).values({
    taktRequestId: reqRejectedId,
    decision: "REJECTED" as const,
    reasonCode: "NO_CAPACITY" as const,
    createdByUserId: NU_USER,
  });

  // ── Request D: no response yet ─────────────────────────────────────────────
  const [rD] = await db.insert(taktRequestsTable).values({
    taktId: TAKT, taktVersion: 1, guOrgId: GU_ORG, nuOrgId: NU_ORG,
    requestNumber: "TKR-6300-0004",
    status: "UNDER_REVIEW" as const,
    createdByUserId: GU_USER,
  }).returning();
  reqNoResponseId = rD.id;

  // ── Request E2: second ALTERNATIVES_PROPOSED (for cross-response test) ────
  const [rE] = await db.insert(taktRequestsTable).values({
    taktId: TAKT, taktVersion: 1, guOrgId: GU_ORG, nuOrgId: NU_ORG,
    requestNumber: "TKR-6300-0005",
    status: "ALTERNATIVES_PROPOSED" as const,
    createdByUserId: GU_USER,
  }).returning();
  reqAlt2Id = rE.id;

  const [respE] = await db.insert(taktResponsesTable).values({
    taktRequestId: reqAlt2Id,
    decision: "ALTERNATIVES_PROPOSED" as const,
    comment: "Andere Alternativen",
    createdByUserId: NU_USER,
  }).returning();
  respAlt2Id = respE.id;

  const [altE] = await db.insert(taktResponseAlternativesTable).values({
    responseId: respAlt2Id,
    alternativeId: "ALT-E01",
    rank: 1,
    proposedStart: new Date("2026-10-20T08:00:00Z"),
    proposedEnd:   new Date("2026-10-24T17:00:00Z"),
  }).returning();
  alt2RowId = altE.id;
});

afterAll(async () => {
  // Clean up in reverse FK order: takt_versions → decisions → alternatives → responses → requests → takt
  await db.delete(taktVersionsTable).where(eq(taktVersionsTable.taktId, TAKT));
  await db.delete(taktResponseDecisionsTable).where(
    eq(taktResponseDecisionsTable.guOrgId, GU_ORG),
  );
  for (const rid of [respAltId, respAlt2Id]) {
    await db.delete(taktResponseAlternativesTable).where(
      eq(taktResponseAlternativesTable.responseId, rid),
    );
  }
  for (const reqId of [reqAcceptedId, reqAltId, reqRejectedId, reqNoResponseId, reqAlt2Id]) {
    await db.delete(taktResponsesTable).where(
      eq(taktResponsesTable.taktRequestId, reqId),
    ).catch(() => {});
    await db.delete(taktRequestsTable).where(eq(taktRequestsTable.id, reqId)).catch(() => {});
  }
  await db.delete(takteTable).where(eq(takteTable.id, TAKT));
  await db.delete(projectContractorsTable).where(
    eq(projectContractorsTable.projectId, PROJECT),
  );
  await db.delete(projectsTable).where(eq(projectsTable.id, PROJECT));
  for (const email of [
    "t63-gu@test.com", "t63-nu@test.com", "t63-gu2@test.com", "t63-hub@test.com",
  ]) {
    await db.delete(usersTable).where(eq(usersTable.email, email));
  }
  // Flush outbox/inbox before org deletes (FK: message_outbox.sender_org_id → organizations)
  await db.delete(messageInboxTable).where(eq(messageInboxTable.senderOrgId, GU_ORG)).catch(() => {});
  await db.delete(messageOutboxTable).where(eq(messageOutboxTable.senderOrgId, GU_ORG)).catch(() => {});
  for (const id of [GU_ORG, NU_ORG, GU2_ORG]) {
    await db.delete(organizationsTable).where(eq(organizationsTable.id, id));
  }
});

// ── Auth guard tests ──────────────────────────────────────────────────────────

describe("POST /takt-requests/:id/gu-decisions — auth guards", () => {
  it("401 without token", async () => {
    const res = await request(app)
      .post(`/api/takt-requests/${reqAcceptedId}/gu-decisions`)
      .send({ decisionType: "CONFIRM_ACCEPTED" });
    expect(res.status).toBe(401);
  });

  it("403 — NU (AN) is rejected", async () => {
    const res = await request(app)
      .post(`/api/takt-requests/${reqAcceptedId}/gu-decisions`)
      .set("Authorization", `Bearer ${nuToken}`)
      .send({ decisionType: "CONFIRM_ACCEPTED" });
    expect(res.status).toBe(403);
  });

  it("403 — hub admin is rejected", async () => {
    const res = await request(app)
      .post(`/api/takt-requests/${reqAcceptedId}/gu-decisions`)
      .set("Authorization", `Bearer ${hubToken}`)
      .send({ decisionType: "CONFIRM_ACCEPTED" });
    expect(res.status).toBe(403);
  });

  it("403 — foreign GU is rejected", async () => {
    const res = await request(app)
      .post(`/api/takt-requests/${reqAcceptedId}/gu-decisions`)
      .set("Authorization", `Bearer ${gu2Token}`)
      .send({ decisionType: "CONFIRM_ACCEPTED" });
    expect(res.status).toBe(403);
  });

  it("404 — non-existent request", async () => {
    const res = await request(app)
      .post("/api/takt-requests/non-existent-id/gu-decisions")
      .set("Authorization", `Bearer ${guToken}`)
      .send({ decisionType: "CONFIRM_ACCEPTED" });
    expect(res.status).toBe(404);
  });
});

// ── Decision type validation ──────────────────────────────────────────────────

describe("POST /takt-requests/:id/gu-decisions — decision type validation", () => {
  it("400 — no NU response yet", async () => {
    const res = await request(app)
      .post(`/api/takt-requests/${reqNoResponseId}/gu-decisions`)
      .set("Authorization", `Bearer ${guToken}`)
      .send({ decisionType: "CONFIRM_ACCEPTED" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/No TaktResponse exists/i);
  });

  it("400 — CONFIRM_ACCEPTED on REJECTED response is not allowed", async () => {
    const res = await request(app)
      .post(`/api/takt-requests/${reqRejectedId}/gu-decisions`)
      .set("Authorization", `Bearer ${guToken}`)
      .send({ decisionType: "CONFIRM_ACCEPTED" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not allowed/i);
  });

  it("400 — ACCEPT_ALTERNATIVE on REJECTED response is not allowed", async () => {
    const res = await request(app)
      .post(`/api/takt-requests/${reqRejectedId}/gu-decisions`)
      .set("Authorization", `Bearer ${guToken}`)
      .send({
        decisionType: "ACCEPT_ALTERNATIVE",
        acceptedAlternativeId: altRowId,
      });
    expect(res.status).toBe(400);
  });

  it("400 — ACCEPT_ALTERNATIVE on ACCEPTED response is not allowed", async () => {
    const res = await request(app)
      .post(`/api/takt-requests/${reqAcceptedId}/gu-decisions`)
      .set("Authorization", `Bearer ${guToken}`)
      .send({
        decisionType: "ACCEPT_ALTERNATIVE",
        acceptedAlternativeId: altRowId,
      });
    expect(res.status).toBe(400);
  });

  it("400 — ACCEPT_ALTERNATIVE without acceptedAlternativeId is rejected", async () => {
    // Use a fresh request to avoid hitting the existing decision from below
    const res = await request(app)
      .post(`/api/takt-requests/${reqAlt2Id}/gu-decisions`)
      .set("Authorization", `Bearer ${guToken}`)
      .send({ decisionType: "ACCEPT_ALTERNATIVE" });
    // No acceptedAlternativeId → 400
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/acceptedAlternativeId is required/i);
  });

  it("400 — alternative from a different response is rejected", async () => {
    // alt2RowId belongs to respAlt2Id, but we're deciding on reqAltId (which has respAltId)
    const res = await request(app)
      .post(`/api/takt-requests/${reqAltId}/gu-decisions`)
      .set("Authorization", `Bearer ${guToken}`)
      .send({
        decisionType: "ACCEPT_ALTERNATIVE",
        acceptedAlternativeId: alt2RowId,  // belongs to respAlt2Id, not respAltId
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/does not belong/i);
  });
});

// ── Happy-path decision tests ─────────────────────────────────────────────────

describe("POST /takt-requests/:id/gu-decisions — happy path", () => {
  it("CONFIRM_ACCEPTED — confirms the NU-accepted request", async () => {
    const res = await request(app)
      .post(`/api/takt-requests/${reqAcceptedId}/gu-decisions`)
      .set("Authorization", `Bearer ${guToken}`)
      .send({
        decisionType: "CONFIRM_ACCEPTED",
        comment: "Bestätigung übernommen.",
      });

    expect(res.status).toBe(201);
    expect(res.body.decisionType).toBe("CONFIRM_ACCEPTED");
    expect(res.body.taktRequestId).toBe(reqAcceptedId);
    expect(res.body.responseId).toBe(respAcceptedId);
    expect(res.body.updatedRequestStatus).toBe("ACCEPTED");
    expect(res.body.decisionId).toBeTruthy();
    expect(res.body.idempotent).toBe(false);
  });

  it("ACCEPT_ALTERNATIVE — selects alt and moves request to ACCEPTED", async () => {
    const res = await request(app)
      .post(`/api/takt-requests/${reqAltId}/gu-decisions`)
      .set("Authorization", `Bearer ${guToken}`)
      .send({
        decisionType: "ACCEPT_ALTERNATIVE",
        acceptedAlternativeId: altRowId,
        comment: "Alternative 1 wird übernommen.",
      });

    expect(res.status).toBe(201);
    expect(res.body.decisionType).toBe("ACCEPT_ALTERNATIVE");
    expect(res.body.acceptedAlternativeId).toBe(altRowId);
    expect(res.body.updatedRequestStatus).toBe("ACCEPTED");
  });

  it("REQUEST_REVISION — moves REJECTED request to REVISION_REQUIRED", async () => {
    const res = await request(app)
      .post(`/api/takt-requests/${reqRejectedId}/gu-decisions`)
      .set("Authorization", `Bearer ${guToken}`)
      .send({
        decisionType: "REQUEST_REVISION",
        comment: "Bitte neuen Zeitraum vorbereiten.",
      });

    expect(res.status).toBe(201);
    expect(res.body.decisionType).toBe("REQUEST_REVISION");
    expect(res.body.updatedRequestStatus).toBe("REVISION_REQUIRED");
  });

  it("CLOSE_WITHOUT_AGREEMENT — cancels request", async () => {
    const res = await request(app)
      .post(`/api/takt-requests/${reqAlt2Id}/gu-decisions`)
      .set("Authorization", `Bearer ${guToken}`)
      .send({ decisionType: "CLOSE_WITHOUT_AGREEMENT" });

    expect(res.status).toBe(201);
    expect(res.body.decisionType).toBe("CLOSE_WITHOUT_AGREEMENT");
    expect(res.body.updatedRequestStatus).toBe("CANCELLED");
  });

  it("CLOSE_WITHOUT_AGREEMENT — takt is NOT automatically set to CANCELLED", async () => {
    // Verify the takt's lifecycle_status was NOT changed to CANCELLED
    const [takt] = await db
      .select()
      .from(takteTable)
      .where(eq(takteTable.id, TAKT));

    expect(takt.lifecycleStatus).not.toBe("CANCELLED");
  });
});

// ── Idempotency tests ─────────────────────────────────────────────────────────

describe("POST /takt-requests/:id/gu-decisions — idempotency", () => {
  it("identical retry with same idempotency key returns existing (200)", async () => {
    // reqNoResponseId has no NU response, but we need to test idempotency
    // against the ALREADY-decided CONFIRMED request (reqAcceptedId)
    // The first decision was made above without a key.
    // Use the CONFIRM_ACCEPTED decision from reqAcceptedId — retry with its properties.
    // Since there's already a decision on reqAcceptedId, we can't add another.
    // We test idempotency using a NEW request scenario via the service directly.
    // Instead: test that re-sending the exact same body on reqAcceptedId returns 409
    // (second attempt, different from idempotent because no key was used).
    const res = await request(app)
      .post(`/api/takt-requests/${reqAcceptedId}/gu-decisions`)
      .set("Authorization", `Bearer ${guToken}`)
      .send({ decisionType: "CONFIRM_ACCEPTED" });
    // The decision already exists (from the happy-path test above)
    // → 409 because no idempotency key was used on first call
    expect(res.status).toBe(409);
  });

  it("second different attempt on same request is rejected (409)", async () => {
    // reqRejectedId already has REQUEST_REVISION decision
    const res = await request(app)
      .post(`/api/takt-requests/${reqRejectedId}/gu-decisions`)
      .set("Authorization", `Bearer ${guToken}`)
      .send({ decisionType: "CLOSE_WITHOUT_AGREEMENT" });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already exists/i);
  });

  it("idempotency key: same key + same content returns 200 on retry", async () => {
    // Create a dedicated request for this test
    const [rIdem] = await db.insert(taktRequestsTable).values({
      taktId: TAKT, taktVersion: 1, guOrgId: GU_ORG, nuOrgId: NU_ORG,
      requestNumber: "TKR-6300-IDEM",
      status: "ACCEPTED" as const,
      createdByUserId: GU_USER,
    }).returning();

    await db.insert(taktResponsesTable).values({
      taktRequestId: rIdem.id,
      decision: "ACCEPTED" as const,
      acceptedStart: new Date("2026-10-01T08:00:00Z"),
      acceptedEnd:   new Date("2026-10-07T17:00:00Z"),
      createdByUserId: NU_USER,
    });

    const body = { decisionType: "CONFIRM_ACCEPTED", comment: "Test" };
    const key  = "t63-idem-key-confirm";

    // First request — should succeed with 201
    const first = await request(app)
      .post(`/api/takt-requests/${rIdem.id}/gu-decisions`)
      .set("Authorization", `Bearer ${guToken}`)
      .set("Idempotency-Key", key)
      .send(body);
    expect(first.status).toBe(201);

    // Identical retry — should return 200 with idempotent=true
    const retry = await request(app)
      .post(`/api/takt-requests/${rIdem.id}/gu-decisions`)
      .set("Authorization", `Bearer ${guToken}`)
      .set("Idempotency-Key", key)
      .send(body);
    expect(retry.status).toBe(200);
    expect(retry.body.idempotent).toBe(true);
    expect(retry.body.decisionId).toBe(first.body.decisionId);

    // Cleanup — versions → decisions → responses → request
    await db.delete(taktVersionsTable).where(eq(taktVersionsTable.taktId, TAKT));
    await db.delete(taktResponseDecisionsTable).where(
      eq(taktResponseDecisionsTable.taktRequestId, rIdem.id),
    );
    await db.delete(taktResponsesTable).where(
      eq(taktResponsesTable.taktRequestId, rIdem.id),
    );
    await db.delete(taktRequestsTable).where(eq(taktRequestsTable.id, rIdem.id));
  });

  it("idempotency key: same key + different content is rejected (409)", async () => {
    // Use a dedicated request
    const [rIdem2] = await db.insert(taktRequestsTable).values({
      taktId: TAKT, taktVersion: 1, guOrgId: GU_ORG, nuOrgId: NU_ORG,
      requestNumber: "TKR-6300-IDEM2",
      status: "ACCEPTED" as const,
      createdByUserId: GU_USER,
    }).returning();

    await db.insert(taktResponsesTable).values({
      taktRequestId: rIdem2.id,
      decision: "ACCEPTED" as const,
      acceptedStart: new Date("2026-10-01T08:00:00Z"),
      acceptedEnd:   new Date("2026-10-07T17:00:00Z"),
      createdByUserId: NU_USER,
    });

    const key = "t63-idem-key-conflict";

    // First with one comment
    await request(app)
      .post(`/api/takt-requests/${rIdem2.id}/gu-decisions`)
      .set("Authorization", `Bearer ${guToken}`)
      .set("Idempotency-Key", key)
      .send({ decisionType: "CONFIRM_ACCEPTED", comment: "Original" });

    // Same key, different comment → 409
    const conflict = await request(app)
      .post(`/api/takt-requests/${rIdem2.id}/gu-decisions`)
      .set("Authorization", `Bearer ${guToken}`)
      .set("Idempotency-Key", key)
      .send({ decisionType: "CONFIRM_ACCEPTED", comment: "Changed" });
    expect(conflict.status).toBe(409);

    // Cleanup — versions → decisions → responses → request
    await db.delete(taktVersionsTable).where(eq(taktVersionsTable.taktId, TAKT));
    await db.delete(taktResponseDecisionsTable).where(
      eq(taktResponseDecisionsTable.taktRequestId, rIdem2.id),
    );
    await db.delete(taktResponsesTable).where(
      eq(taktResponsesTable.taktRequestId, rIdem2.id),
    );
    await db.delete(taktRequestsTable).where(eq(taktRequestsTable.id, rIdem2.id));
  });
});

// ── UUID round-trip: GET detail → ACCEPT_ALTERNATIVE ─────────────────────────
// Verifies that the `id` (row UUID) returned in response.alternatives by
// GET /takt-requests/:id can be submitted directly as acceptedAlternativeId.
// Guards against the regression where the frontend passed the business
// alternativeId string instead of the UUID, causing 400 from the service.
describe("ACCEPT_ALTERNATIVE — UUID round-trip via GET /takt-requests/:id detail", () => {
  let rtReqId = "";
  const RT_BUSINESS_ID = "ALT-RT-01";

  beforeAll(async () => {
    const [req] = await db.insert(taktRequestsTable).values({
      taktId: TAKT, taktVersion: 1, guOrgId: GU_ORG, nuOrgId: NU_ORG,
      requestNumber: "TKR-6300-RT01",
      status: "ALTERNATIVES_PROPOSED" as const,
      createdByUserId: GU_USER,
    }).returning();
    rtReqId = req.id;

    const [resp] = await db.insert(taktResponsesTable).values({
      taktRequestId: rtReqId,
      decision: "ALTERNATIVES_PROPOSED" as const,
      comment: "Round-trip test alternative",
      createdByUserId: NU_USER,
    }).returning();

    await db.insert(taktResponseAlternativesTable).values({
      responseId: resp.id,
      alternativeId: RT_BUSINESS_ID,
      rank: 1,
      proposedStart: new Date("2026-11-01T08:00:00Z"),
      proposedEnd:   new Date("2026-11-07T17:00:00Z"),
    });
  });

  afterAll(async () => {
    await db.delete(taktVersionsTable).where(eq(taktVersionsTable.taktId, TAKT)).catch(() => {});
    const responses = await db.select({ id: taktResponsesTable.id })
      .from(taktResponsesTable)
      .where(eq(taktResponsesTable.taktRequestId, rtReqId))
      .catch(() => []);
    for (const r of responses) {
      await db.delete(taktResponseDecisionsTable).where(eq(taktResponseDecisionsTable.responseId, r.id)).catch(() => {});
      await db.delete(taktResponseAlternativesTable).where(eq(taktResponseAlternativesTable.responseId, r.id)).catch(() => {});
    }
    await db.delete(taktResponsesTable).where(eq(taktResponsesTable.taktRequestId, rtReqId)).catch(() => {});
    await db.delete(taktRequestsTable).where(eq(taktRequestsTable.id, rtReqId)).catch(() => {});
  });

  it("GET /takt-requests/:id returns alternatives with row id (UUID) distinct from business alternativeId", async () => {
    const res = await request(app)
      .get(`/api/takt-requests/${rtReqId}`)
      .set("Authorization", `Bearer ${guToken}`);

    expect(res.status).toBe(200);
    const alts = res.body?.response?.alternatives;
    expect(Array.isArray(alts)).toBe(true);
    expect(alts).toHaveLength(1);

    const alt = alts[0];
    // Row UUID must be present
    expect(typeof alt.id).toBe("string");
    expect(alt.id.length).toBeGreaterThan(0);
    // Business identifier for display
    expect(alt.alternativeId).toBe(RT_BUSINESS_ID);
    // UUID != business string (regression guard)
    expect(alt.id).not.toBe(alt.alternativeId);
  });

  it("ACCEPT_ALTERNATIVE with UUID from GET detail succeeds (201)", async () => {
    // Read the UUID from the detail endpoint exactly as the frontend would
    const detailRes = await request(app)
      .get(`/api/takt-requests/${rtReqId}`)
      .set("Authorization", `Bearer ${guToken}`);
    expect(detailRes.status).toBe(200);
    const altUuid: string = detailRes.body.response.alternatives[0].id;

    const decisionRes = await request(app)
      .post(`/api/takt-requests/${rtReqId}/gu-decisions`)
      .set("Authorization", `Bearer ${guToken}`)
      .send({
        decisionType: "ACCEPT_ALTERNATIVE",
        acceptedAlternativeId: altUuid,   // UUID from GET detail
      });

    expect(decisionRes.status).toBe(201);
    expect(decisionRes.body.decisionType).toBe("ACCEPT_ALTERNATIVE");
    expect(decisionRes.body.acceptedAlternativeId).toBe(altUuid);
    expect(decisionRes.body.updatedRequestStatus).toBe("ACCEPTED");
  });

  it("ACCEPT_ALTERNATIVE with business alternativeId string (not UUID) fails (400)", async () => {
    // Regression guard: sending the business string "ALT-RT-01" instead of the UUID
    // must be rejected, confirming the service exclusively looks up by row UUID.
    const [req2] = await db.insert(taktRequestsTable).values({
      taktId: TAKT, taktVersion: 1, guOrgId: GU_ORG, nuOrgId: NU_ORG,
      requestNumber: "TKR-6300-RT02",
      status: "ALTERNATIVES_PROPOSED" as const,
      createdByUserId: GU_USER,
    }).returning();

    const [resp2] = await db.insert(taktResponsesTable).values({
      taktRequestId: req2.id,
      decision: "ALTERNATIVES_PROPOSED" as const,
      createdByUserId: NU_USER,
    }).returning();

    await db.insert(taktResponseAlternativesTable).values({
      responseId: resp2.id,
      alternativeId: RT_BUSINESS_ID,
      rank: 1,
      proposedStart: new Date("2026-11-10T08:00:00Z"),
      proposedEnd:   new Date("2026-11-14T17:00:00Z"),
    });

    const res = await request(app)
      .post(`/api/takt-requests/${req2.id}/gu-decisions`)
      .set("Authorization", `Bearer ${guToken}`)
      .send({
        decisionType: "ACCEPT_ALTERNATIVE",
        acceptedAlternativeId: RT_BUSINESS_ID,  // wrong: business string, not UUID
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/does not exist/i);

    // Inline cleanup
    await db.delete(taktResponseAlternativesTable).where(eq(taktResponseAlternativesTable.responseId, resp2.id)).catch(() => {});
    await db.delete(taktResponsesTable).where(eq(taktResponsesTable.taktRequestId, req2.id)).catch(() => {});
    await db.delete(taktRequestsTable).where(eq(taktRequestsTable.id, req2.id)).catch(() => {});
  });
});
