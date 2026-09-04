/**
 * Task 80 — Fix revision transport status + responseRequiredBy field bug
 *
 * Tests:
 *   A) POST /takt-requests: responseRequiredBy field round-trip
 *      – returns the actual deadline, not createdAt
 *   B) Revision transport: success path → newRequest.status = DELIVERED
 *   C) Revision transport: FAILED path → newRequest.status stays DRAFT
 *   D) Revision retry idempotency: retry() finds existing outbox row by messageId,
 *      does not create a second revision or snapshot
 *
 * Fixture prefix: "t80-"
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import { agDb as db, runWithDatabaseRole } from "@workspace/db";
import {
  organizationsTable,
  usersTable,
  projectsTable,
  takteTable,
  taktRequestsTable,
  taktRequestSnapshotsTable,
  taktResponsesTable,
  taktResponseDecisionsTable,
  taktVersionsTable,
  messageInboxTable,
  messageOutboxTable,
  messageDeliveryAttemptsTable,
  projectContractorsTable,
  projectMembershipsTable,
  coordinationPoliciesTable,
} from "@workspace/db";
import { eq, inArray, sql } from "drizzle-orm";
import app from "../app";
import { createRevision } from "../services/revision-service";
import { createLeistungsanfrageRevision } from "../services/service-change-proposal-service";
import type { MessageTransport, MessageEnvelope, TransportResult, InboxMessage, InboxQueryOptions } from "../lib/transport/message-transport";

function createAgRevision(input: Parameters<typeof createRevision>[0]) {
  return runWithDatabaseRole("ag", () => createRevision(input));
}

const JWT_SECRET = process.env.JWT_SECRET ?? "taktkoord-jwt-dev-secret-change-in-prod";
function sign(p: { userId: string; orgId: string | null; orgType: "AG" | "AN" | null; hubAdmin?: boolean; roles?: string[] }): string {
  const roles = p.roles ?? (p.orgType === "AG" ? ["AG_ADMIN"] : p.orgType === "AN" ? ["AN_ADMIN"] : []);
  return jwt.sign({ ...p, hubAdmin: p.hubAdmin ?? false, roles }, JWT_SECRET, { expiresIn: "1h" });
}

// ── Fixture IDs ───────────────────────────────────────────────────────────────
const GU_ORG  = "t80-gu-org";
const NU_ORG  = "t80-nu-org";
const GU_USER = "t80-gu-user";
const NU_USER = "t80-nu-user";
const PROJECT = "t80-project";
const TAKT    = "t80-takt";

const guToken = sign({ userId: GU_USER, orgId: GU_ORG, orgType: "AG" });

// ── Mock transports for injection ─────────────────────────────────────────────

/** Returns DELIVERED immediately (simulates successful local delivery). */
class AlwaysDeliveredTransport implements MessageTransport {
  public lastMessageId: string | null = null;
  async send(envelope: MessageEnvelope): Promise<TransportResult> {
    this.lastMessageId = envelope.messageId;
    const now = new Date();
    return { messageId: envelope.messageId, status: "DELIVERED", sentAt: now, deliveredAt: now, attemptCount: 1 };
  }
  async getInbox(_recipientOrgId: string, _options?: InboxQueryOptions): Promise<InboxMessage[]> { return []; }
  async markAsRead(_messageId: string, _recipientOrgId: string): Promise<void> {}
  async retry(_messageId: string): Promise<TransportResult> { throw new Error("not implemented"); }
}

/** Returns FAILED immediately (simulates transport failure). */
class AlwaysFailedTransport implements MessageTransport {
  async send(envelope: MessageEnvelope): Promise<TransportResult> {
    return {
      messageId: envelope.messageId,
      status: "FAILED",
      sentAt: null,
      deliveredAt: null,
      attemptCount: 1,
      error: { code: "TRANSPORT_FAILURE", message: "Simulated transport failure (test)" },
    };
  }
  async getInbox(_recipientOrgId: string, _options?: InboxQueryOptions): Promise<InboxMessage[]> { return []; }
  async markAsRead(_messageId: string, _recipientOrgId: string): Promise<void> {}
  async retry(_messageId: string): Promise<TransportResult> { throw new Error("not implemented"); }
}

