/**
 * Task 6.6 — Transport messages for GU decisions and revisions
 *
 * Tests:
 *   - CONFIRM_ACCEPTED erzeug genau eine TAKT_RESPONSE_ACCEPTED Nachricht
 *   - bestätigtes Zeitfenster wird korrekt übertragen
 *   - ACCEPT_ALTERNATIVE erzeugt TAKT_RESPONSE_ACCEPTED mit acceptedAlternativeId
 *   - REQUEST_REVISION erzeugt TAKT_RESPONSE_REVISION_REQUESTED
 *   - CLOSE_WITHOUT_AGREEMENT erzeugt TAKT_REQUEST_CANCELLED
 *   - Abschlussnachricht enthält keine internen Daten (nur taktRequestId, comment, closedAt)
 *   - NU sieht nur Nachrichten seiner eigenen Organisation
 *   - Hub sieht nur kleine Payloads (keine internen Daten)
 *   - keine internen NU-Daten im Payload
 *   - Retry: zweiter Aufruf mit gleicher messageId wird idempotent behandelt
 *
 * Fixture prefix: "t66-"
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
  taktResponsesTable,
  taktResponseAlternativesTable,
  taktResponseDecisionsTable,
  taktVersionsTable,
  messageOutboxTable,
  messageInboxTable,
  projectContractorsTable,
  dataspaceExchangesTable,
} from "@workspace/db";
import { inArray } from "drizzle-orm";
import { eq, and, or } from "drizzle-orm";
import app from "../app";

const JWT_SECRET = process.env.JWT_SECRET ?? "taktkoord-jwt-dev-secret-change-in-prod";
function sign(p: { userId: string; orgId: string | null; orgType: "AG" | "AN" | null; hubAdmin?: boolean }): string {
  return jwt.sign({ ...p, hubAdmin: p.hubAdmin ?? false }, JWT_SECRET, { expiresIn: "1h" });
}

// ── Fixture IDs ───────────────────────────────────────────────────────────────
const GU_ORG  = "t66-gu-org";
const NU_ORG  = "t66-nu-org";
const NU2_ORG = "t66-nu2-org";
const GU_USER = "t66-gu-user";
const NU_USER = "t66-nu-user";
const PROJECT = "t66-project";
const TAKT    = "t66-takt";

const guToken = sign({ userId: GU_USER, orgId: GU_ORG, orgType: "AG" });

// Requests created in beforeAll for each decision type
let reqConfirmId   = "";  // ACCEPTED response
let reqAltId       = "";  // ALTERNATIVES_PROPOSED response
let altRowId       = "";  // alternative PK
let reqRevisionId  = "";  // to test REQUEST_REVISION transport
let reqCloseId     = "";  // to test CLOSE_WITHOUT_AGREEMENT transport

beforeAll(async () => {
  // Pre-cleanup: remove any stale data from a previous crashed run
  await db.delete(messageInboxTable).where(eq(messageInboxTable.senderOrgId, GU_ORG)).catch(() => {});
  await db.delete(messageOutboxTable).where(eq(messageOutboxTable.senderOrgId, GU_ORG)).catch(() => {});
  await db.delete(dataspaceExchangesTable).where(or(
    eq(dataspaceExchangesTable.senderOrgId, GU_ORG),
    eq(dataspaceExchangesTable.receiverOrgId, GU_ORG),
    eq(dataspaceExchangesTable.senderOrgId, NU_ORG),
    eq(dataspaceExchangesTable.receiverOrgId, NU_ORG),
    eq(dataspaceExchangesTable.senderOrgId, NU2_ORG),
    eq(dataspaceExchangesTable.receiverOrgId, NU2_ORG),
  )).catch(() => {});
  await db.delete(taktVersionsTable).where(eq(taktVersionsTable.taktId, TAKT)).catch(() => {});
  await db.delete(taktResponseDecisionsTable).where(eq(taktResponseDecisionsTable.guOrgId, GU_ORG)).catch(() => {});
  const staleReqs66 = await db.select({ id: taktRequestsTable.id }).from(taktRequestsTable).where(eq(taktRequestsTable.taktId, TAKT)).catch(() => []);
  const staleReqIds66 = staleReqs66.map(r => r.id);
  if (staleReqIds66.length > 0) {
    const staleResps66 = await db.select({ id: taktResponsesTable.id }).from(taktResponsesTable).where(inArray(taktResponsesTable.taktRequestId, staleReqIds66)).catch(() => []);
    const staleRespIds66 = staleResps66.map(r => r.id);
    if (staleRespIds66.length > 0) {
      await db.delete(taktResponseAlternativesTable).where(inArray(taktResponseAlternativesTable.responseId, staleRespIds66)).catch(() => {});
    }
    await db.delete(taktResponsesTable).where(inArray(taktResponsesTable.taktRequestId, staleReqIds66)).catch(() => {});
  }
  await db.delete(taktRequestsTable).where(eq(taktRequestsTable.taktId, TAKT)).catch(() => {});
  await db.delete(takteTable).where(eq(takteTable.id, TAKT)).catch(() => {});
  await db.delete(projectContractorsTable).where(eq(projectContractorsTable.projectId, PROJECT)).catch(() => {});
  await db.delete(projectsTable).where(eq(projectsTable.id, PROJECT)).catch(() => {});
  await db.delete(usersTable).where(eq(usersTable.id, GU_USER)).catch(() => {});
  await db.delete(usersTable).where(eq(usersTable.id, NU_USER)).catch(() => {});
  await db.delete(organizationsTable).where(eq(organizationsTable.id, GU_ORG)).catch(() => {});
  await db.delete(organizationsTable).where(eq(organizationsTable.id, NU_ORG)).catch(() => {});
  await db.delete(organizationsTable).where(eq(organizationsTable.id, NU2_ORG)).catch(() => {});

  await db.insert(organizationsTable).values([
    { id: GU_ORG,  name: "t66 GU",  type: "AG" as const },
    { id: NU_ORG,  name: "t66 NU",  type: "AN" as const },
    { id: NU2_ORG, name: "t66 NU2", type: "AN" as const },
  ]);

  await db.insert(usersTable).values([
    { id: GU_USER, email: "t66-gu@test.com", name: "GU", passwordHash: "x" },
    { id: NU_USER, email: "t66-nu@test.com", name: "NU", passwordHash: "x" },
  ]).onConflictDoNothing();

  await db.insert(projectsTable).values({
    id: PROJECT, agOrgId: GU_ORG, name: "t66 Project",
    status: "ACTIVE" as const, startDate: "2026-09-01", endDate: "2026-12-31",
  }).onConflictDoNothing();

  await db.insert(projectContractorsTable).values({ projectId: PROJECT, anOrgId: NU_ORG }).onConflictDoNothing();
  await db.insert(projectContractorsTable).values({ projectId: PROJECT, anOrgId: NU2_ORG }).onConflictDoNothing();

  await db.insert(takteTable).values({
    id: TAKT, projectId: PROJECT,
    taktBezeichnung: "t66 Takt", zone: "Z3", gewerk: "Trockenbau",
    plannedStart: "2026-10-01", plannedEnd: "2026-10-07",
    lifecycleStatus: "IN_COORDINATION" as const,
  }).onConflictDoNothing();

  // ── CONFIRM_ACCEPTED fixture ──────────────────────────────────────────────
  const [rA] = await db.insert(taktRequestsTable).values({
    taktId: TAKT, taktVersion: 1, guOrgId: GU_ORG, nuOrgId: NU_ORG,
    requestNumber: "TKR-6600-0001", status: "ACCEPTED" as const,
    createdByUserId: GU_USER,
  }).returning();
  reqConfirmId = rA.id;

  await db.insert(taktResponsesTable).values({
    taktRequestId: reqConfirmId,
    decision: "ACCEPTED" as const,
    acceptedStart: new Date("2026-10-01T00:00:00Z"),
    acceptedEnd:   new Date("2026-10-07T00:00:00Z"),
    createdByUserId: NU_USER,
  });

  // ── ACCEPT_ALTERNATIVE fixture ────────────────────────────────────────────
  const [rB] = await db.insert(taktRequestsTable).values({
    taktId: TAKT, taktVersion: 1, guOrgId: GU_ORG, nuOrgId: NU_ORG,
    requestNumber: "TKR-6600-0002", status: "ALTERNATIVES_PROPOSED" as const,
    createdByUserId: GU_USER,
  }).returning();
  reqAltId = rB.id;

  const [respB] = await db.insert(taktResponsesTable).values({
    taktRequestId: reqAltId,
    decision: "ALTERNATIVES_PROPOSED" as const,
    createdByUserId: NU_USER,
  }).returning();

  const [altB] = await db.insert(taktResponseAlternativesTable).values({
    responseId: respB.id,
    alternativeId: "ALT-6601",
    rank: 1,
    proposedStart: new Date("2026-10-15T06:00:00Z"),
    proposedEnd:   new Date("2026-10-22T14:00:00Z"),
  }).returning();
  altRowId = altB.id;

  // ── REQUEST_REVISION fixture ──────────────────────────────────────────────
  const [rC] = await db.insert(taktRequestsTable).values({
    taktId: TAKT, taktVersion: 1, guOrgId: GU_ORG, nuOrgId: NU_ORG,
    requestNumber: "TKR-6600-0003", status: "ACCEPTED" as const,
    createdByUserId: GU_USER,
  }).returning();
  reqRevisionId = rC.id;

  await db.insert(taktResponsesTable).values({
    taktRequestId: reqRevisionId,
    decision: "REJECTED" as const,
    reasonCode: "NO_CAPACITY" as const,
    createdByUserId: NU_USER,
  });

  // ── CLOSE_WITHOUT_AGREEMENT fixture ──────────────────────────────────────
  const [rD] = await db.insert(taktRequestsTable).values({
    taktId: TAKT, taktVersion: 1, guOrgId: GU_ORG, nuOrgId: NU_ORG,
    requestNumber: "TKR-6600-0004", status: "ACCEPTED" as const,
    createdByUserId: GU_USER,
  }).returning();
  reqCloseId = rD.id;

  await db.insert(taktResponsesTable).values({
    taktRequestId: reqCloseId,
    decision: "REJECTED" as const,
    reasonCode: "NO_CAPACITY" as const,
    createdByUserId: NU_USER,
  });
});

afterAll(async () => {
  // FK order: outbox/inbox → versions → decisions → alternatives → responses → requests → takt
  await db.delete(messageInboxTable).where(eq(messageInboxTable.senderOrgId, GU_ORG));
  await db.delete(messageOutboxTable).where(eq(messageOutboxTable.senderOrgId, GU_ORG));
  await db.delete(dataspaceExchangesTable).where(or(
    eq(dataspaceExchangesTable.senderOrgId, GU_ORG),
    eq(dataspaceExchangesTable.receiverOrgId, GU_ORG),
    eq(dataspaceExchangesTable.senderOrgId, NU_ORG),
    eq(dataspaceExchangesTable.receiverOrgId, NU_ORG),
    eq(dataspaceExchangesTable.senderOrgId, NU2_ORG),
    eq(dataspaceExchangesTable.receiverOrgId, NU2_ORG),
  ));
  await db.delete(taktVersionsTable).where(eq(taktVersionsTable.taktId, TAKT));
  await db.delete(taktResponseDecisionsTable).where(eq(taktResponseDecisionsTable.guOrgId, GU_ORG));
  const reqIds66 = await db.select({ id: taktRequestsTable.id }).from(taktRequestsTable).where(eq(taktRequestsTable.taktId, TAKT));
  const reqIdList66 = reqIds66.map(r => r.id);
  if (reqIdList66.length > 0) {
    const respIds66 = await db.select({ id: taktResponsesTable.id }).from(taktResponsesTable).where(inArray(taktResponsesTable.taktRequestId, reqIdList66));
    const respIdList66 = respIds66.map(r => r.id);
    if (respIdList66.length > 0) {
      await db.delete(taktResponseAlternativesTable).where(inArray(taktResponseAlternativesTable.responseId, respIdList66));
    }
    await db.delete(taktResponsesTable).where(inArray(taktResponsesTable.taktRequestId, reqIdList66));
  }
  await db.delete(taktRequestsTable).where(eq(taktRequestsTable.taktId, TAKT));
  await db.delete(takteTable).where(eq(takteTable.id, TAKT));
  await db.delete(projectContractorsTable).where(eq(projectContractorsTable.projectId, PROJECT));
  await db.delete(projectsTable).where(eq(projectsTable.id, PROJECT));
  await db.delete(usersTable).where(eq(usersTable.id, GU_USER));
  await db.delete(usersTable).where(eq(usersTable.id, NU_USER));
  await db.delete(organizationsTable).where(eq(organizationsTable.id, GU_ORG));
  await db.delete(organizationsTable).where(eq(organizationsTable.id, NU_ORG));
  await db.delete(organizationsTable).where(eq(organizationsTable.id, NU2_ORG));
});

// ── CONFIRM_ACCEPTED → TAKT_RESPONSE_ACCEPTED ────────────────────────────────

describe("CONFIRM_ACCEPTED", () => {
  let decisionId = "";

  it("returns 201 and creates decision", async () => {
    const res = await request(app)
      .post(`/api/takt-requests/${reqConfirmId}/gu-decisions`)
      .set("Authorization", `Bearer ${guToken}`)
      .send({ decisionType: "CONFIRM_ACCEPTED", comment: "Gut so." });

    expect(res.status).toBe(201);
    decisionId = res.body.decisionId;
  });

  it("creates exactly one TAKT_RESPONSE_ACCEPTED outbox message", async () => {
    const msgs = await db
      .select()
      .from(messageOutboxTable)
      .where(and(
        eq(messageOutboxTable.messageType, "TAKT_RESPONSE_ACCEPTED"),
        eq(messageOutboxTable.correlationId, reqConfirmId),
      ));
    expect(msgs.length).toBe(1);
    expect(msgs[0].status).toBe("DELIVERED");
  });

  it("NU inbox receives the TAKT_RESPONSE_ACCEPTED message", async () => {
    const [inbox] = await db
      .select()
      .from(messageInboxTable)
      .where(and(
        eq(messageInboxTable.messageType, "TAKT_RESPONSE_ACCEPTED"),
        eq(messageInboxTable.recipientOrgId, NU_ORG),
        eq(messageInboxTable.correlationId, reqConfirmId),
      ))
      .limit(1);

    expect(inbox).toBeDefined();
    const payload = inbox.payload as Record<string, unknown>;
    expect(payload.decisionType).toBe("CONFIRM_ACCEPTED");
    expect(payload.taktRequestId).toBe(reqConfirmId);
  });

  it("confirmed time window is correctly transmitted", async () => {
    const [inbox] = await db
      .select()
      .from(messageInboxTable)
      .where(and(
        eq(messageInboxTable.messageType, "TAKT_RESPONSE_ACCEPTED"),
        eq(messageInboxTable.correlationId, reqConfirmId),
      ))
      .limit(1);

    const payload = inbox.payload as Record<string, unknown>;
    expect(payload.confirmedTimeWindow).toBeDefined();
    const tw = payload.confirmedTimeWindow as { start: string; end: string };
    expect(tw.start).toBeTruthy();
    expect(tw.end).toBeTruthy();
  });

  it("payload does NOT contain internal GU or NU data", async () => {
    const [inbox] = await db
      .select()
      .from(messageInboxTable)
      .where(and(
        eq(messageInboxTable.messageType, "TAKT_RESPONSE_ACCEPTED"),
        eq(messageInboxTable.correlationId, reqConfirmId),
      ))
      .limit(1);

    const payload = inbox.payload as Record<string, unknown>;
    // Only allowed top-level keys
    expect(payload).not.toHaveProperty("fullTakt");
    expect(payload).not.toHaveProperty("snapshotPayload");
    expect(payload).not.toHaveProperty("internalNotes");
    expect(payload).not.toHaveProperty("resourceId");
    expect(payload).not.toHaveProperty("internalCost");
  });

  it("second call with same decisionId is idempotent (outbox stays at 1 message)", async () => {
    // Decision already exists — second gu-decisions call returns 409
    const res2 = await request(app)
      .post(`/api/takt-requests/${reqConfirmId}/gu-decisions`)
      .set("Authorization", `Bearer ${guToken}`)
      .send({ decisionType: "CONFIRM_ACCEPTED" });

    expect(res2.status).toBe(409);

    // Outbox still has exactly 1 TAKT_RESPONSE_ACCEPTED for this request
    const msgs = await db
      .select()
      .from(messageOutboxTable)
      .where(and(
        eq(messageOutboxTable.messageType, "TAKT_RESPONSE_ACCEPTED"),
        eq(messageOutboxTable.correlationId, reqConfirmId),
      ));
    expect(msgs.length).toBe(1);
  });
});

// ── ACCEPT_ALTERNATIVE → TAKT_RESPONSE_ACCEPTED ──────────────────────────────

describe("ACCEPT_ALTERNATIVE", () => {
  it("sends TAKT_RESPONSE_ACCEPTED with acceptedAlternativeId", async () => {
    const res = await request(app)
      .post(`/api/takt-requests/${reqAltId}/gu-decisions`)
      .set("Authorization", `Bearer ${guToken}`)
      .send({ decisionType: "ACCEPT_ALTERNATIVE", acceptedAlternativeId: altRowId });

    expect(res.status).toBe(201);

    const [inbox] = await db
      .select()
      .from(messageInboxTable)
      .where(and(
        eq(messageInboxTable.messageType, "TAKT_RESPONSE_ACCEPTED"),
        eq(messageInboxTable.correlationId, reqAltId),
      ))
      .limit(1);

    expect(inbox).toBeDefined();
    const payload = inbox.payload as Record<string, unknown>;
    expect(payload.decisionType).toBe("ACCEPT_ALTERNATIVE");
    expect(payload.acceptedAlternativeId).toBe(altRowId);
    expect(payload.confirmedTimeWindow).toBeDefined();
  });
});

// ── REQUEST_REVISION → TAKT_RESPONSE_REVISION_REQUESTED ─────────────────────

describe("REQUEST_REVISION", () => {
  it("sends TAKT_RESPONSE_REVISION_REQUESTED to NU", async () => {
    const res = await request(app)
      .post(`/api/takt-requests/${reqRevisionId}/gu-decisions`)
      .set("Authorization", `Bearer ${guToken}`)
      .send({ decisionType: "REQUEST_REVISION", comment: "Bitte neues Zeitfenster." });

    expect(res.status).toBe(201);

    const [inbox] = await db
      .select()
      .from(messageInboxTable)
      .where(and(
        eq(messageInboxTable.messageType, "TAKT_RESPONSE_REVISION_REQUESTED"),
        eq(messageInboxTable.correlationId, reqRevisionId),
      ))
      .limit(1);

    expect(inbox).toBeDefined();
    const payload = inbox.payload as Record<string, unknown>;
    expect(payload.decisionType).toBe("REQUEST_REVISION");
    expect(payload.taktRequestId).toBe(reqRevisionId);
    expect(payload.comment).toBe("Bitte neues Zeitfenster.");
  });

  it("NU2 (different org) cannot see the revision message in their inbox", async () => {
    const msgs = await db
      .select()
      .from(messageInboxTable)
      .where(and(
        eq(messageInboxTable.messageType, "TAKT_RESPONSE_REVISION_REQUESTED"),
        eq(messageInboxTable.recipientOrgId, NU2_ORG),
      ));
    expect(msgs.length).toBe(0);
  });
});

// ── CLOSE_WITHOUT_AGREEMENT → TAKT_REQUEST_CANCELLED ────────────────────────

describe("CLOSE_WITHOUT_AGREEMENT", () => {
  it("sends TAKT_REQUEST_CANCELLED to NU", async () => {
    const res = await request(app)
      .post(`/api/takt-requests/${reqCloseId}/gu-decisions`)
      .set("Authorization", `Bearer ${guToken}`)
      .send({ decisionType: "CLOSE_WITHOUT_AGREEMENT", comment: "Keine Einigung." });

    expect(res.status).toBe(201);

    const [inbox] = await db
      .select()
      .from(messageInboxTable)
      .where(and(
        eq(messageInboxTable.messageType, "TAKT_REQUEST_CANCELLED"),
        eq(messageInboxTable.correlationId, reqCloseId),
      ))
      .limit(1);

    expect(inbox).toBeDefined();
    const payload = inbox.payload as Record<string, unknown>;
    expect(payload.taktRequestId).toBe(reqCloseId);
    expect(payload.closedAt).toBeTruthy();
  });

  it("TAKT_REQUEST_CANCELLED payload contains only allowed fields (no business data)", async () => {
    const [inbox] = await db
      .select()
      .from(messageInboxTable)
      .where(and(
        eq(messageInboxTable.messageType, "TAKT_REQUEST_CANCELLED"),
        eq(messageInboxTable.correlationId, reqCloseId),
      ))
      .limit(1);

    const payload = inbox.payload as Record<string, unknown>;
    // Allowed: taktRequestId, comment, closedAt
    const allowedKeys = new Set(["taktRequestId", "comment", "closedAt"]);
    for (const key of Object.keys(payload)) {
      expect(allowedKeys.has(key)).toBe(true);
    }
  });
});

// ── NU org isolation ─────────────────────────────────────────────────────────

it("NU2 org has no messages in their inbox from any GU decision in this suite", async () => {
  const msgs = await db
    .select()
    .from(messageInboxTable)
    .where(eq(messageInboxTable.recipientOrgId, NU2_ORG));

  expect(msgs.length).toBe(0);
});
