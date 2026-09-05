import bcrypt from "bcryptjs";
import { eq, inArray } from "drizzle-orm";
import {
  agDb,
  anDb,
  hubDb,
  anAvailabilityChecksTable,
  anLeistungsanfragenTable,
  coordinationPoliciesTable,
  dataspaceExchangesTable,
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
  serviceChangeProposalsTable,
  userOrganizationsTable,
  usersTable,
} from "@workspace/db";
import type { PolicyClass, Scenario } from "./fixtures";

export type Seed = Scenario & { ids: string[]; projectId: string; agOrgId: string; anOrgIds: string[]; userIds: string[]; policyIds: string[] };
const id = (namespace: string, name: string) => `${namespace}:${name}`;
const policy = (projectId: string, providerOrgId: string, recipientOrgId: string, key: string, kind: "PROJECT_AGREEMENT" | "PERFORMANCE_REQUEST", deltaClass: PolicyClass | null, parentPolicyId?: string) => ({
  id: key, policyKey: key, version: 1, kind, projectId, providerOrgId, recipientOrgId, parentPolicyId,
  lifecycleStatus: deltaClass === "REQUIRES_CONSENT" ? "CONSENT_REQUIRED" : "ACCEPTED",
  deltaClass, policySnapshot: { permissions: ["READ", "USE_FOR_PERFORMANCE_COORDINATION", "USE_FOR_SCHEDULE_COORDINATION"] },
  effectivePolicy: {
    projectReference: projectId, recipientOrganizationId: recipientOrgId,
    purpose: kind === "PROJECT_AGREEMENT" ? "LEISTUNGSKOORDINATION" : "LEISTUNGSKOORDINATION",
    allowedPurposes: ["LEISTUNGSKOORDINATION", "scheduleCoordination"],
    prohibitions: ["COMMERCIAL_REUSE"],
    validFrom: "2020-01-01T00:00:00.000Z",
    validUntil: "2099-12-31T23:59:59.000Z",
    childPolicyTypes: ["PERFORMANCE_REQUEST", "SCHEDULE_CHANGE"],
    childPermissions: ["READ", "USE_FOR_PERFORMANCE_COORDINATION", "USE_FOR_SCHEDULE_COORDINATION"],
    permissions: ["READ", "USE_FOR_PERFORMANCE_COORDINATION", "USE_FOR_SCHEDULE_COORDINATION"],
  },
  diff: deltaClass === "REQUIRES_CONSENT" ? { summary: ["Terminfenster wurde konkretisiert"], changed: ["Zeitraum"] } : null,
});