// ── Shared fixture state ───────────────────────────────────────────────────────
let taktVersion = 1;

// Helper: insert a TaktRequest in REVISION_REQUIRED status with all required fixtures
async function insertRevisionRequiredFixture(suffix: string): Promise<{
  requestId: string;
  responseId: string;
  decisionId: string;
}> {
  const requestId  = `t80-req-${suffix}`;
  const responseId = `t80-resp-${suffix}`;
  const decisionId = `t80-dec-${suffix}`;
  const now = new Date();

  await db.insert(taktRequestsTable).values({
    id: requestId,
    taktId: TAKT,
    taktVersion,
    guOrgId: GU_ORG,
    nuOrgId: NU_ORG,
    requestNumber: `TKR-80-${suffix}`,
    status: "REVISION_REQUIRED" as const,
    createdByUserId: GU_USER,
    createdAt: now,
    updatedAt: now,
  }).onConflictDoNothing();

  await db.insert(taktRequestSnapshotsTable).values({
    taktRequestId: requestId,
    schemaVersion: "1.0",
    snapshotPayload: { taktId: TAKT, taktVersion },
  }).onConflictDoNothing();

  const [responseRow] = await db.insert(taktResponsesTable).values({
    taktRequestId: requestId,
    decision: "ALTERNATIVES_PROPOSED" as const,
    createdByUserId: NU_USER,
  }).returning();

  await db.insert(taktResponseDecisionsTable).values({
    taktRequestId: requestId,
    responseId: responseRow.id,
    guOrgId: GU_ORG,
    decisionType: "REQUEST_REVISION" as const,
    decidedByUserId: GU_USER,
    decidedAt: now,
  });

  return { requestId, responseId: responseRow.id, decisionId: "" };
}

async function attachPerformancePolicy(
  requestId: string,
  suffix: string,
  options: {
    lifecycleStatus?: "ACCEPTED" | "CONSENT_REQUIRED";
    deltaClass?: "WITHIN_BASELINE" | "REQUIRES_CONSENT" | "NOT_PERMITTED";
    validUntil?: string;
    retentionUntil?: string;
  } = {},
) {
  const id = `t80-performance-${suffix}`;
  const effectivePolicy = {
    policyType: "PERFORMANCE_REQUEST",
    recipientOrganizationId: NU_ORG,
    projectReference: PROJECT,
    workPackageReference: TAKT,
    purpose: "LEISTUNGSKOORDINATION",
    permissions: ["READ", "DOWNLOAD", "USE_FOR_PERFORMANCE_COORDINATION"],
    selectedFields: ["plannedTimeWindow"],
    prohibitions: [],
    childPolicyTypes: ["SCHEDULE_CHANGE"],
    childPermissions: ["READ", "USE_FOR_SCHEDULE_COORDINATION"],
    validFrom: null,
    validUntil: options.validUntil ?? null,
    ...(options.retentionUntil ? { retentionUntil: options.retentionUntil } : {}),
  };
  await db.insert(coordinationPoliciesTable).values({
    id,
    policyKey: `t80-performance-${suffix}`,
    version: 1,
    kind: "PERFORMANCE_REQUEST",
    projectId: PROJECT,
    providerOrgId: GU_ORG,
    recipientOrgId: NU_ORG,
    parentPolicyId: "t80-agreement",
    lifecycleStatus: options.lifecycleStatus ?? "ACCEPTED",
    deltaClass: options.deltaClass ?? "WITHIN_BASELINE",
    policySnapshot: {
      policyId: id,
      templateId: "tk-policy-performance-coordination",
      templateVersion: 1,
      purpose: "LEISTUNGSKOORDINATION",
      projectReference: PROJECT,
      workPackageReference: TAKT,
      selectedFields: ["plannedTimeWindow"],
    },
    effectivePolicy,
    createdByUserId: GU_USER,
  });
  await db.update(taktRequestsTable).set({ performancePolicyId: id })
    .where(eq(taktRequestsTable.id, requestId));
  return id;
}

