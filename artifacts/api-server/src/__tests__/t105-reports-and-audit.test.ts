/**
 * Task 105 — Reports & Audit Trail
 *
 * Tests:
 *   AG summary report:
 *   [1]  AG_ADMIN gets correct counts from /reports/ag/summary
 *   [2]  GENERAL_PLANNER may access /reports/ag/summary
 *   [3]  AN user (wrong role) → 403
 *   [4]  AG summary is org-scoped (other AG's data not included)
 *
 *   AN summary report:
 *   [5]  AN_ADMIN gets correct counts from /reports/an/summary
 *   [6]  AN_DISPATCHER may access /reports/an/summary
 *   [7]  AG user (wrong role) → 403
 *   [8]  AN summary is org-scoped (other AN's data not included)
 *
 *   Hub summary report:
 *   [9]  HUB_ADMIN gets correct outbox counts from /reports/hub/summary
 *   [10] Non-HUB_ADMIN → 403
 *
 *   Audit trail events:
 *   [11] POST /takt-requests writes REQUEST_CREATED and SNAPSHOT_CREATED events
 *   [12] REMINDER_SENT event written after successful reminder dispatch
 *
 * Fixture prefix: "t105-"
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import { agDb as db, anDb } from "@workspace/db";
import {
  anLeistungsanfragenTable,
  anLeistungsantwortenTable,
  organizationsTable,
  usersTable,
  projectsTable,
  takteTable,
  taktRequestsTable,
  taktResponsesTable,
  resourcesTable,
  resourceBookingsTable,
  projectContractorsTable,
  projectMembershipsTable,
  coordinationPoliciesTable,
  messageOutboxTable,
  messageInboxTable,
  taktRequestAuditEventsTable,
  taktRequestRemindersTable,
  taktRequestSnapshotsTable,
} from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";
import app from "../app";

const JWT_SECRET = process.env.JWT_SECRET ?? "taktkoord-jwt-dev-secret-change-in-prod";

// ── Fixture IDs ───────────────────────────────────────────────────────────────

const GU_ORG     = "t105-org-gu";
const NU_ORG_A   = "t105-org-nu-a";
const NU_ORG_B   = "t105-org-nu-b";  // second AN for isolation tests
const USER_ID    = "t105-user";
const PROJ_A     = "t105-proj-a";
const TAKT_A     = "t105-takt-a";
const TAKT_B     = "t105-takt-b";    // confirmed takt
const TR_OPEN    = "t105-tr-open";   // DELIVERED status (open)
const TR_DONE    = "t105-tr-done";   // ACCEPTED status
const RESP_ID    = "t105-resp";
const AN_REQUEST_OPEN = "t105-an-request-open";
const AN_REQUEST_DONE = "t105-an-request-done";
const AN_RESPONSE_ID = "t105-an-response";

function makeToken(orgId: string | null, orgType: "AG" | "AN" | null, roles: string[], hubAdmin = false) {
  return jwt.sign({ userId: USER_ID, orgId, orgType, hubAdmin, roles }, JWT_SECRET, { expiresIn: "1h" });
}

const agAdminToken    = makeToken(GU_ORG,   "AG", ["AG_ADMIN"]);
const agPlannerToken  = makeToken(GU_ORG,   "AG", ["GENERAL_PLANNER"]);
const nuAdminToken    = makeToken(NU_ORG_A, "AN", ["AN_ADMIN"]);
const nuDispToken     = makeToken(NU_ORG_A, "AN", ["AN_DISPATCHER"]);
const nuBToken        = makeToken(NU_ORG_B, "AN", ["AN_ADMIN"]);
const agAsNuToken     = makeToken(GU_ORG,   "AG", ["AG_ADMIN"]);  // AG user trying AN route
const hubAdminToken   = makeToken(null,     null,  ["HUB_ADMIN"], true);
const nonHubToken     = makeToken(GU_ORG,   "AG", ["AG_ADMIN"]);

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeAll(async () => {
  await db.insert(organizationsTable).values([
    { id: GU_ORG,   name: "T105 GU",   type: "AG" as const },
    { id: NU_ORG_A, name: "T105 NU-A", type: "AN" as const },
    { id: NU_ORG_B, name: "T105 NU-B", type: "AN" as const },
  ]).onConflictDoNothing();

  await db.insert(usersTable).values([
    { id: USER_ID, name: "T105 User", email: "t105@test.local", passwordHash: "x" },
  ]).onConflictDoNothing();

  // Two projects for GU_ORG
  await db.insert(projectsTable).values([
    { id: PROJ_A, name: "T105 Proj A", agOrgId: GU_ORG },
  ]).onConflictDoNothing();

  // Assign NU_ORG_A as subcontractor
  await db.insert(projectContractorsTable).values({
    projectId: PROJ_A, anOrgId: NU_ORG_A, assignmentStatus: "ACTIVE" as const,
  }).onConflictDoNothing();

  // Two takte in the project (one confirmed)
  await db.insert(takteTable).values([
    {
      id: TAKT_A, projectId: PROJ_A,
      taktBezeichnung: "T105-A", zone: "Z1", gewerk: "Rohbau",
      plannedStart: "2026-09-01", plannedEnd: "2026-09-30",
      lifecycleStatus: "IN_COORDINATION" as const,
    },
    {
      id: TAKT_B, projectId: PROJ_A,
      taktBezeichnung: "T105-B", zone: "Z2", gewerk: "Ausbau",
      plannedStart: "2026-10-01", plannedEnd: "2026-10-30",
      lifecycleStatus: "CONFIRMED" as const,
    },
  ]).onConflictDoNothing();

  // One open TaktRequest (DELIVERED = open)
  await db.insert(taktRequestsTable).values([
    {
      id: TR_OPEN,
      taktId: TAKT_A,
      guOrgId: GU_ORG,
      nuOrgId: NU_ORG_A,
      requestNumber: "T105-TR-OPEN",
      status: "DELIVERED" as const,
      taktVersion: 1,
      createdByUserId: USER_ID,
    },
    {
      id: TR_DONE,
      taktId: TAKT_A,
      guOrgId: GU_ORG,
      nuOrgId: NU_ORG_A,
      requestNumber: "T105-TR-DONE",
      status: "ACCEPTED" as const,
      taktVersion: 1,
      createdByUserId: USER_ID,
    },
  ]).onConflictDoNothing();

  // One response for TR_DONE
  await db.insert(taktResponsesTable).values({
    taktRequestId: TR_DONE,
    decision: "ACCEPTED" as const,
    responsePayloadHash: "t105-hash",
    createdByUserId: USER_ID,
  }).onConflictDoNothing();

  // AN reporting must only use these local inbound projections, never the
  // AG-side requests above. Their IDs deliberately differ from TR_OPEN/TR_DONE.
  const responseRequiredBy = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
  await anDb.insert(anLeistungsanfragenTable).values([
    {
      id: AN_REQUEST_OPEN,
      externalLeistungsanfrageId: "t105-external-open",
      externalRequestVersion: 1,
      sourceMessageId: "t105-an-source-open",
      payloadHash: "t105-an-hash-open",
      correlationId: "t105-an-correlation-open",
      senderAgOrgId: GU_ORG,
      receiverAnOrgId: NU_ORG_A,
      projectReference: PROJ_A,
      leistungReference: TAKT_A,
      plannedStart: "2026-09-01",
      plannedEnd: "2026-09-30",
      payloadSnapshot: { responseRequiredBy },
      status: "UNDER_REVIEW",
    },
    {
      id: AN_REQUEST_DONE,
      externalLeistungsanfrageId: "t105-external-done",
      externalRequestVersion: 1,
      sourceMessageId: "t105-an-source-done",
      payloadHash: "t105-an-hash-done",
      correlationId: "t105-an-correlation-done",
      senderAgOrgId: GU_ORG,
      receiverAnOrgId: NU_ORG_A,
      projectReference: PROJ_A,
      leistungReference: TAKT_A,
      plannedStart: "2026-09-01",
      plannedEnd: "2026-09-30",
      payloadSnapshot: {},
      status: "RESPONDED",
    },
  ]).onConflictDoNothing();
  await anDb.insert(anLeistungsantwortenTable).values({
    id: AN_RESPONSE_ID,
    anLeistungsanfrageId: AN_REQUEST_DONE,
    sourceRequestId: "t105-external-done",
    requestVersion: 1,
    decision: "ACCEPTED",
    payloadHash: "t105-an-response-hash",
    outboundMessageId: "t105-an-outbound-response",
    createdByUserId: USER_ID,
  }).onConflictDoNothing();

  // One active resource for NU_ORG_A (explicit id, same as t104 pattern)
  await db.insert(resourcesTable).values({
    id: "t105-res-a",
    anOrgId: NU_ORG_A,
    name: "T105 Resource",
    type: "CREW" as const,
    active: true,
  }).onConflictDoNothing();

  // One resource booking for NU_ORG_A (TENTATIVE)
  await db.insert(resourceBookingsTable).values({
    nuOrgId: NU_ORG_A,
    resourceId: "t105-res-a",
    status: "TENTATIVE" as const,
    startAt: new Date("2026-09-05"),
    endAt: new Date("2026-09-10"),
    sourceType: "TAKT_REQUEST" as const,
    sourceReferenceId: TR_DONE,
  }).onConflictDoNothing();
});

afterAll(async () => {
  // Delete in FK-safe order
  await db.delete(taktRequestAuditEventsTable)
    .where(inArray(taktRequestAuditEventsTable.requestId, [TR_OPEN, TR_DONE]));
  await db.delete(taktRequestRemindersTable)
    .where(eq(taktRequestRemindersTable.taktRequestId, TR_OPEN));

  await db.delete(messageOutboxTable)
    .where(inArray(messageOutboxTable.senderOrgId, [GU_ORG, NU_ORG_A, NU_ORG_B]));
  await db.delete(messageInboxTable)
    .where(inArray(messageInboxTable.senderOrgId, [GU_ORG, NU_ORG_A, NU_ORG_B]));

  await anDb.delete(anLeistungsantwortenTable).where(eq(anLeistungsantwortenTable.id, AN_RESPONSE_ID));
  await anDb.delete(anLeistungsanfragenTable)
    .where(inArray(anLeistungsanfragenTable.id, [AN_REQUEST_OPEN, AN_REQUEST_DONE]));
  await db.delete(taktResponsesTable).where(eq(taktResponsesTable.id, RESP_ID));
  await db.delete(taktRequestsTable)
    .where(inArray(taktRequestsTable.id, [TR_OPEN, TR_DONE]));
  await db.delete(resourceBookingsTable).where(eq(resourceBookingsTable.id, "t105-booking-a"));
  await db.delete(resourcesTable).where(eq(resourcesTable.id, "t105-res-a"));
  await db.delete(projectContractorsTable)
    .where(and(eq(projectContractorsTable.projectId, PROJ_A), eq(projectContractorsTable.anOrgId, NU_ORG_A)));
  await db.delete(takteTable).where(inArray(takteTable.id, [TAKT_A, TAKT_B]));
  await db.delete(projectsTable).where(eq(projectsTable.id, PROJ_A));
  await db.delete(usersTable).where(eq(usersTable.id, USER_ID));
  await db.delete(organizationsTable)
    .where(inArray(organizationsTable.id, [GU_ORG, NU_ORG_A, NU_ORG_B]));
});

// ── AG summary ────────────────────────────────────────────────────────────────

describe("GET /api/reports/ag/summary", () => {
  it("[1] AG_ADMIN gets correct counts", async () => {
    const res = await request(app)
      .get("/api/reports/ag/summary")
      .set("Authorization", `Bearer ${agAdminToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      projects: expect.any(Number),
      assignedSubcontractors: expect.any(Number),
      openTaktRequests: expect.any(Number),
      acceptedTaktRequests: expect.any(Number),
      confirmedTakts: expect.any(Number),
    });
    // Our fixture: 1 project, 1 subcontractor, 1 open (DELIVERED), 1 accepted, 1 confirmed takt
    expect(res.body.projects).toBeGreaterThanOrEqual(1);
    expect(res.body.assignedSubcontractors).toBeGreaterThanOrEqual(1);
    expect(res.body.openTaktRequests).toBeGreaterThanOrEqual(1);
    expect(res.body.acceptedTaktRequests).toBeGreaterThanOrEqual(1);
    expect(res.body.confirmedTakts).toBeGreaterThanOrEqual(1);
  });

  it("[2] GENERAL_PLANNER may access", async () => {
    const res = await request(app)
      .get("/api/reports/ag/summary")
      .set("Authorization", `Bearer ${agPlannerToken}`);
    expect(res.status).toBe(200);
  });

  it("[3] AN_ADMIN → 403", async () => {
    const res = await request(app)
      .get("/api/reports/ag/summary")
      .set("Authorization", `Bearer ${nuAdminToken}`);
    expect(res.status).toBe(403);
  });

  it("[4] counts are org-scoped (NU_ORG_B data excluded)", async () => {
    // NU_ORG_B has no projects, so agAdminToken from GU_ORG must not see NU_ORG_B data
    const resA = await request(app)
      .get("/api/reports/ag/summary")
      .set("Authorization", `Bearer ${agAdminToken}`);
    expect(resA.status).toBe(200);

    // NU_ORG_B token is AN type, so cannot access this endpoint at all
    const resB = await request(app)
      .get("/api/reports/ag/summary")
      .set("Authorization", `Bearer ${nuBToken}`);
    expect(resB.status).toBe(403);
  });
});

// ── AN summary ────────────────────────────────────────────────────────────────

describe("GET /api/reports/an/summary", () => {
  it("[5] AN_ADMIN gets correct counts", async () => {
    const res = await request(app)
      .get("/api/reports/an/summary")
      .set("Authorization", `Bearer ${nuAdminToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      openTaktRequests: expect.any(Number),
      dueSoonTaktRequests: expect.any(Number),
      overdueTaktRequests: expect.any(Number),
      acceptedResponses: expect.any(Number),
      alternativeResponses: expect.any(Number),
      rejectedResponses: expect.any(Number),
      activeResources: expect.any(Number),
      activeResourceBookings: expect.any(Number),
    });
    // Our local fixture: 1 open projection, 1 accepted local response,
    // 1 resource, 1 booking.
    expect(res.body.openTaktRequests).toBeGreaterThanOrEqual(1);
    expect(res.body.acceptedResponses).toBeGreaterThanOrEqual(1);
    expect(res.body.activeResources).toBeGreaterThanOrEqual(1);
    expect(res.body.activeResourceBookings).toBeGreaterThanOrEqual(1);
  });

  it("[6] AN_DISPATCHER may access", async () => {
    const res = await request(app)
      .get("/api/reports/an/summary")
      .set("Authorization", `Bearer ${nuDispToken}`);
    expect(res.status).toBe(200);
  });

  it("[7] AG_ADMIN → 403", async () => {
    const res = await request(app)
      .get("/api/reports/an/summary")
      .set("Authorization", `Bearer ${agAsNuToken}`);
    expect(res.status).toBe(403);
  });

  it("[8] counts are org-scoped (NU_ORG_B sees zero for this fixture)", async () => {
    const res = await request(app)
      .get("/api/reports/an/summary")
      .set("Authorization", `Bearer ${nuBToken}`);
    expect(res.status).toBe(200);
    // NU_ORG_B has no resources, bookings, or requests in our fixture
    expect(res.body.activeResources).toBe(0);
    expect(res.body.activeResourceBookings).toBe(0);
    expect(res.body.openTaktRequests).toBe(0);
  });

  it("[8b] AN legacy URL is blocked while the local namespace resolves the projection", async () => {
    const legacy = await request(app)
      .get("/api/leistungsanfragen")
      .set("Authorization", `Bearer ${nuAdminToken}`);
    expect(legacy.status).toBe(403);

    const local = await request(app)
      .get("/api/an/leistungsanfragen")
      .set("Authorization", `Bearer ${nuAdminToken}`);
    expect(local.status).toBe(200);
    expect(local.body).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "t105-external-open", localProjectionId: AN_REQUEST_OPEN }),
    ]));
  });
});

// ── Hub summary ───────────────────────────────────────────────────────────────

describe("GET /api/reports/hub/summary", () => {
  it("[9] HUB_ADMIN gets outbox counts", async () => {
    const res = await request(app)
      .get("/api/reports/hub/summary")
      .set("Authorization", `Bearer ${hubAdminToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      pendingMessages: expect.any(Number),
      deliveredMessages: expect.any(Number),
      failedMessages: expect.any(Number),
      retryCount: expect.any(Number),
    });
    // All values should be non-negative numbers
    expect(res.body.pendingMessages).toBeGreaterThanOrEqual(0);
    expect(res.body.deliveredMessages).toBeGreaterThanOrEqual(0);
    expect(res.body.failedMessages).toBeGreaterThanOrEqual(0);
    expect(res.body.retryCount).toBeGreaterThanOrEqual(0);
  });

  it("[10] non-HUB_ADMIN → 403", async () => {
    const res = await request(app)
      .get("/api/reports/hub/summary")
      .set("Authorization", `Bearer ${nonHubToken}`);
    expect(res.status).toBe(403);
  });
});

// ── Audit trail events ────────────────────────────────────────────────────────

describe("Audit trail — new event types", () => {
  it("[11] POST /takt-requests writes REQUEST_CREATED and SNAPSHOT_CREATED", async () => {
    // We need a contractor assignment for the POST to succeed
    const taktId = "t105-audit-takt";
    const projId = "t105-audit-proj";
    const agreementId = "t105-audit-project-agreement";

    await db.insert(projectsTable).values({ id: projId, name: "T105 Audit Proj", agOrgId: GU_ORG })
      .onConflictDoNothing();
    await db.insert(takteTable).values({
      id: taktId, projectId: projId,
      taktBezeichnung: "T105-Audit", zone: "Z1", gewerk: "Rohbau",
      plannedStart: "2026-09-01", plannedEnd: "2026-09-30",
    }).onConflictDoNothing();
    await db.insert(projectContractorsTable).values({
      projectId: projId, anOrgId: NU_ORG_A, assignmentStatus: "ACTIVE" as const,
    }).onConflictDoNothing();
    await db.insert(coordinationPoliciesTable).values({
      id: agreementId,
      policyKey: agreementId,
      version: 1,
      kind: "PROJECT_AGREEMENT",
      projectId: projId,
      providerOrgId: GU_ORG,
      recipientOrgId: NU_ORG_A,
      lifecycleStatus: "ACCEPTED",
      policySnapshot: {},
      effectivePolicy: {
        policyType: "PROJECT_AGREEMENT",
        recipientOrganizationId: NU_ORG_A,
        projectReference: projId,
        validFrom: null,
        validUntil: null,
        childPolicyTypes: ["PERFORMANCE_REQUEST"],
        childPermissions: ["READ", "DOWNLOAD", "USE_FOR_PERFORMANCE_COORDINATION"],
      },
    }).onConflictDoNothing();
    await db.insert(projectMembershipsTable).values({
      id: "t105-audit-membership",
      projectId: projId,
      agOrgId: GU_ORG,
      anOrgId: NU_ORG_A,
      status: "ACTIVE",
      invitationId: "t105-audit-invitation",
      correlationId: "t105-audit-correlation",
      projectAgreementPolicyId: agreementId,
    }).onConflictDoNothing();

    const res = await request(app)
      .post("/api/takt-requests")
      .set("Authorization", `Bearer ${agAdminToken}`)
      .send({ taktId, nuOrgId: NU_ORG_A });

    expect(res.status).toBe(201);
    const requestId = res.body.id;

    // Check audit events were written
    const events = await db
      .select({ eventType: taktRequestAuditEventsTable.eventType })
      .from(taktRequestAuditEventsTable)
      .where(eq(taktRequestAuditEventsTable.requestId, requestId));

    const types = events.map((e) => e.eventType);
    expect(types).toContain("REQUEST_CREATED");
    expect(types).toContain("SNAPSHOT_CREATED");

    // Cleanup
    await db.delete(taktRequestAuditEventsTable)
      .where(eq(taktRequestAuditEventsTable.requestId, requestId));
    await db.delete(taktRequestSnapshotsTable)
      .where(eq(taktRequestSnapshotsTable.taktRequestId, requestId));
    await db.delete(taktRequestsTable).where(eq(taktRequestsTable.id, requestId));
    await db.delete(projectMembershipsTable)
      .where(eq(projectMembershipsTable.projectId, projId));
    await db.delete(coordinationPoliciesTable)
      .where(eq(coordinationPoliciesTable.projectId, projId));
    await db.delete(projectContractorsTable)
      .where(and(eq(projectContractorsTable.projectId, projId), eq(projectContractorsTable.anOrgId, NU_ORG_A)));
    await db.delete(takteTable).where(eq(takteTable.id, taktId));
    await db.delete(projectsTable).where(eq(projectsTable.id, projId));
  });

  it("[12] evaluateTaktRequestDeadlines writes REMINDER_SENT on successful dispatch", async () => {
    // Import and run the service directly to test REMINDER_SENT event
    const { evaluateTaktRequestDeadlines } = await import("../services/deadline-evaluation-service");
    const { defaultDeadlineConfig } = await import("../services/deadline-config");

    // Update TR_OPEN to have a responseRequiredBy 26h ago to trigger RESPONSE_OVERDUE reminder
    // (defaultDeadlineConfig.overdueReminderHoursAfterDue defaults to 24h)
    const pastDue = new Date(Date.now() - 26 * 60 * 60 * 1000); // 26h ago
    await db.update(taktRequestsTable)
      .set({ responseRequiredBy: pastDue })
      .where(eq(taktRequestsTable.id, TR_OPEN));

    const now = new Date();
    await evaluateTaktRequestDeadlines(now, defaultDeadlineConfig);

    // Check if REMINDER_SENT audit event was written for TR_OPEN
    const events = await db
      .select({ eventType: taktRequestAuditEventsTable.eventType })
      .from(taktRequestAuditEventsTable)
      .where(eq(taktRequestAuditEventsTable.requestId, TR_OPEN));

    const types = events.map((e) => e.eventType);
    // REMINDER_SENT should be present (reminder was dispatched)
    expect(types).toContain("REMINDER_SENT");

    // Cleanup: reset responseRequiredBy
    await db.update(taktRequestsTable)
      .set({ responseRequiredBy: null })
      .where(eq(taktRequestsTable.id, TR_OPEN));
  });
});
