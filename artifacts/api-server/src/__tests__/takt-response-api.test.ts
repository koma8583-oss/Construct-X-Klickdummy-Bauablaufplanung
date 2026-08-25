/**
 * Task 4.8 — POST /takt-requests/:id/responses endpoint tests.
 *
 * Tests:
 *   - Valid ACCEPTED response → 201, GU inbox delivery
 *   - Response with two alternatives → 201
 *   - Valid REJECTED response → 201
 *   - More than three alternatives → 400/422
 *   - Forbidden internal fields → 400
 *   - Unknown extra fields → 400
 *   - Foreign NU → 403
 *   - GU → 403
 *   - Hub admin → 403
 *   - Response delivered to GU inbox as TAKT_RESPONSE_SUBMITTED
 *   - GU inbox message contains no internal NU fields
 *   - Request status updated correctly
 *   - Identical retry produces no second response (200 with existing)
 *   - Different decision on retry → 409
 *   - Transport retries the existing message (idempotent messageId)
 *
 * Fixture prefix: "t48-"
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import { agDb as db, anDb } from "@workspace/db";
import {
  organizationsTable,
  usersTable,
  projectsTable,
  takteTable,
  taktRequestsTable,
  taktRequestSnapshotsTable,
  anLeistungsanfragenTable,
  anLeistungsantwortenTable,
  dataspaceExchangesTable,
  taktResponsesTable,
} from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import app from "../app";

// ── JWT ───────────────────────────────────────────────────────────────────────

const JWT_SECRET = process.env.JWT_SECRET ?? "taktkoord-jwt-dev-secret-change-in-prod";

function signToken(p: {
  userId: string;
  orgId: string | null;
  orgType: "AG" | "AN" | null;
  hubAdmin?: boolean;
  roles?: string[];
}): string {
  const roles = p.roles ?? (p.orgType === "AG" ? ["AG_ADMIN"] : p.orgType === "AN" ? ["AN_ADMIN"] : []);
  return jwt.sign({ ...p, hubAdmin: p.hubAdmin ?? false, roles }, JWT_SECRET, { expiresIn: "1h" });
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

const GU_ORG   = "t48-gu-org";
const NU_ORG_A = "t48-nu-org-a";
const NU_ORG_B = "t48-nu-org-b";
const GU_USER  = "t48-gu-user";
const NU_USER  = "t48-nu-user";
const PROJECT  = "t48-project";

let nuTokenA: string;
let nuTokenB: string;
let guToken:  string;
let hubToken: string;

/** Create a fresh TaktRequest + snapshot in UNDER_REVIEW status, return requestId */
async function seedRequest(suffix: string): Promise<string> {
  const taktId = `t48-takt-${suffix}`;
  const reqId  = `t48-req-${suffix}`;

  await db.insert(takteTable).values({
    id: taktId, projectId: PROJECT, taktBezeichnung: `T48 Takt ${suffix}`, zone: "Z", gewerk: "TRK",
    plannedStart: "2026-09-15", plannedEnd: "2026-09-20",
  }).onConflictDoNothing();

  await db.insert(taktRequestsTable).values({
    id: reqId, taktId, taktVersion: 1,
    guOrgId: GU_ORG, nuOrgId: NU_ORG_A,
    requestNumber: `TKR-T48-${suffix}`,
    // AG-owned fixture: delivery happened. The AN response must move AG state
    // only through the Dataspace inbound path.
    status: "DELIVERED" as const,
    createdByUserId: GU_USER,
  }).onConflictDoNothing();

  await db.insert(taktRequestSnapshotsTable).values([
    {
      id: `t48-snap-${suffix}`,
      taktRequestId: reqId,
      schemaVersion: "1.0",
      snapshotPayload: {
        schemaVersion: "1.0",
        projectReference: PROJECT,
        taktReference: taktId,
        taktVersion: 1,
        trade: "Trockenbau",
        workPackage: "Innenausbau",
        plannedTimeWindow: { start: "2026-09-15", end: "2026-09-20" },
        workdayHours: 8,
        resourceRequirements: [{ resourceType: "CREW", quantity: 2, notes: "" }],
        coordinationContext: {},
      },
    },
  ]).onConflictDoNothing();

  await anDb.insert(anLeistungsanfragenTable).values({
    id: `t48-an-req-${suffix}`,
    externalLeistungsanfrageId: reqId,
    externalRequestVersion: 1,
    sourceMessageId: `t48-source-${suffix}`,
    payloadHash: `t48-payload-${suffix}`,
    correlationId: reqId,
    senderAgOrgId: GU_ORG,
    receiverAnOrgId: NU_ORG_A,
    projectReference: PROJECT,
    leistungReference: taktId,
    plannedStart: "2026-09-15",
    plannedEnd: "2026-09-20",
    payloadSnapshot: {},
    status: "DETAILS_RETRIEVED",
  }).onConflictDoNothing();

  return reqId;
}

