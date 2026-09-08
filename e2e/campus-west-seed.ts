import bcrypt from "bcryptjs";
import { eq, inArray } from "drizzle-orm";
import {
  agDb,
  anDb,
  hubDb,
  anAvailabilityChecksTable,
  anLeistungsanfragenTable,
  anProjectInvitationsTable,
  coordinationPoliciesTable,
  dataspaceExchangesTable,
  leistungsabhaengigkeitenTable,
  leistungsanfragenTable,
  leistungsantwortEntscheidungenTable,
  leistungsVersionenTable,
  leistungenTable,
  messageDeliveryAttemptsTable,
  messageInboxTable,
  messageOutboxTable,
  organizationsTable,
  projectContractorsTable,
  projectMembershipsTable,
  projectsTable,
  resourceBookingsTable,
  resourcesTable,
  resourceTypesTable,
  serviceChangeProposalsTable,
  userOrganizationsTable,
  usersTable,
} from "@workspace/db";
import type { PolicyClass, Scenario } from "./fixtures";

export type Seed = Scenario & {
  ids: string[];
  projectId: string;
  agOrgId: string;
  anOrgIds: string[];
  userIds: string[];
  policyIds: string[];
  serviceIds: string[];
  dependencyIds: string[];
  resourceTypeIds: string[];
  resourceIds: string[];
  companyNames: string[];
  assignments: Array<{
    requestId: string;
    anOrgId: string;
    serviceId: string;
  }>;
  boundaryRequestIds: {
    an3Expiring: string;
    an4ChildReject: string;
  };
};

const id = (namespace: string, name: string) => `${namespace}:${name}`;

/**
 * Seeds only the stable local catalogue used by the business workflows.
 *
 * Invitations, memberships, policies, requests, snapshots, Dataspace
 * projections, responses, and proposals are deliberately created by the
 * authenticated product APIs in e2e/fixtures.ts and the Playwright specs.
 */
