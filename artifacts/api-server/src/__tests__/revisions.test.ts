/**
 * Task 6.5 — POST /takt-requests/:id/revisions
 *
 * Tests:
 *   - neue Revision erzeugt Taktversion n+1
 *   - neue Taktanfrage verweist auf neue Version
 *   - alte Anfrage wird SUPERSEDED
 *   - neuer Snapshot ist unveränderlich (vorhanden)
 *   - Vorgängerkette ist vollständig
 *   - sofortiger Versand → TAKT_REQUEST_REVISED gesendet
 *   - nicht autorisierter GU wird abgelehnt (403)
 *   - Anfrage ohne REVISION_REQUIRED Status wird abgelehnt (409)
 *   - Anfrage ohne GU REQUEST_REVISION Entscheidung wird abgelehnt (400)
 *   - Nachfolgeanfrage bereits vorhanden → 409
 *   - parallele Revisionen: zweite Revision nach abgeschlossener erster wird abgelehnt
 *
 * Fixture prefix: "t65-"
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
  taktRequestSnapshotsTable,
  taktResponsesTable,
  taktResponseDecisionsTable,
  taktVersionsTable,
  messageInboxTable,
  messageOutboxTable,
  projectContractorsTable,
} from "@workspace/db";
import { eq, and, inArray } from "drizzle-orm";
import app from "../app";

const JWT_SECRET = process.env.JWT_SECRET ?? "taktkoord-jwt-dev-secret-change-in-prod";
function sign(p: { userId: string; orgId: string | null; orgType: "AG" | "AN" | null; hubAdmin?: boolean }): string {
  return jwt.sign({ ...p, hubAdmin: p.hubAdmin ?? false }, JWT_SECRET, { expiresIn: "1h" });
}

// ── Fixture IDs ───────────────────────────────────────────────────────────────
const GU_ORG   = "t65-gu-org";
const GU2_ORG  = "t65-gu2-org";
const NU_ORG   = "t65-nu-org";
const GU_USER  = "t65-gu-user";
const GU2_USER = "t65-gu2-user";
const NU_USER  = "t65-nu-user";
const PROJECT  = "t65-project";
const TAKT     = "t65-takt";

const guToken  = sign({ userId: GU_USER,  orgId: GU_ORG,  orgType: "AG" });
const gu2Token = sign({ userId: GU2_USER, orgId: GU2_ORG, orgType: "AG" });
const nuToken  = sign({ userId: NU_USER,  orgId: NU_ORG,  orgType: "AN" });

let revReqId      = "";  // request in REVISION_REQUIRED with REQUEST_REVISION decision
let wrongStatusId = "";  // request in DRAFT (not REVISION_REQUIRED)
let noDecisionId  = "";  // request in REVISION_REQUIRED but NO GU decision
let taktVersion   = 1;

beforeAll(async () => {
  // Pre-cleanup: remove any stale data from a previous crashed run
  await db.delete(messageInboxTable).where(eq(messageInboxTable.senderOrgId, GU_ORG)).catch(() => {});
  await db.delete(messageOutboxTable).where(eq(messageOutboxTable.senderOrgId, GU_ORG)).catch(() => {});
  await db.delete(taktVersionsTable).where(eq(taktVersionsTable.taktId, TAKT)).catch(() => {});
  await db.delete(taktResponseDecisionsTable).where(eq(taktResponseDecisionsTable.guOrgId, GU_ORG)).catch(() => {});
  const staleReqs65 = await db.select({ id: taktRequestsTable.id }).from(taktRequestsTable).where(eq(taktRequestsTable.taktId, TAKT)).catch(() => []);
  const staleReqIds65 = staleReqs65.map(r => r.id);
  if (staleReqIds65.length > 0) {
    const { inArray } = await import("drizzle-orm");
    await db.delete(taktResponsesTable).where(inArray(taktResponsesTable.taktRequestId, staleReqIds65)).catch(() => {});
    await db.delete(taktRequestSnapshotsTable).where(inArray(taktRequestSnapshotsTable.taktRequestId, staleReqIds65)).catch(() => {});
  }
  await db.delete(taktRequestsTable).where(eq(taktRequestsTable.taktId, TAKT)).catch(() => {});
  await db.delete(takteTable).where(eq(takteTable.id, TAKT)).catch(() => {});
  await db.delete(projectContractorsTable).where(eq(projectContractorsTable.projectId, PROJECT)).catch(() => {});
  await db.delete(projectsTable).where(eq(projectsTable.id, PROJECT)).catch(() => {});
  await db.delete(usersTable).where(eq(usersTable.id, GU_USER)).catch(() => {});
  await db.delete(usersTable).where(eq(usersTable.id, GU2_USER)).catch(() => {});
  await db.delete(usersTable).where(eq(usersTable.id, NU_USER)).catch(() => {});
  await db.delete(organizationsTable).where(eq(organizationsTable.id, GU_ORG)).catch(() => {});
  await db.delete(organizationsTable).where(eq(organizationsTable.id, GU2_ORG)).catch(() => {});
  await db.delete(organizationsTable).where(eq(organizationsTable.id, NU_ORG)).catch(() => {});

  await db.insert(organizationsTable).values([
    { id: GU_ORG,  name: "t65 GU",  type: "AG" as const },
    { id: GU2_ORG, name: "t65 GU2", type: "AG" as const },
    { id: NU_ORG,  name: "t65 NU",  type: "AN" as const },
  ]);

  await db.insert(usersTable).values([
    { id: GU_USER,  email: "t65-gu@test.com",  name: "GU",  passwordHash: "x" },
    { id: GU2_USER, email: "t65-gu2@test.com", name: "GU2", passwordHash: "x" },
    { id: NU_USER,  email: "t65-nu@test.com",  name: "NU",  passwordHash: "x" },
  ]).onConflictDoNothing();

  await db.insert(projectsTable).values({
    id: PROJECT, agOrgId: GU_ORG, name: "t65 Project",
    status: "ACTIVE" as const, startDate: "2026-09-01", endDate: "2026-12-31",
  }).onConflictDoNothing();

  await db.insert(projectContractorsTable).values({ projectId: PROJECT, anOrgId: NU_ORG }).onConflictDoNothing();

  await db.insert(takteTable).values({
    id: TAKT, projectId: PROJECT,
    taktBezeichnung: "t65 Takt", zone: "Z2", gewerk: "Beton",
    plannedStart: "2026-11-01", plannedEnd: "2026-11-07",
    lifecycleStatus: "IN_COORDINATION" as const,
  }).onConflictDoNothing();

  const [taktRow] = await db.select().from(takteTable).where(eq(takteTable.id, TAKT)).limit(1);
  taktVersion = taktRow.version;

  // ── Main revision fixture ─────────────────────────────────────────────────
  const [rA] = await db.insert(taktRequestsTable).values({
    taktId: TAKT, taktVersion: taktVersion, guOrgId: GU_ORG, nuOrgId: NU_ORG,
    requestNumber: "TKR-6500-0001", status: "REVISION_REQUIRED" as const,
    createdByUserId: GU_USER,
  }).returning();
  revReqId = rA.id;

  const [respA] = await db.insert(taktResponsesTable).values({
    taktRequestId: revReqId,
    decision: "REJECTED" as const,
    reasonCode: "NO_CAPACITY" as const,
    createdByUserId: NU_USER,
  }).returning();

  await db.insert(taktResponseDecisionsTable).values({
    taktRequestId: revReqId,
    responseId: respA.id,
    guOrgId: GU_ORG,
    decisionType: "REQUEST_REVISION" as const,
    decidedByUserId: GU_USER,
    decidedAt: new Date(),
  });

  // ── Wrong status fixture ─────────────────────────────────────────────────
  const [rB] = await db.insert(taktRequestsTable).values({
    taktId: TAKT, taktVersion: taktVersion, guOrgId: GU_ORG, nuOrgId: NU_ORG,
    requestNumber: "TKR-6500-0002", status: "DRAFT" as const,
    createdByUserId: GU_USER,
  }).returning();
  wrongStatusId = rB.id;

  // ── No decision fixture ───────────────────────────────────────────────────
  const [rC] = await db.insert(taktRequestsTable).values({
    taktId: TAKT, taktVersion: taktVersion, guOrgId: GU_ORG, nuOrgId: NU_ORG,
    requestNumber: "TKR-6500-0003", status: "REVISION_REQUIRED" as const,
    createdByUserId: GU_USER,
  }).returning();
  noDecisionId = rC.id;

  await db.insert(taktResponsesTable).values({
    taktRequestId: noDecisionId,
    decision: "REJECTED" as const,
    reasonCode: "NO_CAPACITY" as const,
    createdByUserId: NU_USER,
  });
  // No GU decision inserted for rC intentionally
});

afterAll(async () => {
  // FK order: outbox/inbox → versions → decisions → responses → snapshots → requests → takt
  await db.delete(messageInboxTable).where(eq(messageInboxTable.senderOrgId, GU_ORG));
  await db.delete(messageOutboxTable).where(eq(messageOutboxTable.senderOrgId, GU_ORG));
  await db.delete(taktVersionsTable).where(eq(taktVersionsTable.taktId, TAKT));
  await db.delete(taktResponseDecisionsTable).where(eq(taktResponseDecisionsTable.guOrgId, GU_ORG));
  const reqIds65 = await db.select({ id: taktRequestsTable.id }).from(taktRequestsTable).where(eq(taktRequestsTable.taktId, TAKT));
  const reqIdList65 = reqIds65.map(r => r.id);
  if (reqIdList65.length > 0) {
    await db.delete(taktResponsesTable).where(inArray(taktResponsesTable.taktRequestId, reqIdList65));
    await db.delete(taktRequestSnapshotsTable).where(inArray(taktRequestSnapshotsTable.taktRequestId, reqIdList65));
  }
  await db.delete(taktRequestsTable).where(eq(taktRequestsTable.taktId, TAKT));
  await db.delete(takteTable).where(eq(takteTable.id, TAKT));
  await db.delete(projectContractorsTable).where(eq(projectContractorsTable.projectId, PROJECT));
  await db.delete(projectsTable).where(eq(projectsTable.id, PROJECT));
  await db.delete(usersTable).where(eq(usersTable.id, GU_USER));
  await db.delete(usersTable).where(eq(usersTable.id, GU2_USER));
  await db.delete(usersTable).where(eq(usersTable.id, NU_USER));
  await db.delete(organizationsTable).where(eq(organizationsTable.id, GU_ORG));
  await db.delete(organizationsTable).where(eq(organizationsTable.id, GU2_ORG));
  await db.delete(organizationsTable).where(eq(organizationsTable.id, NU_ORG));
});

// ── Guard tests ───────────────────────────────────────────────────────────────

it("rejects unauthorized GU (403)", async () => {
  const res = await request(app)
    .post(`/api/takt-requests/${revReqId}/revisions`)
    .set("Authorization", `Bearer ${gu2Token}`)
    .send({ plannedTimeWindow: { start: "2026-11-15", end: "2026-11-21" } });
  expect(res.status).toBe(403);
});

it("rejects NU caller (403)", async () => {
  const res = await request(app)
    .post(`/api/takt-requests/${revReqId}/revisions`)
    .set("Authorization", `Bearer ${nuToken}`)
    .send({ plannedTimeWindow: { start: "2026-11-15", end: "2026-11-21" } });
  expect(res.status).toBe(403);
});

it("rejects request not in REVISION_REQUIRED (409)", async () => {
  const res = await request(app)
    .post(`/api/takt-requests/${wrongStatusId}/revisions`)
    .set("Authorization", `Bearer ${guToken}`)
    .send({ plannedTimeWindow: { start: "2026-11-15", end: "2026-11-21" } });
  expect(res.status).toBe(409);
  expect(res.body.error).toContain("DRAFT");
});

it("rejects request with no REQUEST_REVISION decision (400)", async () => {
  const res = await request(app)
    .post(`/api/takt-requests/${noDecisionId}/revisions`)
    .set("Authorization", `Bearer ${guToken}`)
    .send({ plannedTimeWindow: { start: "2026-11-15", end: "2026-11-21" } });
  expect(res.status).toBe(400);
  expect(res.body.error).toContain("REQUEST_REVISION");
});

it("rejects unknown request (404)", async () => {
  const res = await request(app)
    .post("/api/takt-requests/nonexistent-t65/revisions")
    .set("Authorization", `Bearer ${guToken}`)
    .send({ plannedTimeWindow: { start: "2026-11-15", end: "2026-11-21" } });
  expect(res.status).toBe(404);
});

// ── Happy path ────────────────────────────────────────────────────────────────

describe("Happy path — new revision (sendImmediately=false)", () => {
  let result: Record<string, unknown>;

  it("returns 201 with new request and version details", async () => {
    const res = await request(app)
      .post(`/api/takt-requests/${revReqId}/revisions`)
      .set("Authorization", `Bearer ${guToken}`)
      .send({
        plannedTimeWindow: { start: "2026-11-15", end: "2026-11-22" },
        subject: "Überarbeitete Planung",
        message: "Bitte neues Zeitfenster prüfen.",
        sendImmediately: false,
      });

    expect(res.status).toBe(201);
    result = res.body;
    expect(result.oldRequestId).toBe(revReqId);
    expect(result.oldRequestStatus).toBe("SUPERSEDED");
    expect(result.newRequestId).toBeTruthy();
    expect(result.newRequestStatus).toBe("DRAFT");
    expect(result.sent).toBe(false);
    expect(typeof result.newTaktVersion).toBe("number");
    expect((result.newTaktVersion as number)).toBeGreaterThan(taktVersion);
  });

  it("creates takt version n+1 in takt_versions", async () => {
    const [ver] = await db
      .select()
      .from(taktVersionsTable)
      .where(eq(taktVersionsTable.id, result.newTaktVersionId as string))
      .limit(1);

    expect(ver).toBeDefined();
    expect(ver.sourceType).toBe("REVISION");
    expect(ver.version).toBe(result.newTaktVersion);
    expect(ver.sourceRequestId).toBe(revReqId);
  });

  it("new request references the new takt version", async () => {
    const [newReq] = await db
      .select()
      .from(taktRequestsTable)
      .where(eq(taktRequestsTable.id, result.newRequestId as string))
      .limit(1);

    expect(newReq.taktVersion).toBe(result.newTaktVersion);
    expect(newReq.supersedesRequestId).toBe(revReqId);
  });

  it("old request is set to SUPERSEDED", async () => {
    const [old] = await db
      .select()
      .from(taktRequestsTable)
      .where(eq(taktRequestsTable.id, revReqId))
      .limit(1);

    expect(old.status).toBe("SUPERSEDED");
  });

  it("new snapshot is created and immutable", async () => {
    const [snap] = await db
      .select()
      .from(taktRequestSnapshotsTable)
      .where(eq(taktRequestSnapshotsTable.taktRequestId, result.newRequestId as string))
      .limit(1);

    expect(snap).toBeDefined();
    expect(snap.id).toBe(result.snapshotId);
    const payload = snap.snapshotPayload as Record<string, unknown>;
    expect(payload.plannedStart).toBe("2026-11-15");
    expect(payload.plannedEnd).toBe("2026-11-22");
  });

  it("takt plannedStart/End updated and lifecycle = IN_COORDINATION", async () => {
    const [takt] = await db.select().from(takteTable).where(eq(takteTable.id, TAKT)).limit(1);
    expect(takt.plannedStart).toBe("2026-11-15");
    expect(takt.plannedEnd).toBe("2026-11-22");
    expect(takt.lifecycleStatus).toBe("IN_COORDINATION");
    expect(takt.version).toBe(result.newTaktVersion);
  });

  it("predecessor chain is navigable: old → new via supersedesRequestId", async () => {
    const [newReq] = await db
      .select()
      .from(taktRequestsTable)
      .where(eq(taktRequestsTable.id, result.newRequestId as string))
      .limit(1);

    expect(newReq.supersedesRequestId).toBe(revReqId);

    const [oldReq] = await db
      .select()
      .from(taktRequestsTable)
      .where(eq(taktRequestsTable.id, revReqId))
      .limit(1);

    expect(oldReq.status).toBe("SUPERSEDED");
  });

  it("a second revision attempt on the same (now SUPERSEDED) request returns 409", async () => {
    const res = await request(app)
      .post(`/api/takt-requests/${revReqId}/revisions`)
      .set("Authorization", `Bearer ${guToken}`)
      .send({ plannedTimeWindow: { start: "2026-11-20", end: "2026-11-27" } });

    // Old request is now SUPERSEDED, not REVISION_REQUIRED
    expect(res.status).toBe(409);
  });
});

// ── sendImmediately = true ────────────────────────────────────────────────────

describe("sendImmediately = true", () => {
  let sendReqId   = "";
  let sendRespId  = "";
  let sendDecId   = "";

  beforeAll(async () => {
    // Create a fresh REVISION_REQUIRED fixture
    const [r] = await db.insert(taktRequestsTable).values({
      taktId: TAKT, taktVersion: 1, guOrgId: GU_ORG, nuOrgId: NU_ORG,
      requestNumber: "TKR-6500-0099", status: "REVISION_REQUIRED" as const,
      createdByUserId: GU_USER,
    }).returning();
    sendReqId = r.id;

    const [resp] = await db.insert(taktResponsesTable).values({
      taktRequestId: sendReqId,
      decision: "REJECTED" as const,
      reasonCode: "RESOURCE_CONFLICT" as const,
      createdByUserId: NU_USER,
    }).returning();
    sendRespId = resp.id;

    const [dec] = await db.insert(taktResponseDecisionsTable).values({
      taktRequestId: sendReqId,
      responseId: sendRespId,
      guOrgId: GU_ORG,
      decisionType: "REQUEST_REVISION" as const,
      decidedByUserId: GU_USER,
      decidedAt: new Date(),
    }).returning();
    sendDecId = dec.id;
  });

  it("returns sent=true and newRequestStatus=DELIVERED", async () => {
    // Read current takt version so optimistic lock works even after earlier tests
    const [taktNow] = await db.select({ v: takteTable.version }).from(takteTable).where(eq(takteTable.id, TAKT)).limit(1);

    const res = await request(app)
      .post(`/api/takt-requests/${sendReqId}/revisions`)
      .set("Authorization", `Bearer ${guToken}`)
      .send({
        plannedTimeWindow: { start: "2026-12-01", end: "2026-12-07" },
        sendImmediately: true,
      });

    expect(res.status).toBe(201);
    expect(res.body.sent).toBe(true);
    expect(res.body.newRequestStatus).toBe("DELIVERED");
  });

  it("sends a TAKT_REQUEST_REVISED inbox message to NU", async () => {
    const [inbox] = await db
      .select()
      .from(messageInboxTable)
      .where(and(
        eq(messageInboxTable.recipientOrgId, NU_ORG),
        eq(messageInboxTable.messageType, "TAKT_REQUEST_REVISED"),
      ))
      .limit(1);

    expect(inbox).toBeDefined();
    const payload = inbox.payload as Record<string, unknown>;
    expect(payload.supersedesRequestId).toBe(sendReqId);
    expect(typeof payload.previousTaktVersion).toBe("number");
    expect(typeof payload.taktVersion).toBe("number");
    expect((payload.taktVersion as number)).toBeGreaterThan(payload.previousTaktVersion as number);
    // No full snapshot in message
    expect(payload).not.toHaveProperty("snapshotPayload");
  });
});