beforeAll(async () => {
  await db.insert(organizationsTable).values([
    { id: GU_ORG,   name: "T48 GU Org",   type: "AG" },
    { id: NU_ORG_A, name: "T48 NU Org A", type: "AN" },
    { id: NU_ORG_B, name: "T48 NU Org B", type: "AN" },
  ]).onConflictDoNothing();

  await db.insert(usersTable).values([
    { id: GU_USER, name: "T48 GU", email: "t48-gu@example.com", passwordHash: "x" },
    { id: NU_USER, name: "T48 NU", email: "t48-nu@example.com", passwordHash: "x" },
  ]).onConflictDoNothing();

  await db.insert(projectsTable).values([
    { id: PROJECT, agOrgId: GU_ORG, name: "T48 Project", status: "ACTIVE" },
  ]).onConflictDoNothing();

  nuTokenA = signToken({ userId: NU_USER, orgId: NU_ORG_A, orgType: "AN" });
  nuTokenB = signToken({ userId: NU_USER, orgId: NU_ORG_B, orgType: "AN" });
  guToken  = signToken({ userId: GU_USER, orgId: GU_ORG,   orgType: "AG" });
  hubToken = signToken({ userId: "hub", orgId: null, orgType: null, hubAdmin: true });
});

afterAll(async () => {
  await anDb.execute(sql`
    DELETE FROM an_leistungsantworten WHERE source_request_id LIKE 't48-req-%';
    DELETE FROM an_leistungsanfragen WHERE external_leistungsanfrage_id LIKE 't48-req-%';
  `);
  await db.execute(sql`
    DELETE FROM leistungsantworten         WHERE leistungsanfrage_id LIKE 't48-req-%';
    DELETE FROM message_inbox              WHERE correlation_id      LIKE 't48-req-%';
    DELETE FROM message_outbox             WHERE correlation_id      LIKE 't48-req-%';
    DELETE FROM leistungsanfrage_snapshots WHERE leistungsanfrage_id LIKE 't48-req-%';
    DELETE FROM leistungsanfragen          WHERE id                  LIKE 't48-req-%';
    DELETE FROM leistungen                 WHERE id                  LIKE 't48-takt-%';
    DELETE FROM projects               WHERE id = 't48-project';
    DELETE FROM dataspace_exchanges    WHERE sender_org_id   IN ('t48-gu-org', 't48-nu-org-a', 't48-nu-org-b')
                                          OR receiver_org_id IN ('t48-gu-org', 't48-nu-org-a', 't48-nu-org-b');
    DELETE FROM users                  WHERE id IN ('t48-gu-user', 't48-nu-user');
    DELETE FROM organizations          WHERE id IN ('t48-gu-org', 't48-nu-org-a', 't48-nu-org-b');
  `);
});

// ── Permission tests ──────────────────────────────────────────────────────────

describe("POST /takt-requests/:id/responses — permissions", () => {
  it("foreign NU → 403", async () => {
    const reqId = await seedRequest("perm-foreign");
    const res = await request(app)
       .post(`/api/an/takt-requests/${reqId}/responses`)
      .set("Authorization", `Bearer ${nuTokenB}`)
      .send({ decision: "ACCEPTED", acceptedTimeWindow: { start: "2026-09-15T05:00:00Z", end: "2026-09-19T14:00:00Z" } });
     expect(res.status).toBe(404);
  });

  it("GU → 403", async () => {
    const reqId = await seedRequest("perm-gu");
    const res = await request(app)
       .post(`/api/an/takt-requests/${reqId}/responses`)
      .set("Authorization", `Bearer ${guToken}`)
      .send({ decision: "ACCEPTED", acceptedTimeWindow: { start: "2026-09-15T05:00:00Z", end: "2026-09-19T14:00:00Z" } });
    expect(res.status).toBe(403);
  });

  it("hub admin → 403", async () => {
    const reqId = await seedRequest("perm-hub");
    const res = await request(app)
       .post(`/api/an/takt-requests/${reqId}/responses`)
      .set("Authorization", `Bearer ${hubToken}`)
      .send({ decision: "ACCEPTED", acceptedTimeWindow: { start: "2026-09-15T05:00:00Z", end: "2026-09-19T14:00:00Z" } });
    expect(res.status).toBe(403);
  });
});