export async function seedCampusWest(): Promise<Seed> {
  // Keep generated identifiers short enough for the Dataspace envelope's
  // correlationId limit; the UUID still makes every test run isolated.
  const namespace = `cw-${crypto.randomUUID()}`;
  const agOrgId = id(namespace, "ag");
  const anOrgIds = [1, 2, 3, 4].map((index) => id(namespace, `an-${index}`));
  const userIds = ["ag-user", "an-1-user", "an-2-user", "an-3-user", "an-4-user"]
    .map((name) => id(namespace, name));
  const projectId = id(namespace, "project");
  const companyNames = [
    "Baukoordination West GmbH",
    "Stahlbau Ruhr GmbH",
    "Elektro West GmbH",
    "TGA Technik GmbH",
    "Maler Süd GmbH",
  ];
  const password = `E2E-${crypto.randomUUID()}`;
  const hash = await bcrypt.hash(password, 10);
  const accounts = [
    {
      id: userIds[0],
      name: companyNames[0],
      email: `${namespace}-ag@example.test`,
      passwordHash: hash,
      roles: ["AG_ADMIN"],
    },
    ...anOrgIds.map((_, index) => ({
      id: userIds[index + 1],
      name: companyNames[index + 1],
      email: `${namespace}-an${index + 1}@example.test`,
      passwordHash: hash,
      roles: ["AN_ADMIN"],
    })),
  ];
  const orgs = [
    { id: agOrgId, name: companyNames[0], type: "AG" as const },
    ...anOrgIds.map((orgId, index) => ({
      id: orgId,
      name: companyNames[index + 1],
      type: "AN" as const,
    })),
  ];

  // Authentication is served from Hub; the AG and AN stores also enforce
  // their own foreign keys for the local projections created later.
  for (const database of [agDb, anDb, hubDb]) {
    await database.insert(organizationsTable).values(orgs).onConflictDoNothing();
    await database.insert(usersTable).values(accounts).onConflictDoNothing();
    await database.insert(userOrganizationsTable).values([
      { userId: userIds[0], orgId: agOrgId, role: "ADMIN" },
      ...anOrgIds.map((orgId, index) => ({
        userId: userIds[index + 1],
        orgId,
        role: "ADMIN" as const,
      })),
    ]).onConflictDoNothing();
  }

  await agDb.insert(projectsTable).values({
    id: projectId,
    agOrgId,
    name: "Campus-West",
    location: "Campus-West",
    status: "ACTIVE",
    startDate: "2027-01-01",
    endDate: "2027-12-31",
  });

  await agDb.insert(projectContractorsTable).values(anOrgIds.map((anOrgId, index) => ({
    id: id(namespace, `contractor-${index + 1}`),
    projectId,
    anOrgId,
    trade: ["STAHLBAU", "ELEKTRO", "TGA", "MALER"][index],
    workPackageReference: `L-${101 + index * 100}`,
    assignmentStatus: "ACTIVE",
    validFrom: "2027-01-01",
    validTo: "2027-12-31",
    createdByUserId: userIds[0],
  })));

  const services = ["L-101", "L-201", "L-301", "L-401"].map((code, index) => ({
    id: id(namespace, code),
    projectId,
    leistungsBezeichnung: `${code} Campus-West`,
    kurzbezeichnung: code,
    zone: "West",
    gewerk: index % 2 ? "Elektro" : "Trockenbau",
    plannedStart: "2027-05-10",
    plannedEnd: "2027-05-14",
    lifecycleStatus: "PLANNED" as const,
  }));
  await agDb.insert(leistungenTable).values(services);

  const dependencyIds = ["L-101-201", "L-201-301", "L-301-401"]
    .map((pair) => id(namespace, `dependency-${pair}`));
  await agDb.insert(leistungsabhaengigkeitenTable).values([
    {
      id: dependencyIds[0],
      projectId,
      predecessorId: services[0].id,
      successorId: services[1].id,
      type: "EA",
      lagDays: 0,
    },
    {
      id: dependencyIds[1],
      projectId,
      predecessorId: services[1].id,
      successorId: services[2].id,
      type: "EA",
      lagDays: 2,
    },
    {
      id: dependencyIds[2],
      projectId,
      predecessorId: services[2].id,
      successorId: services[3].id,
      type: "EA",
      lagDays: 0,
    },
  ]);

  const resourceTypeIds = anOrgIds.map((_, index) => id(namespace, `resource-type-an-${index + 1}`));
  const resourceIds = anOrgIds.map((_, index) => id(namespace, `resource-an-${index + 1}`));
  await anDb.insert(resourceTypesTable).values(anOrgIds.map((anOrgId, index) => ({
    id: resourceTypeIds[index],
    anOrgId,
    name: `${companyNames[index + 1]} Mannschaft`,
    category: "CREW",
    code: `CW-AN${index + 1}-CREW`,
    capacityUnit: "PERSONS",
    defaultDailyCapacity: index === 0 ? 8 : 4,
  })));
  await anDb.insert(resourcesTable).values(anOrgIds.map((anOrgId, index) => ({
    id: resourceIds[index],
    anOrgId,
    type: "CREW",
    name: `${companyNames[index + 1]} Montageteam`,
    trade: ["STAHLBAU", "ELEKTRO", "TGA", "MALER"][index],
    capacity: index === 0 ? 8 : 2,
    capacityUnit: "PERSONS",
    resourceTypeId: resourceTypeIds[index],
    qualifications: index === 0 ? ["Schweißfachbetrieb"] : [],
  })));

  return {
    runId: namespace,
    ids: [namespace],
    projectId,
    agOrgId,
    anOrgIds,
    userIds,
    policyIds: [],
    serviceIds: services.map(({ id: serviceId }) => serviceId),
    dependencyIds,
    resourceTypeIds,
    resourceIds,
    companyNames,
    assignments: [],
    boundaryRequestIds: { an3Expiring: "", an4ChildReject: "" },
    ag: { email: accounts[0].email, password },
    an: accounts.slice(1).map(({ email }) => ({ email, password })),
    requests: {} as Record<PolicyClass, string>,
    consentDeltaClass: "REQUIRES_CONSENT",
    notPermittedAttempt: {
      status: 0,
      code: "",
      requestCountBefore: 0,
      requestCountAfter: 0,
      projectionCountBefore: 0,
      projectionCountAfter: 0,
    },
    bilateralRequestId: "",
    bilateralProposalId: "",
    multiRequestIds: [],
  };
}

export async function restrictProjectAgreementPurposes(
  policyId: string,
  allowedPurposes: string[],
): Promise<void> {
  const [policy] = await agDb.select().from(coordinationPoliciesTable)
    .where(eq(coordinationPoliciesTable.id, policyId));
  if (!policy) throw new Error(`Project agreement ${policyId} not found`);
  await agDb.update(coordinationPoliciesTable)
    .set({
      policySnapshot: {
        ...(policy.policySnapshot as Record<string, unknown>),
        allowedPurposes,
      },
      effectivePolicy: {
        ...(policy.effectivePolicy as Record<string, unknown>),
        allowedPurposes,
      },
    })
    .where(eq(coordinationPoliciesTable.id, policyId));
}

