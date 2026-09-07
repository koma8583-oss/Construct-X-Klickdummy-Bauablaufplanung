/**
 * Deterministic Construct-X Campus-West campaign.
 *
 * This is deliberately a small, self-contained integration fixture: it uses
 * the real AG database and HTTP boundary, while policy outcomes are resolved
 * by the production Construct-X service.  Prefix `cw27-` makes cleanup safe
 * after an interrupted run.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import { and, eq, inArray } from "drizzle-orm";
import {
  agDb as db,
  anDb,
  hubDb,
  coordinationPoliciesTable,
  anLeistungsanfragenTable,
  hubMessagesTable,
  leistungenTable,
  organizationsTable,
  projectMembershipsTable,
  projectsTable,
  resourcesTable,
  resourceTypesTable,
  taktDependenciesTable,
  taktRequestSnapshotsTable,
  taktRequestsTable,
  messageOutboxTable,
  usersTable,
} from "@workspace/db";
import app from "../app";
import {
  buildTaktRequestSnapshot,
  createTaktRequestWithSnapshot,
  InvalidLeistungsfreigabeFieldsError,
  PolicyNotPermittedError,
  selectLeistungsfreigabeFields,
} from "../lib/takt-request-snapshot-service";
import { resolvePolicyDelta } from "../services/construct-x-policy-service";

const PREFIX = "cw27";
const AG = `${PREFIX}-ag`;
const OTHER_AG = `${PREFIX}-other-ag`;
const ANS = ["AN1", "AN2", "AN3", "AN4"] as const;
const anId = (an: typeof ANS[number]) => `${PREFIX}-${an.toLowerCase()}`;
const AG_USER = `${PREFIX}-ag-user`;
const OTHER_AG_USER = `${PREFIX}-other-ag-user`;
const AN_USERS = ANS.map((an) => `${PREFIX}-${an.toLowerCase()}-user`);
const PROJECT = "PRJ-CW-2027";
const OTHER_PROJECT = `${PREFIX}-other-project`;
const LEISTUNGEN = ["L-101", "L-201", "L-301", "L-401"] as const;
const AGREEMENT = `${PREFIX}-agreement-an1`;
const MEMBERSHIP = `${PREFIX}-membership-an1`;
const COMPANY_NAMES = [
  "Baukoordination West GmbH",
  "Stahlbau Ruhr GmbH",
  "Elektro West GmbH",
  "TGA Technik GmbH",
  "Maler Süd GmbH",
] as const;
const AN_ASSIGNMENTS = [
  { requestId: `${PREFIX}-request-an1-l101`, an: "AN1", leistungId: "L-101" },
  { requestId: `${PREFIX}-request-an1-l201`, an: "AN1", leistungId: "L-201" },
  { requestId: `${PREFIX}-request-an1-l301`, an: "AN1", leistungId: "L-301" },
  { requestId: `${PREFIX}-request-an1-l401`, an: "AN1", leistungId: "L-401" },
  { requestId: `${PREFIX}-request-an2-l301`, an: "AN2", leistungId: "L-301" },
  { requestId: `${PREFIX}-request-an3-l401`, an: "AN3", leistungId: "L-401" },
  { requestId: `${PREFIX}-request-an3-l201`, an: "AN3", leistungId: "L-201" },
  { requestId: `${PREFIX}-request-an4-l101`, an: "AN4", leistungId: "L-101" },
] as const;
const requestNumbers: string[] = [];

const secret = process.env.JWT_SECRET ?? "taktkoord-jwt-dev-secret-change-in-prod";
const token = (userId: string, orgId: string, orgType: "AG" | "AN" = "AG") => jwt.sign({
  userId, orgId, orgType, hubAdmin: false, roles: [orgType === "AG" ? "AG_ADMIN" : "AN_ADMIN"],
}, secret, { expiresIn: "1h" });

const agToken = token(AG_USER, AG);
const otherAgToken = token(OTHER_AG_USER, OTHER_AG);
const anTokens = ANS.map((an, index) => token(AN_USERS[index], anId(an), "AN"));

const baseline = {
  policyType: "PROJECT_AGREEMENT" as const,
  projectReference: PROJECT,
  recipientOrganizationId: anId("AN1"),
  purpose: "LEISTUNGSKOORDINATION",
  permissions: ["READ", "DOWNLOAD", "USE_FOR_PERFORMANCE_COORDINATION"],
  childPermissions: ["READ", "DOWNLOAD", "USE_FOR_PERFORMANCE_COORDINATION"],
  childPolicyTypes: ["PERFORMANCE_REQUEST", "SCHEDULE_CHANGE"],
  allowedPurposes: ["LEISTUNGSKOORDINATION"],
  allowedFieldScope: [
    "taktReference", "taktVersion", "trade", "workPackage", "kurzbezeichnung",
    "location", "plannedTimeWindow", "bufferTimeWindow", "requiredOutput",
    "resourceRequirements", "constraints", "predecessors", "successors", "documentReferences",
  ],
  validFrom: "2020-01-01T00:00:00.000Z",
  validUntil: "2099-12-31T23:59:59.000Z",
  retentionUntil: "2099-12-31T23:59:59.000Z",
  prohibitions: ["COMMERCIAL_REUSE"],
  duties: [{ action: "DELETE", target: "after-retention" }],
  constraints: [{ leftOperand: "purpose", operator: "eq", rightOperand: "LEISTUNGSKOORDINATION" }],
};

async function cleanup() {
  await anDb.delete(anLeistungsanfragenTable)
    .where(inArray(anLeistungsanfragenTable.externalLeistungsanfrageId, AN_ASSIGNMENTS.map(({ requestId }) => requestId)))
    .catch(() => {});
  const requests = await db.select({ id: taktRequestsTable.id }).from(taktRequestsTable)
    .where(inArray(taktRequestsTable.requestNumber, requestNumbers));
  const requestIds = requests.map(({ id }) => id);
  if (requestIds.length) {
    await db.update(taktRequestsTable).set({ performancePolicyId: null, scheduleChangePolicyId: null })
      .where(inArray(taktRequestsTable.id, requestIds));
    await db.delete(taktRequestSnapshotsTable).where(inArray(taktRequestSnapshotsTable.taktRequestId, requestIds));
    await db.delete(taktRequestsTable).where(inArray(taktRequestsTable.id, requestIds));
  }
  await db.delete(projectMembershipsTable).where(inArray(projectMembershipsTable.projectId, [PROJECT, OTHER_PROJECT])).catch(() => {});
  await db.delete(coordinationPoliciesTable).where(inArray(coordinationPoliciesTable.projectId, [PROJECT, OTHER_PROJECT])).catch(() => {});
  await db.delete(taktDependenciesTable).where(eq(taktDependenciesTable.projectId, PROJECT)).catch(() => {});
  await db.delete(leistungenTable).where(eq(leistungenTable.projectId, PROJECT)).catch(() => {});
  await db.delete(projectsTable).where(inArray(projectsTable.id, [PROJECT, OTHER_PROJECT])).catch(() => {});
  await db.delete(usersTable).where(inArray(usersTable.id, [AG_USER, OTHER_AG_USER])).catch(() => {});
  await db.delete(organizationsTable).where(inArray(organizationsTable.id, [AG, OTHER_AG, ...ANS.map(anId)])).catch(() => {});
  await anDb.delete(resourcesTable).where(inArray(resourcesTable.anOrgId, ANS.map(anId))).catch(() => {});
  await anDb.delete(resourceTypesTable).where(inArray(resourceTypesTable.anOrgId, ANS.map(anId))).catch(() => {});
  await anDb.delete(organizationsTable).where(inArray(organizationsTable.id, [AG, ...ANS.map(anId)])).catch(() => {});
  requestNumbers.length = 0;
}

beforeAll(async () => {
  await cleanup();
  await db.insert(organizationsTable).values([
    { id: AG, name: COMPANY_NAMES[0], type: "AG" },
    { id: OTHER_AG, name: "Fremdmandant GmbH", type: "AG" },
    ...ANS.map((an, index) => ({ id: anId(an), name: COMPANY_NAMES[index + 1], type: "AN" as const })),
  ]);
  await anDb.insert(organizationsTable).values([
    { id: AG, name: COMPANY_NAMES[0], type: "AG" },
    ...ANS.map((an, index) => ({ id: anId(an), name: COMPANY_NAMES[index + 1], type: "AN" as const })),
  ]
  ).onConflictDoNothing();
  await db.insert(usersTable).values([
    { id: AG_USER, name: COMPANY_NAMES[0], email: "cw27-ag@test.invalid", passwordHash: "x" },
    { id: OTHER_AG_USER, name: "Campus-West Fremd-AG", email: "cw27-other@test.invalid", passwordHash: "x" },
  ]);
  await db.insert(projectsTable).values([
    { id: PROJECT, agOrgId: AG, name: "RUB Campus West – Laborgebäude", location: "Bochum", startDate: "2027-01-01", endDate: "2027-12-31" },
    { id: OTHER_PROJECT, agOrgId: OTHER_AG, name: "Fremdprojekt" },
  ]);
  await db.insert(leistungenTable).values(LEISTUNGEN.map((id, index) => ({
    id, projectId: PROJECT, leistungsBezeichnung: `Campus West ${id}`, kurzbezeichnung: id,
    zone: "Campus West", gewerk: ["Rohbau", "TGA", "Laborbau", "Inbetriebnahme"][index],
    plannedStart: `2027-0${index + 1}-01`, plannedEnd: `2027-0${index + 1}-20`,
    internalNote: "AG-intern", costEstimate: "vertraulich", version: 1,
  })));
  await db.insert(taktDependenciesTable).values([
    { id: `${PREFIX}-dep-101-201`, projectId: PROJECT, predecessorId: "L-101", successorId: "L-201", type: "EA", lagDays: 0 },
    { id: `${PREFIX}-dep-201-301`, projectId: PROJECT, predecessorId: "L-201", successorId: "L-301", type: "EA", lagDays: 2 },
    { id: `${PREFIX}-dep-301-401`, projectId: PROJECT, predecessorId: "L-301", successorId: "L-401", type: "EA", lagDays: 0 },
  ]);
  const agreementFor = (
    an: typeof ANS[number],
    permissions = baseline.permissions,
    validUntil = baseline.validUntil,
  ) => ({
    id: an === "AN1" ? AGREEMENT : `${PREFIX}-agreement-${an.toLowerCase()}`,
    policyKey: `${PREFIX}:agreement:${an.toLowerCase()}`,
    version: 1,
    kind: "PROJECT_AGREEMENT" as const,
    projectId: PROJECT,
    providerOrgId: AG,
    recipientOrgId: anId(an),
    lifecycleStatus: "ACCEPTED" as const,
    policySnapshot: { ...baseline, recipientOrganizationId: anId(an), permissions },
    effectivePolicy: {
      ...baseline,
      recipientOrganizationId: anId(an),
      permissions,
      childPermissions: permissions,
      validUntil,
    },
  });
  await db.insert(coordinationPoliciesTable).values([
    agreementFor("AN1"),
    agreementFor("AN2", ["READ"]),
    agreementFor("AN3", baseline.permissions, "2027-06-30T23:59:59.000Z"),
    agreementFor("AN4"),
    {
      id: `${PREFIX}-child-an4`,
      policyKey: `${PREFIX}:performance:an4`,
      version: 1,
      kind: "PERFORMANCE_REQUEST" as const,
      projectId: PROJECT,
      providerOrgId: AG,
      recipientOrgId: anId("AN4"),
      parentPolicyId: `${PREFIX}-agreement-an4`,
      lifecycleStatus: "CONSENT_REQUIRED" as const,
      deltaClass: "REQUIRES_CONSENT" as const,
      policySnapshot: { ...baseline, recipientOrganizationId: anId("AN4") },
      effectivePolicy: { ...baseline, recipientOrganizationId: anId("AN4") },
    },
  ]);
  await db.insert(projectMembershipsTable).values([
    { id: MEMBERSHIP, projectId: PROJECT, agOrgId: AG, anOrgId: anId("AN1"), status: "ACTIVE", invitationId: `${PREFIX}-invite-an1`, correlationId: `${PREFIX}-correlation-an1`, projectAgreementPolicyId: AGREEMENT },
    { id: `${PREFIX}-membership-an2`, projectId: PROJECT, agOrgId: AG, anOrgId: anId("AN2"), status: "ACTIVE", invitationId: `${PREFIX}-invite-an2`, correlationId: `${PREFIX}-correlation-an2`, projectAgreementPolicyId: `${PREFIX}-agreement-an2` },
    { id: `${PREFIX}-membership-an3`, projectId: PROJECT, agOrgId: AG, anOrgId: anId("AN3"), status: "ACTIVE", invitationId: `${PREFIX}-invite-an3`, correlationId: `${PREFIX}-correlation-an3`, projectAgreementPolicyId: `${PREFIX}-agreement-an3`, invitationExpiresAt: new Date("2027-06-30T23:59:59.000Z") },
    { id: `${PREFIX}-membership-an4`, projectId: PROJECT, agOrgId: AG, anOrgId: anId("AN4"), status: "INVITED", invitationId: `${PREFIX}-invite-an4`, correlationId: `${PREFIX}-correlation-an4`, projectAgreementPolicyId: `${PREFIX}-agreement-an4` },
  ]);
  const resourceTypeIds = ANS.map((an) => `${PREFIX}-resource-type-${an.toLowerCase()}`);
  await anDb.insert(resourceTypesTable).values(ANS.map((an, index) => ({
    id: resourceTypeIds[index], anOrgId: anId(an), name: `${an}-Team`, category: "CREW" as const, capacityUnit: "PERSONS" as const,
  }))).onConflictDoNothing();
  await anDb.insert(resourcesTable).values(ANS.map((an, index) => ({
    id: `${PREFIX}-resource-${an.toLowerCase()}`, anOrgId: anId(an), type: "CREW" as const, name: `${an} Montageteam`,
    resourceTypeId: resourceTypeIds[index], capacity: index === 0 ? 8 : 2, capacityUnit: "PERSONS" as const,
  }))).onConflictDoNothing();
  await anDb.insert(anLeistungsanfragenTable).values(AN_ASSIGNMENTS.map((assignment) => ({
    id: `${assignment.requestId}-projection`,
    externalLeistungsanfrageId: assignment.requestId,
    externalRequestVersion: 1,
    sourceMessageId: `${assignment.requestId}-message`,
    payloadHash: `${assignment.requestId}-hash`,
    correlationId: `${assignment.requestId}-correlation`,
    senderAgOrgId: AG,
    receiverAnOrgId: anId(assignment.an),
    projectReference: PROJECT,
    leistungReference: assignment.leistungId,
    plannedStart: "2027-05-10",
    plannedEnd: "2027-05-14",
    policyDeltaClass: "WITHIN_BASELINE" as const,
    policyConsentStatus: "NOT_REQUIRED" as const,
    policySnapshot: { permissions: baseline.permissions },
    effectivePolicy: { ...baseline, recipientOrganizationId: anId(assignment.an) },
    payloadSnapshot: {
      schemaVersion: "1.0",
      kurzbezeichnung: assignment.leistungId,
      workPackage: `Campus West ${assignment.leistungId}`,
      plannedTimeWindow: { start: "2027-05-10", end: "2027-05-14" },
    },
    status: "UNDER_REVIEW" as const,
  })));
});

afterAll(cleanup);

describe("Construct-X Campus West campaign", () => {
  it("keeps the project fixture, invitation states and tenant boundary exact", async () => {
    const memberships = await request(app).get(`/api/projects/${PROJECT}/memberships`).set("Authorization", `Bearer ${agToken}`);
    expect(memberships.status).toBe(200);
    expect(memberships.body.map((row: { anOrgId: string; status: string }) => [row.anOrgId, row.status]).sort())
      .toEqual([[anId("AN1"), "ACTIVE"], [anId("AN2"), "ACTIVE"], [anId("AN3"), "ACTIVE"], [anId("AN4"), "INVITED"]].sort());
    const foreign = await request(app).get(`/api/projects/${PROJECT}/memberships`).set("Authorization", `Bearer ${otherAgToken}`);
    expect(foreign.status).toBe(200);
    expect(foreign.body).toEqual([]);
  });

  it("keeps the five Campus-West companies, complete service chain, and AN-local resource boundary exact", async () => {
    const companies = await db.select({ id: organizationsTable.id, name: organizationsTable.name })
      .from(organizationsTable).where(inArray(organizationsTable.id, [AG, ...ANS.map(anId)]));
    expect(companies.map(({ name }) => name).sort()).toEqual([...COMPANY_NAMES].sort());

    const dependencies = await db.select().from(taktDependenciesTable)
      .where(eq(taktDependenciesTable.projectId, PROJECT));
    expect(dependencies.map(({ predecessorId, successorId, lagDays }) => [predecessorId, successorId, lagDays]))
      .toEqual([["L-101", "L-201", 0], ["L-201", "L-301", 2], ["L-301", "L-401", 0]]);

    const an1Resources = await request(app).get("/api/an/resources").set("Authorization", `Bearer ${anTokens[0]}`);
    expect(an1Resources.status).toBe(200);
    expect(an1Resources.body).toHaveLength(1);
    expect(an1Resources.body[0].anOrgId).toBe(anId("AN1"));
    const foreignResource = await request(app).get(`/api/an/nu/resource-types/${PREFIX}-resource-type-an2`)
      .set("Authorization", `Bearer ${anTokens[0]}`);
    expect(foreignResource.status).toBe(404);
  });

  it("gives AN1–AN4 exactly their assigned local projections and resources", async () => {
    for (const [index, an] of ANS.entries()) {
      const [requests, resources, resourceTypes] = await Promise.all([
        request(app).get("/api/an/leistungsanfragen").set("Authorization", `Bearer ${anTokens[index]}`),
        request(app).get("/api/resources").set("Authorization", `Bearer ${anTokens[index]}`),
        request(app).get("/api/nu/resource-types").set("Authorization", `Bearer ${anTokens[index]}`),
      ]);
      expect(requests.status).toBe(200);
      expect(resources.status).toBe(200);
      expect(resourceTypes.status).toBe(200);
      expect(requests.body.map((row: { id: string; nuOrgId: string; takt: { id: string } }) =>
        [row.id, row.nuOrgId, row.takt.id],
      ).sort())
        .toEqual(AN_ASSIGNMENTS.filter((assignment) => assignment.an === an)
          .map(({ requestId, leistungId }) => [requestId, anId(an), leistungId]).sort());
      expect(resources.body.map((row: { id: string; anOrgId: string }) => [row.id, row.anOrgId]))
        .toEqual([[`${PREFIX}-resource-${an.toLowerCase()}`, anId(an)]]);
      expect(resourceTypes.body.items.map((row: { id: string; anOrgId: string }) => [row.id, row.anOrgId]))
        .toEqual([[`${PREFIX}-resource-type-${an.toLowerCase()}`, anId(an)]]);
    }
  });

  it("denies wrong-AN reads and writes without returning foreign metadata", async () => {
    for (const [index, an] of ANS.entries()) {
      const foreign = AN_ASSIGNMENTS.find((assignment) => assignment.an !== an);
      if (!foreign) throw new Error("Campus-West fixture requires a foreign AN assignment");
      const foreignResourceId = `${PREFIX}-resource-${ANS[(index + 1) % ANS.length].toLowerCase()}`;
      const responses = await Promise.all([
        request(app).get(`/api/an/leistungsanfragen/${foreign.requestId}/details`).set("Authorization", `Bearer ${anTokens[index]}`),
        request(app).post(`/api/an/takt-requests/${foreign.requestId}/availability-checks`).set("Authorization", `Bearer ${anTokens[index]}`),
        request(app).post(`/api/an/leistungsanfragen/${foreign.requestId}/responses`)
          .set("Authorization", `Bearer ${anTokens[index]}`)
          .send({ decision: "REJECTED", reasonCode: "OTHER" }),
        request(app).patch(`/api/resources/${foreignResourceId}`).set("Authorization", `Bearer ${anTokens[index]}`).send({ name: "must not mutate" }),
      ]);
      for (const response of responses) {
        expect([403, 404]).toContain(response.status);
        const serialized = JSON.stringify(response.body);
        for (const value of [foreign.requestId, foreign.leistungId, foreignResourceId, anId(foreign.an)]) {
          expect(serialized).not.toContain(value);
        }
      }
    }
  });

  it("derives baseline, consent, and forbidden child deltas from AN1's effective parent policy", async () => {
    const [parent] = await db.select({ effectivePolicy: coordinationPoliciesTable.effectivePolicy })
      .from(coordinationPoliciesTable).where(eq(coordinationPoliciesTable.id, AGREEMENT));
    const candidate = {
      policyType: "PERFORMANCE_REQUEST" as const, projectReference: PROJECT, recipientOrganizationId: anId("AN1"),
      purpose: "LEISTUNGSKOORDINATION", workPackageReference: "L-101",
      permissions: ["READ", "DOWNLOAD", "USE_FOR_PERFORMANCE_COORDINATION"],
      selectedFields: baseline.allowedFieldScope, prohibitions: ["COMMERCIAL_REUSE"],
      validFrom: baseline.validFrom, validUntil: baseline.validUntil,
    };
    const effectiveParent = parent.effectivePolicy as Record<string, unknown>;
    expect(resolvePolicyDelta(effectiveParent, candidate).deltaClass).toBe("WITHIN_BASELINE");
    expect(resolvePolicyDelta(effectiveParent, { ...candidate, validUntil: "2100-01-01T00:00:00.000Z" }).deltaClass).toBe("NOT_PERMITTED");
    expect(resolvePolicyDelta(effectiveParent, {
      ...candidate,
      selectedFields: [...baseline.allowedFieldScope, "internalNote"],
    }).deltaClass).toBe("NOT_PERMITTED");
    expect((await db.select().from(projectMembershipsTable).where(eq(projectMembershipsTable.id, MEMBERSHIP)))[0]?.status).toBe("ACTIVE");
  });

  it("keeps policy preview and batch creation bound to the selected parent policy", async () => {
    const preview = await request(app)
      .post("/api/leistungsanfragen/policy-preview")
      .set("Authorization", `Bearer ${agToken}`)
      .send({
        taktIds: ["L-101"],
        nuOrgId: anId("AN1"),
        purpose: "RAHMENTERMINE",
        selectedFields: ["plannedTimeWindow"],
        parentPolicyId: AGREEMENT,
        parentPolicyVersion: 1,
      });
    expect(preview.status).toBe(200);
    expect(preview.body.items).toEqual([
      expect.objectContaining({ taktId: "L-101", deltaClass: "NOT_PERMITTED" }),
    ]);

    const wrongParent = await request(app)
      .post("/api/leistungsanfragen/policy-preview")
      .set("Authorization", `Bearer ${agToken}`)
      .send({
        taktIds: ["L-101"],
        nuOrgId: anId("AN1"),
        purpose: "LEISTUNGSKOORDINATION",
        selectedFields: ["plannedTimeWindow"],
        parentPolicyId: `${PREFIX}-agreement-an2`,
        parentPolicyVersion: 1,
      });
    expect(wrongParent.status).toBe(200);
    expect(wrongParent.body.items).toEqual([
      expect.objectContaining({ taktId: "L-101", deltaClass: "NOT_PERMITTED" }),
    ]);

    const forbiddenPurpose = await request(app)
      .post("/api/takt-requests/batch")
      .set("Authorization", `Bearer ${agToken}`)
      .send({
        taktId: "L-101",
        nuOrgIds: [anId("AN1")],
        purpose: "RAHMENTERMINE",
        selectedFields: ["plannedTimeWindow"],
        parentPolicyId: AGREEMENT,
        parentPolicyVersion: 1,
      });
    expect(forbiddenPurpose.status, JSON.stringify(forbiddenPurpose.body)).toBe(409);
    expect(forbiddenPurpose.body.error).toBe("POLICY_NOT_PERMITTED");
  });

  it("rejects a forbidden child before request creation or Dataspace delivery side effects", async () => {
    const requestNumber = "CW27-L101-NOT-PERMITTED";
    const [parent] = await db.select().from(coordinationPoliciesTable).where(eq(coordinationPoliciesTable.id, AGREEMENT));
    const restrictiveParent = {
      ...(parent.effectivePolicy as Record<string, unknown>),
      allowedFieldScope: baseline.allowedFieldScope.filter((field) => field !== "resourceRequirements"),
    };
    await db.update(coordinationPoliciesTable).set({ effectivePolicy: restrictiveParent })
      .where(eq(coordinationPoliciesTable.id, AGREEMENT));
    try {
      const [outboxBefore, projectionBefore, historyBefore] = await Promise.all([
        hubDb.select().from(messageOutboxTable),
        anDb.select().from(anLeistungsanfragenTable).where(eq(anLeistungsanfragenTable.senderAgOrgId, AG)),
        hubDb.select().from(hubMessagesTable),
      ]);
      await expect(createTaktRequestWithSnapshot({
        taktId: "L-101", guOrgId: AG, nuOrgId: anId("AN1"), requestNumber, createdByUserId: AG_USER,
        purpose: "LEISTUNGSKOORDINATION", selectedFields: ["resourceRequirements"],
        parentPolicyId: AGREEMENT, parentPolicyVersion: 1,
      })).rejects.toBeInstanceOf(PolicyNotPermittedError);
      const [outboxAfter, projectionAfter, historyAfter, membership] = await Promise.all([
        hubDb.select().from(messageOutboxTable),
        anDb.select().from(anLeistungsanfragenTable).where(eq(anLeistungsanfragenTable.senderAgOrgId, AG)),
        hubDb.select().from(hubMessagesTable),
        db.select({ status: projectMembershipsTable.status }).from(projectMembershipsTable)
          .where(eq(projectMembershipsTable.id, MEMBERSHIP)),
      ]);
      expect(await db.select().from(taktRequestsTable).where(eq(taktRequestsTable.requestNumber, requestNumber))).toEqual([]);
      expect(await db.select().from(coordinationPoliciesTable).where(eq(coordinationPoliciesTable.policyKey, `${requestNumber}:performance`))).toEqual([]);
      expect(outboxAfter).toHaveLength(outboxBefore.length);
      expect(projectionAfter).toHaveLength(projectionBefore.length);
      expect(historyAfter).toHaveLength(historyBefore.length);
      expect(membership[0]?.status).toBe("ACTIVE");
    } finally {
      await db.update(coordinationPoliciesTable).set({ effectivePolicy: parent.effectivePolicy })
        .where(eq(coordinationPoliciesTable.id, AGREEMENT));
    }
  });

  it("keeps AN3 valid through 2027-06-30 and lets AN4 join before its child policy is rejected", async () => {
    const [an3Agreement] = await db.select().from(coordinationPoliciesTable).where(eq(coordinationPoliciesTable.id, `${PREFIX}-agreement-an3`));
    expect((an3Agreement.effectivePolicy as { validUntil: string }).validUntil).toBe("2027-06-30T23:59:59.000Z");

    const [an4BeforeJoin] = await db.select({ status: projectMembershipsTable.status })
      .from(projectMembershipsTable).where(eq(projectMembershipsTable.id, `${PREFIX}-membership-an4`));
    expect(an4BeforeJoin.status).toBe("INVITED");
    await db.update(projectMembershipsTable).set({ status: "ACTIVE", acceptedAt: new Date("2027-01-10T10:00:00.000Z") })
      .where(eq(projectMembershipsTable.id, `${PREFIX}-membership-an4`));
    const [an4AfterJoin] = await db.select({ status: projectMembershipsTable.status })
      .from(projectMembershipsTable).where(eq(projectMembershipsTable.id, `${PREFIX}-membership-an4`));
    expect(an4AfterJoin.status).toBe("ACTIVE");

    const [child] = await db.select().from(coordinationPoliciesTable).where(eq(coordinationPoliciesTable.id, `${PREFIX}-child-an4`));
    expect(child.lifecycleStatus).toBe("CONSENT_REQUIRED");
    await db.update(coordinationPoliciesTable).set({ lifecycleStatus: "REJECTED" })
      .where(eq(coordinationPoliciesTable.id, child.id));
    const [rejected] = await db.select({ lifecycleStatus: coordinationPoliciesTable.lifecycleStatus })
      .from(coordinationPoliciesTable).where(eq(coordinationPoliciesTable.id, child.id));
    expect(rejected.lifecycleStatus).toBe("REJECTED");
  });

  it("creates an immutable, whitelist-only performance request with its parent policy", async () => {
    const requestNumber = "CW27-L101-001";
    requestNumbers.push(requestNumber);
    const created = await createTaktRequestWithSnapshot({
      taktId: "L-101", guOrgId: AG, nuOrgId: anId("AN1"), requestNumber, createdByUserId: AG_USER,
      purpose: "LEISTUNGSKOORDINATION", selectedFields: [...baseline.allowedFieldScope],
      parentPolicyId: AGREEMENT, parentPolicyVersion: 1,
    });
    expect(created.request).not.toHaveProperty("dataPublicationId"); // DataOffer is never coupled to a Leistung request.
    expect(created.snapshot.snapshotPayload).toMatchObject({ taktReference: "L-101", projectReference: PROJECT });
    expect(JSON.stringify(created.snapshot.snapshotPayload)).not.toContain("vertraulich");
    expect(((created.snapshot.snapshotPayload as Record<string, unknown>).policySnapshot as Record<string, unknown>)).toMatchObject({
      parentPolicyId: AGREEMENT,
      inheritFrom: AGREEMENT,
      prohibitions: expect.arrayContaining(baseline.prohibitions),
      duties: baseline.duties,
      constraints: baseline.constraints,
      validFrom: baseline.validFrom,
      validUntil: baseline.validUntil,
      retentionUntil: baseline.retentionUntil,
    });
    await db.update(leistungenTable).set({ leistungsBezeichnung: "mutiert", version: 2 }).where(eq(leistungenTable.id, "L-101"));
    const [stored] = await db.select().from(taktRequestSnapshotsTable).where(eq(taktRequestSnapshotsTable.id, created.snapshot.id));
    expect((stored.snapshotPayload as { workPackage: string }).workPackage).toBe("Campus West L-101");
    await db.update(leistungenTable).set({ leistungsBezeichnung: "Campus West L-101", version: 1 }).where(eq(leistungenTable.id, "L-101"));
  });

  it("rejects non-whitelisted fields while retaining dependency-only schedule data", async () => {
    const [leistung] = await db.select().from(leistungenTable).where(eq(leistungenTable.id, "L-201"));
    const snapshot = buildTaktRequestSnapshot({
      takt: { ...leistung, taktBezeichnung: leistung.leistungsBezeichnung },
      projectId: PROJECT,
      predecessors: [],
      successors: [],
    });
    expect(() => selectLeistungsfreigabeFields(snapshot, "RAHMENTERMINE", ["resourceRequirements"])).toThrow(InvalidLeistungsfreigabeFieldsError);
    expect(Object.keys(selectLeistungsfreigabeFields(snapshot, "RAHMENTERMINE"))).toContain("plannedTimeWindow");
  });
});