/** Creates only namespaced records. It is safe to call once per Playwright test. */
export async function seedCampusWest(): Promise<Seed> {
  const namespace = `e2e-campus-west-${crypto.randomUUID()}`;
  const agOrgId = id(namespace, "ag");
  const anOrgIds = [id(namespace, "an-1"), id(namespace, "an-2")];
  const userIds = [id(namespace, "ag-user"), id(namespace, "an-1-user"), id(namespace, "an-2-user")];
  const projectId = id(namespace, "project");
  const password = `E2E-${crypto.randomUUID()}`;
  const hash = await bcrypt.hash(password, 10);
  const accounts = [
    { id: userIds[0], name: "Campus-West Auftraggeber", email: `${namespace}-ag@example.test`, passwordHash: hash, roles: ["AG_ADMIN"] },
    { id: userIds[1], name: "Campus-West Nachunternehmen Eins", email: `${namespace}-an1@example.test`, passwordHash: hash, roles: ["AN_ADMIN"] },
    { id: userIds[2], name: "Campus-West Nachunternehmen Zwei", email: `${namespace}-an2@example.test`, passwordHash: hash, roles: ["AN_ADMIN"] },
  ];
  const orgs = [
    { id: agOrgId, name: "Campus-West Auftraggeber", type: "AG" as const },
    { id: anOrgIds[0], name: "Campus-West Nachunternehmen Eins", type: "AN" as const },
    { id: anOrgIds[1], name: "Campus-West Nachunternehmen Zwei", type: "AN" as const },
  ];
  // Auth is served from Hub; the AG and AN stores also enforce their own FKs.
  for (const database of [agDb, anDb, hubDb]) {
    await database.insert(organizationsTable).values(orgs).onConflictDoNothing();
    await database.insert(usersTable).values(accounts).onConflictDoNothing();
    await database.insert(userOrganizationsTable).values([
      { userId: userIds[0], orgId: agOrgId, role: "ADMIN" },
      { userId: userIds[1], orgId: anOrgIds[0], role: "ADMIN" },
      { userId: userIds[2], orgId: anOrgIds[1], role: "ADMIN" },
    ]).onConflictDoNothing();
  }
  await agDb.insert(projectsTable).values({ id: projectId, agOrgId, name: "Campus-West", location: "Campus-West", status: "ACTIVE", startDate: "2027-01-01", endDate: "2027-12-31" });
  const parentIds = anOrgIds.map((anOrgId, index) => id(namespace, `parent-${index + 1}`));
  await agDb.insert(coordinationPoliciesTable).values(anOrgIds.map((anOrgId, index) =>
    policy(projectId, agOrgId, anOrgId, parentIds[index], "PROJECT_AGREEMENT", "WITHIN_BASELINE")));
  await agDb.insert(projectContractorsTable).values(anOrgIds.map((anOrgId) => ({ id: id(namespace, `contractor-${anOrgId.endsWith("1") ? "1" : "2"}`), projectId, anOrgId, assignmentStatus: "ACTIVE", createdByUserId: userIds[0] })));
  await agDb.insert(projectMembershipsTable).values(anOrgIds.map((anOrgId, index) => ({
    id: id(namespace, `membership-${index + 1}`), projectId, agOrgId, anOrgId, status: "ACTIVE",
    invitationId: id(namespace, `invitation-${index + 1}`), correlationId: id(namespace, `correlation-${index + 1}`), projectAgreementPolicyId: parentIds[index],
  })));

  const services = ["L-101", "L-201", "L-301", "L-401"].map((code, index) => ({
    id: id(namespace, code), projectId, leistungsBezeichnung: `${code} Campus-West`, kurzbezeichnung: code,
    zone: "West", gewerk: index % 2 ? "Elektro" : "Trockenbau", plannedStart: "2027-05-10", plannedEnd: "2027-05-14", lifecycleStatus: "IN_COORDINATION" as const,
  }));
  await agDb.insert(leistungenTable).values(services);
  const requestKeys: Array<[PolicyClass | "BILATERAL" | "MULTI_1" | "MULTI_2", number, number, PolicyClass]> = [
    ["WITHIN_BASELINE", 0, 0, "WITHIN_BASELINE"], ["REQUIRES_CONSENT", 1, 0, "REQUIRES_CONSENT"],
    ["NOT_PERMITTED", 2, 0, "NOT_PERMITTED"], ["BILATERAL", 3, 0, "WITHIN_BASELINE"],
    ["MULTI_1", 2, 0, "WITHIN_BASELINE"], ["MULTI_2", 3, 1, "WITHIN_BASELINE"],
  ];
  const requestIds = Object.fromEntries(requestKeys.map(([key]) => [key, id(namespace, `request-${key}`)])) as Record<string, string>;
  const policyIds: string[] = [...parentIds];
  for (const [key, serviceIndex, anIndex, deltaClass] of requestKeys) {
    const requestId = requestIds[key];
    const childId = id(namespace, `performance-${key}`);
    policyIds.push(childId);
    await agDb.insert(coordinationPoliciesTable).values(policy(projectId, agOrgId, anOrgIds[anIndex], childId, "PERFORMANCE_REQUEST", deltaClass, parentIds[anIndex]));
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
      kurzbezeichnung: services[serviceIndex].kurzbezeichnung,
      workPackage: services[serviceIndex].leistungsBezeichnung,
      plannedTimeWindow: { start: "2027-05-10", end: "2027-05-14" },
      resourceRequirements: [],
    };
    await agDb.insert(leistungsanfrageSnapshotsTable).values({ id: id(namespace, `snapshot-${key}`), leistungsanfrageId: requestId, schemaVersion: "1.0", snapshotPayload: payload });
    await anDb.insert(anLeistungsanfragenTable).values({
      id: id(namespace, `an-request-${key}`), externalLeistungsanfrageId: requestId, externalRequestVersion: 1,
      sourceMessageId: id(namespace, `message-${key}`), payloadHash: id(namespace, `hash-${key}`), correlationId: id(namespace, `correlation-${key}`),
      senderAgOrgId: agOrgId, receiverAnOrgId: anOrgIds[anIndex], projectReference: projectId, leistungReference: services[serviceIndex].id,
      plannedStart: "2027-05-10", plannedEnd: "2027-05-14", policyDeltaClass: deltaClass,
      policyConsentStatus: deltaClass === "WITHIN_BASELINE" ? "NOT_REQUIRED" : "PENDING",
      policyDiff: deltaClass === "REQUIRES_CONSENT" ? { summary: ["Terminfenster wurde konkretisiert"], changed: ["Zeitraum"] } : null,
      policySnapshot: { policyId: childId, permissions: ["READ"] }, payloadSnapshot: payload, status: "UNDER_REVIEW",
    });
  }
  await agDb.insert(serviceChangeProposalsTable).values({
    id: id(namespace, "proposal-an"), leistungsanfrageId: requestIds.BILATERAL, proposerOrgId: anOrgIds[0], proposerUserId: userIds[1],
    start: new Date("2027-05-12T08:00:00.000Z"), end: new Date("2027-05-16T17:00:00.000Z"), action: "PROPOSE", status: "OPEN", comment: "Campus-West Terminverschiebung",
  });
  return {
    runId: namespace, ids: [namespace], projectId, agOrgId, anOrgIds, userIds, policyIds,
    ag: { email: accounts[0].email, password }, an: accounts.slice(1).map(({ email }) => ({ email, password })),
    requests: { WITHIN_BASELINE: requestIds.WITHIN_BASELINE, REQUIRES_CONSENT: requestIds.REQUIRES_CONSENT, NOT_PERMITTED: requestIds.NOT_PERMITTED },
    bilateralRequestId: requestIds.BILATERAL, multiRequestIds: [requestIds.MULTI_1, requestIds.MULTI_2],
  };
}

