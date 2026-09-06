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
  leistungsanfrageSnapshotsTable,
  leistungsanfragenTable,
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
const policy = (
  projectId: string,
  providerOrgId: string,
  recipientOrgId: string,
  key: string,
  kind: "PROJECT_AGREEMENT" | "PERFORMANCE_REQUEST",
  deltaClass: PolicyClass | null,
  parentPolicyId?: string,
  options: { validUntil?: string; permissions?: string[] } = {},
) => {
  const permissions = options.permissions ?? ["READ", "USE_FOR_PERFORMANCE_COORDINATION", "USE_FOR_SCHEDULE_COORDINATION"];
  return {
  id: key, policyKey: key, version: 1, kind, projectId, providerOrgId, recipientOrgId, parentPolicyId,
  lifecycleStatus: deltaClass === "REQUIRES_CONSENT" ? "CONSENT_REQUIRED" : "ACCEPTED",
  deltaClass, policySnapshot: { permissions },
  effectivePolicy: {
    projectReference: projectId, recipientOrganizationId: recipientOrgId,
    purpose: kind === "PROJECT_AGREEMENT" ? "LEISTUNGSKOORDINATION" : "LEISTUNGSKOORDINATION",
    allowedPurposes: ["LEISTUNGSKOORDINATION", "scheduleCoordination"],
    prohibitions: ["COMMERCIAL_REUSE"],
    validFrom: "2020-01-01T00:00:00.000Z",
    validUntil: options.validUntil ?? "2099-12-31T23:59:59.000Z",
    childPolicyTypes: ["PERFORMANCE_REQUEST", "SCHEDULE_CHANGE"],
    childPermissions: permissions,
    permissions,
  },
  diff: deltaClass === "REQUIRES_CONSENT" ? { summary: ["Terminfenster wurde konkretisiert"], changed: ["Zeitraum"] } : null,
  };
};