// ── Global beforeAll / afterAll ────────────────────────────────────────────────
beforeAll(async () => {
  // Pre-cleanup
  await db.delete(messageInboxTable).where(eq(messageInboxTable.senderOrgId, GU_ORG)).catch(() => {});
  await db.delete(messageOutboxTable).where(eq(messageOutboxTable.senderOrgId, GU_ORG)).catch(() => {});
  await db.delete(taktVersionsTable).where(eq(taktVersionsTable.taktId, TAKT)).catch(() => {});
  await db.delete(taktResponseDecisionsTable).where(eq(taktResponseDecisionsTable.guOrgId, GU_ORG)).catch(() => {});

  const staleReqs = await db.select({ id: taktRequestsTable.id }).from(taktRequestsTable)
    .where(eq(taktRequestsTable.taktId, TAKT)).catch(() => [] as { id: string }[]);
  if (staleReqs.length > 0) {
    const ids = staleReqs.map(r => r.id);
    await db.delete(taktResponsesTable).where(inArray(taktResponsesTable.taktRequestId, ids)).catch(() => {});
    await db.delete(taktRequestSnapshotsTable).where(inArray(taktRequestSnapshotsTable.taktRequestId, ids)).catch(() => {});
    await db.delete(taktRequestsTable).where(inArray(taktRequestsTable.id, ids)).catch(() => {});
  }

  await db.delete(projectContractorsTable).where(eq(projectContractorsTable.projectId, PROJECT)).catch(() => {});
  await db.delete(takteTable).where(eq(takteTable.id, TAKT)).catch(() => {});
  await db.delete(projectsTable).where(eq(projectsTable.id, PROJECT)).catch(() => {});
  await db.delete(usersTable).where(eq(usersTable.id, GU_USER)).catch(() => {});
  await db.delete(usersTable).where(eq(usersTable.id, NU_USER)).catch(() => {});
  await db.delete(organizationsTable).where(eq(organizationsTable.id, GU_ORG)).catch(() => {});
  await db.delete(organizationsTable).where(eq(organizationsTable.id, NU_ORG)).catch(() => {});

  // Insert shared fixtures
  await db.insert(organizationsTable).values([
    { id: GU_ORG, name: "t80 GU", type: "AG" as const },
    { id: NU_ORG, name: "t80 NU", type: "AN" as const },
  ]).onConflictDoNothing();

  await db.insert(usersTable).values([
    { id: GU_USER, email: "t80-gu@test.com", name: "GU80", passwordHash: "x" },
    { id: NU_USER, email: "t80-nu@test.com", name: "NU80", passwordHash: "x" },
  ]).onConflictDoNothing();

  await db.insert(projectsTable).values({
    id: PROJECT, agOrgId: GU_ORG, name: "t80 Project",
    status: "ACTIVE" as const, startDate: "2027-01-01", endDate: "2027-12-31",
  }).onConflictDoNothing();

  await db.insert(projectContractorsTable).values({
    projectId: PROJECT,
    anOrgId: NU_ORG,
    assignmentStatus: "ACTIVE",
  }).onConflictDoNothing();
  await db.insert(coordinationPoliciesTable).values({
    id: "t80-agreement", policyKey: "t80-agreement", version: 1, kind: "PROJECT_AGREEMENT",
    projectId: PROJECT, providerOrgId: GU_ORG, recipientOrgId: NU_ORG,
    lifecycleStatus: "ACCEPTED", policySnapshot: {}, effectivePolicy: {
      policyType: "PROJECT_AGREEMENT",
      recipientOrganizationId: NU_ORG,
      projectReference: PROJECT,
      validFrom: null,
      validUntil: null,
      childPolicyTypes: ["PERFORMANCE_REQUEST"],
      childPermissions: ["READ", "DOWNLOAD", "USE_FOR_PERFORMANCE_COORDINATION"],
    },
  }).onConflictDoNothing();
  // The shared test database predates the optional publication columns in the
  // current Drizzle model, so keep this fixture insert to physical columns.
  await db.execute(sql`
    INSERT INTO project_memberships (id, project_id, ag_org_id, an_org_id, invitation_id, correlation_id, status, project_agreement_policy_id)
    VALUES ('t80-membership', ${PROJECT}, ${GU_ORG}, ${NU_ORG}, 't80-invitation', 't80-correlation', 'ACTIVE', 't80-agreement')
    ON CONFLICT DO NOTHING
  `);

  await db.insert(takteTable).values({
    id: TAKT, projectId: PROJECT,
    taktBezeichnung: "t80 Takt", zone: "Z1", gewerk: "Beton",
    plannedStart: "2027-03-01", plannedEnd: "2027-03-07",
    lifecycleStatus: "IN_COORDINATION" as const,
  }).onConflictDoNothing();

  const [taktRow] = await db.select().from(takteTable).where(eq(takteTable.id, TAKT)).limit(1);
  taktVersion = taktRow.version;
});