export async function cleanupCampusWest(seed: Seed): Promise<void> {
  const seededRequestIds = [
    ...Object.values(seed.requests),
    seed.bilateralRequestId,
    ...seed.multiRequestIds,
    seed.boundaryRequestIds.an3Expiring,
    seed.boundaryRequestIds.an4ChildReject,
  ].filter(Boolean);
  const projectRequests = await agDb.select({ id: leistungsanfragenTable.id })
    .from(leistungsanfragenTable)
    .where(inArray(leistungsanfragenTable.leistungId, seed.serviceIds));
  const requestIds = Array.from(new Set([
    ...seededRequestIds,
    ...projectRequests.map(({ id: requestId }) => requestId),
  ]));

  await anDb.delete(anAvailabilityChecksTable).where(inArray(anAvailabilityChecksTable.anOrgId, seed.anOrgIds));
  await anDb.delete(resourceBookingsTable).where(inArray(resourceBookingsTable.nuOrgId, seed.anOrgIds));
  await anDb.delete(resourcesTable).where(inArray(resourcesTable.id, seed.resourceIds));
  await anDb.delete(resourceTypesTable).where(inArray(resourceTypesTable.anOrgId, seed.anOrgIds));
  await anDb.delete(anProjectInvitationsTable).where(inArray(anProjectInvitationsTable.receiverAnOrgId, seed.anOrgIds));
  if (requestIds.length) {
    await anDb.delete(anLeistungsanfragenTable)
      .where(inArray(anLeistungsanfragenTable.externalLeistungsanfrageId, requestIds));
    await agDb.delete(serviceChangeProposalsTable)
      .where(inArray(serviceChangeProposalsTable.leistungsanfrageId, requestIds));
    await agDb.delete(leistungsantwortEntscheidungenTable)
      .where(inArray(leistungsantwortEntscheidungenTable.leistungsanfrageId, requestIds));
    await agDb.delete(leistungsanfragenTable).where(inArray(leistungsanfragenTable.id, requestIds));
  }
  await agDb.delete(projectMembershipsTable).where(eq(projectMembershipsTable.projectId, seed.projectId));
  await agDb.delete(coordinationPoliciesTable).where(eq(coordinationPoliciesTable.projectId, seed.projectId));
  await agDb.delete(projectContractorsTable).where(eq(projectContractorsTable.projectId, seed.projectId));
  await agDb.delete(leistungsabhaengigkeitenTable).where(eq(leistungsabhaengigkeitenTable.projectId, seed.projectId));
  await agDb.delete(leistungsVersionenTable).where(inArray(
    leistungsVersionenTable.leistungId,
    seed.serviceIds,
  ));
  await agDb.delete(leistungenTable).where(eq(leistungenTable.projectId, seed.projectId));
  await agDb.delete(projectsTable).where(eq(projectsTable.id, seed.projectId));

  // Dataspace exchanges and delivery history belong to Hub in the separated
  // physical-database layout. Remove append-only children before outbox rows.
  await hubDb.delete(dataspaceExchangesTable)
    .where(inArray(dataspaceExchangesTable.senderOrgId, [seed.agOrgId, ...seed.anOrgIds]));
  const outboxRows = await hubDb.select({ messageId: messageOutboxTable.messageId })
    .from(messageOutboxTable)
    .where(inArray(messageOutboxTable.senderOrgId, [seed.agOrgId, ...seed.anOrgIds]));
  const messageIds = outboxRows.map(({ messageId }) => messageId);
  if (messageIds.length) {
    await hubDb.delete(messageDeliveryAttemptsTable).where(inArray(messageDeliveryAttemptsTable.messageId, messageIds));
    await hubDb.delete(messageInboxTable).where(inArray(messageInboxTable.messageId, messageIds));
    await hubDb.delete(messageOutboxTable).where(inArray(messageOutboxTable.messageId, messageIds));
  }
  for (const database of [agDb, anDb, hubDb]) {
    await database.delete(userOrganizationsTable).where(inArray(userOrganizationsTable.userId, seed.userIds));
    await database.delete(usersTable).where(inArray(usersTable.id, seed.userIds));
    await database.delete(organizationsTable).where(inArray(organizationsTable.id, [seed.agOrgId, ...seed.anOrgIds]));
  }
}