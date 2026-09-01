/**
 * Bilateral Leistungsanfrage change-proposal invariants.
 *
 * These tests deliberately keep the original agreement on the request and
 * verify that proposals are additive history, not replacements for it.
 *
 * Fixture prefix: "t212-"
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import { and, eq, inArray, sql } from "drizzle-orm";
import { agDb as db, anDb, runWithDatabaseRole } from "@workspace/db";
import {
  anLeistungsanfragenTable,
  leistungsanfragenTable,
  leistungsanfrageSnapshotsTable,
  leistungenTable,
  organizationsTable,
  projectsTable,
  serviceChangeProposalsTable,
  usersTable,
} from "@workspace/db";
import app from "../app";
import {
  buildCoordinationTimeline,
  calculateScheduleDelta,
  createChangeProposal,
  resolveChangeProposal,
} from "../services/service-change-proposal-service";
import { getAnLeistungsanfrageDetail } from "../services/an-leistungsanfrage-service";

const JWT_SECRET = process.env.JWT_SECRET ?? "taktkoord-jwt-dev-secret-change-in-prod";
const GU_ORG = "t212-gu-org";
const NU_ORG = "t212-nu-org";
const OTHER_ORG = "t212-other-org";
const GU_USER = "t212-gu-user";
const NU_USER = "t212-nu-user";
const OTHER_USER = "t212-other-user";
const PROJECT = "t212-project";
const LEISTUNG = "t212-leistung";
const ROUNDTRIP_REQUEST = "t212-request-roundtrip";
const REQUEST_IDS = [
  "t212-request-initial",
  "t212-request-counter",
  "t212-request-reject",
  "t212-request-expired",
  "t212-request-mismatch",
  "t212-request-concurrent",
  "t212-request-published-labels",
  ROUNDTRIP_REQUEST,
];

const publishedSnapshot = {
  schemaVersion: "1.0",
  projectReference: PROJECT,
  projectLocation: "Published T212 site",
  projectDescription: "Published T212 project description",
  taktReference: LEISTUNG,
  taktVersion: 1,
  trade: "Published T212 trade",
  workPackage: "Published T212 work package",
  kurzbezeichnung: "Published T212 service",
  location: { building: null, storey: null, zone: "Published T212 zone" },
  plannedTimeWindow: { start: "2026-09-03", end: "2026-09-07" },
  bufferTimeWindow: null,
  requiredOutput: "Published T212 output",
  resourceRequirements: [],
  constraints: [],
  predecessors: [],
  successors: [],
  documentReferences: { lvReference: null, bimReference: null },
} as const;

function token(userId: string, orgId: string, orgType: "AG" | "AN") {
  return jwt.sign(
    { userId, orgId, orgType, hubAdmin: false, roles: [orgType === "AG" ? "AG_ADMIN" : "AN_ADMIN"] },
    JWT_SECRET,
    { expiresIn: "1h" },
  );
}

const guToken = token(GU_USER, GU_ORG, "AG");
const nuToken = token(NU_USER, NU_ORG, "AN");
const otherToken = token(OTHER_USER, OTHER_ORG, "AN");

function createAgChangeProposal(input: Parameters<typeof createChangeProposal>[0]) {
  return runWithDatabaseRole("ag", () => createChangeProposal(input));
}

const originalStart = new Date("2026-09-01T08:00:00.000Z");
const originalEnd = new Date("2026-09-05T17:00:00.000Z");

async function cleanupFixtures() {
  // Keep reruns independent from a previous interrupted Vitest process. The
  // AN projection is filtered by its fixture organisation because schedule
  // change projections use generated proposal IDs rather than request IDs.
  await anDb.delete(anLeistungsanfragenTable)
    .where(eq(anLeistungsanfragenTable.receiverAnOrgId, NU_ORG))
    .catch(() => {});
  await db.delete(serviceChangeProposalsTable)
    .where(inArray(serviceChangeProposalsTable.leistungsanfrageId, REQUEST_IDS))
    .catch(() => {});
  await db.delete(leistungsanfrageSnapshotsTable)
    .where(inArray(leistungsanfrageSnapshotsTable.leistungsanfrageId, REQUEST_IDS))
    .catch(() => {});
  await db.delete(leistungsanfragenTable)
    .where(inArray(leistungsanfragenTable.id, REQUEST_IDS))
    .catch(() => {});
  await db.delete(leistungenTable).where(eq(leistungenTable.id, LEISTUNG)).catch(() => {});
  await db.delete(projectsTable).where(eq(projectsTable.id, PROJECT)).catch(() => {});
  await db.delete(usersTable).where(inArray(usersTable.id, [GU_USER, NU_USER, OTHER_USER])).catch(() => {});
  await db.delete(organizationsTable).where(inArray(organizationsTable.id, [GU_ORG, NU_ORG, OTHER_ORG])).catch(() => {});
}

async function insertRequest(id: string, suffix: string, agreed = true, status: "UNDER_REVIEW" | "EXPIRED" = "UNDER_REVIEW") {
  await db.insert(leistungsanfragenTable).values({
    id,
    leistungId: LEISTUNG,
    leistungVersion: 1,
    guOrgId: GU_ORG,
    nuOrgId: NU_ORG,
    requestNumber: `T212-${suffix}`,
    status,
    sentAt: new Date("2026-08-01T09:00:00.000Z"),
    deliveredAt: new Date("2026-08-01T09:05:00.000Z"),
    createdByUserId: GU_USER,
    agreedStart: agreed ? originalStart : null,
    agreedEnd: agreed ? originalEnd : null,
    createdAt: new Date("2026-08-01T08:00:00.000Z"),
    updatedAt: new Date("2026-08-01T08:00:00.000Z"),
  });
}

beforeAll(async () => {
  await cleanupFixtures();
  await db.insert(organizationsTable).values({ id: GU_ORG, name: "Published T212 Auftraggeber", type: "AG" })
    .onConflictDoUpdate({ target: organizationsTable.id, set: { name: "Published T212 Auftraggeber" } });
  await db.insert(organizationsTable).values([
    { id: NU_ORG, name: "T212 NU", type: "AN" },
    { id: OTHER_ORG, name: "T212 Other", type: "AN" },
  ]).onConflictDoNothing();
  await db.insert(usersTable).values([
    { id: GU_USER, name: "T212 GU user", email: "t212-gu@test.invalid", passwordHash: "x" },
    { id: NU_USER, name: "T212 NU user", email: "t212-nu@test.invalid", passwordHash: "x" },
    { id: OTHER_USER, name: "T212 other user", email: "t212-other@test.invalid", passwordHash: "x" },
  ]).onConflictDoNothing();
  await db.insert(projectsTable).values({ id: PROJECT, agOrgId: GU_ORG, name: "Published T212 project" })
    .onConflictDoUpdate({ target: projectsTable.id, set: { name: "Published T212 project" } });
  await db.insert(leistungenTable).values({
    id: LEISTUNG,
    projectId: PROJECT,
    leistungsBezeichnung: "T212 Leistung",
    zone: "A",
    gewerk: "Rohbau",
    plannedStart: "2026-09-01",
    plannedEnd: "2026-09-05",
  }).onConflictDoNothing();
  await insertRequest(REQUEST_IDS[0], "INITIAL", false);
  await insertRequest(REQUEST_IDS[1], "COUNTER");
  await insertRequest(REQUEST_IDS[2], "REJECT");
  await insertRequest(REQUEST_IDS[3], "EXPIRED", true, "EXPIRED");
  await insertRequest(REQUEST_IDS[4], "MISMATCH");
  await insertRequest(REQUEST_IDS[5], "CONCURRENT");
  await insertRequest(REQUEST_IDS[6], "PUBLISHED-LABELS");
  await insertRequest(ROUNDTRIP_REQUEST, "ROUNDTRIP");
  await db.insert(leistungsanfrageSnapshotsTable).values({
    leistungsanfrageId: REQUEST_IDS[6],
    schemaVersion: publishedSnapshot.schemaVersion,
    snapshotPayload: publishedSnapshot as Record<string, unknown>,
  });
});

afterAll(async () => {
  await cleanupFixtures();
});

describe("bilateral change proposals", () => {
  it("requires an existing agreement before a change proposal can be created", async () => {
    const requestId = REQUEST_IDS[0];
    const proposal = await request(app)
      .post(`/api/leistungsanfragen/${requestId}/change-proposals`)
      .set("Authorization", `Bearer ${guToken}`)
      .send({ start: "2026-09-02T08:00:00.000Z", end: "2026-09-06T17:00:00.000Z", reasonCode: "SEQUENCING" });
    expect(proposal.status).toBe(422);
    expect(proposal.body.code).toBe("CHANGE_PROPOSAL_REQUIRES_AGREEMENT");
  });

  it("allows only one open proposal, while the opposite party may replace it with a counter", async () => {
    const requestId = REQUEST_IDS[1];
    const first = await createAgChangeProposal({
      requestId, orgId: GU_ORG, userId: GU_USER,
      start: new Date("2026-09-03T08:00:00Z"), end: new Date("2026-09-07T17:00:00Z"),
    });
    await expect(createAgChangeProposal({
      requestId, orgId: GU_ORG, userId: GU_USER,
      start: new Date("2026-09-04T08:00:00Z"), end: new Date("2026-09-08T17:00:00Z"),
    })).rejects.toMatchObject({ statusCode: 409 });

    const counter = await request(app)
      .post(`/api/leistungsanfragen/${requestId}/change-proposals/${first.id}/counter`)
      .set("Authorization", `Bearer ${nuToken}`)
      .send({ start: "2026-09-04T08:00:00.000Z", end: "2026-09-08T17:00:00.000Z", comment: "Mehr Puffer" });
    expect(counter.status).toBe(201);
    expect(counter.body.action).toBe("COUNTER");

    const rows = await db.select().from(serviceChangeProposalsTable)
      .where(eq(serviceChangeProposalsTable.leistungsanfrageId, requestId));
    expect(rows.filter((row) => row.status === "OPEN")).toHaveLength(1);
    expect(rows.find((row) => row.id === first.id)?.status).toBe("SUPERSEDED");

    const coordination = await request(app)
      .get(`/api/leistungsanfragen/${requestId}/coordination`)
      .set("Authorization", `Bearer ${guToken}`);
    expect(coordination.status).toBe(200);
    expect(coordination.body.currentAgreement.start).toContain("2026-09-01");
    expect(coordination.body.openProposal.start).toContain("2026-09-04");
  });

  it("accepts a proposal only through the local Dataspace roundtrip", async () => {
    const requestId = ROUNDTRIP_REQUEST;
    const [openProposal] = await db.select().from(serviceChangeProposalsTable)
      .where(and(
        eq(serviceChangeProposalsTable.leistungsanfrageId, requestId),
        eq(serviceChangeProposalsTable.status, "OPEN"),
      ));
    const proposal = openProposal ?? await createAgChangeProposal({
      requestId,
      orgId: GU_ORG,
      userId: GU_USER,
      start: new Date("2026-09-03T08:00:00Z"),
      end: new Date("2026-09-07T17:00:00Z"),
    });

    const beforeBookings = await db.execute(
      sql`SELECT count(*)::int AS count FROM resource_bookings WHERE source_reference_id = ${requestId}`,
    );
    const result = await runWithDatabaseRole("ag", () => resolveChangeProposal({
      requestId,
      proposalId: proposal.id,
      orgId: NU_ORG,
      userId: NU_USER,
      status: "ACCEPTED",
    }));

    expect(result.status).toBe("ACCEPTED");
    expect(result).toMatchObject({ transportStatus: "DELIVERED" });
    expect(new Date(result.start).toISOString()).toContain("2026-09-03");
    const afterBookings = await db.execute(
      sql`SELECT count(*)::int AS count FROM resource_bookings WHERE source_reference_id = ${requestId}`,
    );
    expect(afterBookings.rows[0]?.count).toBe(beforeBookings.rows[0]?.count);
  });

  it("keeps published names and the public snapshot through a schedule-change delivery", async () => {
    const requestId = REQUEST_IDS[6];
    const proposal = await createAgChangeProposal({
      requestId,
      orgId: GU_ORG,
      userId: GU_USER,
      start: new Date("2026-09-03T08:00:00Z"),
      end: new Date("2026-09-07T17:00:00Z"),
    });
    const result = await runWithDatabaseRole("ag", () => resolveChangeProposal({
      requestId,
      proposalId: proposal.id,
      orgId: NU_ORG,
      userId: NU_USER,
      status: "ACCEPTED",
    }));

    expect(result).toMatchObject({
      status: "ACCEPTED",
      transportStatus: "DELIVERED",
    });

    const [projection] = await anDb.select().from(anLeistungsanfragenTable).where(and(
      eq(anLeistungsanfragenTable.externalLeistungsanfrageId, proposal.id),
      eq(anLeistungsanfragenTable.receiverAnOrgId, NU_ORG),
    ));
    expect(projection).toBeDefined();
    expect(projection?.payloadSnapshot).toMatchObject({
      requestKind: "SCHEDULE_CHANGE",
      sourceRequestId: requestId,
      changeProposalId: proposal.id,
      senderOrganizationName: "Published T212 Auftraggeber",
      projectName: "Published T212 project",
      publicSnapshot: expect.objectContaining({
        projectReference: PROJECT,
        taktReference: LEISTUNG,
        workPackage: "Published T212 work package",
        kurzbezeichnung: "Published T212 service",
      }),
    });

    const detail = await getAnLeistungsanfrageDetail(proposal.id, NU_ORG);
    expect(detail).toMatchObject({
      guOrgName: "Published T212 Auftraggeber",
      project: {
        id: PROJECT,
        name: "Published T212 project",
        location: "Published T212 site",
      },
      takt: {
        id: LEISTUNG,
        taktBezeichnung: "Published T212 work package",
        kurzbezeichnung: "Published T212 service",
        gewerk: "Published T212 trade",
        zone: "Published T212 zone",
        plannedStart: "2026-09-03",
        plannedEnd: "2026-09-07",
      },
      snapshotPayload: expect.objectContaining({
        projectReference: PROJECT,
        kurzbezeichnung: "Published T212 service",
      }),
    });
  });

  it("requires the opposite party for accept/reject and does not permit unrelated organizations", async () => {
    const requestId = REQUEST_IDS[2];
    const proposal = await createAgChangeProposal({
      requestId, orgId: GU_ORG, userId: GU_USER,
      start: new Date("2026-09-02T08:00:00Z"), end: new Date("2026-09-04T17:00:00Z"),
    });
    const proposer = await request(app)
      .post(`/api/leistungsanfragen/${requestId}/change-proposals/${proposal.id}/accept`)
      .set("Authorization", `Bearer ${guToken}`);
    expect(proposer.status).toBe(403);
    const unrelated = await request(app)
      .post(`/api/leistungsanfragen/${requestId}/change-proposals/${proposal.id}/reject`)
      .set("Authorization", `Bearer ${otherToken}`);
    expect(unrelated.status).toBe(403);

    const rejected = await request(app)
      .post(`/api/leistungsanfragen/${requestId}/change-proposals/${proposal.id}/reject`)
      .set("Authorization", `Bearer ${nuToken}`);
    expect(rejected.status).toBe(200);
    expect(rejected.body.status).toBe("REJECTED");
    const coordination = await request(app)
      .get(`/api/leistungsanfragen/${requestId}/coordination`)
      .set("Authorization", `Bearer ${nuToken}`);
    expect(coordination.body.currentAgreement.start).toContain("2026-09-01");
    expect(coordination.body.proposals).toHaveLength(1);
  });

  it("rejects inverted date windows with a German validation error", async () => {
    const response = await request(app)
      .post(`/api/leistungsanfragen/${REQUEST_IDS[4]}/change-proposals`)
      .set("Authorization", `Bearer ${guToken}`)
      .send({ start: "2026-09-08T17:00:00.000Z", end: "2026-09-07T08:00:00.000Z" });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain("Ende muss nach Beginn liegen");
  });

  it("does not allow new proposals for expired requests", async () => {
    const response = await request(app)
      .post(`/api/leistungsanfragen/${REQUEST_IDS[3]}/change-proposals`)
      .set("Authorization", `Bearer ${guToken}`)
      .send({ start: "2026-09-02T08:00:00.000Z", end: "2026-09-04T17:00:00.000Z" });

    expect(response.status).toBe(409);
    expect(response.body.error).toContain("keine Änderung mehr möglich");
  });

  it("does not resolve a proposal through a different request URL", async () => {
    const proposal = await createAgChangeProposal({
      requestId: REQUEST_IDS[4], orgId: GU_ORG, userId: GU_USER,
      start: new Date("2026-09-02T08:00:00Z"), end: new Date("2026-09-04T17:00:00Z"),
    });

    const response = await request(app)
      .post(`/api/leistungsanfragen/${REQUEST_IDS[2]}/change-proposals/${proposal.id}/accept`)
      .set("Authorization", `Bearer ${nuToken}`);

    expect(response.status).toBe(404);
    expect(response.body.error).toContain("gehört nicht zu dieser Anfrage");

    const rows = await db.select().from(serviceChangeProposalsTable)
      .where(eq(serviceChangeProposalsTable.id, proposal.id));
    expect(rows[0]?.status).toBe("OPEN");
  });

  it("leaves at most one open proposal when two submissions race", async () => {
    const requestId = REQUEST_IDS[5];
    const results = await Promise.allSettled([
      createAgChangeProposal({
        requestId, orgId: GU_ORG, userId: GU_USER,
        start: new Date("2026-09-02T08:00:00Z"), end: new Date("2026-09-04T17:00:00Z"),
      }),
      createAgChangeProposal({
        requestId, orgId: GU_ORG, userId: GU_USER,
        start: new Date("2026-09-03T08:00:00Z"), end: new Date("2026-09-05T17:00:00Z"),
      }),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected");
    expect(rejected).toMatchObject({ status: "rejected", reason: { statusCode: 409 } });

    const rows = await db.select().from(serviceChangeProposalsTable)
      .where(eq(serviceChangeProposalsTable.leistungsanfrageId, requestId));
    expect(rows.filter((row) => row.status === "OPEN")).toHaveLength(1);
  });
});

describe("proposal calculations and history ordering", () => {
  it("calculates signed start/end and duration deltas", () => {
    expect(calculateScheduleDelta(
      "2026-09-01T08:00:00Z", "2026-09-05T17:00:00Z",
      "2026-09-03T08:00:00Z", "2026-09-04T17:00:00Z",
    )).toEqual({ startDays: 2, endDays: -1, durationDays: -3, hasChange: true });
    expect(calculateScheduleDelta(null, originalEnd, originalStart, originalEnd))
      .toEqual({ startDays: 0, endDays: 0, durationDays: 0, hasChange: false });
  });

  it("sorts the timeline chronologically, including proposal resolution events", () => {
    const timeline = buildCoordinationTimeline({
      createdAt: new Date("2026-08-01T08:00:00Z"),
      sentAt: new Date("2026-08-01T09:00:00Z"),
      deliveredAt: new Date("2026-08-01T10:00:00Z"),
      agreedStart: originalStart,
      agreedEnd: originalEnd,
    }, [{
      id: "proposal-1",
      leistungsanfrageId: REQUEST_IDS[0],
      proposerOrgId: GU_ORG,
      proposerUserId: GU_USER,
      start: originalStart,
      end: originalEnd,
      reasonCode: null,
      comment: null,
      action: "PROPOSE",
      status: "ACCEPTED",
      supersedesProposalId: null,
      createdAt: new Date("2026-08-01T11:00:00Z"),
      resolvedAt: new Date("2026-08-01T12:00:00Z"),
      resolvedByUserId: NU_USER,
    }]);
    expect(timeline.map((event) => event.type))
      .toEqual(["REQUEST_CREATED", "REQUEST_SENT", "REQUEST_DELIVERED", "CHANGE_PROPOSAL_CREATED", "CHANGE_PROPOSAL_ACCEPTED"]);
  });
});