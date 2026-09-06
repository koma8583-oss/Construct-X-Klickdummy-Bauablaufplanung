import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  agDb, anDb, anLeistungsanfragenTable, anProjectInvitationsTable,
  coordinationPoliciesTable, messageOutboxTable, organizationsTable, projectMembershipsTable, projectsTable,
} from "@workspace/db";
import { deliverLocalProjectInvitation, deliverLocalServiceRequest } from "../services/dataspace/local-dataspace-delivery";
import { acceptInvitation, revokeMembership, revokeProjectAgreement } from "../services/project-membership-service";
import { createAnScheduleChangeProposal, getAnLeistungsanfrageDetail, runAnAvailabilityCheck, updateAnResourceRequirement } from "../services/an-leistungsanfrage-service";
import { createAnServiceResponse } from "../services/nu-response-service";
import { LeistungsanfragePolicyAccessError } from "../services/leistungsanfrage-policy-guard";

const ids: string[] = [];
const track = (id: string) => (ids.push(id), id);

function policy(ag: string, an: string, project: string, validUntil: string | null = null) {
  return {
    policyId: track(`phase1-policy-${crypto.randomUUID()}`), templateId: "PROJECT_MEMBERSHIP",
    templateVersion: 1, code: "PROJECT_MEMBERSHIP", name: "Project membership",
    description: "Phase 1 test policy", permissions: ["READ"], prohibitions: [],
    provider: { organizationId: ag, userId: null }, recipientOrganizationId: an,
    purpose: "PROJECT_MEMBERSHIP", projectReference: project, workPackageReference: null,
    validFrom: null, validUntil, createdAt: new Date().toISOString(),
    policyType: "PROJECT_AGREEMENT" as const, policyVersion: 1, lifecycleStatus: "ACCEPTED" as const,
    effectivePolicy: { validFrom: null, validUntil },
  };
}

async function deliveredFixture(validUntil: string | null = null) {
  const suffix = crypto.randomUUID();
  const ag = track(`phase1-ag-${suffix}`), an = track(`phase1-an-${suffix}`);
  await agDb.insert(organizationsTable).values([{ id: ag, name: ag, type: "AG" }, { id: an, name: an, type: "AN" }]);
  const project = track(`phase1-project-${suffix}`);
  await agDb.insert(projectsTable).values({ id: project, name: project, agOrgId: ag, status: "ACTIVE", startDate: "2025-01-01", endDate: "2027-01-01" });
  const agreement = policy(ag, an, project, validUntil);
  await agDb.insert(coordinationPoliciesTable).values({
    id: agreement.policyId, policyKey: agreement.policyId, version: 1, kind: "PROJECT_AGREEMENT",
    projectId: project, providerOrgId: ag, recipientOrgId: an, lifecycleStatus: "ACCEPTED",
    policySnapshot: agreement, effectivePolicy: agreement.effectivePolicy,
  });
  const invitationId = track(`phase1-invitation-${suffix}`);
  const correlationId = track(`phase1-correlation-${suffix}`);
  const [membership] = await agDb.insert(projectMembershipsTable).values({
    projectId: project, agOrgId: ag, anOrgId: an, anParticipantId: `BPNL${suffix.replaceAll("-", "").slice(0, 12)}`,
    status: "ACTIVE", invitationId, correlationId, projectAgreementPolicyId: agreement.policyId,
  }).returning();
  ids.push(membership.id);
  await deliverLocalProjectInvitation({
    metadata: { messageId: track(`phase1-invite-message-${suffix}`), correlationId, schemaVersion: "1.0", senderOrgId: ag, receiverOrgId: an, createdAt: new Date().toISOString() },
    invitationId, project: { projectReference: project, projectName: project, status: "ACTIVE" },
    requestedRole: "CONTRACTOR", purpose: "PROJECT_COLLABORATION",
    policy: { usagePurpose: "PROJECT_MEMBERSHIP", allowedConsumerParticipantId: membership.anParticipantId! },
    policySnapshot: agreement,
  });
  await anDb.update(anProjectInvitationsTable).set({ status: "ACCEPTED" }).where(eq(anProjectInvitationsTable.invitationId, invitationId));
  const requestId = track(`phase1-request-${suffix}`);
  await deliverLocalServiceRequest({
    metadata: { messageId: track(`phase1-request-message-${suffix}`), correlationId, schemaVersion: "1.0", senderOrgId: ag, receiverOrgId: an, createdAt: new Date().toISOString() },
    requestId, requestVersion: 1, projectReference: project, projectName: project,
    plannedStart: "2026-03-01T00:00:00.000Z", plannedEnd: "2026-03-02T00:00:00.000Z", resourceRequirements: [],
  });
  return { ag, an, project, membership, agreement, requestId };
}

