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
  coordinationPoliciesTable,
  leistungenTable,
  organizationsTable,
  projectMembershipsTable,
  projectsTable,
  taktDependenciesTable,
  taktRequestSnapshotsTable,
  taktRequestsTable,
  usersTable,
} from "@workspace/db";
import app from "../app";
import {
  buildTaktRequestSnapshot,
  createTaktRequestWithSnapshot,
  InvalidLeistungsfreigabeFieldsError,
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
const PROJECT = "PRJ-CW-2027";
const OTHER_PROJECT = `${PREFIX}-other-project`;
const LEISTUNGEN = ["L-101", "L-201", "L-301", "L-401"] as const;
const AGREEMENT = `${PREFIX}-agreement-an1`;
const MEMBERSHIP = `${PREFIX}-membership-an1`;
const requestNumbers: string[] = [];

const secret = process.env.JWT_SECRET ?? "taktkoord-jwt-dev-secret-change-in-prod";
const token = (userId: string, orgId: string) => jwt.sign({
  userId, orgId, orgType: "AG", hubAdmin: false, roles: ["AG_ADMIN"],
}, secret, { expiresIn: "1h" });

const agToken = token(AG_USER, AG);
const otherAgToken = token(OTHER_AG_USER, OTHER_AG);

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
  prohibitions: ["COMMERCIAL_REUSE"],
};

async function cleanup() {
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
  requestNumbers.length = 0;
}

beforeAll(async () => {
  await cleanup();
  await db.insert(organizationsTable).values([
    { id: AG, name: "Baukoordination West GmbH", type: "AG" },
    { id: OTHER_AG, name: "Fremdmandant GmbH", type: "AG" },
    ...ANS.map((an) => ({ id: anId(an), name: `Campus West ${an}`, type: "AN" as const })),
  ]);
  await db.insert(usersTable).values([
    { id: AG_USER, name: "Campus-West AG", email: "cw27-ag@test.invalid", passwordHash: "x" },
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
  await db.insert(coordinationPoliciesTable).values({
    id: AGREEMENT, policyKey: `${PREFIX}:agreement:an1`, version: 1, kind: "PROJECT_AGREEMENT",
    projectId: PROJECT, providerOrgId: AG, recipientOrgId: anId("AN1"), lifecycleStatus: "ACCEPTED",
    policySnapshot: baseline, effectivePolicy: baseline,
  });
  await db.insert(projectMembershipsTable).values([
    { id: MEMBERSHIP, projectId: PROJECT, agOrgId: AG, anOrgId: anId("AN1"), status: "ACTIVE", invitationId: `${PREFIX}-invite-an1`, correlationId: `${PREFIX}-correlation-an1`, projectAgreementPolicyId: AGREEMENT },
    { id: `${PREFIX}-membership-an2`, projectId: PROJECT, agOrgId: AG, anOrgId: anId("AN2"), status: "INVITED", invitationId: `${PREFIX}-invite-an2`, correlationId: `${PREFIX}-correlation-an2` },
    { id: `${PREFIX}-membership-an3`, projectId: PROJECT, agOrgId: AG, anOrgId: anId("AN3"), status: "ACTIVE", invitationId: `${PREFIX}-invite-an3`, correlationId: `${PREFIX}-correlation-an3` },
    { id: `${PREFIX}-membership-an4`, projectId: PROJECT, agOrgId: AG, anOrgId: anId("AN4"), status: "INVITED", invitationId: `${PREFIX}-invite-an4`, correlationId: `${PREFIX}-correlation-an4` },
  ]);
});

afterAll(cleanup);

describe("Construct-X Campus West campaign", () => {
  it("keeps the project fixture, invitation states and tenant boundary exact", async () => {
    const memberships = await request(app).get(`/api/projects/${PROJECT}/memberships`).set("Authorization", `Bearer ${agToken}`);
    expect(memberships.status).toBe(200);
    expect(memberships.body.map((row: { anOrgId: string; status: string }) => [row.anOrgId, row.status]).sort())
      .toEqual([[anId("AN1"), "ACTIVE"], [anId("AN2"), "INVITED"], [anId("AN3"), "ACTIVE"], [anId("AN4"), "INVITED"]].sort());
    const foreign = await request(app).get(`/api/projects/${PROJECT}/memberships`).set("Authorization", `Bearer ${otherAgToken}`);
    expect(foreign.status).toBe(200);
    expect(foreign.body).toEqual([]);
  });

  it("classifies baseline, consent, and forbidden child deltas without changing membership", async () => {
    const candidate = {
      policyType: "PERFORMANCE_REQUEST" as const, projectReference: PROJECT, recipientOrganizationId: anId("AN1"),
      purpose: "LEISTUNGSKOORDINATION", workPackageReference: "L-101",
      permissions: ["READ", "DOWNLOAD", "USE_FOR_PERFORMANCE_COORDINATION"],
      selectedFields: baseline.allowedFieldScope, prohibitions: ["COMMERCIAL_REUSE"],
      validFrom: baseline.validFrom, validUntil: baseline.validUntil,
    };
    expect(resolvePolicyDelta(baseline, candidate).deltaClass).toBe("WITHIN_BASELINE");
    expect(resolvePolicyDelta(baseline, { ...candidate, validUntil: "2100-01-01T00:00:00.000Z" }).deltaClass).toBe("REQUIRES_CONSENT");
    expect(resolvePolicyDelta(baseline, { ...candidate, recipientOrganizationId: anId("AN2") }).deltaClass).toBe("NOT_PERMITTED");
    expect((await db.select().from(projectMembershipsTable).where(eq(projectMembershipsTable.id, MEMBERSHIP)))[0]?.status).toBe("ACTIVE");
  });

  it("creates an immutable, whitelist-only performance request with its parent policy", async () => {
    const requestNumber = "CW27-L101-001";
    requestNumbers.push(requestNumber);
    const created = await createTaktRequestWithSnapshot({
      taktId: "L-101", guOrgId: AG, nuOrgId: anId("AN1"), requestNumber, createdByUserId: AG_USER,
      purpose: "LEISTUNGSKOORDINATION",
    });
    expect(created.request).not.toHaveProperty("dataPublicationId"); // DataOffer is never coupled to a Leistung request.
    expect(created.snapshot.snapshotPayload).toMatchObject({ taktReference: "L-101", projectReference: PROJECT });
    expect(JSON.stringify(created.snapshot.snapshotPayload)).not.toContain("vertraulich");
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