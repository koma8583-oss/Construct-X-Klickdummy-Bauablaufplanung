/**
 * Independent AG ↔ AN smoke flow.
 *
 * This deliberately uses its own fixture namespace and exercises the public
 * boundary rather than calling domain services directly.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import { sql, eq, inArray, or } from "drizzle-orm";
import app from "../app";
import {
  agDb as db,
  organizationsTable,
  usersTable,
  projectsTable,
  takteTable,
  taktRequestsTable,
  taktResponsesTable,
  taktResponseDecisionsTable,
  taktVersionsTable,
  taktRequestSnapshotsTable,
  taktResponseAlternativesTable,
  messageInboxTable,
  messageOutboxTable,
  dataspaceExchangesTable,
  projectContractorsTable,
} from "@workspace/db";

const PREFIX = "independent-ag-an";
const AG = `${PREFIX}-ag`;
const AN = `${PREFIX}-an`;
const AG_USER = `${PREFIX}-ag-user`;
const AN_USER = `${PREFIX}-an-user`;
const PROJECT = `${PREFIX}-project`;
const TAKT = `${PREFIX}-takt`;

const secret = process.env.JWT_SECRET ?? "taktkoord-jwt-dev-secret-change-in-prod";
const token = (userId: string, orgId: string, orgType: "AG" | "AN") =>
  jwt.sign({
    userId,
    orgId,
    orgType,
    hubAdmin: false,
    roles: [orgType === "AG" ? "AG_ADMIN" : "AN_ADMIN"],
  }, secret, { expiresIn: "1h" });

const agToken = token(AG_USER, AG, "AG");
const anToken = token(AN_USER, AN, "AN");

async function cleanup() {
  const requests = await db.select({ id: taktRequestsTable.id })
    .from(taktRequestsTable).where(eq(taktRequestsTable.taktId, TAKT));
  const requestIds = requests.map(({ id }) => id);
  if (requestIds.length) {
    const responses = await db.select({ id: taktResponsesTable.id })
      .from(taktResponsesTable).where(inArray(taktResponsesTable.taktRequestId, requestIds));
    const responseIds = responses.map(({ id }) => id);
    await db.delete(taktVersionsTable).where(eq(taktVersionsTable.taktId, TAKT));
    await db.delete(taktResponseDecisionsTable).where(inArray(taktResponseDecisionsTable.taktRequestId, requestIds));
    if (responseIds.length) {
      await db.delete(taktResponseAlternativesTable).where(inArray(taktResponseAlternativesTable.responseId, responseIds));
      await db.delete(taktResponsesTable).where(inArray(taktResponsesTable.id, responseIds));
    }
    await db.delete(taktRequestSnapshotsTable).where(inArray(taktRequestSnapshotsTable.taktRequestId, requestIds));
    await db.delete(taktRequestsTable).where(inArray(taktRequestsTable.id, requestIds));
  }
  await db.delete(messageInboxTable).where(eq(messageInboxTable.recipientOrgId, AN));
  await db.delete(messageInboxTable).where(eq(messageInboxTable.recipientOrgId, AG));
  await db.delete(messageOutboxTable).where(eq(messageOutboxTable.senderOrgId, AG));
  await db.delete(messageOutboxTable).where(eq(messageOutboxTable.recipientOrgId, AG));
  await db.delete(dataspaceExchangesTable).where(or(
    eq(dataspaceExchangesTable.senderOrgId, AG),
    eq(dataspaceExchangesTable.receiverOrgId, AG),
    eq(dataspaceExchangesTable.senderOrgId, AN),
    eq(dataspaceExchangesTable.receiverOrgId, AN),
  ));
  await db.delete(projectContractorsTable).where(eq(projectContractorsTable.projectId, PROJECT));
  await db.delete(takteTable).where(eq(takteTable.id, TAKT));
  await db.delete(projectsTable).where(eq(projectsTable.id, PROJECT));
  await db.delete(usersTable).where(inArray(usersTable.id, [AG_USER, AN_USER]));
  await db.delete(organizationsTable).where(inArray(organizationsTable.id, [AG, AN]));
}

beforeAll(async () => {
  await cleanup();
  await db.insert(organizationsTable).values([
    { id: AG, name: "Independent AG", type: "AG" },
    { id: AN, name: "Independent AN", type: "AN" },
  ]);
  await db.insert(usersTable).values([
    { id: AG_USER, name: "Independent AG User", email: `${AG_USER}@test.local`, passwordHash: "x" },
    { id: AN_USER, name: "Independent AN User", email: `${AN_USER}@test.local`, passwordHash: "x" },
  ]);
  await db.insert(projectsTable).values({
    id: PROJECT, name: "Independent Project", agOrgId: AG,
    status: "ACTIVE", startDate: "2026-09-01", endDate: "2026-12-31",
  });
  await db.insert(takteTable).values({
    id: TAKT, projectId: PROJECT, taktBezeichnung: "Independent Leistung",
    zone: "A", gewerk: "Rohbau", plannedStart: "2026-10-01", plannedEnd: "2026-10-14",
    lifecycleStatus: "IN_COORDINATION",
  });
  await db.insert(projectContractorsTable).values({
    projectId: PROJECT, anOrgId: AN, assignmentStatus: "ACTIVE",
  });
  // The shared test database may not contain the newer optional publication
  // column, so insert only the physical membership columns.
  await db.execute(sql`
    INSERT INTO project_memberships
      (id, project_id, ag_org_id, an_org_id, invitation_id, correlation_id, status)
    VALUES (${`${PREFIX}-membership`}, ${PROJECT}, ${AG}, ${AN},
      ${`${PREFIX}-invitation`}, ${`${PREFIX}-correlation`}, 'ACTIVE')
    ON CONFLICT DO NOTHING
  `);
});

afterAll(cleanup);

describe("independent AG–AN coordination flow", () => {
  let requestId = "";

  it("AG creates and sends a Leistung request", async () => {
    const created = await request(app)
      .post("/api/takt-requests")
      .set("Authorization", `Bearer ${agToken}`)
      .send({ taktId: TAKT, nuOrgId: AN, responseRequiredBy: "2026-11-01T12:00:00.000Z" });
    expect(created.status).toBe(201);
    expect(created.body.status).toBe("DRAFT");
    requestId = created.body.id;

    const sent = await request(app)
      .post(`/api/takt-requests/${requestId}/send`)
      .set("Authorization", `Bearer ${agToken}`);
    expect([200, 201]).toContain(sent.status);
    expect(sent.body.status).toMatch(/SENT|DELIVERED/);
  });

  it("AN sees the request, but AG cannot use the AN response endpoint", async () => {
    const inbox = await request(app)
      .get("/api/takt-requests?role=nu")
      .set("Authorization", `Bearer ${anToken}`);
    expect(inbox.status).toBe(200);
    expect(inbox.body.some((row: { id: string }) => row.id === requestId)).toBe(true);

    const forbidden = await request(app)
      .post(`/api/takt-requests/${requestId}/responses`)
      .set("Authorization", `Bearer ${agToken}`)
      .send({ decision: "ACCEPTED", acceptedTimeWindow: { start: "2026-10-01", end: "2026-10-14" } });
    expect(forbidden.status).toBe(403);
  });

  it("AN accepts and AG confirms the response", async () => {
    // Local transport delivery and AN inbound processing are separate
    // boundaries. Simulate the committed inbound state before the AN action.
    await db.update(taktRequestsTable)
      .set({ status: "UNDER_REVIEW" })
      .where(eq(taktRequestsTable.id, requestId));

    const response = await request(app)
      .post(`/api/takt-requests/${requestId}/responses`)
      .set("Authorization", `Bearer ${anToken}`)
      .send({
        decision: "ACCEPTED",
        acceptedTimeWindow: { start: "2026-10-01", end: "2026-10-14" },
        comment: "Kapazität bestätigt",
      });
    expect(response.status).toBe(201);

    const decision = await request(app)
      .post(`/api/takt-requests/${requestId}/gu-decisions`)
      .set("Authorization", `Bearer ${agToken}`)
      .send({ decisionType: "CONFIRM_ACCEPTED", responseId: response.body.id });
    expect(decision.status).toBe(201);
    expect(decision.body.updatedRequestStatus).toBe("ACCEPTED");
  });

  it("runs alternatives, revision and a shifted second agreement", async () => {
    // Start a fresh coordination round through the public AG API.
    const created = await request(app)
      .post("/api/takt-requests")
      .set("Authorization", `Bearer ${agToken}`)
      .send({ taktId: TAKT, nuOrgId: AN });
    expect(created.status).toBe(201);
    const firstRoundId = created.body.id as string;

    const sent = await request(app)
      .post(`/api/takt-requests/${firstRoundId}/send`)
      .set("Authorization", `Bearer ${agToken}`);
    expect(sent.status).toBe(200);

    // The transport and inbound processing are separate boundaries.
    await db.update(taktRequestsTable)
      .set({ status: "UNDER_REVIEW" })
      .where(eq(taktRequestsTable.id, firstRoundId));

    const alternatives = await request(app)
      .post(`/api/takt-requests/${firstRoundId}/responses`)
      .set("Authorization", `Bearer ${anToken}`)
      .send({
        decision: "ALTERNATIVES_PROPOSED",
        alternatives: [
          { alternativeId: `${PREFIX}-alt-early`, rank: 1, timeWindow: { start: "2026-10-15", end: "2026-10-28" }, crewSize: 3 },
          { alternativeId: `${PREFIX}-alt-late`, rank: 2, timeWindow: { start: "2026-11-01", end: "2026-11-14" }, crewSize: 4 },
        ],
      });
    expect(alternatives.status).toBe(201);

    const revisionDecision = await request(app)
      .post(`/api/takt-requests/${firstRoundId}/gu-decisions`)
      .set("Authorization", `Bearer ${agToken}`)
      .send({
        decisionType: "REQUEST_REVISION",
        comment: "Bitte die Ausführung auf den späteren Bauabschnitt verschieben.",
        idempotencyKey: `${PREFIX}-revision-decision`,
      });
    expect(revisionDecision.status).toBe(201);
    expect(revisionDecision.body.updatedRequestStatus).toBe("REVISION_REQUIRED");

    const revision = await request(app)
      .post(`/api/takt-requests/${firstRoundId}/revisions`)
      .set("Authorization", `Bearer ${agToken}`)
      .send({
        plannedTimeWindow: { start: "2026-11-01", end: "2026-11-14" },
        subject: "Verschobene Leistungsplanung",
        message: "Neue Abstimmungsrunde für den späteren Bauabschnitt.",
        sendImmediately: false,
      });
    expect(revision.status).toBe(201);
    expect(revision.body.newRequestStatus).toBe("DRAFT");
    expect(revision.body.newTaktVersion).toBe(2);
    const secondRoundId = revision.body.newRequestId as string;

    const secondRoundSent = await request(app)
      .post(`/api/takt-requests/${secondRoundId}/send`)
      .set("Authorization", `Bearer ${agToken}`);
    expect([200, 201]).toContain(secondRoundSent.status);

    const [oldRequest] = await db.select({ status: taktRequestsTable.status })
      .from(taktRequestsTable).where(eq(taktRequestsTable.id, firstRoundId));
    expect(oldRequest.status).toBe("SUPERSEDED");

    const shiftedResponse = await request(app)
      .post(`/api/takt-requests/${secondRoundId}/responses`)
      .set("Authorization", `Bearer ${anToken}`)
      .send({
        decision: "ACCEPTED",
        acceptedTimeWindow: { start: "2026-11-01", end: "2026-11-14" },
        comment: "Der verschobene Zeitraum ist bestätigt.",
      });
    expect(shiftedResponse.status).toBe(201);

    const finalDecision = await request(app)
      .post(`/api/takt-requests/${secondRoundId}/gu-decisions`)
      .set("Authorization", `Bearer ${agToken}`)
      .send({
        decisionType: "CONFIRM_ACCEPTED",
        idempotencyKey: `${PREFIX}-final-decision`,
      });
    expect(finalDecision.status).toBe(201);
    expect(finalDecision.body.updatedRequestStatus).toBe("ACCEPTED");

    const [takt] = await db.select().from(takteTable).where(eq(takteTable.id, TAKT));
    expect(String(takt.plannedStart)).toContain("2026-11-01");
    expect(String(takt.plannedEnd)).toContain("2026-11-14");
    expect(takt.version).toBe(2);

    const versions = await db.select({ version: taktVersionsTable.version, sourceType: taktVersionsTable.sourceType })
      .from(taktVersionsTable).where(eq(taktVersionsTable.taktId, TAKT));
    expect(versions.some((version) => version.version === 2 && version.sourceType === "REVISION")).toBe(true);

    const [agResponse] = await db.select({ id: taktResponsesTable.id })
      .from(taktResponsesTable)
      .where(eq(taktResponsesTable.taktRequestId, firstRoundId));
    const alternativesInHistory = await db.select({ alternativeId: taktResponseAlternativesTable.alternativeId })
      .from(taktResponseAlternativesTable)
      .where(eq(taktResponseAlternativesTable.responseId, agResponse.id));
    expect(alternativesInHistory.map((alternative) => alternative.alternativeId).sort())
      .toEqual([`${PREFIX}-alt-early`, `${PREFIX}-alt-late`].sort());
  });
});