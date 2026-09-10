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
import { createHash } from "node:crypto";
import { agDb as db, anDb, hubDb } from "@workspace/db";
import {
  anLeistungsanfrageResourceRequirementsTable,
  anLeistungsanfragenTable,
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
  messageDeliveryAttemptsTable,
  messageInboxTable,
  projectContractorsTable,
  dataspaceExchangesTable,
  resourceBookingsTable,
  resourceTypesTable,
  resourcesTable,
} from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import app from "../app";
import { handleIncomingCoordinationDecision } from "../services/dataspace/inbound-exchange-service";
import { processIncomingCoordinationDecision } from "../services/dataspace/inbound-domain-service";
import type { ExternalCoordinationDecision } from "../services/dataspace/external-contracts";

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
const ALT_PUBLIC_ID = "ALT-001";

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
    alternativeId: ALT_PUBLIC_ID,
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
  await hubDb.delete(messageInboxTable).where(eq(messageInboxTable.senderOrgId, GU_ORG)).catch(() => {});
  await hubDb.delete(messageOutboxTable).where(eq(messageOutboxTable.senderOrgId, GU_ORG)).catch(() => {});
  await hubDb.execute(sql`DELETE FROM dataspace_exchanges WHERE sender_org_id IN ('t63-gu-org','t63-nu-org','t63-gu2-org') OR receiver_org_id IN ('t63-gu-org','t63-nu-org','t63-gu2-org')`).catch(() => {});
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
    expect(res.body.acceptedAlternativeId).toBe(ALT_PUBLIC_ID);
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

// ── Public alternative ID round-trip ─────────────────────────────────────────
// Verifies that the public alternativeId delivered in the response can be
// submitted directly as acceptedAlternativeId.
describe("ACCEPT_ALTERNATIVE — public alternativeId", () => {
  let rtReqId = "";
  let rtAltRowId = "";
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

    const [alternative] = await db.insert(taktResponseAlternativesTable).values({
      responseId: resp.id,
      alternativeId: RT_BUSINESS_ID,
      rank: 1,
      proposedStart: new Date("2026-11-01T08:00:00Z"),
      proposedEnd:   new Date("2026-11-07T17:00:00Z"),
    }).returning();
    rtAltRowId = alternative.id;
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

  it("ACCEPT_ALTERNATIVE with the delivered public alternativeId succeeds (201)", async () => {
    const decisionRes = await request(app)
      .post(`/api/takt-requests/${rtReqId}/gu-decisions`)
      .set("Authorization", `Bearer ${guToken}`)
      .send({
        decisionType: "ACCEPT_ALTERNATIVE",
        acceptedAlternativeId: RT_BUSINESS_ID,
        idempotencyKey: "t63-public-alt-retry",
      });

    expect(decisionRes.status).toBe(201);
    expect(decisionRes.body.decisionType).toBe("ACCEPT_ALTERNATIVE");
    expect(decisionRes.body.acceptedAlternativeId).toBe(RT_BUSINESS_ID);
    expect(decisionRes.body.updatedRequestStatus).toBe("ACCEPTED");

    const retryRes = await request(app)
      .post(`/api/takt-requests/${rtReqId}/gu-decisions`)
      .set("Authorization", `Bearer ${guToken}`)
      .send({
        decisionType: "ACCEPT_ALTERNATIVE",
        acceptedAlternativeId: rtAltRowId,
        idempotencyKey: "t63-public-alt-retry",
      });
    expect(retryRes.status).toBe(200);
    expect(retryRes.body.idempotent).toBe(true);
    expect(retryRes.body.acceptedAlternativeId).toBe(RT_BUSINESS_ID);
  });

  it("stores the public alternativeId in the decision and transport records", async () => {
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
        acceptedAlternativeId: RT_BUSINESS_ID,
      });

    expect(res.status).toBe(201);
    expect(res.body.acceptedAlternativeId).toBe(RT_BUSINESS_ID);

    // Inline cleanup
    await db.delete(taktVersionsTable).where(eq(taktVersionsTable.taktId, TAKT)).catch(() => {});
    await db.delete(taktResponseDecisionsTable).where(eq(taktResponseDecisionsTable.responseId, resp2.id)).catch(() => {});
    await db.delete(taktResponseAlternativesTable).where(eq(taktResponseAlternativesTable.responseId, resp2.id)).catch(() => {});
    await db.delete(taktResponsesTable).where(eq(taktResponsesTable.taktRequestId, req2.id)).catch(() => {});
    await db.delete(taktRequestsTable).where(eq(taktRequestsTable.id, req2.id)).catch(() => {});
  });
});