async function invitedAgreementFixture(options: {
  validUntil?: string | null;
  policyStatus?: "PUBLISHED" | "ACCEPTED";
} = {}) {
  const suffix = crypto.randomUUID();
  const ag = track(`phase1-invited-ag-${suffix}`);
  const an = track(`phase1-invited-an-${suffix}`);
  const project = track(`phase1-invited-project-${suffix}`);
  const invitationId = track(`phase1-invited-invitation-${suffix}`);
  const correlationId = track(`phase1-invited-correlation-${suffix}`);
  const policyId = track(`phase1-invited-policy-${suffix}`);
  await agDb.insert(organizationsTable).values([
    { id: ag, name: ag, type: "AG" },
    { id: an, name: an, type: "AN" },
  ]);
  await agDb.insert(projectsTable).values({
    id: project, name: project, agOrgId: ag, status: "ACTIVE",
    startDate: "2025-01-01", endDate: "2027-01-01",
  });
  const validUntil = options.validUntil ?? null;
  const snapshot = {
    ...policy(ag, an, project, validUntil),
    lifecycleStatus: options.policyStatus ?? "PUBLISHED",
    effectivePolicy: { validFrom: null, validUntil },
  };
  await agDb.insert(coordinationPoliciesTable).values({
    id: policyId, policyKey: policyId, version: 1, kind: "PROJECT_AGREEMENT",
    projectId: project, providerOrgId: ag, recipientOrgId: an,
    lifecycleStatus: options.policyStatus ?? "PUBLISHED",
    policySnapshot: snapshot, effectivePolicy: snapshot.effectivePolicy,
  });
  const [membership] = await agDb.insert(projectMembershipsTable).values({
    projectId: project, agOrgId: ag, anOrgId: an,
    anParticipantId: `BPNL${suffix.replaceAll("-", "").slice(0, 12)}`,
    status: "INVITED", invitationId, correlationId, projectAgreementPolicyId: policyId,
  }).returning();
  ids.push(membership.id);
  return { ag, an, project, membership, policyId, invitationId };
}

async function expectProtectedDenied(fixture: Awaited<ReturnType<typeof deliveredFixture>>) {
  const detail = await getAnLeistungsanfrageDetail(fixture.requestId, fixture.an);
  expect(detail?.policyDetailsAvailable).toBe(false);
  expect(detail?.projectId).toBe(fixture.project); // metadata remains visible
  await expect(runAnAvailabilityCheck(fixture.requestId, fixture.an, null)).rejects.toBeInstanceOf(LeistungsanfragePolicyAccessError);
  await expect(updateAnResourceRequirement(fixture.requestId, "missing", fixture.an, {})).rejects.toBeInstanceOf(LeistungsanfragePolicyAccessError);
  await expect(createAnScheduleChangeProposal({
    requestId: fixture.requestId, anOrgId: fixture.an, userId: "phase1-user",
    start: "2026-04-01T00:00:00.000Z", end: "2026-04-02T00:00:00.000Z",
  })).rejects.toBeInstanceOf(LeistungsanfragePolicyAccessError);
  const [projection] = await anDb.select().from(anLeistungsanfragenTable).where(eq(anLeistungsanfragenTable.externalLeistungsanfrageId, fixture.requestId));
  await expect(createAnServiceResponse({ anLeistungsanfrageId: projection!.id, anOrgId: fixture.an, userId: null, decision: "REJECTED" })).rejects.toBeInstanceOf(LeistungsanfragePolicyAccessError);
}

