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
import { and, eq, inArray, or, sql } from "drizzle-orm";
import { agDb as db, anDb, hubDb, runWithDatabaseRole } from "@workspace/db";
import {
  anAvailabilityChecksTable,
  anLeistungsanfragenTable,
  anLeistungsantwortenTable,
  dataspaceExchangesTable,
  messageDeliveryAttemptsTable,
  messageInboxTable,
  leistungsanfragenTable,
  leistungsanfrageSnapshotsTable,
  leistungenTable,
  organizationsTable,
  projectsTable,
  messageOutboxTable,
  serviceChangeProposalsTable,
  coordinationPoliciesTable,
  usersTable,
} from "@workspace/db";
import app from "../app";
import {
  buildCoordinationTimeline,
  calculateScheduleDelta,
  createChangeProposal,
  resolveChangeProposal,
  applyIncomingScheduleChangeResponseOnAg,
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
  "t212-request-an-local",
  "t212-request-an-init",
  "t212-request-policy-chain",
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
const POLICY_AGREEMENT = "t212-policy-agreement";
const POLICY_PERFORMANCE = "t212-policy-performance";

async function cleanupFixtures() {
  await hubDb.delete(messageDeliveryAttemptsTable)
    .where(sql`message_id LIKE 'an-schedule-change:%' OR message_id LIKE 'coordination-decision:%'`)
    .catch(() => {});
  await hubDb.delete(messageInboxTable).where(or(
    eq(messageInboxTable.senderOrgId, GU_ORG),
    eq(messageInboxTable.recipientOrgId, GU_ORG),
    eq(messageInboxTable.senderOrgId, NU_ORG),
    eq(messageInboxTable.recipientOrgId, NU_ORG),
  )).catch(() => {});
  await hubDb.delete(messageOutboxTable).where(or(
    eq(messageOutboxTable.senderOrgId, GU_ORG),
    eq(messageOutboxTable.recipientOrgId, GU_ORG),
    eq(messageOutboxTable.senderOrgId, NU_ORG),
    eq(messageOutboxTable.recipientOrgId, NU_ORG),
  )).catch(() => {});
  await hubDb.delete(dataspaceExchangesTable).where(or(
    eq(dataspaceExchangesTable.senderOrgId, GU_ORG),
    eq(dataspaceExchangesTable.receiverOrgId, GU_ORG),
    eq(dataspaceExchangesTable.senderOrgId, NU_ORG),
    eq(dataspaceExchangesTable.receiverOrgId, NU_ORG),
  )).catch(() => {});
  // Keep reruns independent from a previous interrupted Vitest process. The
  // AN projection is filtered by its fixture organisation because schedule
  // change projections use generated proposal IDs rather than request IDs.
  await anDb.delete(anLeistungsanfragenTable)
    .where(eq(anLeistungsanfragenTable.receiverAnOrgId, NU_ORG))
    .catch(() => {});
  await db.delete(serviceChangeProposalsTable)
    .where(inArray(serviceChangeProposalsTable.leistungsanfrageId, REQUEST_IDS))
    .catch(() => {});
  await db.update(leistungsanfragenTable).set({
    performancePolicyId: null, scheduleChangePolicyId: null,
  }).where(inArray(leistungsanfragenTable.id, REQUEST_IDS)).catch(() => {});
  await db.delete(coordinationPoliciesTable).where(and(
    eq(coordinationPoliciesTable.projectId, PROJECT),
    eq(coordinationPoliciesTable.kind, "SCHEDULE_CHANGE"),
  )).catch(() => {});
  await db.delete(coordinationPoliciesTable).where(inArray(coordinationPoliciesTable.id, [
    POLICY_PERFORMANCE, POLICY_AGREEMENT,
  ])).catch(() => {});
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
  await insertRequest("t212-request-an-local", "AN-LOCAL");
  await insertRequest("t212-request-an-init", "AN-INIT");
  await insertRequest("t212-request-policy-chain", "POLICY-CHAIN");
  await db.insert(coordinationPoliciesTable).values([
    {
      id: POLICY_AGREEMENT, policyKey: "t212:agreement", version: 1, kind: "PROJECT_AGREEMENT",
      projectId: PROJECT, providerOrgId: GU_ORG, recipientOrgId: NU_ORG, lifecycleStatus: "ACCEPTED",
      policySnapshot: {}, effectivePolicy: {
        policyType: "PROJECT_AGREEMENT", projectReference: PROJECT, recipientOrganizationId: NU_ORG,
        childPolicyTypes: ["PERFORMANCE_REQUEST", "SCHEDULE_CHANGE"],
        childPermissions: ["READ", "USE_FOR_SCHEDULE_COORDINATION"],
        permissions: ["READ", "USE_FOR_SCHEDULE_COORDINATION"], prohibitions: [],
      },
    },
    {
      id: POLICY_PERFORMANCE, policyKey: "t212:performance", version: 1, kind: "PERFORMANCE_REQUEST",
      projectId: PROJECT, providerOrgId: GU_ORG, recipientOrgId: NU_ORG, parentPolicyId: POLICY_AGREEMENT,
      lifecycleStatus: "ACCEPTED", policySnapshot: {}, effectivePolicy: {
        policyType: "PERFORMANCE_REQUEST", projectReference: PROJECT, recipientOrganizationId: NU_ORG,
        childPolicyTypes: ["SCHEDULE_CHANGE"], childPermissions: ["READ", "USE_FOR_SCHEDULE_COORDINATION"],
        permissions: ["READ", "USE_FOR_SCHEDULE_COORDINATION"], prohibitions: [],
      },
    },
  ]);
  await db.update(leistungsanfragenTable).set({ performancePolicyId: POLICY_PERFORMANCE })
    .where(inArray(leistungsanfragenTable.id, [
      "t212-request-policy-chain",
    ]));
  await db.insert(leistungsanfrageSnapshotsTable).values({
    leistungsanfrageId: REQUEST_IDS[6],
    schemaVersion: publishedSnapshot.schemaVersion,
    snapshotPayload: publishedSnapshot as Record<string, unknown>,
  });
  const [localProjection] = await anDb.insert(anLeistungsanfragenTable).values({
    id: "t212-an-local-projection",
    externalLeistungsanfrageId: "t212-request-an-local",
    externalRequestVersion: 1,
    sourceMessageId: "t212-an-local-message",
    payloadHash: "t212-an-local-hash",
    correlationId: "t212-request-an-local",
    senderAgOrgId: GU_ORG,
    receiverAnOrgId: NU_ORG,
    projectReference: PROJECT,
    leistungReference: LEISTUNG,
    plannedStart: "2026-09-01",
    plannedEnd: "2026-09-05",
    payloadSnapshot: {
      requestKind: "INITIAL",
      publicSnapshot: publishedSnapshot,
    },
    status: "RESPONDED",
  }).returning();
  await anDb.insert(anLeistungsantwortenTable).values({
    anLeistungsanfrageId: localProjection.id,
    sourceRequestId: "t212-request-an-local",
    requestVersion: 1,
    decision: "ACCEPTED",
    acceptedStart: originalStart,
    acceptedEnd: originalEnd,
    payloadHash: "t212-an-local-response-hash",
    outboundMessageId: "t212-an-local-response",
    createdByUserId: NU_USER,
  });
  await anDb.insert(anLeistungsanfragenTable).values({
    id: "t212-an-init-projection",
    externalLeistungsanfrageId: "t212-request-an-init",
    externalRequestVersion: 1,
    sourceMessageId: "t212-an-init-message",
    payloadHash: "t212-an-init-hash",
    correlationId: "t212-request-an-init",
    senderAgOrgId: GU_ORG,
    receiverAnOrgId: NU_ORG,
    projectReference: PROJECT,
    leistungReference: LEISTUNG,
    plannedStart: "2026-09-01",
    plannedEnd: "2026-09-05",
    payloadSnapshot: {
      requestKind: "INITIAL",
      publicSnapshot: publishedSnapshot,
    },
    status: "RESPONDED",
  });
  await anDb.insert(anLeistungsantwortenTable).values({
    anLeistungsanfrageId: "t212-an-init-projection",
    sourceRequestId: "t212-request-an-init",
    requestVersion: 1,
    decision: "ACCEPTED",
    acceptedStart: originalStart,
    acceptedEnd: originalEnd,
    payloadHash: "t212-an-init-response-hash",
    outboundMessageId: "t212-an-init-response",
    createdByUserId: NU_USER,
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
    // The AG namespace is no longer an exception path for AN callers.
    expect(counter.status).toBe(403);

    const rows = await db.select().from(serviceChangeProposalsTable)
      .where(eq(serviceChangeProposalsTable.leistungsanfrageId, requestId));
    expect(rows.filter((row) => row.status === "OPEN")).toHaveLength(1);
    expect(rows.find((row) => row.id === first.id)?.status).toBe("OPEN");

    const coordination = await request(app)
      .get(`/api/leistungsanfragen/${requestId}/coordination`)
      .set("Authorization", `Bearer ${guToken}`);
    expect(coordination.status).toBe(200);
    expect(coordination.body.currentAgreement.start).toContain("2026-09-01");
    expect(coordination.body.openProposal.start).toContain("2026-09-03");
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
        // The AN projection owns its local identifier; the published AG
        // reference remains in publicSnapshot above.
        id: expect.any(String),
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
    expect(detail?.takt?.id).not.toBe(LEISTUNG);
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
    expect(rejected.status).toBe(403);
    const coordination = await request(app)
      .get(`/api/leistungsanfragen/${requestId}/coordination`)
      .set("Authorization", `Bearer ${guToken}`);
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
      .set("Authorization", `Bearer ${guToken}`);

    expect(response.status).toBe(404);
    expect(response.body.error).toContain("gehört nicht zu dieser Anfrage");

    const rows = await db.select().from(serviceChangeProposalsTable)
      .where(eq(serviceChangeProposalsTable.id, proposal.id));
    expect(rows[0]?.status).toBe("OPEN");
  });

  it("uses the AN projection for local proposal reads and acceptance", async () => {
    const requestId = "t212-request-an-local";
    const proposal = await createAgChangeProposal({
      requestId,
      orgId: GU_ORG,
      userId: GU_USER,
      start: new Date("2026-09-03T08:00:00Z"),
      end: new Date("2026-09-07T17:00:00Z"),
    });

    const localView = await request(app)
      .get(`/api/an/leistungsanfragen/${requestId}/coordination`)
      .set("Authorization", `Bearer ${nuToken}`);
    expect(localView.status).toBe(200);
    expect(localView.body.openProposal.id).toBe(proposal.id);
    expect(localView.body.currentAgreement.start).toContain("2026-09-01");

    const mismatched = await request(app)
      .get(`/api/an/leistungsanfragen/${REQUEST_IDS[2]}/coordination`)
      .set("Authorization", `Bearer ${nuToken}`);
    expect(mismatched.status).toBe(404);

    const oppositeNamespace = await request(app)
      .get(`/api/an/leistungsanfragen/${requestId}/coordination`)
      .set("Authorization", `Bearer ${guToken}`);
    expect(oppositeNamespace.status).toBe(403);

    const sharedNamespace = await request(app)
      .get(`/api/leistungsanfragen/${requestId}/coordination`)
      .set("Authorization", `Bearer ${nuToken}`);
    expect(sharedNamespace.status).toBe(403);

    const accepted = await request(app)
      .post(`/api/an/leistungsanfragen/${requestId}/change-proposals/${proposal.id}/accept`)
      .set("Authorization", `Bearer ${nuToken}`);
    expect([200, 201]).toContain(accepted.status);
    expect(accepted.body.decision).toBe("ACCEPTED");
    const retried = await request(app)
      .post(`/api/an/leistungsanfragen/${requestId}/change-proposals/${proposal.id}/accept`)
      .set("Authorization", `Bearer ${nuToken}`);
    expect(retried.status).toBe(200);
    const afterAcceptance = await request(app)
      .get(`/api/an/leistungsanfragen/${requestId}/coordination`)
      .set("Authorization", `Bearer ${nuToken}`);
    expect(afterAcceptance.body.openProposal).toBeNull();
    expect(afterAcceptance.body.currentAgreement.start).toContain("2026-09-03");
  });

  it("delivers and confirms an AN-initiated proposal exactly once", async () => {
    const requestId = "t212-request-an-init";
    const first = await request(app)
      .post(`/api/an/leistungsanfragen/${requestId}/change-proposals`)
      .set("Authorization", `Bearer ${nuToken}`)
      .send({ start: "2026-09-03T08:00:00.000Z", end: "2026-09-07T17:00:00.000Z", reasonCode: "SEQUENCING" });
    expect(first.status).toBe(201);

    const retry = await request(app)
      .post(`/api/an/leistungsanfragen/${requestId}/change-proposals`)
      .set("Authorization", `Bearer ${nuToken}`)
      .send({ start: "2026-09-03T08:00:00.000Z", end: "2026-09-07T17:00:00.000Z", reasonCode: "SEQUENCING" });
    expect(retry.status).toBe(201);
    expect(retry.body.proposalId).toBe(first.body.proposalId);
    const [localProjection] = await anDb.select().from(anLeistungsanfragenTable)
      .where(eq(anLeistungsanfragenTable.externalLeistungsanfrageId, first.body.proposalId));
    const checks = await anDb.select().from(anAvailabilityChecksTable)
      .where(eq(anAvailabilityChecksTable.anLeistungsanfrageId, localProjection.id));
    expect(checks).toHaveLength(1);

    const agView = await request(app)
      .get(`/api/leistungsanfragen/${requestId}/coordination`)
      .set("Authorization", `Bearer ${guToken}`);
    expect(agView.status).toBe(200);
    expect(agView.body.openProposal.id).toBe(first.body.proposalId);

    const accepted = await request(app)
      .post(`/api/leistungsanfragen/${requestId}/change-proposals/${first.body.proposalId}/accept`)
      .set("Authorization", `Bearer ${guToken}`);
    expect([200, 201]).toContain(accepted.status);

    const anView = await request(app)
      .get(`/api/an/leistungsanfragen/${requestId}/coordination`)
      .set("Authorization", `Bearer ${nuToken}`);
    expect(anView.status).toBe(200);
    expect(anView.body.openProposal).toBeNull();
    expect(anView.body.currentAgreement.start).toContain("2026-09-03");
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

  it("versions schedule policies without replacing the agreed period until consent", async () => {
    const requestId = "t212-request-policy-chain";
    const first = await createAgChangeProposal({
      requestId, orgId: GU_ORG, userId: GU_USER,
      start: new Date("2026-09-03T08:00:00Z"), end: new Date("2026-09-07T17:00:00Z"),
    });
    const pending = await db.select().from(coordinationPoliciesTable).where(and(
      eq(coordinationPoliciesTable.kind, "SCHEDULE_CHANGE"),
      eq(coordinationPoliciesTable.parentPolicyId, POLICY_PERFORMANCE),
    ));
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ version: 1, lifecycleStatus: "PUBLISHED" });
    expect((pending[0]?.policySnapshot as Record<string, unknown>).parentPolicyId).toBe(POLICY_PERFORMANCE);
    expect((await db.select().from(leistungsanfragenTable).where(eq(leistungsanfragenTable.id, requestId)))[0]?.agreedStart)
      .toEqual(originalStart);

    await runWithDatabaseRole("ag", () => resolveChangeProposal({
      requestId, proposalId: first.id, orgId: NU_ORG, userId: NU_USER, status: "ACCEPTED",
    }));
    const accepted = await db.select().from(coordinationPoliciesTable).where(and(
      eq(coordinationPoliciesTable.kind, "SCHEDULE_CHANGE"),
      eq(coordinationPoliciesTable.parentPolicyId, POLICY_PERFORMANCE),
    ));
    expect(accepted).toHaveLength(1);
    expect(accepted[0]).toMatchObject({ version: 1, lifecycleStatus: "ACCEPTED" });

    const second = await createAgChangeProposal({
      requestId, orgId: GU_ORG, userId: GU_USER,
      start: new Date("2026-09-04T08:00:00Z"), end: new Date("2026-09-08T17:00:00Z"),
    });
    await runWithDatabaseRole("ag", () => resolveChangeProposal({
      requestId, proposalId: second.id, orgId: NU_ORG, userId: NU_USER, status: "REJECTED",
    }));
    const afterReject = await db.select().from(coordinationPoliciesTable).where(and(
      eq(coordinationPoliciesTable.kind, "SCHEDULE_CHANGE"),
      eq(coordinationPoliciesTable.parentPolicyId, POLICY_PERFORMANCE),
    )).orderBy(coordinationPoliciesTable.version);
    expect(afterReject.map((row) => row.lifecycleStatus)).toEqual(["ACCEPTED", "REJECTED"]);
    expect((await db.select().from(leistungsanfragenTable).where(eq(leistungsanfragenTable.id, requestId)))[0]?.agreedStart)
      .toEqual(new Date("2026-09-03T08:00:00.000Z"));

    const third = await createAgChangeProposal({
      requestId, orgId: GU_ORG, userId: GU_USER,
      start: new Date("2026-09-05T08:00:00Z"), end: new Date("2026-09-09T17:00:00Z"),
    });
    const counter = await createAgChangeProposal({
      requestId, orgId: NU_ORG, userId: NU_USER, action: "COUNTER", supersedesProposalId: third.id,
      start: new Date("2026-09-06T08:00:00Z"), end: new Date("2026-09-10T17:00:00Z"),
    });
    await runWithDatabaseRole("ag", () => resolveChangeProposal({
      requestId, proposalId: counter.id, orgId: GU_ORG, userId: GU_USER, status: "ACCEPTED",
    }));
    const chain = await db.select().from(coordinationPoliciesTable).where(and(
      eq(coordinationPoliciesTable.kind, "SCHEDULE_CHANGE"),
      eq(coordinationPoliciesTable.parentPolicyId, POLICY_PERFORMANCE),
    ));
    expect(chain.filter((row) => row.lifecycleStatus === "ACCEPTED")).toHaveLength(1);
    expect(chain.filter((row) => row.lifecycleStatus === "SUPERSEDED")).toHaveLength(2);
    expect(chain.map((row) => (row.policySnapshot as Record<string, unknown>).inheritFrom))
      .toEqual(expect.arrayContaining([POLICY_PERFORMANCE]));
  });

  it("rejects an inbound acceptance whose window differs from the open proposal", async () => {
    const requestId = "t212-request-policy-chain";
    const proposal = await createAgChangeProposal({
      requestId, orgId: GU_ORG, userId: GU_USER,
      start: new Date("2026-09-11T08:00:00Z"), end: new Date("2026-09-15T17:00:00Z"),
    });
    await expect(applyIncomingScheduleChangeResponseOnAg({
      metadata: { messageId: `mismatch-${proposal.id}`, correlationId: proposal.id, schemaVersion: "1.0", senderOrgId: NU_ORG, receiverOrgId: GU_ORG, createdAt: new Date().toISOString() },
      requestId: proposal.id, requestVersion: 1, requestKind: "SCHEDULE_CHANGE", sourceRequestId: requestId,
      changeProposalId: proposal.id, decision: "ACCEPTED",
      acceptedTimeWindow: { start: "2026-09-12T08:00:00.000Z", end: "2026-09-16T17:00:00.000Z" },
    })).rejects.toMatchObject({ statusCode: 409 });
    const [unchanged] = await db.select().from(leistungsanfragenTable).where(eq(leistungsanfragenTable.id, requestId));
    const [stillOpen] = await db.select().from(serviceChangeProposalsTable).where(eq(serviceChangeProposalsTable.id, proposal.id));
    expect(stillOpen?.status).toBe("OPEN");
    expect(unchanged?.agreedStart?.toISOString()).toContain("2026-09-06");

    // Close the invalid candidate, then race opposite inbound decisions for
    // one new candidate.  Only the conditional OPEN->resolved claim may win.
    await applyIncomingScheduleChangeResponseOnAg({
      metadata: { messageId: `reject-${proposal.id}`, correlationId: proposal.id, schemaVersion: "1.0", senderOrgId: NU_ORG, receiverOrgId: GU_ORG, createdAt: new Date().toISOString() },
      requestId: proposal.id, requestVersion: 1, requestKind: "SCHEDULE_CHANGE", sourceRequestId: requestId,
      changeProposalId: proposal.id, decision: "REJECTED",
    });
    const raced = await createAgChangeProposal({
      requestId, orgId: GU_ORG, userId: GU_USER,
      start: new Date("2026-09-12T08:00:00Z"), end: new Date("2026-09-16T17:00:00Z"),
    });
    const response = (decision: "ACCEPTED" | "REJECTED") => applyIncomingScheduleChangeResponseOnAg({
      metadata: { messageId: `race-${decision}-${raced.id}`, correlationId: raced.id, schemaVersion: "1.0", senderOrgId: NU_ORG, receiverOrgId: GU_ORG, createdAt: new Date().toISOString() },
      requestId: raced.id, requestVersion: 1, requestKind: "SCHEDULE_CHANGE", sourceRequestId: requestId,
      changeProposalId: raced.id, decision,
      ...(decision === "ACCEPTED" ? { acceptedTimeWindow: { start: raced.start.toISOString(), end: raced.end.toISOString() } } : {}),
    });
    const results = await Promise.all([response("ACCEPTED"), response("REJECTED")]);
    expect(results.filter((result) => !result.idempotent)).toHaveLength(1);
    const [resolved] = await db.select().from(serviceChangeProposalsTable).where(eq(serviceChangeProposalsTable.id, raced.id));
    const [afterRace] = await db.select().from(leistungsanfragenTable).where(eq(leistungsanfragenTable.id, requestId));
    expect(["ACCEPTED", "REJECTED"]).toContain(resolved?.status);
    expect(afterRace?.agreedStart?.toISOString()).toContain(
      resolved?.status === "ACCEPTED" ? "2026-09-12" : "2026-09-06",
    );
  });

  it("rechecks an expired root policy when accepting an already-created proposal", async () => {
    const requestId = "t212-request-policy-chain";
    const proposal = await createAgChangeProposal({
      requestId, orgId: GU_ORG, userId: GU_USER,
      start: new Date("2026-09-17T08:00:00Z"), end: new Date("2026-09-21T17:00:00Z"),
    });
    const [root] = await db.select().from(coordinationPoliciesTable)
      .where(eq(coordinationPoliciesTable.id, POLICY_PERFORMANCE));
    await db.update(coordinationPoliciesTable).set({
      effectivePolicy: {
        policyType: "PERFORMANCE_REQUEST", projectReference: PROJECT, recipientOrganizationId: NU_ORG,
        childPolicyTypes: ["SCHEDULE_CHANGE"], childPermissions: ["READ", "USE_FOR_SCHEDULE_COORDINATION"],
        permissions: ["READ", "USE_FOR_SCHEDULE_COORDINATION"], prohibitions: [],
        validUntil: "2020-01-01T00:00:00.000Z",
      },
    }).where(eq(coordinationPoliciesTable.id, POLICY_PERFORMANCE));
    await expect(runWithDatabaseRole("ag", () => resolveChangeProposal({
      requestId, proposalId: proposal.id, orgId: NU_ORG, userId: NU_USER, status: "ACCEPTED",
    }))).rejects.toMatchObject({ statusCode: 409 });
    const [stillOpen] = await db.select().from(serviceChangeProposalsTable).where(eq(serviceChangeProposalsTable.id, proposal.id));
    expect(stillOpen?.status).toBe("OPEN");
    await db.update(coordinationPoliciesTable).set({ effectivePolicy: root!.effectivePolicy })
      .where(eq(coordinationPoliciesTable.id, POLICY_PERFORMANCE));
  });

  it("blocks AG and AN proposal and counter entry points at every root-policy gate before writes or delivery", async () => {
    const requestId = "t212-request-an-init";
    await db.update(leistungsanfragenTable).set({ performancePolicyId: POLICY_PERFORMANCE })
      .where(eq(leistungsanfragenTable.id, requestId));
    const [basePolicy] = await db.select().from(coordinationPoliciesTable)
      .where(eq(coordinationPoliciesTable.id, POLICY_PERFORMANCE));
    const [baseProjection] = await anDb.select().from(anLeistungsanfragenTable).where(and(
      eq(anLeistungsanfragenTable.externalLeistungsanfrageId, requestId),
      eq(anLeistungsanfragenTable.receiverAnOrgId, NU_ORG),
    ));
    expect(basePolicy).toBeDefined();
    expect(baseProjection).toBeDefined();

    const baseEffectivePolicy = basePolicy!.effectivePolicy as Record<string, unknown>;
    const baseProjectionEffectivePolicy = baseProjection!.effectivePolicy as Record<string, unknown>;
    const sideEffects = async () => Promise.all([
      db.select({
        id: serviceChangeProposalsTable.id,
        status: serviceChangeProposalsTable.status,
      }).from(serviceChangeProposalsTable)
        .where(eq(serviceChangeProposalsTable.leistungsanfrageId, requestId))
        .orderBy(serviceChangeProposalsTable.id),
      anDb.select({ count: sql<number>`count(*)::int` }).from(anAvailabilityChecksTable)
        .where(eq(anAvailabilityChecksTable.anOrgId, NU_ORG)),
      hubDb.select({ count: sql<number>`count(*)::int` }).from(messageOutboxTable).where(or(
        eq(messageOutboxTable.senderOrgId, GU_ORG),
        eq(messageOutboxTable.senderOrgId, NU_ORG),
      )),
      hubDb.select({ count: sql<number>`count(*)::int` }).from(dataspaceExchangesTable).where(or(
        eq(dataspaceExchangesTable.senderOrgId, GU_ORG),
        eq(dataspaceExchangesTable.senderOrgId, NU_ORG),
      )),
    ]);
    const restoreRootPolicy = async () => {
      await db.update(coordinationPoliciesTable).set({
        deltaClass: "WITHIN_BASELINE",
        lifecycleStatus: "ACCEPTED",
        effectivePolicy: baseEffectivePolicy,
      }).where(eq(coordinationPoliciesTable.id, POLICY_PERFORMANCE));
      await anDb.update(anLeistungsanfragenTable).set({
        policyDeltaClass: "WITHIN_BASELINE",
        policyConsentStatus: "NOT_REQUIRED",
        effectivePolicy: baseProjectionEffectivePolicy,
      }).where(eq(anLeistungsanfragenTable.id, baseProjection!.id));
    };

    const cases = [
      {
        name: "REQUIRES_CONSENT",
        ag: { deltaClass: "REQUIRES_CONSENT" as const, lifecycleStatus: "PUBLISHED" as const },
        an: { policyDeltaClass: "REQUIRES_CONSENT" as const, policyConsentStatus: "PENDING" as const },
        error: "POLICY_CONSENT_REQUIRED",
        effective: {},
      },
      {
        name: "NOT_PERMITTED",
        ag: { deltaClass: "NOT_PERMITTED" as const, lifecycleStatus: "ACCEPTED" as const },
        an: { policyDeltaClass: "NOT_PERMITTED" as const, policyConsentStatus: "NOT_REQUIRED" as const },
        error: "NOT_PERMITTED",
        effective: {},
      },
      {
        name: "expired validity",
        ag: { deltaClass: "WITHIN_BASELINE" as const, lifecycleStatus: "ACCEPTED" as const },
        an: { policyDeltaClass: "WITHIN_BASELINE" as const, policyConsentStatus: "NOT_REQUIRED" as const },
        error: "NOT_PERMITTED",
        effective: { validUntil: "2000-01-01T00:00:00.000Z" },
      },
      {
        name: "expired retention",
        ag: { deltaClass: "WITHIN_BASELINE" as const, lifecycleStatus: "ACCEPTED" as const },
        an: { policyDeltaClass: "WITHIN_BASELINE" as const, policyConsentStatus: "NOT_REQUIRED" as const },
        error: "NOT_PERMITTED",
        effective: { retentionUntil: "2000-01-01T00:00:00.000Z" },
      },
    ];

    for (const policyCase of cases) {
      const effective = { ...baseEffectivePolicy, ...policyCase.effective };
      const projectionEffective = { ...baseProjectionEffectivePolicy, ...policyCase.effective };
      await db.update(coordinationPoliciesTable).set({
        ...policyCase.ag,
        effectivePolicy: effective,
      }).where(eq(coordinationPoliciesTable.id, POLICY_PERFORMANCE));
      await anDb.update(anLeistungsanfragenTable).set({
        ...policyCase.an,
        effectivePolicy: projectionEffective,
      }).where(eq(anLeistungsanfragenTable.id, baseProjection!.id));

      const beforeProposal = await sideEffects();
      const agProposal = await request(app)
        .post(`/api/leistungsanfragen/${requestId}/change-proposals`)
        .set("Authorization", `Bearer ${guToken}`)
        .send({ start: "2026-09-03T08:00:00.000Z", end: "2026-09-07T17:00:00.000Z" });
      const anProposal = await request(app)
        .post(`/api/an/leistungsanfragen/${requestId}/change-proposals`)
        .set("Authorization", `Bearer ${nuToken}`)
        .send({ start: "2026-09-03T08:00:00.000Z", end: "2026-09-07T17:00:00.000Z" });
      expect(agProposal.status, policyCase.name).toBe(409);
      expect(anProposal.status, policyCase.name).toBe(409);
      expect(agProposal.body.error ?? agProposal.body.code).toBe(policyCase.error);
      expect(anProposal.body.error).toBe(policyCase.error);
      expect(await sideEffects()).toEqual(beforeProposal);

      await restoreRootPolicy();
      const open = await request(app)
        .post(`/api/leistungsanfragen/${requestId}/change-proposals`)
        .set("Authorization", `Bearer ${guToken}`)
        .send({ start: "2026-09-03T08:00:00.000Z", end: "2026-09-07T17:00:00.000Z" });
      expect(open.status).toBe(201);

      await db.update(coordinationPoliciesTable).set({
        ...policyCase.ag,
        effectivePolicy: effective,
      }).where(eq(coordinationPoliciesTable.id, POLICY_PERFORMANCE));
      await anDb.update(anLeistungsanfragenTable).set({
        ...policyCase.an,
        effectivePolicy: projectionEffective,
      }).where(eq(anLeistungsanfragenTable.id, baseProjection!.id));
      const beforeCounter = await sideEffects();
      const agCounter = await request(app)
        .post(`/api/leistungsanfragen/${requestId}/change-proposals/${open.body.id}/counter`)
        .set("Authorization", `Bearer ${guToken}`)
        .send({ start: "2026-09-04T08:00:00.000Z", end: "2026-09-08T17:00:00.000Z" });
      const anCounter = await request(app)
        .post(`/api/an/leistungsanfragen/${requestId}/change-proposals/${open.body.id}/counter`)
        .set("Authorization", `Bearer ${nuToken}`)
        .send({ start: "2026-09-04T08:00:00.000Z", end: "2026-09-08T17:00:00.000Z" });
      expect(agCounter.status, `${policyCase.name} counter`).toBe(409);
      expect(anCounter.status, `${policyCase.name} counter`).toBe(409);
      expect(await sideEffects()).toEqual(beforeCounter);

      await anDb.delete(anLeistungsanfragenTable)
        .where(eq(anLeistungsanfragenTable.externalLeistungsanfrageId, open.body.id));
      await db.delete(serviceChangeProposalsTable)
        .where(eq(serviceChangeProposalsTable.id, open.body.id));
      await restoreRootPolicy();
    }
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