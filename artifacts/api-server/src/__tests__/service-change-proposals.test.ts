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
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  leistungsanfragenTable,
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
} from "../services/service-change-proposal-service";

const JWT_SECRET = process.env.JWT_SECRET ?? "taktkoord-jwt-dev-secret-change-in-prod";
const GU_ORG = "t212-gu-org";
const NU_ORG = "t212-nu-org";
const OTHER_ORG = "t212-other-org";
const GU_USER = "t212-gu-user";
const NU_USER = "t212-nu-user";
const OTHER_USER = "t212-other-user";
const PROJECT = "t212-project";
const LEISTUNG = "t212-leistung";
const REQUEST_IDS = [
  "t212-request-initial",
  "t212-request-counter",
  "t212-request-reject",
  "t212-request-expired",
  "t212-request-mismatch",
  "t212-request-concurrent",
];

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

const originalStart = new Date("2026-09-01T08:00:00.000Z");
const originalEnd = new Date("2026-09-05T17:00:00.000Z");

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
  await db.insert(organizationsTable).values([
    { id: GU_ORG, name: "T212 GU", type: "AG" },
    { id: NU_ORG, name: "T212 NU", type: "AN" },
    { id: OTHER_ORG, name: "T212 Other", type: "AN" },
  ]).onConflictDoNothing();
  await db.insert(usersTable).values([
    { id: GU_USER, name: "T212 GU user", email: "t212-gu@test.invalid", passwordHash: "x" },
    { id: NU_USER, name: "T212 NU user", email: "t212-nu@test.invalid", passwordHash: "x" },
    { id: OTHER_USER, name: "T212 other user", email: "t212-other@test.invalid", passwordHash: "x" },
  ]).onConflictDoNothing();
  await db.insert(projectsTable).values({ id: PROJECT, agOrgId: GU_ORG, name: "T212 project" }).onConflictDoNothing();
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
});

afterAll(async () => {
  // Proposals must be removed before request/organization fixtures. This is
  // intentionally explicit even though the request FK currently cascades.
  await db.delete(serviceChangeProposalsTable)
    .where(inArray(serviceChangeProposalsTable.leistungsanfrageId, REQUEST_IDS))
    .catch(() => {});
  await db.delete(leistungsanfragenTable)
    .where(inArray(leistungsanfragenTable.id, REQUEST_IDS))
    .catch(() => {});
  await db.delete(leistungenTable).where(eq(leistungenTable.id, LEISTUNG)).catch(() => {});
  await db.delete(projectsTable).where(eq(projectsTable.id, PROJECT)).catch(() => {});
  await db.delete(usersTable).where(inArray(usersTable.id, [GU_USER, NU_USER, OTHER_USER])).catch(() => {});
  await db.delete(organizationsTable).where(inArray(organizationsTable.id, [GU_ORG, NU_ORG, OTHER_ORG])).catch(() => {});
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
    const first = await createChangeProposal({
      requestId, orgId: GU_ORG, userId: GU_USER,
      start: new Date("2026-09-03T08:00:00Z"), end: new Date("2026-09-07T17:00:00Z"),
    });
    await expect(createChangeProposal({
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

  it("requires the opposite party for accept/reject and does not permit unrelated organizations", async () => {
    const requestId = REQUEST_IDS[2];
    const proposal = await createChangeProposal({
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
      .send({ start: "2026-09-08T17:00:00.000Z", end: "2026-09-08T08:00:00.000Z" });

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
    const proposal = await createChangeProposal({
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
      createChangeProposal({
        requestId, orgId: GU_ORG, userId: GU_USER,
        start: new Date("2026-09-02T08:00:00Z"), end: new Date("2026-09-04T17:00:00Z"),
      }),
      createChangeProposal({
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
      .toEqual(["REQUEST_CREATED", "REQUEST_SENT", "REQUEST_DELIVERED", "PROPOSED", "AGREEMENT_REACHED", "CHANGE_PROPOSAL_ACCEPTED"]);
  });
});