/** Creates only namespaced records. It is safe to call once per Playwright test. */
export async function seedCampusWest(): Promise<Seed> {
  const namespace = `e2e-campus-west-${crypto.randomUUID()}`;
  const agOrgId = id(namespace, "ag");
  const anOrgIds = [1, 2, 3, 4].map((index) => id(namespace, `an-${index}`));
  const userIds = ["ag-user", "an-1-user", "an-2-user", "an-3-user", "an-4-user"].map((name) => id(namespace, name));
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
    { id: userIds[0], name: companyNames[0], email: `${namespace}-ag@example.test`, passwordHash: hash, roles: ["AG_ADMIN"] },
    ...anOrgIds.map((_, index) => ({
      id: userIds[index + 1], name: companyNames[index + 1],
      email: `${namespace}-an${index + 1}@example.test`, passwordHash: hash, roles: ["AN_ADMIN"],
    })),
  ];
  const orgs = [
    { id: agOrgId, name: companyNames[0], type: "AG" as const },
    ...anOrgIds.map((orgId, index) => ({ id: orgId, name: companyNames[index + 1], type: "AN" as const })),
  ];
  // Auth is served from Hub; the AG and AN stores also enforce their own FKs.
  for (const database of [agDb, anDb, hubDb]) {
    await database.insert(organizationsTable).values(orgs).onConflictDoNothing();
    await database.insert(usersTable).values(accounts).onConflictDoNothing();
    await database.insert(userOrganizationsTable).values([
      { userId: userIds[0], orgId: agOrgId, role: "ADMIN" },
      ...anOrgIds.map((orgId, index) => ({ userId: userIds[index + 1], orgId, role: "ADMIN" as const })),
    ]).onConflictDoNothing();
  }
  await agDb.insert(projectsTable).values({ id: projectId, agOrgId, name: "Campus-West", location: "Campus-West", status: "ACTIVE", startDate: "2027-01-01", endDate: "2027-12-31" });
  const parentIds = anOrgIds.map((anOrgId, index) => id(namespace, `parent-${index + 1}`));
  await agDb.insert(coordinationPoliciesTable).values(anOrgIds.map((anOrgId, index) =>
    policy(
      projectId, agOrgId, anOrgId, parentIds[index], "PROJECT_AGREEMENT", "WITHIN_BASELINE", undefined,
      index === 2 ? { validUntil: "2027-06-30T23:59:59.000Z" } :
        index === 1 ? { permissions: ["READ"] } : undefined,
    )));
  await agDb.insert(projectContractorsTable).values(anOrgIds.map((anOrgId, index) => ({
    id: id(namespace, `contractor-${index + 1}`), projectId, anOrgId, trade: ["STAHLBAU", "ELEKTRO", "TGA", "MALER"][index],
    workPackageReference: `L-${101 + index * 100}`, assignmentStatus: "ACTIVE", validFrom: "2027-01-01",
    validTo: index === 2 ? "2027-06-30" : "2027-12-31", createdByUserId: userIds[0],
  })));
  await agDb.insert(projectMembershipsTable).values(anOrgIds.map((anOrgId, index) => ({
    id: id(namespace, `membership-${index + 1}`), projectId, agOrgId, anOrgId,
    status: index === 3 ? "INVITED" : "ACTIVE",
    invitationId: id(namespace, `invitation-${index + 1}`), correlationId: id(namespace, `correlation-${index + 1}`),
    projectAgreementPolicyId: parentIds[index], invitationExpiresAt: index === 2
      ? new Date("2027-06-30T23:59:59.000Z") : new Date("2027-12-31T23:59:59.000Z"),
  })));

  const services = ["L-101", "L-201", "L-301", "L-401"].map((code, index) => ({
    id: id(namespace, code), projectId, leistungsBezeichnung: `${code} Campus-West`, kurzbezeichnung: code,
    zone: "West", gewerk: index % 2 ? "Elektro" : "Trockenbau", plannedStart: "2027-05-10", plannedEnd: "2027-05-14", lifecycleStatus: "IN_COORDINATION" as const,
  }));
  await agDb.insert(leistungenTable).values(services);
  const dependencyIds = ["L-101-201", "L-201-301", "L-301-401"].map((pair) => id(namespace, `dependency-${pair}`));
  await agDb.insert(leistungsabhaengigkeitenTable).values([
    { id: dependencyIds[0], projectId, predecessorId: services[0].id, successorId: services[1].id, type: "EA", lagDays: 0 },
    { id: dependencyIds[1], projectId, predecessorId: services[1].id, successorId: services[2].id, type: "EA", lagDays: 2 },
    { id: dependencyIds[2], projectId, predecessorId: services[2].id, successorId: services[3].id, type: "EA", lagDays: 0 },
  ]);

  const resourceTypeIds = anOrgIds.map((anOrgId, index) => id(namespace, `resource-type-an-${index + 1}`));
  const resourceIds = anOrgIds.map((anOrgId, index) => id(namespace, `resource-an-${index + 1}`));
  for (const database of [anDb]) {
    await database.insert(resourceTypesTable).values(anOrgIds.map((anOrgId, index) => ({
      id: resourceTypeIds[index], anOrgId, name: `${companyNames[index + 1]} Mannschaft`,
      category: "CREW", code: `CW-AN${index + 1}-CREW`, capacityUnit: "PERSONS", defaultDailyCapacity: index === 0 ? 8 : 4,
    })));
    await database.insert(resourcesTable).values(anOrgIds.map((anOrgId, index) => ({
      id: resourceIds[index], anOrgId, type: "CREW", name: `${companyNames[index + 1]} Montageteam`,
      trade: ["STAHLBAU", "ELEKTRO", "TGA", "MALER"][index], capacity: index === 0 ? 8 : 2, capacityUnit: "PERSONS",
      resourceTypeId: resourceTypeIds[index], qualifications: index === 0 ? ["Schweißfachbetrieb"] : [],
    })));
  }
  const requestKeys: Array<[
    PolicyClass | "BILATERAL" | "MULTI_1" | "MULTI_2" | "AN3_EXPIRING" | "AN4_CHILD_REJECT",
    number,
    number,
    PolicyClass,
  ]> = [
    ["WITHIN_BASELINE", 0, 0, "WITHIN_BASELINE"], ["REQUIRES_CONSENT", 1, 0, "REQUIRES_CONSENT"],
    ["NOT_PERMITTED", 2, 0, "NOT_PERMITTED"], ["BILATERAL", 3, 0, "WITHIN_BASELINE"],
    ["MULTI_1", 2, 1, "NOT_PERMITTED"], ["MULTI_2", 3, 2, "WITHIN_BASELINE"],
    ["AN3_EXPIRING", 1, 2, "WITHIN_BASELINE"], ["AN4_CHILD_REJECT", 0, 3, "REQUIRES_CONSENT"],
  ];
  const requestIds = Object.fromEntries(requestKeys.map(([key]) => [key, id(namespace, `request-${key}`)])) as Record<string, string>;
  const assignments = requestKeys.map(([key, serviceIndex, anIndex]) => ({
    requestId: requestIds[key],
    anOrgId: anOrgIds[anIndex],
    serviceId: services[serviceIndex].id,
  }));
  const policyIds: string[] = [...parentIds];
  for (const [key, serviceIndex, anIndex, deltaClass] of requestKeys) {
    const requestId = requestIds[key];
    const childId = id(namespace, `performance-${key}`);
    policyIds.push(childId);
    const childPolicy = policy(
      projectId, agOrgId, anOrgIds[anIndex], childId, "PERFORMANCE_REQUEST", deltaClass, parentIds[anIndex],
      anIndex === 2 ? { validUntil: "2027-06-30T23:59:59.000Z" } :
        anIndex === 1 ? { permissions: ["READ"] } : undefined,
    );
    await agDb.insert(coordinationPoliciesTable).values(childPolicy);
    await agDb.insert(leistungsanfragenTable).values({
      id: requestId, leistungId: services[serviceIndex].id, leistungVersion: 1, guOrgId: agOrgId, nuOrgId: anOrgIds[anIndex],
      requestNumber: `${namespace}-${key}`, selectionGroupId: id(namespace, `group-${key}`), status: "UNDER_REVIEW",
      createdByUserId: userIds[0], performancePolicyId: childId, responseRequiredBy: new Date("2027-04-30T17:00:00.000Z"),
      agreedStart: key === "BILATERAL" ? new Date("2027-05-10T08:00:00.000Z") : null, agreedEnd: key === "BILATERAL" ? new Date("2027-05-14T17:00:00.000Z") : null,
    });
    const payload = {
      schemaVersion: "1.0",
      projectReference: projectId,
      projectLocation: "Campus-West",
      taktReference: services[serviceIndex].id,
      taktVersion: 1,
      kurzbezeichnung: services[serviceIndex].kurzbezeichnung,
      workPackage: services[serviceIndex].leistungsBezeichnung,
      plannedTimeWindow: { start: "2027-05-10", end: "2027-05-14" },
      resourceRequirements: [{
        resourceType: "CREW",
        // The public contract requires this field. An empty note deliberately
        // adds no qualification constraint to this type-only requirement.
        notes: "",
      }],
    };
    await agDb.insert(leistungsanfrageSnapshotsTable).values({ id: id(namespace, `snapshot-${key}`), leistungsanfrageId: requestId, schemaVersion: "1.0", snapshotPayload: payload });
    await anDb.insert(anLeistungsanfragenTable).values({
      id: id(namespace, `an-request-${key}`), externalLeistungsanfrageId: requestId, externalRequestVersion: 1,
      sourceMessageId: id(namespace, `message-${key}`), payloadHash: id(namespace, `hash-${key}`), correlationId: id(namespace, `correlation-${key}`),
      senderAgOrgId: agOrgId, receiverAnOrgId: anOrgIds[anIndex], projectReference: projectId, leistungReference: services[serviceIndex].id,
      plannedStart: "2027-05-10", plannedEnd: "2027-05-14", policyDeltaClass: deltaClass,
      policyConsentStatus: deltaClass === "WITHIN_BASELINE" ? "NOT_REQUIRED" : "PENDING",
      policyDiff: deltaClass === "REQUIRES_CONSENT" ? { summary: ["Terminfenster wurde konkretisiert"], changed: ["Zeitraum"] } : null,
      policySnapshot: { ...childPolicy.policySnapshot, policyId: childId },
      effectivePolicy: childPolicy.effectivePolicy,
      payloadSnapshot: payload, status: "UNDER_REVIEW",
    });
  }
  await anDb.insert(anProjectInvitationsTable).values({
    id: id(namespace, "an4-project-invitation"),
    invitationId: id(namespace, "invitation-4"),
    correlationId: id(namespace, "correlation-4"),
    senderAgOrgId: agOrgId,
    senderAgOrgName: companyNames[0],
    receiverAnOrgId: anOrgIds[3],
    projectReference: projectId,
    projectName: "Campus-West",
    projectLocation: "Campus-West",
    invitationExpiresAt: new Date("2027-12-31T23:59:59.000Z"),
    selectedFields: ["projectReference", "workPackage", "plannedTimeWindow"],
    policySnapshot: policy(projectId, agOrgId, anOrgIds[3], id(namespace, "parent-4"), "PROJECT_AGREEMENT", "WITHIN_BASELINE").effectivePolicy,
    status: "PENDING",
  });
  await agDb.insert(serviceChangeProposalsTable).values({
    id: id(namespace, "proposal-an"), leistungsanfrageId: requestIds.BILATERAL, proposerOrgId: anOrgIds[0], proposerUserId: userIds[1],
    start: new Date("2027-05-12T08:00:00.000Z"), end: new Date("2027-05-16T17:00:00.000Z"), action: "PROPOSE", status: "OPEN", comment: "Campus-West Terminverschiebung",
  });
  const an3Expiring = requestIds.AN3_EXPIRING;
  const an4ChildReject = requestIds.AN4_CHILD_REJECT;
  return {
    runId: namespace, ids: [namespace], projectId, agOrgId, anOrgIds, userIds, policyIds,
    serviceIds: services.map(({ id: serviceId }) => serviceId), dependencyIds, resourceTypeIds, resourceIds, companyNames, assignments,
    boundaryRequestIds: { an3Expiring, an4ChildReject },
    ag: { email: accounts[0].email, password }, an: accounts.slice(1).map(({ email }) => ({ email, password })),
    requests: { WITHIN_BASELINE: requestIds.WITHIN_BASELINE, REQUIRES_CONSENT: requestIds.REQUIRES_CONSENT, NOT_PERMITTED: requestIds.NOT_PERMITTED },
    bilateralRequestId: requestIds.BILATERAL, bilateralProposalId: id(namespace, "proposal-an"),
    multiRequestIds: [requestIds.MULTI_1, requestIds.MULTI_2],
  };
}

