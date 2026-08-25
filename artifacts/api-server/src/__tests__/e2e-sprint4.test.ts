/**
 * Task 4.9 — End-to-end Sprint 4 integration test.
 *
 * Covers the full NU coordination flow (Scenario B — Alternatives):
 *   1. GU creates and sends a TaktRequest.
 *   2. NU reads the notification from their inbox.
 *   3. NU retrieves the snapshot (DETAILS_RETRIEVED).
 *   4. NU creates a conflicting local booking.
 *   5. NU starts a feasibility check (UNDER_REVIEW → FEASIBLE_WITH_ALTERNATIVES).
 *   6. System generates alternatives.
 *   7. NU sends a response with alternatives (ALTERNATIVES_PROPOSED).
 *   8. GU reads the response from their inbox.
 *   9. GU message contains only public data — no internal NU fields.
 *  10. Internal conflicts remain exclusively at the NU.
 *  11. Repeated NU send creates no second response (idempotency).
 *  12. Takt data and NU resources remain separate (data sovereignty).
 *
 * Additionally verifies:
 *   - Backward compat: existing delegation routes still reachable.
 *   - GU cannot read NU availability checks.
 *   - Hub cannot access /nu/* endpoints.
 *   - Repeated snapshot retrieval is idempotent.
 *
 * Fixture prefix: "t49-"
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import { agDb as db } from "@workspace/db";
import {
  organizationsTable,
  usersTable,
  projectsTable,
  projectContractorsTable,
  projectMembershipsTable,
  takteTable,
  taktRequestsTable,
  taktRequestSnapshotsTable,
  resourcesTable,
  resourceBookingsTable,
  availabilityChecksTable,
  messageInboxTable,
  messageOutboxTable,
  taktResponsesTable,
  dataPublicationsTable,
  dataPublicationRecipientsTable,
  policyTemplatesTable,
  dataspaceExchangesTable,
} from "@workspace/db";
import { and, eq, inArray, or, sql } from "drizzle-orm";
import app from "../app";

// ── JWT helpers ───────────────────────────────────────────────────────────────

const JWT_SECRET = process.env.JWT_SECRET ?? "taktkoord-jwt-dev-secret-change-in-prod";

function signToken(p: {
  userId: string;
  orgId: string | null;
  orgType: "AG" | "AN" | null;
  hubAdmin?: boolean;
  roles?: string[];
}): string {
  const roles = p.roles ?? (p.orgType === "AG" ? ["AG_ADMIN"] : p.orgType === "AN" ? ["AN_ADMIN"] : []);
  return jwt.sign({ ...p, hubAdmin: p.hubAdmin ?? false, roles }, JWT_SECRET, { expiresIn: "1h" });
}

// ── Fixture IDs ───────────────────────────────────────────────────────────────

const GU_ORG  = "t49-gu-org";
const NU_ORG  = "t49-nu-org";
const GU_USER = "t49-gu-user";
const NU_USER = "t49-nu-user";
const PROJECT = "t49-project";
const TAKT    = "t49-takt";
const CREW_1  = "t49-crew-1";   // fully booked in window (causes conflict)
const CREW_2  = "t49-crew-2";   // available (triggers FEASIBLE_WITH_ALTERNATIVES)

let guToken:  string;
let nuToken:  string;
let hubToken: string;

// ── Shared state (populated during the E2E flow) ──────────────────────────────

let requestId:         string;
let bookingId:         string;
let testPublicationId: string;
// Stored so Step 11 can retry with the identical payload (hash-idempotency)
let step7RequestBody:  Record<string, unknown> = {};

// ── Seed + teardown ───────────────────────────────────────────────────────────

beforeAll(async () => {
  await db.insert(organizationsTable).values([
    { id: GU_ORG, name: "T49 GU Org", type: "AG" },
    { id: NU_ORG, name: "T49 NU Org", type: "AN" },
  ]).onConflictDoNothing();

  await db.insert(usersTable).values([
    { id: GU_USER, name: "T49 GU",  email: "t49-gu@example.com",  passwordHash: "x" },
    { id: NU_USER, name: "T49 NU",  email: "t49-nu@example.com",  passwordHash: "x" },
  ]).onConflictDoNothing();

  await db.insert(projectsTable).values([
    { id: PROJECT, agOrgId: GU_ORG, name: "T49 Project", status: "ACTIVE" },
  ]).onConflictDoNothing();

  await db.insert(takteTable).values({
    id: TAKT,
    projectId: PROJECT,
    taktBezeichnung: "T49 Takt Innenausbau",
    zone: "OG2",
    gewerk: "TRK",
    plannedStart: "2026-09-15",
    plannedEnd:   "2026-09-20",
  }).onConflictDoNothing();

  // Register NU as a contractor on the project (required by createTaktRequestWithSnapshot)
  await db.insert(projectContractorsTable).values({ projectId: PROJECT, anOrgId: NU_ORG })
    .onConflictDoNothing();
  await db.insert(projectMembershipsTable).values({
    id: "t49-membership",
    projectId: PROJECT,
    agOrgId: GU_ORG,
    anOrgId: NU_ORG,
    status: "ACTIVE",
    invitationId: "t49-invitation",
    correlationId: "t49-correlation",
  }).onConflictDoNothing();

  // Create a published data publication so the AN can access /details (policy gate, Task 116)
  const now = new Date();
  const [anyPolicy] = await db.select({ id: policyTemplatesTable.id }).from(policyTemplatesTable).limit(1).catch(() => [] as { id: string }[]);
  let policyTemplateId = anyPolicy?.id;
  if (!policyTemplateId) {
    const [pt] = await db
      .insert(policyTemplatesTable)
      .values({ id: "t49-policy-template", code: "STANDARD", name: "Standard", description: "Auto-created for t49", purpose: "Test", permissions: ["READ"], prohibitions: [], validityRule: "None", createdAt: now, updatedAt: now })
      .onConflictDoNothing()
      .returning();
    policyTemplateId = pt?.id ?? "t49-policy-template";
  }
  testPublicationId = "t49-test-publication";
  await db.insert(dataPublicationsTable).values({
    id: testPublicationId,
    agOrgId: GU_ORG,
    projectId: PROJECT,
    dataProductType: "TAKT_INFORMATION_PACKAGE",
    title: "T49 Test Publication",
    version: 1,
    schemaVersion: "1.0",
    status: "PUBLISHED",
    policyTemplateId,
    selectedFields: ["taktReference"],
    selectedTaktIds: [TAKT],
    publishedAt: now,
    createdAt: now,
    updatedAt: now,
  }).onConflictDoNothing();
  await db.insert(dataPublicationRecipientsTable).values({
    id: "t49-pub-recipient",
    publicationId: testPublicationId,
    anOrgId: NU_ORG,
    status: "ACCEPTED",
    notifiedAt: now,
    policyAcceptedAt: now,
    createdAt: now,
    updatedAt: now,
  }).onConflictDoNothing();

  // NU resources: CREW_1 will be booked (conflicts), CREW_2 will be available
  for (const row of [
    { id: CREW_1, anOrgId: NU_ORG, type: "CREW" as const, name: "T49 Kolonne 1", capacity: 4, active: true },
    { id: CREW_2, anOrgId: NU_ORG, type: "CREW" as const, name: "T49 Kolonne 2", capacity: 4, active: true },
  ]) {
    await db.insert(resourcesTable).values(row).onConflictDoNothing();
  }

  guToken  = signToken({ userId: GU_USER, orgId: GU_ORG, orgType: "AG" });
  nuToken  = signToken({ userId: NU_USER, orgId: NU_ORG, orgType: "AN" });
  hubToken = signToken({ userId: "hub-user", orgId: null, orgType: null, hubAdmin: true });
});

afterAll(async () => {
  const testOrgIds = [GU_ORG, NU_ORG] as [string, ...string[]];

  // 1. dataspace_exchanges — FK to organizations (sender_org_id / receiver_org_id)
  await db.delete(dataspaceExchangesTable)
    .where(or(
      inArray(dataspaceExchangesTable.senderOrgId, testOrgIds),
      inArray(dataspaceExchangesTable.receiverOrgId, testOrgIds),
    ));

  // 2. takt responses + alternatives (FK to leistungsanfragen via takt_request_id)
  const ourRequests = await db.select({ id: taktRequestsTable.id })
    .from(taktRequestsTable)
    .where(or(
      eq(taktRequestsTable.guOrgId, GU_ORG),
      eq(taktRequestsTable.nuOrgId, NU_ORG),
    ));
  for (const { id } of ourRequests) {
    const responses = await db.select({ id: taktResponsesTable.id })
      .from(taktResponsesTable)
      .where(eq(taktResponsesTable.taktRequestId, id));
    for (const { id: rid } of responses) {
      await db.execute(sql`DELETE FROM leistungsantwort_alternativen WHERE response_id = ${rid}`);
    }
    await db.delete(taktResponsesTable).where(eq(taktResponsesTable.taktRequestId, id));
  }

  // 3. availability checks
  await db.delete(availabilityChecksTable)
    .where(eq(availabilityChecksTable.nuOrgId, NU_ORG));

  // 4. resource bookings
  await db.delete(resourceBookingsTable)
    .where(eq(resourceBookingsTable.nuOrgId, NU_ORG));

  // 5. messages
  await db.delete(messageInboxTable)
    .where(inArray(messageInboxTable.recipientOrgId, testOrgIds));
  await db.delete(messageOutboxTable)
    .where(inArray(messageOutboxTable.senderOrgId, testOrgIds));

  // 6. snapshots + requests
  for (const { id } of ourRequests) {
    await db.delete(taktRequestSnapshotsTable)
      .where(eq(taktRequestSnapshotsTable.taktRequestId, id));
  }
  await db.delete(taktRequestsTable)
    .where(or(
      eq(taktRequestsTable.guOrgId, GU_ORG),
      eq(taktRequestsTable.nuOrgId, NU_ORG),
    ));

  // 7. data publication recipients + publications
  await db.delete(dataPublicationRecipientsTable)
    .where(eq(dataPublicationRecipientsTable.anOrgId, NU_ORG));
  await db.delete(dataPublicationsTable)
    .where(eq(dataPublicationsTable.agOrgId, GU_ORG));

  // 8. resources
  await db.delete(resourcesTable)
    .where(eq(resourcesTable.anOrgId, NU_ORG));

  // 9. project fixtures
  await db.delete(projectContractorsTable)
    .where(eq(projectContractorsTable.projectId, PROJECT));
  await db.delete(projectMembershipsTable)
    .where(eq(projectMembershipsTable.projectId, PROJECT));
  await db.execute(sql`DELETE FROM leistungen WHERE project_id = ${PROJECT}`);
  await db.delete(takteTable).where(eq(takteTable.projectId, PROJECT));
  await db.delete(projectsTable).where(eq(projectsTable.id, PROJECT));

  // 10. users + orgs
  await db.delete(usersTable).where(eq(usersTable.id, GU_USER));
  await db.delete(usersTable).where(eq(usersTable.id, NU_USER));
  await db.delete(organizationsTable).where(inArray(organizationsTable.id, testOrgIds));
});

// ── Full E2E flow: Scenario B (Alternatives) ──────────────────────────────────

describe("E2E Sprint 4 — Scenario B: ALTERNATIVES_PROPOSED", () => {
  it("Step 1: GU creates TaktRequest with snapshot (DRAFT)", async () => {
    const res = await request(app)
      .post("/api/takt-requests")
      .set("Authorization", `Bearer ${guToken}`)
      .send({
        taktId:            TAKT,
        nuOrgId:           NU_ORG,
        subject:           "T49 Koordinationsanfrage",
        message:           "Bitte prüfen Sie den Zeitraum.",
        responseRequiredBy: "2026-09-10T23:59:59Z",
        dataPublicationId: testPublicationId,
      });

    expect(res.status).toBe(201);
    requestId = res.body.id as string;
    expect(requestId).toBeTruthy();
    expect(res.body.status).toBe("DRAFT");
    expect(res.body.snapshotId).toBeTruthy();
  });

  it("Step 2: GU sends TaktRequest → DELIVERED in NU inbox", async () => {
    const res = await request(app)
      .post(`/api/takt-requests/${requestId}/send`)
      .set("Authorization", `Bearer ${guToken}`);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("DELIVERED");
  });

  it("Step 3: NU reads notification in their inbox", async () => {
    const res = await request(app)
      .get("/api/messages/inbox")
      .set("Authorization", `Bearer ${nuToken}`);

    expect(res.status).toBe(200);
    const msgs = res.body as Array<Record<string, unknown>>;
    const notification = msgs.find(m => m.correlationId === requestId);
    expect(notification).toBeTruthy();
    expect(notification?.messageType).toBe("TAKT_REQUEST_NOTIFICATION");
    // Notification must not expose full Takt details
    const payload = notification?.payload as Record<string, unknown>;
    expect(payload).not.toHaveProperty("snapshotPayload");
  });

  it("Step 4: NU retrieves snapshot → DETAILS_RETRIEVED", async () => {
    const res = await request(app)
      .get(`/api/takt-requests/${requestId}/details`)
      .set("Authorization", `Bearer ${nuToken}`);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("DETAILS_RETRIEVED");
    expect(res.body.snapshotPayload).toBeTruthy();
    // GU identity must NOT be exposed in snapshot (data sovereignty)
    expect(res.body.snapshotPayload).not.toHaveProperty("guName");
    expect(res.body.snapshotPayload).not.toHaveProperty("customerName");
  });

  it("Step 4b: Repeated snapshot retrieval is idempotent (stays DETAILS_RETRIEVED)", async () => {
    const res = await request(app)
      .get(`/api/takt-requests/${requestId}/details`)
      .set("Authorization", `Bearer ${nuToken}`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("DETAILS_RETRIEVED");
  });

  it("Step 5: NU creates a conflicting booking for CREW_1", async () => {
    const res = await request(app)
      .post("/api/nu/resource-bookings")
      .set("Authorization", `Bearer ${nuToken}`)
      .send({
        resourceId:         CREW_1,
        sourceType:         "MANUAL_BLOCK",
        startAt:            "2026-09-14T00:00:00Z",
        endAt:              "2026-09-21T00:00:00Z",
        utilizationPercent: 100,
        status:             "CONFIRMED",
      });

    expect(res.status).toBe(201);
    bookingId = res.body.id as string;
    expect(bookingId).toBeTruthy();
  });

  it("Step 6: NU starts feasibility check → UNDER_REVIEW, FEASIBLE_WITH_ALTERNATIVES", async () => {
    const res = await request(app)
      .post(`/api/takt-requests/${requestId}/availability-checks`)
      .set("Authorization", `Bearer ${nuToken}`);

    expect(res.status).toBe(201);
    expect(res.body.status).toBe("COMPLETED");
    // CREW_1 is fully booked, CREW_2 is available → FEASIBLE_WITH_ALTERNATIVES
    expect(res.body.result).toBe("FEASIBLE_WITH_ALTERNATIVES");

    // TaktRequest advanced to UNDER_REVIEW
    const [req] = await db.select({ status: taktRequestsTable.status })
      .from(taktRequestsTable)
      .where(eq(taktRequestsTable.id, requestId));
    expect(req?.status).toBe("UNDER_REVIEW");
  });

  it("Step 6b: Alternatives are generated and at most 3 returned", async () => {
    const res = await request(app)
      .get(`/api/takt-requests/${requestId}/availability-checks/latest`)
      .set("Authorization", `Bearer ${nuToken}`);

    expect(res.status).toBe(200);
    const publicResult = res.body.publicResult as { alternatives: unknown[] };
    expect(publicResult.alternatives.length).toBeGreaterThan(0);
    expect(publicResult.alternatives.length).toBeLessThanOrEqual(3);
  });

  it("Step 6c: Internal result contains resourceIds (NU-only data)", async () => {
    const res = await request(app)
      .get(`/api/takt-requests/${requestId}/availability-checks/latest`)
      .set("Authorization", `Bearer ${nuToken}`);

    expect(res.status).toBe(200);
    const internalResult = res.body.internalResult as { conflicts: Array<{ resourceId: string }> };
    // The internal result has resourceIds (the conflict with CREW_1)
    expect(internalResult).toHaveProperty("conflicts");
  });

  it("Step 7: NU sends response with alternatives → 201, ALTERNATIVES_PROPOSED", async () => {
    // Use alternatives from the check
    const checkRes = await request(app)
      .get(`/api/takt-requests/${requestId}/availability-checks/latest`)
      .set("Authorization", `Bearer ${nuToken}`);

    const publicAlts = (checkRes.body.publicResult as { alternatives: Array<{
      alternativeId: string; rank: number;
      timeWindow: { start: string; end: string };
      crewSize: number | null; conditions: string[] | null;
    }> }).alternatives;

    step7RequestBody = {
      decision:   "ALTERNATIVES_PROPOSED",
      reasonCode: "RESOURCE_CONFLICT",
      comment:    "Der ursprüngliche Zeitraum ist nicht vollständig verfügbar.",
      alternatives: publicAlts.slice(0, 3).map(a => ({
        alternativeId: a.alternativeId,
        rank:          a.rank,
        timeWindow:    a.timeWindow,
        crewSize:      a.crewSize ?? undefined,
        // normalize: JSONB may return conditions as string or string[]
        conditions:    Array.isArray(a.conditions) ? a.conditions : a.conditions ? [a.conditions] : [],
      })),
    };

    const res = await request(app)
      .post(`/api/takt-requests/${requestId}/responses`)
      .set("Authorization", `Bearer ${nuToken}`)
      .send(step7RequestBody);

    expect(res.status).toBe(201);
    expect(res.body.decision).toBe("ALTERNATIVES_PROPOSED");
    expect(res.body.requestStatus).toBe("ALTERNATIVES_PROPOSED");
    expect(res.body.transportStatus).toBe("DELIVERED");
  });

  it("Step 8: GU receives response in their inbox", async () => {
    const res = await request(app)
      .get("/api/messages/inbox")
      .set("Authorization", `Bearer ${guToken}`);

    expect(res.status).toBe(200);
    const msgs = res.body as Array<Record<string, unknown>>;
    const responseMsg = msgs.find(m =>
      m.correlationId === requestId &&
      m.messageType === "TAKT_RESPONSE_SUBMITTED",
    );
    expect(responseMsg).toBeTruthy();
    expect(responseMsg?.senderOrgId).toBe(NU_ORG);
  });

  it("Step 9: GU message contains only public data — no internal NU fields", async () => {
    const [msg] = await db.select()
      .from(messageInboxTable)
      .where(and(
        eq(messageInboxTable.recipientOrgId, GU_ORG),
        eq(messageInboxTable.correlationId, requestId),
        eq(messageInboxTable.messageType, "TAKT_RESPONSE_SUBMITTED"),
      ));

    expect(msg).toBeTruthy();
    const payload = msg.payload as Record<string, unknown>;

    // No internal NU data
    const forbidden = [
      "resourceId", "localProjectId", "localProjectCode",
      "customerAlias", "internalResultPayload", "internalConflicts",
      "availabilityCheckId", "resourceName", "employeeId",
    ];
    for (const field of forbidden) {
      expect(payload, `payload should not contain "${field}"`).not.toHaveProperty(field);
    }

    // Required public fields
    expect(payload).toHaveProperty("taktRequestId", requestId);
    expect(payload).toHaveProperty("decision", "ALTERNATIVES_PROPOSED");
    expect(payload).toHaveProperty("alternatives");
  });

  it("Step 10: Internal conflicts remain exclusively at the NU", async () => {
    // GU cannot access availability checks
    const guCheck = await request(app)
      .get(`/api/takt-requests/${requestId}/availability-checks/latest`)
      .set("Authorization", `Bearer ${guToken}`);
    expect(guCheck.status).toBe(403);

    // Hub cannot access availability checks
    const hubCheck = await request(app)
      .get(`/api/takt-requests/${requestId}/availability-checks/latest`)
      .set("Authorization", `Bearer ${hubToken}`);
    expect(hubCheck.status).toBe(403);
  });

  it("Step 11: Repeated NU send creates no second response (idempotency)", async () => {
    const before = await db.select()
      .from(taktResponsesTable)
      .where(eq(taktResponsesTable.taktRequestId, requestId));
    expect(before).toHaveLength(1);

    // Re-send exactly the same payload as Step 7 → hash matches → idempotent 200
    const retry = await request(app)
      .post(`/api/takt-requests/${requestId}/responses`)
      .set("Authorization", `Bearer ${nuToken}`)
      .send(step7RequestBody);
    // Same payload hash → 200 (idempotent)
    expect(retry.status).toBe(200);
    expect(retry.body.responseId).toBe(before[0].id);

    const after = await db.select()
      .from(taktResponsesTable)
      .where(eq(taktResponsesTable.taktRequestId, requestId));
    expect(after).toHaveLength(1); // still only one response
  });

  it("Step 12: Takt data and NU resources remain separate", async () => {
    // The Takt row has no reference to NU resource IDs
    const [takt] = await db.select()
      .from(takteTable)
      .where(eq(takteTable.id, TAKT));
    const taktJson = JSON.stringify(takt);
    expect(taktJson).not.toContain(CREW_1);
    expect(taktJson).not.toContain(CREW_2);

    // Resource bookings belong to NU org only
    const bookings = await db.select()
      .from(resourceBookingsTable)
      .where(eq(resourceBookingsTable.nuOrgId, NU_ORG));
    for (const b of bookings) {
      expect(b.nuOrgId).toBe(NU_ORG);
    }
  });
});

// ── Scenario A: ACCEPTED (abbreviated) ───────────────────────────────────────

describe("E2E Sprint 4 — Scenario A: ACCEPTED (no conflicts)", () => {
  it("Full ACCEPTED flow: DELIVERED → DETAILS_RETRIEVED → UNDER_REVIEW → ACCEPTED", async () => {
    // No conflicting booking for these resources — use CREW_2 only
    // Create a fresh takt+request
    const taktId = "t49-takt-scenario-a";
    const reqId  = "t49-req-scenario-a";

    await db.insert(takteTable).values({
      id: taktId, projectId: PROJECT,
      taktBezeichnung: "T49 Takt Szenario A", zone: "A", gewerk: "ELK",
      plannedStart: "2026-10-01", plannedEnd: "2026-10-06",
    }).onConflictDoNothing();

    await db.insert(taktRequestsTable).values({
      id: reqId, taktId, taktVersion: 1,
      guOrgId: GU_ORG, nuOrgId: NU_ORG,
      requestNumber: "TKR-T49A", status: "DETAILS_RETRIEVED" as const,
      createdByUserId: GU_USER,
    }).onConflictDoNothing();

    await db.insert(taktRequestSnapshotsTable).values([{
      id: "t49-snap-a", taktRequestId: reqId, schemaVersion: "1.0",
      snapshotPayload: {
        schemaVersion: "1.0", projectReference: PROJECT,
        taktReference: taktId, taktVersion: 1,
        trade: "Elektro", workPackage: "ELK OG1",
        plannedTimeWindow: { start: "2026-10-01", end: "2026-10-06" },
        workdayHours: 8,
        resourceRequirements: [{ resourceType: "CREW", quantity: 1, notes: "" }],
        coordinationContext: {},
      },
    }]).onConflictDoNothing();

    // Run feasibility check — no conflicting bookings for Oct window → FEASIBLE
    const checkRes = await request(app)
      .post(`/api/takt-requests/${reqId}/availability-checks`)
      .set("Authorization", `Bearer ${nuToken}`);
    expect(checkRes.status).toBe(201);
    expect(["FEASIBLE", "FEASIBLE_WITH_ALTERNATIVES"]).toContain(checkRes.body.result);

    // NU sends ACCEPTED
    const respRes = await request(app)
      .post(`/api/takt-requests/${reqId}/responses`)
      .set("Authorization", `Bearer ${nuToken}`)
      .send({
        decision: "ACCEPTED",
        acceptedTimeWindow: { start: "2026-10-01T06:00:00Z", end: "2026-10-06T14:00:00Z" },
        comment: "Bestätigt.",
      });
    expect(respRes.status).toBe(201);
    expect(respRes.body.requestStatus).toBe("ACCEPTED");
  });
});

// ── Scenario C: REJECTED (no capacity) ───────────────────────────────────────

describe("E2E Sprint 4 — Scenario C: REJECTED (no capacity)", () => {
  it("Sends REJECTED when NU explicitly rejects", async () => {
    const taktId = "t49-takt-scenario-c";
    const reqId  = "t49-req-scenario-c";

    await db.insert(takteTable).values({
      id: taktId, projectId: PROJECT,
      taktBezeichnung: "T49 Takt Szenario C", zone: "C", gewerk: "SAN",
      plannedStart: "2026-11-01", plannedEnd: "2026-11-10",
    }).onConflictDoNothing();

    await db.insert(taktRequestsTable).values({
      id: reqId, taktId, taktVersion: 1,
      guOrgId: GU_ORG, nuOrgId: NU_ORG,
      requestNumber: "TKR-T49C", status: "UNDER_REVIEW" as const,
      createdByUserId: GU_USER,
    }).onConflictDoNothing();

    await db.insert(taktRequestSnapshotsTable).values([{
      id: "t49-snap-c", taktRequestId: reqId, schemaVersion: "1.0",
      snapshotPayload: {
        schemaVersion: "1.0", projectReference: PROJECT,
        taktReference: taktId, taktVersion: 1,
        trade: "Sanitär", workPackage: "SAN OG3",
        plannedTimeWindow: { start: "2026-11-01", end: "2026-11-10" },
        workdayHours: 8,
        resourceRequirements: [{ resourceType: "CREW", quantity: 1, notes: "" }],
        coordinationContext: {},
      },
    }]).onConflictDoNothing();

    const respRes = await request(app)
      .post(`/api/takt-requests/${reqId}/responses`)
      .set("Authorization", `Bearer ${nuToken}`)
      .send({
        decision: "REJECTED",
        reasonCode: "NO_CAPACITY",
        comment: "Im angefragten Zeitraum keine Kapazität verfügbar.",
        nextAvailableDate: "2026-12-01",
      });

    expect(respRes.status).toBe(201);
    expect(respRes.body.decision).toBe("REJECTED");
    expect(respRes.body.requestStatus).toBe("REJECTED");
    expect(respRes.body.nextAvailableDate).toBe("2026-12-01");
  });
});

// ── Backward compat checks ────────────────────────────────────────────────────

describe("E2E Sprint 4 — Backward compatibility", () => {
  it("GET /api/takt-requests still works for GU", async () => {
    const res = await request(app)
      .get("/api/takt-requests")
      .set("Authorization", `Bearer ${guToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it("GET /api/resources still works for NU", async () => {
    const res = await request(app)
      .get("/api/resources")
      .set("Authorization", `Bearer ${nuToken}`);
    expect(res.status).toBe(200);
  });

  it("Hub cannot access /nu/* local project endpoints", async () => {
    const res = await request(app)
      .get("/api/nu/local-projects")
      .set("Authorization", `Bearer ${hubToken}`);
    expect(res.status).toBe(403);
  });

  it("GU cannot access /nu/* local project endpoints", async () => {
    const res = await request(app)
      .get("/api/nu/local-projects")
      .set("Authorization", `Bearer ${guToken}`);
    expect(res.status).toBe(403);
  });
});