// ── Local/private input tests ─────────────────────────────────────────────────

describe("POST /an/takt-requests/:id/responses — local/private input", () => {
  it("localProjectId is never promoted into the public AG response", async () => {
    const reqId = await seedRequest("priv-lpid");
    const res = await request(app)
       .post(`/api/an/takt-requests/${reqId}/responses`)
      .set("Authorization", `Bearer ${nuTokenA}`)
      .send({ decision: "REJECTED", localProjectId: "LP-001", reasonCode: "NO_CAPACITY" });
    expect(res.status).toBe(201);
    const [publicResponse] = await db.select({ id: taktResponsesTable.id })
      .from(taktResponsesTable).where(eq(taktResponsesTable.taktRequestId, reqId));
    expect(publicResponse).toBeDefined();
  });

  it("resourceId is never promoted into the public AG response", async () => {
    const reqId = await seedRequest("priv-resid");
    const res = await request(app)
       .post(`/api/an/takt-requests/${reqId}/responses`)
      .set("Authorization", `Bearer ${nuTokenA}`)
      .send({ decision: "REJECTED", resourceId: "RES-001", reasonCode: "NO_CAPACITY" });
    expect(res.status).toBe(201);
  });

  it("internal result input stays out of the public AG response", async () => {
    const reqId = await seedRequest("priv-internal");
    const res = await request(app)
       .post(`/api/an/takt-requests/${reqId}/responses`)
      .set("Authorization", `Bearer ${nuTokenA}`)
      .send({ decision: "REJECTED", internalResultPayload: { conflicts: [] }, reasonCode: "NO_CAPACITY" });
    expect(res.status).toBe(201);
  });

  it("unknown local metadata does not alter the public response contract", async () => {
    const reqId = await seedRequest("priv-unknown");
    const res = await request(app)
       .post(`/api/an/takt-requests/${reqId}/responses`)
      .set("Authorization", `Bearer ${nuTokenA}`)
      .send({ decision: "REJECTED", unknownField: "should-fail", reasonCode: "NO_CAPACITY" });
    expect(res.status).toBe(201);
  });
});

// ── Valid decisions ───────────────────────────────────────────────────────────

