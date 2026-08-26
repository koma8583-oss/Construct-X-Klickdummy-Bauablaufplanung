/**
 * Physical AG ↔ AN ↔ Hub boundary tests.
 *
 * Unlike the normal PoC suite, this file never falls back to DATABASE_URL.
 * Run it with AG_DATABASE_URL, AN_DATABASE_URL, and HUB_DATABASE_URL pointing
 * at three separately migrated PostgreSQL databases.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  agDb,
  anDb,
  hubDb,
  assertDatabaseConfiguration,
  anLeistungsanfrageResourceRequirementsTable,
  anLeistungsanfragenTable,
  anProjectInvitationsTable,
  anAvailabilityChecksTable,
  dataspaceExchangesTable,
  messageInboxTable,
  messageOutboxTable,
  organizationsTable,
  projectMembershipsTable,
  projectsTable,
  resourceBookingsTable,
  resourceTypesTable,
  taktRequestsTable,
  taktResponsesTable,
  takteTable,
  usersTable,
} from "@workspace/db";
import {
  deliverLocalProjectInvitation,
  deliverLocalProjectInvitationResponse,
  deliverLocalServiceRequest,
} from "../services/dataspace/local-dataspace-delivery";
import { RestDataspaceExchange } from "../services/dataspace/rest-dataspace-exchange";
import {
  processIncomingCoordinationDecision,
  processIncomingServiceRequest,
  processIncomingServiceResponse,
} from "../services/dataspace/inbound-domain-service";
import type {
  ExternalCoordinationDecision,
  ExternalProjectInvitation,
  ExternalProjectInvitationResponse,
  ExternalServiceRequest,
  ExternalServiceResponse,
} from "../services/dataspace/external-contracts";

const hasAnyRoleTarget = [
  process.env.AG_DATABASE_URL,
  process.env.AN_DATABASE_URL,
  process.env.HUB_DATABASE_URL,
].some(Boolean);

const PREFIX = `physical-boundary-${crypto.randomUUID()}`;
const AG = `${PREFIX}-ag`;
const AN = `${PREFIX}-an`;
const PROJECT = `${PREFIX}-project`;
const USER = `${PREFIX}-user`;
const TAKT = `${PREFIX}-takt`;
const SERVICE_REQUEST = `${PREFIX}-service-request`;
const SCHEDULE_REQUEST = `${PREFIX}-schedule-request`;
const RESOURCE_TYPE = `${PREFIX}-resource-type`;

const iso = (value: string) => `${value}T00:00:00.000Z`;

function metadata(messageId: string, correlationId: string) {
  return {
    messageId,
    correlationId,
    schemaVersion: "1.0" as const,
    senderOrgId: AG,
    receiverOrgId: AN,
    createdAt: iso("2026-08-26"),
  };
}

function policySnapshot() {
  return {
    policyId: `${PREFIX}-policy`,
    templateId: "PROJECT_COORDINATION",
    templateVersion: 1,
    code: "PROJECT_COORDINATION",
    name: "Physical boundary test policy",
    description: "A policy used only by the physical boundary suite.",
    permissions: ["read:project"],
    prohibitions: ["share-outside-project"],
    provider: { organizationId: AG, userId: null },
    recipientOrganizationId: AN,
    purpose: "Project coordination",
    projectReference: PROJECT,
    workPackageReference: null,
    validFrom: null,
    validUntil: null,
    createdAt: iso("2026-08-26"),
  };
}

function invitation(messageId = `${PREFIX}-invitation`): ExternalProjectInvitation {
  return {
    metadata: { ...metadata(messageId, `${PREFIX}-invitation-correlation`) },
    invitationId: `${PREFIX}-invitation-id`,
    project: { projectReference: PROJECT, projectName: "Physical boundary project" },
    requestedRole: "CONTRACTOR",
    purpose: "PROJECT_COLLABORATION",
    policy: {
      usagePurpose: "PROJECT_MEMBERSHIP",
      allowedConsumerParticipantId: `local:${AN}`,
    },
    policySnapshot: policySnapshot(),
  };
}

function invitationResponse(): ExternalProjectInvitationResponse {
  return {
    metadata: {
      ...metadata(`${PREFIX}-invitation-response`, `${PREFIX}-invitation-correlation`),
      senderOrgId: AN,
      receiverOrgId: AG,
    },
    invitationId: `${PREFIX}-invitation-id`,
    projectReference: PROJECT,
    decision: "ACCEPTED",
    policyAccepted: true,
    respondedAt: iso("2026-08-27"),
  };
}

function serviceRequest(
  requestId: string,
  messageId: string,
  requestVersion = 1,
  overrides: Partial<ExternalServiceRequest> = {},
): ExternalServiceRequest {
  return {
    metadata: metadata(messageId, `${PREFIX}-${requestId}-correlation`),
    requestId,
    requestVersion,
    projectReference: PROJECT,
    leistungReference: TAKT,
    plannedStart: "2026-09-01",
    plannedEnd: "2026-09-05",
    resourceRequirements: [{
      resourceTypeCode: "CREW",
      resourceTypeName: "Montageteam",
      requiredCapacity: 2,
      capacityUnit: "PERSONS",
      utilizationPercent: 100,
      periodStart: "2026-09-01",
      periodEnd: "2026-09-05",
    }],
    policySnapshot: policySnapshot(),
    ...overrides,
  };
}

function serviceResponse(requestId: string, messageId: string): ExternalServiceResponse {
  return {
    metadata: {
      ...metadata(messageId, `${PREFIX}-${requestId}-correlation`),
      senderOrgId: AN,
      receiverOrgId: AG,
    },
    requestId,
    requestVersion: 1,
    decision: "ACCEPTED",
    acceptedTimeWindow: { start: iso("2026-09-01"), end: iso("2026-09-05") },
  };
}

async function tableExists(database: typeof agDb, tableName: string): Promise<boolean> {
  const result = await database.execute<{ relation_name: string | null }>(
    sql`SELECT to_regclass(${`public.${tableName}`}) AS relation_name`,
  );
  return Boolean(result.rows[0]?.relation_name);
}

async function seedFixtures() {
  await Promise.all([
    hubDb.insert(organizationsTable).values([
      { id: AG, name: "Physical boundary AG", type: "AG" },
      { id: AN, name: "Physical boundary AN", type: "AN" },
    ]),
    agDb.insert(organizationsTable).values([
      { id: AG, name: "Physical boundary AG", type: "AG" },
      { id: AN, name: "Physical boundary AN", type: "AN" },
    ]),
    anDb.insert(organizationsTable).values([
      { id: AG, name: "Physical boundary AG", type: "AG" },
      { id: AN, name: "Physical boundary AN", type: "AN" },
    ]),
  ]);

  await agDb.insert(usersTable).values({
    id: USER,
    name: "Physical boundary test user",
    email: `${USER}@example.test`,
    passwordHash: "not-used",
    roles: ["AG_ADMIN"],
  });
  await agDb.insert(projectsTable).values({
    id: PROJECT,
    agOrgId: AG,
    name: "Physical boundary project",
    startDate: "2026-08-01",
    endDate: "2026-12-31",
  });
  await agDb.insert(takteTable).values({
    id: TAKT,
    projectId: PROJECT,
    taktBezeichnung: "Physical boundary Takt",
    gewerk: "Montage",
    plannedStart: "2026-09-01",
    plannedEnd: "2026-09-05",
  });
  await agDb.insert(taktRequestsTable).values({
    id: SERVICE_REQUEST,
    taktId: TAKT,
    taktVersion: 1,
    guOrgId: AG,
    nuOrgId: AN,
    requestNumber: `${PREFIX}-request-number`,
    status: "SENT",
    createdByUserId: USER,
  });
  await anDb.insert(resourceTypesTable).values({
    id: RESOURCE_TYPE,
    anOrgId: AN,
    name: "Montageteam",
    category: "CREW",
    code: "CREW",
    capacityUnit: "PERSONS",
  });
  await agDb.insert(projectMembershipsTable).values({
    id: `${PREFIX}-membership`,
    projectId: PROJECT,
    agOrgId: AG,
    anOrgId: AN,
    anParticipantId: `local:${AN}`,
    status: "INVITED",
    invitationId: `${PREFIX}-invitation-id`,
    correlationId: `${PREFIX}-invitation-correlation`,
  });
}

async function cleanupFixtures() {
  const anRequests = await anDb.select({ id: anLeistungsanfragenTable.id })
    .from(anLeistungsanfragenTable)
    .where(eq(anLeistungsanfragenTable.receiverAnOrgId, AN));
  const anRequestIds = anRequests.map((row) => row.id);
  if (anRequestIds.length) {
    await anDb.delete(anAvailabilityChecksTable)
      .where(inArray(anAvailabilityChecksTable.anLeistungsanfrageId, anRequestIds));
    await anDb.delete(anLeistungsanfrageResourceRequirementsTable)
      .where(inArray(anLeistungsanfrageResourceRequirementsTable.anLeistungsanfrageId, anRequestIds));
    await anDb.delete(anLeistungsanfragenTable)
      .where(inArray(anLeistungsanfragenTable.id, anRequestIds));
  }
  await anDb.delete(resourceBookingsTable).where(eq(resourceBookingsTable.nuOrgId, AN));
  await anDb.delete(anProjectInvitationsTable).where(eq(anProjectInvitationsTable.receiverAnOrgId, AN));
  await anDb.delete(resourceTypesTable).where(eq(resourceTypesTable.id, RESOURCE_TYPE));

  await agDb.delete(taktResponsesTable).where(eq(taktResponsesTable.taktRequestId, SERVICE_REQUEST));
  await agDb.delete(projectMembershipsTable).where(eq(projectMembershipsTable.projectId, PROJECT));
  await agDb.delete(taktRequestsTable).where(eq(taktRequestsTable.id, SERVICE_REQUEST));
  await agDb.delete(takteTable).where(eq(takteTable.id, TAKT));
  await agDb.delete(projectsTable).where(eq(projectsTable.id, PROJECT));
  await agDb.delete(usersTable).where(eq(usersTable.id, USER));

  await hubDb.delete(messageInboxTable).where(
    inArray(messageInboxTable.senderOrgId, [AG, AN]),
  );
  await hubDb.delete(messageOutboxTable).where(
    inArray(messageOutboxTable.senderOrgId, [AG, AN]),
  );
  await hubDb.delete(dataspaceExchangesTable).where(
    inArray(dataspaceExchangesTable.senderOrgId, [AG, AN]),
  );
  await Promise.all([
    hubDb.delete(organizationsTable).where(inArray(organizationsTable.id, [AG, AN])),
    anDb.delete(organizationsTable).where(inArray(organizationsTable.id, [AG, AN])),
    agDb.delete(organizationsTable).where(inArray(organizationsTable.id, [AG, AN])),
  ]);
}

// No role URLs means this opt-in suite is unavailable in the shared-PoC
// workspace. A partial role configuration must run and fail in
// assertDatabaseConfiguration rather than silently skipping a broken setup.
const physicalBoundary = hasAnyRoleTarget ? describe : describe.skip;

physicalBoundary("physically separate AG, AN and Hub databases", () => {
  beforeAll(async () => {
    await assertDatabaseConfiguration();
    await seedFixtures();
  });

  afterAll(async () => {
    await cleanupFixtures();
  });

  it("rejects a configuration that does not provide physical private-table boundaries", async () => {
    expect(await tableExists(agDb, "resources")).toBe(false);
    expect(await tableExists(agDb, "resource_bookings")).toBe(false);
    expect(await tableExists(anDb, "leistungen")).toBe(false);
    expect(await tableExists(anDb, "leistungsanfragen")).toBe(false);
    expect(await tableExists(hubDb, "resources")).toBe(false);
    expect(await tableExists(hubDb, "leistungen")).toBe(false);
  });

  it("delivers a project invitation locally while keeping invitation data on AN and transport data on Hub", async () => {
    const result = await deliverLocalProjectInvitation(invitation());
    expect(result.status).toBe("DELIVERED");

    const [anInvitation] = await anDb.select().from(anProjectInvitationsTable)
      .where(eq(anProjectInvitationsTable.invitationId, `${PREFIX}-invitation-id`));
    expect(anInvitation?.receiverAnOrgId).toBe(AN);

    const [outbox] = await hubDb.select().from(messageOutboxTable)
      .where(eq(messageOutboxTable.messageId, `${PREFIX}-invitation`));
    const [inbox] = await hubDb.select().from(messageInboxTable)
      .where(eq(messageInboxTable.messageId, `${PREFIX}-invitation`));
    expect(outbox?.status).toBe("DELIVERED");
    expect(inbox?.recipientOrgId).toBe(AN);

    const response = await deliverLocalProjectInvitationResponse(invitationResponse());
    expect(response.status).toBe("DELIVERED");
    const [membership] = await agDb.select({ status: projectMembershipsTable.status })
      .from(projectMembershipsTable)
      .where(eq(projectMembershipsTable.invitationId, `${PREFIX}-invitation-id`));
    expect(membership?.status).toBe("ACTIVE");
    expect(await anDb.select().from(anLeistungsanfragenTable)
      .where(eq(anLeistungsanfragenTable.externalLeistungsanfrageId, `${PREFIX}-invitation-id`))).toHaveLength(0);
  });

  it("runs SERVICE_REQUEST locally, applies SERVICE_RESPONSE through AG, and rejects replay tampering", async () => {
    const request = serviceRequest(SERVICE_REQUEST, `${PREFIX}-service-request`);
    expect((await deliverLocalServiceRequest(request)).status).toBe("DELIVERED");

    const [projection] = await anDb.select().from(anLeistungsanfragenTable)
      .where(eq(anLeistungsanfragenTable.externalLeistungsanfrageId, SERVICE_REQUEST));
    expect(projection?.senderAgOrgId).toBe(AG);
    expect(projection?.receiverAnOrgId).toBe(AN);
    expect(await tableExists(agDb, "an_leistungsanfragen")).toBe(false);

    const responsePayload = serviceResponse(SERVICE_REQUEST, `${PREFIX}-service-response`);
    const response = await new RestDataspaceExchange().receiveServiceResponse(
      responsePayload,
      processIncomingServiceResponse,
    );
    expect(response.status).toBe("PROCESSED");
    expect(await agDb.select().from(taktResponsesTable)
      .where(eq(taktResponsesTable.taktRequestId, SERVICE_REQUEST))).toHaveLength(1);
    expect(await tableExists(anDb, "leistungsantworten")).toBe(false);

    const replay = await new RestDataspaceExchange().receiveServiceResponse(
      responsePayload,
      processIncomingServiceResponse,
    );
    expect(replay).toEqual({ duplicate: true, status: "DUPLICATE" });
    await expect(new RestDataspaceExchange().receiveServiceResponse(
      { ...responsePayload, comment: "tampered" },
      processIncomingServiceResponse,
    )).rejects.toThrow(/conflicts/);
  });

  it("processes a SCHEDULE_CHANGE on AN, confirms only an AN-local booking, and returns through the inbound processor", async () => {
    const initial = serviceRequest(
      SCHEDULE_REQUEST,
      `${PREFIX}-schedule-initial`,
    );
    await new RestDataspaceExchange().receiveServiceRequest(
      initial,
      processIncomingServiceRequest,
    );

    const schedule = serviceRequest(
      SCHEDULE_REQUEST,
      `${PREFIX}-schedule-change`,
      2,
      {
        requestKind: "SCHEDULE_CHANGE",
        sourceRequestId: SCHEDULE_REQUEST,
        changeProposalId: `${PREFIX}-change-proposal`,
        plannedStart: "2026-09-08",
        plannedEnd: "2026-09-12",
        baseTimeWindow: { start: iso("2026-09-01"), end: iso("2026-09-05") },
      },
    );
    let generatedResponse: ExternalServiceResponse | undefined;
    const inbound = await new RestDataspaceExchange().receiveServiceRequest(
      schedule,
      (payload) => processIncomingServiceRequest(payload, async (response) => {
        generatedResponse = response;
      }),
    );
    expect(inbound.status).toBe("PROCESSED");
    expect(generatedResponse?.requestKind).toBe("SCHEDULE_CHANGE");
    expect(generatedResponse?.metadata.senderOrgId).toBe(AN);

    const [scheduleProjection] = await anDb.select().from(anLeistungsanfragenTable)
      .where(and(
        eq(anLeistungsanfragenTable.externalLeistungsanfrageId, SCHEDULE_REQUEST),
        eq(anLeistungsanfragenTable.externalRequestVersion, 2),
      ));
    expect(scheduleProjection).toBeDefined();
    expect(await anDb.select().from(anAvailabilityChecksTable)
      .where(eq(anAvailabilityChecksTable.anLeistungsanfrageId, scheduleProjection.id))).not.toHaveLength(0);
    expect(await tableExists(agDb, "an_leistungsanfragen")).toBe(false);

    const decision: ExternalCoordinationDecision = {
      metadata: {
        ...metadata(`${PREFIX}-decision`, `${PREFIX}-decision-correlation`),
      },
      requestId: SCHEDULE_REQUEST,
      requestVersion: 2,
      taktVersion: 2,
      decisionType: "CONFIRM_ACCEPTED",
      confirmedTimeWindow: { start: iso("2026-09-08"), end: iso("2026-09-12") },
    };
    decision.metadata.correlationId = scheduleProjection.correlationId;
    const processed = await new RestDataspaceExchange().receiveCoordinationDecision(
      decision,
      processIncomingCoordinationDecision,
    );
    expect(processed.status).toBe("PROCESSED");
    const bookings = await anDb.select().from(resourceBookingsTable)
      .where(eq(resourceBookingsTable.sourceReferenceId, scheduleProjection.id));
    expect(bookings).toHaveLength(1);
    expect(await tableExists(agDb, "resource_bookings")).toBe(false);
  });
});