afterAll(async () => {
  await db.delete(messageInboxTable).where(eq(messageInboxTable.senderOrgId, GU_ORG)).catch(() => {});
  await db.delete(messageOutboxTable).where(eq(messageOutboxTable.senderOrgId, GU_ORG)).catch(() => {});
  await db.delete(taktVersionsTable).where(eq(taktVersionsTable.taktId, TAKT)).catch(() => {});
  await db.delete(taktResponseDecisionsTable).where(eq(taktResponseDecisionsTable.guOrgId, GU_ORG)).catch(() => {});

  const reqs = await db.select({ id: taktRequestsTable.id }).from(taktRequestsTable)
    .where(eq(taktRequestsTable.taktId, TAKT)).catch(() => [] as { id: string }[]);
  if (reqs.length > 0) {
    const ids = reqs.map(r => r.id);
    await db.delete(taktResponsesTable).where(inArray(taktResponsesTable.taktRequestId, ids)).catch(() => {});
    await db.delete(taktRequestSnapshotsTable).where(inArray(taktRequestSnapshotsTable.taktRequestId, ids)).catch(() => {});
    await db.delete(taktRequestsTable).where(inArray(taktRequestsTable.id, ids)).catch(() => {});
  }

  await db.delete(projectContractorsTable).where(eq(projectContractorsTable.projectId, PROJECT)).catch(() => {});
  await db.delete(projectMembershipsTable).where(eq(projectMembershipsTable.projectId, PROJECT)).catch(() => {});
  await db.delete(coordinationPoliciesTable).where(eq(coordinationPoliciesTable.projectId, PROJECT)).catch(() => {});
  await db.delete(takteTable).where(eq(takteTable.id, TAKT)).catch(() => {});
  await db.delete(projectsTable).where(eq(projectsTable.id, PROJECT)).catch(() => {});
  await db.delete(usersTable).where(eq(usersTable.id, GU_USER)).catch(() => {});
  await db.delete(usersTable).where(eq(usersTable.id, NU_USER)).catch(() => {});
  await db.delete(organizationsTable).where(eq(organizationsTable.id, GU_ORG)).catch(() => {});
  await db.delete(organizationsTable).where(eq(organizationsTable.id, NU_ORG)).catch(() => {});
});

