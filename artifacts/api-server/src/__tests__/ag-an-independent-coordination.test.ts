/**
 * Independent AG ↔ AN smoke flow.
 *
 * This deliberately uses its own fixture namespace and exercises the public
 * boundary rather than calling domain services directly.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import { sql, and, eq, inArray, or } from "drizzle-orm";
import app from "../app";
import {
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
  projectMembershipsTable,
  coordinationPoliciesTable,
  anLeistungsanfragenTable,
  anAvailabilityChecksTable,
  anLeistungsantwortAlternativenTable,
  anLeistungsantwortenTable,
  anProjectInvitationsTable,
} from "@workspace/db";
import { buildAgFixture, buildAnFixture, buildHubFixture } from "./fixtures";

const PREFIX = "independent-ag-an";
const AG = `${PREFIX}-ag`;
const AN = `${PREFIX}-an`;
const AG_USER = `${PREFIX}-ag-user`;
const AN_USER = `${PREFIX}-an-user`;
const PROJECT = `${PREFIX}-project`;
const TAKT = `${PREFIX}-takt`;
const PROJECT_AGREEMENT_ID = `${PREFIX}-agreement`;
const PARENT_POLICY_VERSION = 1;
const performanceRequestPolicy = {
  purpose: "LEISTUNGSKOORDINATION",
  selectedFields: ["workPackage", "plannedTimeWindow"],
  parentPolicyId: PROJECT_AGREEMENT_ID,
  parentPolicyVersion: PARENT_POLICY_VERSION,
};

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
const agFixture = buildAgFixture({
  prefix: PREFIX,
  organizationIds: [AG, AN],
  userIds: [AG_USER, AN_USER],
});
const anFixture = buildAnFixture({
  prefix: PREFIX,
  organizationIds: [AN],
});
const hubFixture = buildHubFixture({
  prefix: PREFIX,
  organizationIds: [AG, AN],
});
const agDatabase = agFixture.database;
const anDatabase = anFixture.database;
const hubDatabase = hubFixture.database;

async function cleanup() {
  const localRequests = await anDatabase.select({ id: anLeistungsanfragenTable.id })
    .from(anLeistungsanfragenTable)
    .where(eq(anLeistungsanfragenTable.receiverAnOrgId, AN));
  const localRequestIds = localRequests.map(({ id }) => id);
  if (localRequestIds.length) {
    await anDatabase.delete(anAvailabilityChecksTable)
      .where(inArray(anAvailabilityChecksTable.anLeistungsanfrageId, localRequestIds));
    const localResponses = await anDatabase.select({ id: anLeistungsantwortenTable.id })
      .from(anLeistungsantwortenTable)
      .where(inArray(anLeistungsantwortenTable.anLeistungsanfrageId, localRequestIds));
    const localResponseIds = localResponses.map(({ id }) => id);
    if (localResponseIds.length) {
      await anDatabase.delete(anLeistungsantwortAlternativenTable)
        .where(inArray(anLeistungsantwortAlternativenTable.responseId, localResponseIds));
      await anDatabase.delete(anLeistungsantwortenTable)
        .where(inArray(anLeistungsantwortenTable.id, localResponseIds));
    }
    await anDatabase.delete(anLeistungsanfragenTable)
      .where(inArray(anLeistungsanfragenTable.id, localRequestIds));
  }
  const requests = await agDatabase.select({ id: taktRequestsTable.id })
    .from(taktRequestsTable).where(eq(taktRequestsTable.taktId, TAKT));
  const requestIds = requests.map(({ id }) => id);
  if (requestIds.length) {
    const responses = await agDatabase.select({ id: taktResponsesTable.id })
      .from(taktResponsesTable).where(inArray(taktResponsesTable.taktRequestId, requestIds));
    const responseIds = responses.map(({ id }) => id);
    await agDatabase.delete(taktVersionsTable).where(eq(taktVersionsTable.taktId, TAKT));
    await agDatabase.delete(taktResponseDecisionsTable).where(inArray(taktResponseDecisionsTable.taktRequestId, requestIds));
    if (responseIds.length) {
      await agDatabase.delete(taktResponseAlternativesTable).where(inArray(taktResponseAlternativesTable.responseId, responseIds));
      await agDatabase.delete(taktResponsesTable).where(inArray(taktResponsesTable.id, responseIds));
    }
    await agDatabase.delete(taktRequestSnapshotsTable).where(inArray(taktRequestSnapshotsTable.taktRequestId, requestIds));
    await agDatabase.delete(taktRequestsTable).where(inArray(taktRequestsTable.id, requestIds));
  }
  await hubDatabase.delete(messageInboxTable).where(eq(messageInboxTable.recipientOrgId, AN));
  await hubDatabase.delete(messageInboxTable).where(eq(messageInboxTable.recipientOrgId, AG));
  await hubDatabase.delete(messageOutboxTable).where(eq(messageOutboxTable.senderOrgId, AG));
  await hubDatabase.delete(messageOutboxTable).where(eq(messageOutboxTable.recipientOrgId, AG));
  await hubDatabase.delete(dataspaceExchangesTable).where(or(
    eq(dataspaceExchangesTable.senderOrgId, AG),
    eq(dataspaceExchangesTable.receiverOrgId, AG),
    eq(dataspaceExchangesTable.senderOrgId, AN),
    eq(dataspaceExchangesTable.receiverOrgId, AN),
  ));
  await agDatabase.delete(projectContractorsTable).where(eq(projectContractorsTable.projectId, PROJECT));
  await agDatabase.delete(projectMembershipsTable).where(eq(projectMembershipsTable.projectId, PROJECT));
  await agDatabase.delete(coordinationPoliciesTable).where(eq(coordinationPoliciesTable.projectId, PROJECT));
  await agDatabase.delete(takteTable).where(eq(takteTable.id, TAKT));
  await agDatabase.delete(projectsTable).where(eq(projectsTable.id, PROJECT));
  await anDatabase.delete(anProjectInvitationsTable)
    .where(eq(anProjectInvitationsTable.invitationId, `${PREFIX}-invitation`));
  await agDatabase.delete(usersTable).where(eq(usersTable.id, AG_USER));
  await anDatabase.delete(usersTable).where(eq(usersTable.id, AN_USER));
  await hubFixture.cleanupOrganizations();
  await anFixture.cleanupOrganizations();
  await agFixture.cleanupIdentity();
}

beforeAll(async () => {
  await cleanup();
  await agFixture.seedOrganizations([
    { id: AG, name: "Independent AG", type: "AG" },
    { id: AN, name: "Independent AN", type: "AN" },
  ]);
  await anFixture.seedOrganizations([
    { id: AN, name: "Independent AN", type: "AN" },
  ]);
  await agFixture.seedUsers([
    { id: AG_USER, name: "Independent AG User", email: `${AG_USER}@test.local`, passwordHash: "x" },
    { id: AN_USER, name: "Independent AN User", email: `${AN_USER}@test.local`, passwordHash: "x" },
  ]);
  await anDatabase.insert(usersTable).values({
    id: AN_USER, name: "Independent AN User", email: `${AN_USER}@test.local`, passwordHash: "x",
  }).onConflictDoNothing();
  await agDatabase.insert(projectsTable).values({
    id: PROJECT, name: "Independent Project", agOrgId: AG,
    status: "ACTIVE", startDate: "2026-09-01", endDate: "2026-12-31",
  });
  await agDatabase.insert(takteTable).values({
    id: TAKT, projectId: PROJECT, taktBezeichnung: "Independent Leistung",
    zone: "A", gewerk: "Rohbau", plannedStart: "2026-10-01", plannedEnd: "2026-10-14",
    lifecycleStatus: "IN_COORDINATION",
  });
  await agDatabase.insert(projectContractorsTable).values({
    projectId: PROJECT, anOrgId: AN, assignmentStatus: "ACTIVE",
  });
  await agDatabase.insert(coordinationPoliciesTable).values({
    id: PROJECT_AGREEMENT_ID,
    policyKey: PROJECT_AGREEMENT_ID,
    version: PARENT_POLICY_VERSION,
    kind: "PROJECT_AGREEMENT",
    projectId: PROJECT,
    providerOrgId: AG,
    recipientOrgId: AN,
    lifecycleStatus: "ACCEPTED",
    policySnapshot: {
      policyId: PROJECT_AGREEMENT_ID,
      templateId: "PROJECT_MEMBERSHIP",
      templateVersion: 1,
      code: "PROJECT_MEMBERSHIP",
      name: "Project Membership",
      description: "Accepted project coordination agreement",
      permissions: ["READ", "DOWNLOAD", "USE_FOR_PERFORMANCE_COORDINATION", "USE_FOR_SCHEDULE_COORDINATION", "USE_FOR_RESOURCE_COORDINATION", "USE_FOR_EXECUTION_COORDINATION"],
      prohibitions: [],
      provider: { organizationId: AG, userId: null },
      recipientOrganizationId: AN,
      purpose: "PROJECT_MEMBERSHIP",
      projectReference: PROJECT,
      workPackageReference: null,
      validFrom: null,
      validUntil: null,
      createdAt: "2026-09-01T00:00:00.000Z",
    },
    effectivePolicy: {
      policyId: PROJECT_AGREEMENT_ID,
      templateId: "PROJECT_MEMBERSHIP",
      templateVersion: 1,
      code: "PROJECT_MEMBERSHIP",
      name: "Project Membership",
      description: "Accepted project coordination agreement",
      permissions: ["READ", "DOWNLOAD", "USE_FOR_PERFORMANCE_COORDINATION", "USE_FOR_SCHEDULE_COORDINATION", "USE_FOR_RESOURCE_COORDINATION", "USE_FOR_EXECUTION_COORDINATION"],
      prohibitions: [],
      provider: { organizationId: AG, userId: null },
      policyType: "PROJECT_AGREEMENT",
      recipientOrganizationId: AN,
      purpose: "PROJECT_MEMBERSHIP",
      projectReference: PROJECT,
      workPackageReference: null,
      validFrom: null,
      validUntil: null,
      createdAt: "2026-09-01T00:00:00.000Z",
      childPolicyTypes: ["PERFORMANCE_REQUEST", "SCHEDULE_CHANGE", "DATA_OFFER"],
      childPermissions: ["READ", "DOWNLOAD", "USE_FOR_PERFORMANCE_COORDINATION", "USE_FOR_SCHEDULE_COORDINATION", "USE_FOR_RESOURCE_COORDINATION", "USE_FOR_EXECUTION_COORDINATION"],
      allowedPurposes: ["RAHMENTERMINE", "LEISTUNGSKOORDINATION", "AUSFUEHRUNGSINFORMATIONEN", "INDIVIDUELLE_FREIGABE"],
      allowedFieldScope: ["trade", "workPackage", "kurzbezeichnung", "location", "plannedTimeWindow", "bufferTimeWindow", "predecessors", "successors", "taktReference", "taktVersion", "requiredOutput", "resourceRequirements", "constraints", "documentReferences"],
    },
  });
  await agDatabase.execute(sql`
    INSERT INTO project_memberships
      (id, project_id, ag_org_id, an_org_id, invitation_id, correlation_id, status, project_agreement_policy_id)
    VALUES (${`${PREFIX}-membership`}, ${PROJECT}, ${AG}, ${AN},
      ${`${PREFIX}-invitation`}, ${`${PREFIX}-correlation`}, 'ACTIVE', ${PROJECT_AGREEMENT_ID})
    ON CONFLICT DO NOTHING
  `);
  await anDatabase.insert(anProjectInvitationsTable).values({
    id: `${PREFIX}-an-invitation`,
    invitationId: `${PREFIX}-invitation`,
    correlationId: `${PREFIX}-invitation-correlation`,
    senderAgOrgId: AG,
    senderAgOrgName: "Independent AG",
    receiverAnOrgId: AN,
    projectReference: PROJECT,
    projectName: "Independent Project",
    policySnapshot: {
      effectivePolicy: {
        parentMembershipStatus: "ACTIVE",
        childPolicyTypes: ["PERFORMANCE_REQUEST"],
        childPermissions: ["READ", "DOWNLOAD", "USE_FOR_PERFORMANCE_COORDINATION"],
        allowedPurposes: ["LEISTUNGSKOORDINATION"],
        allowedFieldScope: ["workPackage", "plannedTimeWindow"],
      },
    },
    status: "ACCEPTED",
    policyAcceptedAt: new Date(),
  }).onConflictDoNothing();
});

afterAll(cleanup);

describe("independent AG–AN coordination flow", () => {
  let requestId = "";

  it("AG creates and sends a Leistung request", async () => {
    const created = await request(app)
      .post("/api/takt-requests")
      .set("Authorization", `Bearer ${agToken}`)
      .send({
        taktId: TAKT,
        nuOrgId: AN,
        responseRequiredBy: "2026-11-01T12:00:00.000Z",
        ...performanceRequestPolicy,
      });
    expect(created.status).toBe(201);
    expect(created.body.status).toBe("DRAFT");
    requestId = created.body.id;
    const beforeInbound = await anDatabase.select({ id: anLeistungsanfragenTable.id })
      .from(anLeistungsanfragenTable)
      .where(eq(anLeistungsanfragenTable.externalLeistungsanfrageId, requestId));
    expect(beforeInbound).toHaveLength(0);

    const sent = await request(app)
      .post(`/api/takt-requests/${requestId}/send`)
      .set("Authorization", `Bearer ${agToken}`);
    expect([200, 201]).toContain(sent.status);
    expect(sent.body.status).toMatch(/SENT|DELIVERED/);
    const afterInbound = await anDatabase.select({ id: anLeistungsanfragenTable.id })
      .from(anLeistungsanfragenTable)
      .where(eq(anLeistungsanfragenTable.externalLeistungsanfrageId, requestId));
    expect(afterInbound).toHaveLength(1);
    const [outboundEnvelope] = await hubDatabase.select({ payload: messageOutboxTable.payload })
      .from(messageOutboxTable)
      .where(eq(messageOutboxTable.correlationId, requestId));
    const outboundPayload = outboundEnvelope.payload as {
      policySnapshot?: { policyId: string; templateId: string; templateVersion: number; code: string };
    };
    expect(outboundPayload.policySnapshot).toBeDefined();
    const inbound = await hubDatabase.select({ status: dataspaceExchangesTable.status })
      .from(dataspaceExchangesTable)
      .where(and(
        eq(dataspaceExchangesTable.direction, "INBOUND"),
        eq(dataspaceExchangesTable.messageType, "SERVICE_REQUEST"),
        eq(dataspaceExchangesTable.businessObjectId, requestId),
      ));
    expect(inbound).toHaveLength(1);
    expect(inbound[0].status).toBe("PROCESSED");
    const [anProjection] = await anDatabase.select({ policySnapshot: anLeistungsanfragenTable.policySnapshot })
      .from(anLeistungsanfragenTable)
      .where(eq(anLeistungsanfragenTable.externalLeistungsanfrageId, requestId));
    expect(anProjection.policySnapshot).toEqual(outboundPayload.policySnapshot);
  });

  it("AN sees the request, but AG cannot use the AN response endpoint", async () => {
    const inbox = await request(app)
      .get("/api/an/takt-requests?role=nu")
      .set("Authorization", `Bearer ${anToken}`);
    expect(inbox.status).toBe(200);
    expect(inbox.body.some((row: { id: string }) => row.id === requestId)).toBe(true);

    const forbidden = await request(app)
      .post(`/api/an/takt-requests/${requestId}/responses`)
      .set("Authorization", `Bearer ${agToken}`)
      .send({ decision: "ACCEPTED", acceptedTimeWindow: { start: "2026-10-01", end: "2026-10-14" } });
    expect(forbidden.status).toBe(403);
  });

  it("AN accepts and AG confirms the response", async () => {
    const [agRequestBefore] = await agDatabase.select({ status: taktRequestsTable.status })
      .from(taktRequestsTable).where(eq(taktRequestsTable.id, requestId));
    expect(["SENT", "DELIVERED"]).toContain(agRequestBefore.status);

    const details = await request(app)
      .get(`/api/an/takt-requests/${requestId}/details`)
      .set("Authorization", `Bearer ${anToken}`);
    expect(details.status).toBe(200);
    expect(details.body.status).toBe("DETAILS_RETRIEVED");
    const reviewed = await request(app)
      .post(`/api/an/takt-requests/${requestId}/details/review`)
      .set("Authorization", `Bearer ${anToken}`)
      .send({});
    expect(reviewed.status).toBe(200);
    expect(reviewed.body.status).toBe("DETAILS_RETRIEVED");
    const agStatusBeforeAvailability = agRequestBefore.status;
    const [localProjection] = await anDatabase.select({ id: anLeistungsanfragenTable.id })
      .from(anLeistungsanfragenTable)
      .where(eq(anLeistungsanfragenTable.externalLeistungsanfrageId, requestId));
    expect(localProjection).toBeDefined();

    const availability = await request(app)
      .post(`/api/an/takt-requests/${requestId}/availability-checks`)
      .set("Authorization", `Bearer ${anToken}`);
    expect(availability.status).toBe(201);
    expect(availability.body.status).toBe("COMPLETED");

    const latestAvailability = await request(app)
      .get(`/api/an/takt-requests/${requestId}/availability-checks/latest`)
      .set("Authorization", `Bearer ${anToken}`);
    expect(latestAvailability.status).toBe(200);
    expect(latestAvailability.body.checkId).toBe(availability.body.checkId);
    const localChecks = await anDatabase.select({ id: anAvailabilityChecksTable.id })
      .from(anAvailabilityChecksTable)
      .where(eq(anAvailabilityChecksTable.anLeistungsanfrageId, localProjection.id));
    expect(localChecks).toHaveLength(1);
    const [agRequestAfterAvailability] = await agDatabase.select({ status: taktRequestsTable.status })
      .from(taktRequestsTable).where(eq(taktRequestsTable.id, requestId));
    expect(agRequestAfterAvailability.status).toBe(agStatusBeforeAvailability);

    const response = await request(app)
      .post(`/api/an/takt-requests/${requestId}/responses`)
      .set("Authorization", `Bearer ${anToken}`)
      .send({
        decision: "ACCEPTED",
        acceptedTimeWindow: { start: "2026-10-01", end: "2026-10-14" },
        comment: "Kapazität bestätigt",
      });
    expect(response.status).toBe(201);
    const localResponses = await anDatabase.select({ id: anLeistungsantwortenTable.id })
      .from(anLeistungsantwortenTable)
      .where(eq(anLeistungsantwortenTable.anLeistungsanfrageId, localProjection.id));
    expect(localResponses).toHaveLength(1);

    const [agRequestAfterResponse] = await agDatabase.select({ status: taktRequestsTable.status })
      .from(taktRequestsTable).where(eq(taktRequestsTable.id, requestId));
    expect(["SENT", "DELIVERED", "UNDER_REVIEW", "ACCEPTED"]).toContain(agRequestAfterResponse.status);
    const [agResponse] = await agDatabase.select({ id: taktResponsesTable.id })
      .from(taktResponsesTable).where(eq(taktResponsesTable.taktRequestId, requestId));
    expect(agResponse).toBeDefined();
    const responseInbound = await hubDatabase.select({ status: dataspaceExchangesTable.status })
      .from(dataspaceExchangesTable)
      .where(and(
        eq(dataspaceExchangesTable.direction, "INBOUND"),
        eq(dataspaceExchangesTable.messageType, "SERVICE_RESPONSE"),
        eq(dataspaceExchangesTable.businessObjectId, requestId),
      ));
    expect(responseInbound).toHaveLength(1);
    expect(responseInbound[0].status).toBe("PROCESSED");

    const decision = await request(app)
      .post(`/api/takt-requests/${requestId}/gu-decisions`)
      .set("Authorization", `Bearer ${agToken}`)
      .send({ decisionType: "CONFIRM_ACCEPTED", responseId: agResponse.id });
    expect(decision.status).toBe(201);
    expect(decision.body.updatedRequestStatus).toBe("ACCEPTED");
    const [confirmedProjection] = await anDatabase.select({ status: anLeistungsanfragenTable.status })
      .from(anLeistungsanfragenTable)
      .where(eq(anLeistungsanfragenTable.externalLeistungsanfrageId, requestId));
    expect(confirmedProjection.status).toBe("CONFIRMED");
  });

  it("runs alternatives, revision and a shifted second agreement", async () => {
    // Start a fresh coordination round through the public AG API.
    const created = await request(app)
      .post("/api/takt-requests")
      .set("Authorization", `Bearer ${agToken}`)
      .send({ taktId: TAKT, nuOrgId: AN, ...performanceRequestPolicy });
    expect(created.status).toBe(201);
    const firstRoundId = created.body.id as string;

    const sent = await request(app)
      .post(`/api/takt-requests/${firstRoundId}/send`)
      .set("Authorization", `Bearer ${agToken}`);
    expect(sent.status).toBe(200);

    const receivedDetails = await request(app)
      .get(`/api/an/takt-requests/${firstRoundId}/details`)
      .set("Authorization", `Bearer ${anToken}`);
    expect(receivedDetails.status).toBe(200);

    const alternatives = await request(app)
      .post(`/api/an/takt-requests/${firstRoundId}/responses`)
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

    const [oldRequest] = await agDatabase.select({ status: taktRequestsTable.status })
      .from(taktRequestsTable).where(eq(taktRequestsTable.id, firstRoundId));
    expect(oldRequest.status).toBe("SUPERSEDED");

    const shiftedResponse = await request(app)
      .post(`/api/an/takt-requests/${secondRoundId}/responses`)
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

    const [takt] = await agDatabase.select().from(takteTable).where(eq(takteTable.id, TAKT));
    expect(String(takt.plannedStart)).toContain("2026-11-01");
    expect(String(takt.plannedEnd)).toContain("2026-11-14");
    expect(takt.version).toBe(2);

    const versions = await agDatabase.select({ version: taktVersionsTable.version, sourceType: taktVersionsTable.sourceType })
      .from(taktVersionsTable).where(eq(taktVersionsTable.taktId, TAKT));
    expect(versions.some((version) => version.version === 2 && version.sourceType === "REVISION")).toBe(true);

    const [agResponse] = await agDatabase.select({ id: taktResponsesTable.id })
      .from(taktResponsesTable)
      .where(eq(taktResponsesTable.taktRequestId, firstRoundId));
    const alternativesInHistory = await agDatabase.select({ alternativeId: taktResponseAlternativesTable.alternativeId })
      .from(taktResponseAlternativesTable)
      .where(eq(taktResponseAlternativesTable.responseId, agResponse.id));
    expect(alternativesInHistory.map((alternative) => alternative.alternativeId).sort())
      .toEqual([`${PREFIX}-alt-early`, `${PREFIX}-alt-late`].sort());
  });
});