export async function cleanupCampusWest(seed: Seed): Promise<void> {
  const requestIds = [
    ...Object.values(seed.requests),
    seed.bilateralRequestId,
    ...seed.multiRequestIds,
    seed.boundaryRequestIds.an3Expiring,
    seed.boundaryRequestIds.an4ChildReject,
  ];
  await anDb.delete(anAvailabilityChecksTable).where(inArray(anAvailabilityChecksTable.anOrgId, seed.anOrgIds));
  await anDb.delete(resourceBookingsTable).where(inArray(resourceBookingsTable.nuOrgId, seed.anOrgIds));
  await anDb.delete(resourcesTable).where(inArray(resourcesTable.id, seed.resourceIds));
  await anDb.delete(resourceTypesTable).where(inArray(resourceTypesTable.anOrgId, seed.anOrgIds));
  await anDb.delete(anProjectInvitationsTable).where(eq(anProjectInvitationsTable.receiverAnOrgId, seed.anOrgIds[3]));
  await anDb.delete(anLeistungsanfragenTable).where(inArray(anLeistungsanfragenTable.externalLeistungsanfrageId, requestIds));
  await agDb.delete(serviceChangeProposalsTable).where(inArray(serviceChangeProposalsTable.leistungsanfrageId, requestIds));
  await agDb.delete(leistungsanfragenTable).where(inArray(leistungsanfragenTable.id, requestIds));
  await agDb.delete(projectMembershipsTable).where(eq(projectMembershipsTable.projectId, seed.projectId));
  await agDb.delete(coordinationPoliciesTable).where(eq(coordinationPoliciesTable.projectId, seed.projectId));
  await agDb.delete(projectContractorsTable).where(eq(projectContractorsTable.projectId, seed.projectId));
  await agDb.delete(leistungsabhaengigkeitenTable).where(eq(leistungsabhaengigkeitenTable.projectId, seed.projectId));
  await agDb.delete(leistungsVersionenTable).where(inArray(
    leistungsVersionenTable.leistungId,
    ["L-101", "L-201", "L-301", "L-401"].map((code) => id(seed.runId, code)),
  ));
  await agDb.delete(leistungenTable).where(eq(leistungenTable.projectId, seed.projectId));
  await agDb.delete(projectsTable).where(eq(projectsTable.id, seed.projectId));
  // Dataspace exchanges and delivery history are Hub transport state. AG/AN
  // clients may use the narrow transport interface, but cleanup must target
  // the owning Hub schema explicitly.
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