// ── A) responseRequiredBy field round-trip ────────────────────────────────────
describe("A — POST /takt-requests: responseRequiredBy round-trip", () => {
  it("returns the supplied responseRequiredBy timestamp, not createdAt", async () => {
    const deadline = "2027-06-15T12:00:00.000Z";

    const res = await request(app)
      .post("/api/takt-requests")
      .set("Authorization", `Bearer ${guToken}`)
      .send({
        taktId: TAKT,
        nuOrgId: NU_ORG,
        responseRequiredBy: deadline,
      });

    expect(res.status).toBe(201);
    expect(res.body.responseRequiredBy).toBeTruthy();

    // The returned value must reflect the supplied deadline, not createdAt.
    // createdAt is always near "now"; deadline is 2027-06-15.
    const returnedDeadline = new Date(res.body.responseRequiredBy as string);
    const returnedCreatedAt = new Date(res.body.createdAt as string);
    const suppliedDeadline  = new Date(deadline);

    // Should be the same date as supplied (within 1 second tolerance for DB round-trip)
    expect(Math.abs(returnedDeadline.getTime() - suppliedDeadline.getTime())).toBeLessThan(1000);
    // Must NOT equal createdAt
    expect(Math.abs(returnedDeadline.getTime() - returnedCreatedAt.getTime())).toBeGreaterThan(1000);
  });

  it("returns null responseRequiredBy when none is supplied", async () => {
    const res = await request(app)
      .post("/api/takt-requests")
      .set("Authorization", `Bearer ${guToken}`)
      .send({
        taktId: TAKT,
        nuOrgId: NU_ORG,
      });

    expect(res.status).toBe(201);
    expect(res.body.responseRequiredBy).toBeNull();
  });
});

// ── B) Revision transport: success path → DELIVERED ──────────────────────────
describe("B — Revision transport: success → newRequest.status = DELIVERED", () => {
  it("with sendImmediately=true and working transport → new request is DELIVERED", async () => {
    const { requestId } = await insertRevisionRequiredFixture("b1");
    const mockTransport = new AlwaysDeliveredTransport();

    const result = await createAgRevision({
      oldRequestId:     requestId,
      guOrgId:          GU_ORG,
      userId:           GU_USER,
      plannedTimeWindow: { start: "2027-05-01", end: "2027-05-07" },
      sendImmediately:  true,
      _transport:       mockTransport,
    });

    expect(result.sent).toBe(true);
    expect(result.newRequest.status).toBe("DELIVERED");

    // Verify DB reflects DELIVERED
    const [dbRow] = await db.select({ status: taktRequestsTable.status })
      .from(taktRequestsTable)
      .where(eq(taktRequestsTable.id, result.newRequest.id))
      .limit(1);
    expect(dbRow?.status).toBe("DELIVERED");
  });
});