export async function cleanupCampusWest(seed: Seed): Promise<void> {
  const requestIds = [...Object.values(seed.requests), seed.bilateralRequestId, ...seed.multiRequestIds];
  await anDb.delete(anAvailabilityChecksTable).where(inArray(anAvailabilityChecksTable.anOrgId, seed.anOrgIds));
  await anDb.delete(anLeistungsanfragenTable).where(inArray(anLeistungsanfragenTable.externalLeistungsanfrageId, requestIds));
  await agDb.delete(serviceChangeProposalsTable).where(inArray(serviceChangeProposalsTable.leistungsanfrageId, requestIds));
  await agDb.delete(leistungsanfragenTable).where(inArray(leistungsanfragenTable.id, requestIds));
  await agDb.delete(projectMembershipsTable).where(eq(projectMembershipsTable.projectId, seed.projectId));
  await agDb.delete(coordinationPoliciesTable).where(eq(coordinationPoliciesTable.projectId, seed.projectId));
  await agDb.delete(projectContractorsTable).where(eq(projectContractorsTable.projectId, seed.projectId));
  await agDb.delete(leistungsVersionenTable).where(inArray(
    leistungsVersionenTable.leistungId,
    ["L-101", "L-201", "L-301", "L-401"].map((code) => id(seed.runId, code)),
  ));
  await agDb.delete(leistungenTable).where(eq(leistungenTable.projectId, seed.projectId));
  await agDb.delete(projectsTable).where(eq(projectsTable.id, seed.projectId));
  for (const database of [agDb, anDb, hubDb]) {
    await database.delete(dataspaceExchangesTable)
      .where(inArray(dataspaceExchangesTable.senderOrgId, [seed.agOrgId, ...seed.anOrgIds]));
    const outboxRows = await database.select({ messageId: messageOutboxTable.messageId })
      .from(messageOutboxTable)
      .where(inArray(messageOutboxTable.senderOrgId, [seed.agOrgId, ...seed.anOrgIds]));
    const messageIds = outboxRows.map(({ messageId }) => messageId);
    if (messageIds.length) {
      await database.delete(messageDeliveryAttemptsTable).where(inArray(messageDeliveryAttemptsTable.messageId, messageIds));
      await database.delete(messageInboxTable).where(inArray(messageInboxTable.messageId, messageIds));
      await database.delete(messageOutboxTable).where(inArray(messageOutboxTable.messageId, messageIds));
    }
    await database.delete(userOrganizationsTable).where(inArray(userOrganizationsTable.userId, seed.userIds));
    await database.delete(usersTable).where(inArray(usersTable.id, seed.userIds));
    await database.delete(organizationsTable).where(inArray(organizationsTable.id, [seed.agOrgId, ...seed.anOrgIds]));
  }
}