describe("Phase 1 delivered-request root synchronization", () => {
  it("synchronizes real revokeMembership through local Dataspace and blocks protected AN services", async () => {
    const fixture = await deliveredFixture();
    await revokeMembership(fixture.membership.id, fixture.ag);
    const [projection] = await anDb.select().from(anLeistungsanfragenTable).where(eq(anLeistungsanfragenTable.externalLeistungsanfrageId, fixture.requestId));
    expect((projection!.effectivePolicy as Record<string, unknown>).parentMembershipStatus).toBe("REVOKED");
    await expectProtectedDenied(fixture);
  });

  it("synchronizes the explicit root agreement lifecycle owner after delivery", async () => {
    const fixture = await deliveredFixture();
    await revokeProjectAgreement(fixture.agreement.policyId, fixture.ag);
    const [projection] = await anDb.select().from(anLeistungsanfragenTable)
      .where(eq(anLeistungsanfragenTable.externalLeistungsanfrageId, fixture.requestId));
    expect((projection!.effectivePolicy as Record<string, unknown>).parentAgreementStatus).toBe("REVOKED");
    await expectProtectedDenied(fixture);
  });

  it("enforces parent expiry after delivery while preserving metadata", async () => {
    const fixture = await deliveredFixture("2020-01-01T00:00:00.000Z");
    const [projection] = await anDb.select().from(anLeistungsanfragenTable)
      .where(eq(anLeistungsanfragenTable.externalLeistungsanfrageId, fixture.requestId));
    expect((projection!.effectivePolicy as Record<string, unknown>).validUntil).toBe("2020-01-01T00:00:00.000Z");
    await expectProtectedDenied(fixture);
  });

  it("blocks revoke-before-accept and never reactivates the parent agreement", async () => {
    const fixture = await invitedAgreementFixture();
    await revokeProjectAgreement(fixture.policyId, fixture.ag);

    await expect(acceptInvitation(fixture.membership.id, fixture.an, true))
      .rejects.toMatchObject({
        code: expect.stringMatching(/^PROJECT_(AGREEMENT_NOT_ACCEPTABLE|INVITATION_ALREADY_RESOLVED)$/),
      });
    const [membership] = await agDb.select().from(projectMembershipsTable)
      .where(eq(projectMembershipsTable.id, fixture.membership.id));
    const [agreement] = await agDb.select().from(coordinationPoliciesTable)
      .where(eq(coordinationPoliciesTable.id, fixture.policyId));
    expect(membership?.status).toBe("REVOKED");
    expect(agreement?.lifecycleStatus).toBe("REVOKED");
  });

  it("revokes an accepted membership and is idempotent when repeated", async () => {
    const fixture = await invitedAgreementFixture();
    await acceptInvitation(fixture.membership.id, fixture.an, true);
    await revokeProjectAgreement(fixture.policyId, fixture.ag);
    const second = await revokeProjectAgreement(fixture.policyId, fixture.ag);

    const [membership] = await agDb.select().from(projectMembershipsTable)
      .where(eq(projectMembershipsTable.id, fixture.membership.id));
    expect(second.lifecycleStatus).toBe("REVOKED");
    expect(membership?.status).toBe("REVOKED");
  });

  it("blocks acceptance when the parent agreement validity has expired", async () => {
    const fixture = await invitedAgreementFixture({ validUntil: "2020-01-01T00:00:00.000Z" });
    await expect(acceptInvitation(fixture.membership.id, fixture.an, true))
      .rejects.toMatchObject({ code: "PROJECT_AGREEMENT_EXPIRED" });
    const [membership] = await agDb.select().from(projectMembershipsTable)
      .where(eq(projectMembershipsTable.id, fixture.membership.id));
    expect(membership?.status).toBe("INVITED");
  });

  it("serializes parallel acceptance and revocation without an ACTIVE/REVOKED split state", async () => {
    const fixture = await invitedAgreementFixture();
    const outcomes = await Promise.allSettled([
      acceptInvitation(fixture.membership.id, fixture.an, true),
      revokeProjectAgreement(fixture.policyId, fixture.ag),
    ]);
    expect(outcomes.some((outcome) => outcome.status === "fulfilled")).toBe(true);
    const [membership] = await agDb.select().from(projectMembershipsTable)
      .where(eq(projectMembershipsTable.id, fixture.membership.id));
    const [agreement] = await agDb.select().from(coordinationPoliciesTable)
      .where(eq(coordinationPoliciesTable.id, fixture.policyId));
    expect(agreement?.lifecycleStatus).toBe("REVOKED");
    expect(membership?.status).toBe("REVOKED");
  });
});

afterEach(async () => {
  const created = ids.splice(0);
  for (const id of created) {
    await agDb.delete(messageOutboxTable).where(eq(messageOutboxTable.messageId, `project-invitation-response-${id}-ACTIVE`)).catch(() => {});
    await anDb.delete(anLeistungsanfragenTable).where(eq(anLeistungsanfragenTable.externalLeistungsanfrageId, id)).catch(() => {});
    await anDb.delete(anProjectInvitationsTable).where(eq(anProjectInvitationsTable.invitationId, id)).catch(() => {});
    await agDb.delete(projectMembershipsTable).where(eq(projectMembershipsTable.id, id)).catch(() => {});
  }
  // Delete AG records in FK order; identifiers are deliberately namespaced,
  // making cleanup safe when this file runs alongside other suites.
  for (const id of created) {
    await agDb.delete(coordinationPoliciesTable).where(eq(coordinationPoliciesTable.id, id)).catch(() => {});
    await agDb.delete(projectsTable).where(eq(projectsTable.id, id)).catch(() => {});
    await agDb.delete(organizationsTable).where(eq(organizationsTable.id, id)).catch(() => {});
  }
});