// ── C) Revision transport: FAILED path → request stays DRAFT ─────────────────
describe("C — Revision transport: FAILED → newRequest.status stays DRAFT", () => {
  it("with sendImmediately=true and failing transport → new request remains DRAFT", async () => {
    const { requestId } = await insertRevisionRequiredFixture("c1");
    const mockTransport = new AlwaysFailedTransport();

    const result = await createAgRevision({
      oldRequestId:      requestId,
      guOrgId:           GU_ORG,
      userId:            GU_USER,
      plannedTimeWindow: { start: "2027-06-01", end: "2027-06-07" },
      sendImmediately:   true,
      _transport:        mockTransport,
    });

    // Transport failed → sent=false, request stays DRAFT
    expect(result.sent).toBe(false);
    expect(result.newRequest.status).toBe("DRAFT");

    // Verify DB: new request is DRAFT, not DELIVERED
    const [dbRow] = await db.select({ status: taktRequestsTable.status })
      .from(taktRequestsTable)
      .where(eq(taktRequestsTable.id, result.newRequest.id))
      .limit(1);
    expect(dbRow?.status).toBe("DRAFT");
  });

  it("old request (REVISION_REQUIRED) remains valid when transport fails", async () => {
    const { requestId } = await insertRevisionRequiredFixture("c2");

    await createAgRevision({
      oldRequestId:      requestId,
      guOrgId:           GU_ORG,
      userId:            GU_USER,
      plannedTimeWindow: { start: "2027-07-01", end: "2027-07-07" },
      sendImmediately:   true,
      _transport:        new AlwaysFailedTransport(),
    });

    const [oldRow] = await db.select({ status: taktRequestsTable.status })
      .from(taktRequestsTable)
      .where(eq(taktRequestsTable.id, requestId))
      .limit(1);
    expect(oldRow?.status).toBe("REVISION_REQUIRED");
  });

  it("no second revision or snapshot is created on transport failure", async () => {
    const { requestId } = await insertRevisionRequiredFixture("c3");

    const result = await createAgRevision({
      oldRequestId:      requestId,
      guOrgId:           GU_ORG,
      userId:            GU_USER,
      plannedTimeWindow: { start: "2027-08-01", end: "2027-08-07" },
      sendImmediately:   true,
      _transport:        new AlwaysFailedTransport(),
    });

    // Exactly one snapshot for the new request
    const snapshots = await db
      .select()
      .from(taktRequestSnapshotsTable)
      .where(eq(taktRequestSnapshotsTable.taktRequestId, result.newRequest.id));
    expect(snapshots).toHaveLength(1);
  });
});

describe("policy-linked Leistungsanfrage revisions", () => {
  it("persists a fresh child policy before linking the successor and drops DataPublication inheritance", async () => {
    const { requestId } = await insertRevisionRequiredFixture("policy-linked");
    const sourcePolicyId = await attachPerformancePolicy(requestId, "linked");
    const result = await createLeistungsanfrageRevision({
      requestId,
      orgId: GU_ORG,
      userId: GU_USER,
      start: new Date("2027-09-01T08:00:00.000Z"),
      end: new Date("2027-09-07T17:00:00.000Z"),
    });
    const [successor] = await db.select().from(taktRequestsTable)
      .where(eq(taktRequestsTable.id, result.requestId));
    expect(successor?.performancePolicyId).toBeTruthy();
    expect(successor?.performancePolicyId).not.toBe(sourcePolicyId);
    expect(successor?.dataPublicationId).toBeNull();
    const [policy] = await db.select().from(coordinationPoliciesTable)
      .where(eq(coordinationPoliciesTable.id, successor!.performancePolicyId!));
    expect(policy).toMatchObject({
      policyKey: "t80-performance-linked",
      version: 2,
      kind: "PERFORMANCE_REQUEST",
      parentPolicyId: "t80-agreement",
      lifecycleStatus: "PUBLISHED",
      deltaClass: "WITHIN_BASELINE",
    });
    expect(policy?.effectivePolicy).toBeTruthy();
    expect(policy?.diff).toBeTruthy();
    expect(policy?.policySnapshot).toMatchObject({
      inheritFrom: "t80-agreement",
      supersedesPolicyId: sourcePolicyId,
      sourceRequestId: requestId,
      successorRequestId: result.requestId,
    });
  });

  it.each([
    ["pending", { lifecycleStatus: "CONSENT_REQUIRED" as const, deltaClass: "REQUIRES_CONSENT" as const }, "POLICY_CONSENT_REQUIRED"],
    ["denied", { lifecycleStatus: "ACCEPTED" as const, deltaClass: "NOT_PERMITTED" as const }, "NOT_PERMITTED"],
    ["expired", { lifecycleStatus: "ACCEPTED" as const, deltaClass: "WITHIN_BASELINE" as const, validUntil: "2020-01-01T00:00:00.000Z" }, "NOT_PERMITTED"],
    ["retention-expired", { lifecycleStatus: "ACCEPTED" as const, deltaClass: "WITHIN_BASELINE" as const, retentionUntil: "2020-01-01T00:00:00.000Z" }, "NOT_PERMITTED"],
  ])("does not create an unguarded legacy successor for a %s source policy", async (suffix, policyOptions, expectedError) => {
    const { requestId } = await insertRevisionRequiredFixture(`guard-${suffix}`);
    await attachPerformancePolicy(requestId, `guard-${suffix}`, policyOptions);
    await expect(createLeistungsanfrageRevision({
      requestId,
      orgId: GU_ORG,
      userId: GU_USER,
      start: new Date("2027-10-01T08:00:00.000Z"),
      end: new Date("2027-10-07T17:00:00.000Z"),
    })).rejects.toMatchObject({ message: expectedError, statusCode: 409 });
    const successors = await db.select().from(taktRequestsTable)
      .where(eq(taktRequestsTable.supersedesRequestId, requestId));
    expect(successors).toHaveLength(0);
  });
});