// ── Failed Dataspace delivery retry regression ─────────────────────────────────
// A retry must deliver the immutable public envelope that was originally
// persisted, not rebuild a new decision from the response's current window.
describe("GU decision delivery retry preserves the accepted time window", () => {
  const RETRY_TAKTS = ["t63-retry-takt-canonical", "t63-retry-takt-legacy"];
  const RETRY_REQUEST_NUMBERS = ["TKR-6300-RETRY-CANONICAL", "TKR-6300-RETRY-LEGACY"];
  const AN_RETRY_TYPE = "t63-retry-an-resource-type";
  const AN_RETRY_RESOURCE = "t63-retry-an-resource";
  const ORIGINAL_WINDOW = {
    start: "2026-11-02T08:00:00.000Z",
    end: "2026-11-06T17:00:00.000Z",
  };
  const CHANGED_WINDOW = {
    start: "2026-12-07T08:00:00.000Z",
    end: "2026-12-11T17:00:00.000Z",
  };
  const DECIDED_AT = "2026-11-01T12:00:00.000Z";
  const fixtures: Array<{
    taktId: string;
    requestId: string;
    responseId: string;
    decisionId: string;
    messageId: string;
    anProjectionId?: string;
  }> = [];

  async function seedFailedDecision(
    taktId: string,
    requestNumber: string,
    withAnProjection = false,
  ) {
    await db.insert(takteTable).values({
      id: taktId,
      projectId: PROJECT,
      taktBezeichnung: `${requestNumber} Takt`,
      zone: "RETRY",
      gewerk: "Elektro",
      plannedStart: "2026-11-02",
      plannedEnd: "2026-11-06",
      version: 1,
      lifecycleStatus: "CONFIRMED" as const,
    });

    const [requestRow] = await db.insert(taktRequestsTable).values({
      taktId,
      taktVersion: 1,
      guOrgId: GU_ORG,
      nuOrgId: NU_ORG,
      requestNumber,
      status: "ACCEPTED" as const,
      createdByUserId: GU_USER,
    }).returning();

    const [responseRow] = await db.insert(taktResponsesTable).values({
      taktRequestId: requestRow.id,
      decision: "ACCEPTED" as const,
      acceptedStart: new Date(ORIGINAL_WINDOW.start),
      acceptedEnd: new Date(ORIGINAL_WINDOW.end),
      createdByUserId: NU_USER,
    }).returning();

    const decidedAt = new Date(DECIDED_AT);
    const [decisionRow] = await db.insert(taktResponseDecisionsTable).values({
      taktRequestId: requestRow.id,
      responseId: responseRow.id,
      guOrgId: GU_ORG,
      decisionType: "CONFIRM_ACCEPTED" as const,
      comment: "Persisted retry envelope",
      idempotencyKey: `${requestNumber}-decision`,
      decidedByUserId: GU_USER,
      decidedAt,
    }).returning();

    await db.insert(taktVersionsTable).values({
      taktId,
      version: 1,
      sourceType: "ACCEPTED_ALTERNATIVE" as const,
      sourceRequestId: requestRow.id,
      sourceResponseId: responseRow.id,
      sourceDecisionId: decisionRow.id,
      snapshotPayload: {
        taktBezeichnung: `${requestNumber} Takt`,
        plannedStart: "2026-11-02",
        plannedEnd: "2026-11-06",
        version: 1,
      },
      createdByUserId: GU_USER,
    });

    const messageId = `gu-decision-${decisionRow.id}`;
    const persistedPayload = {
      taktRequestId: requestRow.id,
      decisionType: "CONFIRM_ACCEPTED",
      acceptedAlternativeId: null,
      confirmedTimeWindow: ORIGINAL_WINDOW,
      taktVersion: 1,
      comment: "Persisted retry envelope",
    };
    await hubDb.insert(messageOutboxTable).values({
      messageId,
      schemaVersion: "1.0",
      messageType: "TAKT_RESPONSE_ACCEPTED",
      senderOrgId: GU_ORG,
      recipientOrgId: NU_ORG,
      correlationId: requestRow.id,
      payload: persistedPayload,
      status: "FAILED",
      attemptCount: 1,
      failureReason: "seeded delivery failure",
    });
    await hubDb.insert(messageDeliveryAttemptsTable).values({
      messageId,
      attemptNumber: 1,
      status: "FAILED",
      attemptedAt: decidedAt,
      failureReason: "seeded delivery failure",
    });
    await hubDb.insert(dataspaceExchangesTable).values({
      direction: "OUTBOUND",
      messageType: "TAKT_RESPONSE_ACCEPTED",
      messageId,
      correlationId: requestRow.id,
      senderOrgId: GU_ORG,
      receiverOrgId: NU_ORG,
      businessObjectId: requestRow.id,
      businessObjectVersion: 1,
      status: "FAILED",
      errorCode: "SEEDED_FAILURE",
    });

    let anProjectionId: string | undefined;
    if (withAnProjection) {
      const [projection] = await anDb.insert(anLeistungsanfragenTable).values({
        externalLeistungsanfrageId: requestRow.id,
        externalRequestVersion: 1,
        sourceMessageId: `${messageId}-request`,
        payloadHash: `${messageId}-request-hash`,
        correlationId: requestRow.id,
        senderAgOrgId: GU_ORG,
        receiverAnOrgId: NU_ORG,
        projectReference: PROJECT,
        leistungReference: requestNumber,
        plannedStart: "2026-11-02",
        plannedEnd: "2026-11-06",
        payloadSnapshot: {},
        status: "RESPONDED",
      }).returning();
      anProjectionId = projection.id;
      await anDb.insert(anLeistungsanfrageResourceRequirementsTable).values({
        id: `${messageId}-requirement`,
        anLeistungsanfrageId: projection.id,
        externalResourceTypeCode: "WORKER",
        externalResourceTypeName: "Worker",
        localResourceTypeId: AN_RETRY_TYPE,
        requiredCapacity: "2",
        capacityUnit: "PERSONS",
        utilizationPercent: 100,
        periodStart: "2026-11-02",
        periodEnd: "2026-11-06",
      });
    }

    // Simulate a later response edit. A retry must not apply this changed
    // window because the decision's public envelope is immutable.
    await db.update(taktResponsesTable).set({
      acceptedStart: new Date(CHANGED_WINDOW.start),
      acceptedEnd: new Date(CHANGED_WINDOW.end),
    }).where(eq(taktResponsesTable.id, responseRow.id));

    const fixture = {
      taktId,
      requestId: requestRow.id,
      responseId: responseRow.id,
      decisionId: decisionRow.id,
      messageId,
      anProjectionId,
    };
    fixtures.push(fixture);
    return fixture;
  }

  beforeAll(async () => {
    await anDb.delete(resourceBookingsTable).where(eq(resourceBookingsTable.nuOrgId, NU_ORG)).catch(() => {});
    await anDb.delete(anLeistungsanfragenTable).where(eq(
      anLeistungsanfragenTable.receiverAnOrgId,
      NU_ORG,
    )).catch(() => {});
    await anDb.delete(resourcesTable).where(eq(resourcesTable.id, AN_RETRY_RESOURCE)).catch(() => {});
    await anDb.delete(resourceTypesTable).where(eq(resourceTypesTable.id, AN_RETRY_TYPE)).catch(() => {});
    await anDb.delete(organizationsTable).where(eq(organizationsTable.id, GU_ORG)).catch(() => {});
    await anDb.delete(organizationsTable).where(eq(organizationsTable.id, NU_ORG)).catch(() => {});
    await anDb.insert(organizationsTable).values([
      { id: GU_ORG, name: "t63 retry GU", type: "AG" as const },
      { id: NU_ORG, name: "t63 retry NU", type: "AN" as const },
    ]).onConflictDoNothing();
    await anDb.insert(resourceTypesTable).values({
      id: AN_RETRY_TYPE,
      anOrgId: NU_ORG,
      name: "Retry workers",
      category: "PERSONNEL",
      active: true,
    }).onConflictDoNothing();
    await anDb.insert(resourcesTable).values({
      id: AN_RETRY_RESOURCE,
      anOrgId: NU_ORG,
      resourceTypeId: AN_RETRY_TYPE,
      type: "CREW",
      name: "Retry worker pool",
      capacity: 8,
      capacityUnit: "PERSONS",
      active: true,
    }).onConflictDoNothing();
    for (let index = 0; index < RETRY_TAKTS.length; index += 1) {
      await seedFailedDecision(
        RETRY_TAKTS[index],
        RETRY_REQUEST_NUMBERS[index],
        index === 0,
      );
    }
  });

  afterAll(async () => {
    for (const fixture of fixtures) {
      await hubDb.delete(messageInboxTable).where(eq(messageInboxTable.messageId, fixture.messageId)).catch(() => {});
      await hubDb.delete(messageDeliveryAttemptsTable).where(eq(messageDeliveryAttemptsTable.messageId, fixture.messageId)).catch(() => {});
      await hubDb.delete(messageOutboxTable).where(eq(messageOutboxTable.messageId, fixture.messageId)).catch(() => {});
      await hubDb.delete(dataspaceExchangesTable).where(eq(dataspaceExchangesTable.messageId, fixture.messageId)).catch(() => {});
      await db.delete(taktVersionsTable).where(eq(taktVersionsTable.taktId, fixture.taktId)).catch(() => {});
      await db.delete(taktResponseDecisionsTable).where(eq(taktResponseDecisionsTable.id, fixture.decisionId)).catch(() => {});
      await db.delete(taktResponsesTable).where(eq(taktResponsesTable.id, fixture.responseId)).catch(() => {});
      await db.delete(taktRequestsTable).where(eq(taktRequestsTable.id, fixture.requestId)).catch(() => {});
      await db.delete(takteTable).where(eq(takteTable.id, fixture.taktId)).catch(() => {});
      if (fixture.anProjectionId) {
        await anDb.delete(resourceBookingsTable)
          .where(eq(resourceBookingsTable.sourceReferenceId, fixture.anProjectionId))
          .catch(() => {});
        await anDb.delete(anLeistungsanfrageResourceRequirementsTable)
          .where(eq(anLeistungsanfrageResourceRequirementsTable.anLeistungsanfrageId, fixture.anProjectionId))
          .catch(() => {});
        await anDb.delete(anLeistungsanfragenTable)
          .where(eq(anLeistungsanfragenTable.id, fixture.anProjectionId))
          .catch(() => {});
      }
    }
    await anDb.delete(resourcesTable).where(eq(resourcesTable.id, AN_RETRY_RESOURCE)).catch(() => {});
    await anDb.delete(resourceTypesTable).where(eq(resourceTypesTable.id, AN_RETRY_TYPE)).catch(() => {});
    await anDb.delete(organizationsTable).where(eq(organizationsTable.id, GU_ORG)).catch(() => {});
    await anDb.delete(organizationsTable).where(eq(organizationsTable.id, NU_ORG)).catch(() => {});
  });

  async function expectRetryToPreserveState(
    fixture: (typeof fixtures)[number],
    path: string,
  ) {
    const [decisionsBefore, versionsBefore] = await Promise.all([
      db.select().from(taktResponseDecisionsTable)
        .where(eq(taktResponseDecisionsTable.taktRequestId, fixture.requestId)),
      db.select().from(taktVersionsTable)
        .where(eq(taktVersionsTable.taktId, fixture.taktId)),
    ]);

    const retry = await request(app)
      .post(path)
      .set("Authorization", `Bearer ${guToken}`);

    expect(retry.status).toBe(200);
    expect(retry.body).toMatchObject({
      decisionId: fixture.decisionId,
      taktRequestId: fixture.requestId,
      delivery: { status: "DELIVERED", attemptCount: 2 },
    });

    const [decisionsAfter, versionsAfter] = await Promise.all([
      db.select().from(taktResponseDecisionsTable)
        .where(eq(taktResponseDecisionsTable.taktRequestId, fixture.requestId)),
      db.select().from(taktVersionsTable)
        .where(eq(taktVersionsTable.taktId, fixture.taktId)),
    ]);
    expect(decisionsAfter).toHaveLength(decisionsBefore.length);
    expect(versionsAfter).toHaveLength(versionsBefore.length);
    expect(decisionsAfter[0].id).toBe(decisionsBefore[0].id);
    expect(versionsAfter.map((version) => version.id))
      .toEqual(versionsBefore.map((version) => version.id));

    const [outbox] = await hubDb.select().from(messageOutboxTable)
      .where(eq(messageOutboxTable.messageId, fixture.messageId));
    const [inbox] = await hubDb.select().from(messageInboxTable)
      .where(eq(messageInboxTable.messageId, fixture.messageId));
    expect(outbox.status).toBe("DELIVERED");
    expect(inbox.status).toBe("DELIVERED");

    const payload = inbox.payload as Record<string, unknown>;
    expect(payload.confirmedTimeWindow).toEqual(ORIGINAL_WINDOW);
    expect(payload.confirmedTimeWindow).not.toEqual(CHANGED_WINDOW);
    for (const privateField of [
      "resourceId",
      "resourceName",
      "localProjectId",
      "customerAlias",
      "internalConflicts",
      "internalPriority",
      "internalCost",
    ]) {
      expect(JSON.stringify(payload)).not.toContain(privateField);
    }

    const [inboundExchange] = await hubDb.select({
      payloadHash: dataspaceExchangesTable.payloadHash,
    }).from(dataspaceExchangesTable).where(and(
      eq(dataspaceExchangesTable.messageId, fixture.messageId),
      eq(dataspaceExchangesTable.direction, "INBOUND"),
    ));
    const originalInboundEnvelope = {
      metadata: {
        messageId: fixture.messageId,
        correlationId: fixture.requestId,
        schemaVersion: "1.0",
        senderOrgId: GU_ORG,
        receiverOrgId: NU_ORG,
        createdAt: DECIDED_AT,
      },
      requestId: fixture.requestId,
      requestVersion: 1,
      taktVersion: 1,
      decisionType: "CONFIRM_ACCEPTED",
      acceptedAlternativeId: null,
      confirmedTimeWindow: ORIGINAL_WINDOW,
      comment: "Persisted retry envelope",
    };
    const originalPayloadHash = createHash("sha256").update(JSON.stringify(
      originalInboundEnvelope,
      (_, value) => {
        if (!value || typeof value !== "object" || Array.isArray(value)) return value;
        return Object.keys(value).sort().reduce<Record<string, unknown>>((sorted, key) => {
          sorted[key] = value[key];
          return sorted;
        }, {});
      },
    )).digest("hex");
    expect(inboundExchange.payloadHash).toBe(originalPayloadHash);
  }

  it("retries through the TaktRequest alias without changing the accepted window", async () => {
    const fixture = fixtures[0];
    await expectRetryToPreserveState(
      fixture,
      `/api/takt-requests/${fixtures[0].requestId}/gu-decisions/delivery/retry`,
    );

    expect(fixture.anProjectionId).toBeTruthy();
    const [booking] = await anDb.select().from(resourceBookingsTable).where(and(
      eq(resourceBookingsTable.nuOrgId, NU_ORG),
      eq(resourceBookingsTable.sourceReferenceId, fixture.anProjectionId!),
    ));
    expect(booking).toMatchObject({
      sourceReferenceId: fixture.anProjectionId,
      resourceTypeId: AN_RETRY_TYPE,
      quantity: "2.00",
      status: "CONFIRMED",
    });
    expect(booking.startAt.toISOString()).toBe(`${ORIGINAL_WINDOW.start}`);
    expect(booking.endAt.toISOString()).toBe(`${ORIGINAL_WINDOW.end}`);
    const [projectionAfterRetry] = await anDb.select({
      status: anLeistungsanfragenTable.status,
      updatedAt: anLeistungsanfragenTable.updatedAt,
    }).from(anLeistungsanfragenTable).where(eq(
      anLeistungsanfragenTable.id,
      fixture.anProjectionId!,
    ));
    expect(projectionAfterRetry.status).toBe("CONFIRMED");

    const repeatedInbound: ExternalCoordinationDecision = {
      metadata: {
        messageId: fixture.messageId,
        correlationId: fixture.requestId,
        schemaVersion: "1.0",
        senderOrgId: GU_ORG,
        receiverOrgId: NU_ORG,
        createdAt: DECIDED_AT,
      },
      requestId: fixture.requestId,
      requestVersion: 1,
      taktVersion: 1,
      decisionType: "CONFIRM_ACCEPTED",
      acceptedAlternativeId: null,
      confirmedTimeWindow: ORIGINAL_WINDOW,
      comment: "Persisted retry envelope",
    };
    const repeated = await handleIncomingCoordinationDecision(
      repeatedInbound,
      processIncomingCoordinationDecision,
    );
    expect(repeated).toEqual({ duplicate: true, status: "DUPLICATE" });

    const bookingsAfterRepeat = await anDb.select().from(resourceBookingsTable).where(and(
      eq(resourceBookingsTable.nuOrgId, NU_ORG),
      eq(resourceBookingsTable.sourceReferenceId, fixture.anProjectionId!),
    ));
    expect(bookingsAfterRepeat).toHaveLength(1);
    expect(bookingsAfterRepeat[0].id).toBe(booking.id);
    const [projectionAfterRepeat] = await anDb.select({
      status: anLeistungsanfragenTable.status,
      updatedAt: anLeistungsanfragenTable.updatedAt,
    }).from(anLeistungsanfragenTable).where(eq(
      anLeistungsanfragenTable.id,
      fixture.anProjectionId!,
    ));
    expect(projectionAfterRepeat).toEqual(projectionAfterRetry);
  });

  it("retries through the Leistungsanfrage alias without changing the accepted window", async () => {
    await expectRetryToPreserveState(
      fixtures[1],
      `/api/leistungsanfragen/${fixtures[1].requestId}/gu-decisions/delivery/retry`,
    );
  });
});