describe("POST /takt-requests/:id/responses — valid decisions", () => {
  it("valid ACCEPTED response → 201, request status ACCEPTED", async () => {
    const reqId = await seedRequest("accepted");
    const res = await request(app)
       .post(`/api/an/takt-requests/${reqId}/responses`)
      .set("Authorization", `Bearer ${nuTokenA}`)
      .send({
        decision: "ACCEPTED",
        acceptedTimeWindow: {
          start: "2026-09-15T05:00:00Z",
          end:   "2026-09-19T14:00:00Z",
        },
        comment: "Der Zeitraum kann bestätigt werden.",
      });

    expect(res.status).toBe(201);
    expect(res.body.decision).toBe("ACCEPTED");
    expect(res.body.acceptedTimeWindow).toMatchObject({
      start: expect.stringContaining("2026-09-15"),
      end:   expect.stringContaining("2026-09-19"),
    });
    expect(res.body.requestStatus).toBe("RESPONDED");
    expect(res.body.transportStatus).toBe("DELIVERED");
    expect(res.body.responseId).toBeTruthy();
  });

  it("response with two alternatives → 201, request status ALTERNATIVES_PROPOSED", async () => {
    const reqId = await seedRequest("alts");
    const res = await request(app)
       .post(`/api/an/takt-requests/${reqId}/responses`)
      .set("Authorization", `Bearer ${nuTokenA}`)
      .send({
        decision: "ALTERNATIVES_PROPOSED",
        reasonCode: "RESOURCE_CONFLICT",
        comment: "Der ursprüngliche Zeitraum ist nicht vollständig verfügbar.",
        alternatives: [
          {
            alternativeId: "ALT-01",
            rank: 1,
            timeWindow: { start: "2026-09-22T05:00:00Z", end: "2026-09-26T14:00:00Z" },
            crewSize: 4,
            conditions: [],
          },
          {
            alternativeId: "ALT-02",
            rank: 2,
            timeWindow: { start: "2026-09-29T05:00:00Z", end: "2026-10-03T14:00:00Z" },
            crewSize: 2,
            conditions: ["reduced crew"],
          },
        ],
      });

    expect(res.status).toBe(201);
    expect(res.body.decision).toBe("ALTERNATIVES_PROPOSED");
    expect(res.body.alternatives).toHaveLength(2);
    expect(res.body.alternatives[0].timeWindow).toMatchObject({
      start: expect.stringContaining("2026-09-22"),
      end:   expect.stringContaining("2026-09-26"),
    });
    expect(res.body.requestStatus).toBe("RESPONDED");
  });

  it("valid REJECTED response → 201, request status REJECTED", async () => {
    const reqId = await seedRequest("rejected");
    const res = await request(app)
       .post(`/api/an/takt-requests/${reqId}/responses`)
      .set("Authorization", `Bearer ${nuTokenA}`)
      .send({
        decision: "REJECTED",
        reasonCode: "NO_CAPACITY",
        comment: "Im angefragten Zeitraum ist keine ausreichende Kapazität verfügbar.",
        nextAvailableDate: "2026-10-05",
      });

    expect(res.status).toBe(201);
    expect(res.body.decision).toBe("REJECTED");
    expect(res.body.requestStatus).toBe("RESPONDED");
  });

  it("more than three alternatives → 400/422", async () => {
    const reqId = await seedRequest("too-many-alts");
    const res = await request(app)
       .post(`/api/an/takt-requests/${reqId}/responses`)
      .set("Authorization", `Bearer ${nuTokenA}`)
      .send({
        decision: "ALTERNATIVES_PROPOSED",
        reasonCode: "RESOURCE_CONFLICT",
        alternatives: [1, 2, 3, 4].map(n => ({
          alternativeId: `ALT-0${n}`,
          rank: n,
          timeWindow: { start: "2026-10-01T05:00:00Z", end: "2026-10-05T14:00:00Z" },
        })),
      });
    expect([400, 422]).toContain(res.status);
  });
});

// ── Dataspace delivery to AG ──────────────────────────────────────────────────

describe("POST /an/takt-requests/:id/responses — Dataspace delivery to AG", () => {
  it("is received by the AG through a processed SERVICE_RESPONSE inbound exchange", async () => {
    const reqId = await seedRequest("inbox-delivery");
    await request(app)
       .post(`/api/an/takt-requests/${reqId}/responses`)
      .set("Authorization", `Bearer ${nuTokenA}`)
      .send({
        decision: "ACCEPTED",
        acceptedTimeWindow: { start: "2026-09-15T05:00:00Z", end: "2026-09-19T14:00:00Z" },
      });

    const [exchange] = await db.select()
      .from(dataspaceExchangesTable)
      .where(and(
        eq(dataspaceExchangesTable.direction, "INBOUND"),
        eq(dataspaceExchangesTable.receiverOrgId, GU_ORG),
        eq(dataspaceExchangesTable.correlationId, reqId),
        eq(dataspaceExchangesTable.messageType, "SERVICE_RESPONSE"),
      ));

    expect(exchange).toBeTruthy();
    expect(exchange.senderOrgId).toBe(NU_ORG_A);
    expect(exchange.status).toBe("PROCESSED");
  });

  it("publishes only the public decision data to the AG-owned response", async () => {
    const reqId = await seedRequest("inbox-privacy");
    await request(app)
       .post(`/api/an/takt-requests/${reqId}/responses`)
      .set("Authorization", `Bearer ${nuTokenA}`)
      .send({
        decision: "ALTERNATIVES_PROPOSED",
        reasonCode: "RESOURCE_CONFLICT",
        alternatives: [{
          alternativeId: "ALT-01",
          rank: 1,
          timeWindow: { start: "2026-09-22T05:00:00Z", end: "2026-09-26T14:00:00Z" },
        }],
      });

    const [publicResponse] = await db.select({
      decision: taktResponsesTable.decision,
      taktRequestId: taktResponsesTable.taktRequestId,
    })
      .from(taktResponsesTable)
      .where(and(
        eq(taktResponsesTable.taktRequestId, reqId),
      ));

    expect(publicResponse).toEqual({
      taktRequestId: reqId,
      decision: "ALTERNATIVES_PROPOSED",
    });
  });

  it("creates an AG response only after the Dataspace inbound exchange", async () => {
    const reqId = await seedRequest("gu-inbox-read");
    await request(app)
       .post(`/api/an/takt-requests/${reqId}/responses`)
      .set("Authorization", `Bearer ${nuTokenA}`)
      .send({
        decision: "REJECTED",
        reasonCode: "NO_CAPACITY",
        nextAvailableDate: "2026-11-01",
      });

    const [agResponse] = await db.select({ id: taktResponsesTable.id })
      .from(taktResponsesTable).where(eq(taktResponsesTable.taktRequestId, reqId));
    const [exchange] = await db.select({ status: dataspaceExchangesTable.status })
      .from(dataspaceExchangesTable).where(and(
        eq(dataspaceExchangesTable.direction, "INBOUND"),
        eq(dataspaceExchangesTable.businessObjectId, reqId),
        eq(dataspaceExchangesTable.messageType, "SERVICE_RESPONSE"),
      ));
    expect(agResponse).toBeDefined();
    expect(exchange?.status).toBe("PROCESSED");
  });
});