// ── D) Retry idempotency ──────────────────────────────────────────────────────
describe("D — Retry idempotency: retry uses same messageId, no second revision", () => {
  it("transport.retry() finds existing FAILED outbox row by messageId — does not create a new row", async () => {
    const { LocalHubTransport } = await import("../lib/transport/local-hub-transport");
    const transport = new LocalHubTransport();

    // Pre-insert an outbox row in FAILED status
    const msgId = "t80-retry-test-msg";
    const GU_ORG2 = "t80-retry-gu";
    const NU_ORG2 = "t80-retry-nu";

    // Ensure orgs exist (reuse if already present)
    await db.insert(organizationsTable).values([
      { id: GU_ORG2, name: "t80 Retry GU", type: "AG" as const },
      { id: NU_ORG2, name: "t80 Retry NU", type: "AN" as const },
    ]).onConflictDoNothing();

    // Insert a FAILED outbox row manually
    await db.delete(messageOutboxTable).where(eq(messageOutboxTable.messageId, msgId)).catch(() => {});
    await db.delete(messageDeliveryAttemptsTable).where(eq(messageDeliveryAttemptsTable.messageId, msgId)).catch(() => {});
    await db.insert(messageOutboxTable).values({
      messageId: msgId,
      schemaVersion: "1.0",
      messageType: "TAKT_REQUEST_REVISED",
      senderOrgId: GU_ORG2,
      recipientOrgId: NU_ORG2,
      correlationId: "t80-retry-corr",
      payload: { taktRequestId: "t80-retry-req" },
      status: "FAILED",
      failureReason: "Simulated prior failure",
      attemptCount: 1,
    });

    // Retry should succeed and transition the EXISTING row to DELIVERED
    const result = await transport.retry(msgId);
    expect(result.status).toBe("DELIVERED");
    expect(result.messageId).toBe(msgId);

    // Verify: still only ONE outbox row for this messageId
    const outboxRows = await db
      .select()
      .from(messageOutboxTable)
      .where(eq(messageOutboxTable.messageId, msgId));
    expect(outboxRows).toHaveLength(1);
    expect(outboxRows[0].status).toBe("DELIVERED");

    // Cleanup
    await db.delete(messageInboxTable).where(eq(messageInboxTable.messageId, msgId)).catch(() => {});
    await db.delete(messageOutboxTable).where(eq(messageOutboxTable.messageId, msgId)).catch(() => {});
    await db.delete(messageDeliveryAttemptsTable).where(eq(messageDeliveryAttemptsTable.messageId, msgId)).catch(() => {});
    await db.delete(organizationsTable).where(eq(organizationsTable.id, GU_ORG2)).catch(() => {});
    await db.delete(organizationsTable).where(eq(organizationsTable.id, NU_ORG2)).catch(() => {});
  });

  it("allows only one of two concurrent retries to deliver a FAILED message", async () => {
    const { LocalHubTransport } = await import("../lib/transport/local-hub-transport");
    const transport = new LocalHubTransport();
    const msgId = "t80-concurrent-retry-msg";
    const GU_ORG3 = "t80-concurrent-retry-gu";
    const NU_ORG3 = "t80-concurrent-retry-nu";
    const failureReason = "Simulated prior failure";

    await db.insert(organizationsTable).values([
      { id: GU_ORG3, name: "t80 Concurrent Retry GU", type: "AG" as const },
      { id: NU_ORG3, name: "t80 Concurrent Retry NU", type: "AN" as const },
    ]).onConflictDoNothing();

    try {
      await db.delete(messageInboxTable).where(eq(messageInboxTable.messageId, msgId)).catch(() => {});
      await db.delete(messageDeliveryAttemptsTable).where(eq(messageDeliveryAttemptsTable.messageId, msgId)).catch(() => {});
      await db.delete(messageOutboxTable).where(eq(messageOutboxTable.messageId, msgId)).catch(() => {});

      await db.insert(messageOutboxTable).values({
        messageId: msgId,
        schemaVersion: "1.0",
        messageType: "TAKT_REQUEST_REVISED",
        senderOrgId: GU_ORG3,
        recipientOrgId: NU_ORG3,
        correlationId: "t80-concurrent-retry-corr",
        payload: { taktRequestId: "t80-concurrent-retry-req" },
        status: "FAILED",
        failureReason,
        attemptCount: 1,
      });
      await db.insert(messageDeliveryAttemptsTable).values({
        messageId: msgId,
        attemptNumber: 1,
        status: "FAILED",
        attemptedAt: new Date(),
        failureReason,
      });

      const results = await Promise.allSettled([
        transport.retry(msgId),
        transport.retry(msgId),
      ]);
      const successfulRetries = results.filter(
        (result) => result.status === "fulfilled",
      );
      const rejectedRetries = results.filter(
        (result) => result.status === "rejected",
      );

      expect(successfulRetries).toHaveLength(1);
      expect(successfulRetries[0].value).toMatchObject({
        messageId: msgId,
        status: "DELIVERED",
        attemptCount: 2,
      });
      expect(rejectedRetries).toHaveLength(1);
      expect(rejectedRetries[0].reason).toMatchObject({
        code: "NOT_RETRYABLE",
        messageId: msgId,
      });

      const [outbox] = await db
        .select()
        .from(messageOutboxTable)
        .where(eq(messageOutboxTable.messageId, msgId));
      const history = (await db
        .select()
        .from(messageDeliveryAttemptsTable)
        .where(eq(messageDeliveryAttemptsTable.messageId, msgId)))
        .sort((left, right) => left.attemptNumber - right.attemptNumber);
      const inboxRows = await db
        .select()
        .from(messageInboxTable)
        .where(eq(messageInboxTable.messageId, msgId));

      expect(outbox).toMatchObject({
        status: "DELIVERED",
        attemptCount: 2,
        failureReason: null,
      });
      expect(history).toHaveLength(2);
      expect(history.map((attempt) => [attempt.attemptNumber, attempt.status]))
        .toEqual([[1, "FAILED"], [2, "DELIVERED"]]);
      expect(outbox.lastAttemptAt).toEqual(history[1].attemptedAt);
      expect(inboxRows).toHaveLength(1);
    } finally {
      await db.delete(messageInboxTable).where(eq(messageInboxTable.messageId, msgId)).catch(() => {});
      await db.delete(messageDeliveryAttemptsTable).where(eq(messageDeliveryAttemptsTable.messageId, msgId)).catch(() => {});
      await db.delete(messageOutboxTable).where(eq(messageOutboxTable.messageId, msgId)).catch(() => {});
      await db.delete(organizationsTable).where(eq(organizationsTable.id, GU_ORG3)).catch(() => {});
      await db.delete(organizationsTable).where(eq(organizationsTable.id, NU_ORG3)).catch(() => {});
    }
  });
});