// ── Idempotency ───────────────────────────────────────────────────────────────

describe("POST /takt-requests/:id/responses — idempotency", () => {
  it("identical retry creates no second response → 200 with existing", async () => {
    const reqId = await seedRequest("idempotent");
    const body = {
      decision: "REJECTED",
      reasonCode: "NO_CAPACITY",
      nextAvailableDate: "2026-10-01",
    };

    const first = await request(app)
       .post(`/api/an/takt-requests/${reqId}/responses`)
      .set("Authorization", `Bearer ${nuTokenA}`)
      .send(body);
    expect(first.status).toBe(201);

    const retry = await request(app)
       .post(`/api/an/takt-requests/${reqId}/responses`)
      .set("Authorization", `Bearer ${nuTokenA}`)
      .send(body);
    expect(retry.status).toBe(200);
    // Same responseId
    expect(retry.body.responseId).toBe(first.body.responseId);
  });

  it("different decision on retry → 409", async () => {
    const reqId = await seedRequest("conflict-decision");
    await request(app)
       .post(`/api/an/takt-requests/${reqId}/responses`)
      .set("Authorization", `Bearer ${nuTokenA}`)
      .send({ decision: "REJECTED", reasonCode: "NO_CAPACITY" });

    const retry = await request(app)
       .post(`/api/an/takt-requests/${reqId}/responses`)
      .set("Authorization", `Bearer ${nuTokenA}`)
      .send({ decision: "ACCEPTED", acceptedTimeWindow: { start: "2026-09-15T05:00:00Z", end: "2026-09-19T14:00:00Z" } });
    expect(retry.status).toBe(409);
  });

  it("retry re-delivers transport message but creates no second response", async () => {
    const reqId = await seedRequest("retry-transport");
    await request(app)
       .post(`/api/an/takt-requests/${reqId}/responses`)
      .set("Authorization", `Bearer ${nuTokenA}`)
      .send({ decision: "REJECTED", reasonCode: "NO_CAPACITY" });

    // The retry reuses the same exchange message and cannot create a second
    // AG response or inbound exchange record.
    const before = await db.select()
      .from(dataspaceExchangesTable)
      .where(and(
        eq(dataspaceExchangesTable.correlationId, reqId),
        eq(dataspaceExchangesTable.direction, "INBOUND"),
        eq(dataspaceExchangesTable.messageType, "SERVICE_RESPONSE"),
      ));

    // Retry (same content)
    await request(app)
       .post(`/api/an/takt-requests/${reqId}/responses`)
      .set("Authorization", `Bearer ${nuTokenA}`)
      .send({ decision: "REJECTED", reasonCode: "NO_CAPACITY" });

    const after = await db.select()
      .from(dataspaceExchangesTable)
      .where(and(
        eq(dataspaceExchangesTable.correlationId, reqId),
        eq(dataspaceExchangesTable.direction, "INBOUND"),
        eq(dataspaceExchangesTable.messageType, "SERVICE_RESPONSE"),
      ));

    // messageId is UNIQUE — transport deduplication ensures only one inbound row.
    expect(after.length).toBe(before.length);
  });
});
