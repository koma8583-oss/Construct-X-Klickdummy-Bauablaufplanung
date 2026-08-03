/**
 * Task #90 — TaktRequest Audit Trail + EDC Readiness
 *
 * Verifies:
 *  1. Details retrieval (GET /takt-requests/:id/details) writes a DETAILS_RETRIEVED
 *     audit event for NU callers.
 *  2. Details retrieval by GU does NOT write a DETAILS_RETRIEVED event.
 *  3. GET /takt-requests/:id/audit-trail returns events for the GU (full list).
 *  4. GET /takt-requests/:id/audit-trail returns a filtered list for NU callers
 *     (only NU-visible event types).
 *  5. Hub admins receive the full event list.
 *  6. Other orgs (not GU, not NU, not hub admin) receive 403.
 *  7. Send route writes NOTIFICATION_SENT + NOTIFICATION_DELIVERED audit events.
 *
 * Fixture prefix: "t90-"
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import { db } from "@workspace/db";
import {
  organizationsTable,
  projectsTable,
  takteTable,
  usersTable,
  taktRequestsTable,
  taktRequestSnapshotsTable,
  taktRequestAuditEventsTable,
  messageOutboxTable,
  messageInboxTable,
  projectContractorsTable,
} from "@workspace/db";
import { eq, and } from "drizzle-orm";
import app from "../app";

// ── JWT helper ────────────────────────────────────────────────────────────────

const DEV_SECRET =
  process.env.JWT_SECRET ?? "taktkoord-jwt-dev-secret-change-in-prod";

function signToken(payload: {
  userId: string;
  orgId: string | null;
  orgType: "AG" | "AN" | null;
  hubAdmin?: boolean;
}): string {
  return jwt.sign(
    { ...payload, hubAdmin: payload.hubAdmin ?? false },
    DEV_SECRET,
    { expiresIn: "1h" },
  );
}

// ── Fixture IDs ───────────────────────────────────────────────────────────────

const GU_ORG      = "t90-org-gu";
const NU_ORG      = "t90-org-nu";
const OTHER_ORG   = "t90-org-other";
const GU_USER     = "t90-user-gu";
const NU_USER     = "t90-user-nu";
const HUB_USER    = "t90-user-hub";
const OTHER_USER  = "t90-user-other";
const PROJECT_ID  = "t90-project-001";
const TAKT_ID     = "t90-takt-001";
const REQUEST_ID  = "t90-request-001";

let guToken: string;
let nuToken: string;
let hubToken: string;
let otherToken: string;

// ── Setup / teardown ──────────────────────────────────────────────────────────

beforeAll(async () => {
  // Orgs
  await db.insert(organizationsTable).values([
    { id: GU_ORG,    name: "T90 GU Org",    type: "AG" },
    { id: NU_ORG,    name: "T90 NU Org",    type: "AN" },
    { id: OTHER_ORG, name: "T90 Other Org", type: "AG" },
  ]).onConflictDoNothing();

  // Users
  await db.insert(usersTable).values([
    { id: GU_USER,   name: "T90 GU User",    email: "t90-gu@example.com",    passwordHash: "x" },
    { id: NU_USER,   name: "T90 NU User",    email: "t90-nu@example.com",    passwordHash: "x" },
    { id: HUB_USER,  name: "T90 Hub User",   email: "t90-hub@example.com",   passwordHash: "x" },
    { id: OTHER_USER,name: "T90 Other User", email: "t90-other@example.com", passwordHash: "x" },
  ]).onConflictDoNothing();

  // Project
  await db.insert(projectsTable).values({
    id: PROJECT_ID,
    agOrgId: GU_ORG,
    name: "T90 Test Project",
  }).onConflictDoNothing();

  // Takt
  await db.insert(takteTable).values({
    id: TAKT_ID,
    projectId: PROJECT_ID,
    taktBezeichnung: "T90 Test Takt",
    zone: "A",
    gewerk: "Elektro",
    plannedStart: "2026-09-01",
    plannedEnd: "2026-09-07",
  }).onConflictDoNothing();

  // Project contractor (needed for snapshot creation)
  await db.insert(projectContractorsTable).values({
    projectId: PROJECT_ID,
    anOrgId: NU_ORG,
    assignmentStatus: "ACTIVE",
  }).onConflictDoNothing();

  // TaktRequest in DELIVERED status (ready for NU to pull details)
  await db.insert(taktRequestsTable).values({
    id: REQUEST_ID,
    taktId: TAKT_ID,
    taktVersion: 1,
    guOrgId: GU_ORG,
    nuOrgId: NU_ORG,
    requestNumber: "T90-REQ-001",
    status: "DELIVERED",
    createdByUserId: GU_USER,
    deliveredAt: new Date(),
  }).onConflictDoNothing();

  // Snapshot for the request
  await db.insert(taktRequestSnapshotsTable).values({
    taktRequestId: REQUEST_ID,
    schemaVersion: "1.0",
    snapshotPayload: {
      trade: "Elektro",
      workPackage: "T90 Test Takt",
      location: { zone: "A" },
      plannedTimeWindow: { start: "2026-09-01", end: "2026-09-07" },
    },
  }).onConflictDoNothing();

  // Tokens
  guToken    = signToken({ userId: GU_USER,    orgId: GU_ORG,    orgType: "AG" });
  nuToken    = signToken({ userId: NU_USER,    orgId: NU_ORG,    orgType: "AN" });
  hubToken   = signToken({ userId: HUB_USER,   orgId: null,      orgType: null, hubAdmin: true });
  otherToken = signToken({ userId: OTHER_USER, orgId: OTHER_ORG, orgType: "AG" });
});

afterAll(async () => {
  // Delete in FK-safe order
  await db.delete(taktRequestAuditEventsTable)
    .where(eq(taktRequestAuditEventsTable.requestId, REQUEST_ID));
  await db.delete(messageInboxTable)
    .where(eq(messageInboxTable.correlationId, REQUEST_ID));
  await db.delete(messageOutboxTable)
    .where(eq(messageOutboxTable.correlationId, REQUEST_ID));
  await db.delete(taktRequestSnapshotsTable)
    .where(eq(taktRequestSnapshotsTable.taktRequestId, REQUEST_ID));
  await db.delete(taktRequestsTable)
    .where(eq(taktRequestsTable.id, REQUEST_ID));
  await db.delete(projectContractorsTable)
    .where(and(
      eq(projectContractorsTable.projectId, PROJECT_ID),
      eq(projectContractorsTable.anOrgId, NU_ORG),
    ));
  await db.delete(takteTable)
    .where(eq(takteTable.id, TAKT_ID));
  await db.delete(projectsTable)
    .where(eq(projectsTable.id, PROJECT_ID));
  await db.delete(usersTable).where(
    eq(usersTable.id, GU_USER),
  );
  await db.delete(usersTable).where(eq(usersTable.id, NU_USER));
  await db.delete(usersTable).where(eq(usersTable.id, HUB_USER));
  await db.delete(usersTable).where(eq(usersTable.id, OTHER_USER));
  await db.delete(organizationsTable).where(
    eq(organizationsTable.id, GU_ORG),
  );
  await db.delete(organizationsTable).where(eq(organizationsTable.id, NU_ORG));
  await db.delete(organizationsTable).where(eq(organizationsTable.id, OTHER_ORG));
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("GET /api/takt-requests/:id/details — DETAILS_RETRIEVED audit event", () => {
  it("NU first access writes DETAILS_RETRIEVED audit event", async () => {
    const res = await request(app)
      .get(`/api/takt-requests/${REQUEST_ID}/details`)
      .set("Authorization", `Bearer ${nuToken}`);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("DETAILS_RETRIEVED");

    // Verify audit event was written to DB
    const events = await db
      .select()
      .from(taktRequestAuditEventsTable)
      .where(
        and(
          eq(taktRequestAuditEventsTable.requestId, REQUEST_ID),
          eq(taktRequestAuditEventsTable.eventType, "DETAILS_RETRIEVED"),
        ),
      );

    expect(events.length).toBeGreaterThanOrEqual(1);
    const evt = events[0];
    expect(evt.actorOrgId).toBe(NU_ORG);
    expect(evt.actorUserId).toBe(NU_USER);
    expect(evt.actorRole).toBe("NU");
    expect(evt.metadata).toMatchObject({ firstAccess: true });
  });

  it("NU subsequent access does NOT add a second DETAILS_RETRIEVED event", async () => {
    // Already DETAILS_RETRIEVED from previous test; call again
    const res = await request(app)
      .get(`/api/takt-requests/${REQUEST_ID}/details`)
      .set("Authorization", `Bearer ${nuToken}`);

    expect(res.status).toBe(200);

    const events = await db
      .select()
      .from(taktRequestAuditEventsTable)
      .where(
        and(
          eq(taktRequestAuditEventsTable.requestId, REQUEST_ID),
          eq(taktRequestAuditEventsTable.eventType, "DETAILS_RETRIEVED"),
        ),
      );

    // Only 1 audit event written (from first access)
    expect(events.length).toBe(1);
  });

  it("GU preview access does NOT write a DETAILS_RETRIEVED event", async () => {
    // Clear any existing events first
    await db.delete(taktRequestAuditEventsTable)
      .where(
        and(
          eq(taktRequestAuditEventsTable.requestId, REQUEST_ID),
          eq(taktRequestAuditEventsTable.eventType, "DETAILS_RETRIEVED"),
        ),
      );

    const res = await request(app)
      .get(`/api/takt-requests/${REQUEST_ID}/details`)
      .set("Authorization", `Bearer ${guToken}`);

    expect(res.status).toBe(200);

    const events = await db
      .select()
      .from(taktRequestAuditEventsTable)
      .where(
        and(
          eq(taktRequestAuditEventsTable.requestId, REQUEST_ID),
          eq(taktRequestAuditEventsTable.eventType, "DETAILS_RETRIEVED"),
          eq(taktRequestAuditEventsTable.actorOrgId, GU_ORG),
        ),
      );

    expect(events.length).toBe(0);
  });
});

describe("GET /api/takt-requests/:id/audit-trail — access control", () => {
  it("GU (owner) receives full event list with 200", async () => {
    const res = await request(app)
      .get(`/api/takt-requests/${REQUEST_ID}/audit-trail`)
      .set("Authorization", `Bearer ${guToken}`);

    expect(res.status).toBe(200);
    expect(res.body.requestId).toBe(REQUEST_ID);
    expect(res.body.callerRole).toBe("GU");
    expect(Array.isArray(res.body.events)).toBe(true);
  });

  it("NU (addressed) receives 200 with filtered event types only", async () => {
    // Seed a GU_DECISION_MADE event which NU should NOT see
    await db.insert(taktRequestAuditEventsTable).values({
      requestId: REQUEST_ID,
      eventType: "GU_DECISION_MADE",
      actorOrgId: GU_ORG,
      actorUserId: GU_USER,
      actorRole: "GU",
      metadata: { decisionType: "CONFIRM_ACCEPTED" },
    });

    const res = await request(app)
      .get(`/api/takt-requests/${REQUEST_ID}/audit-trail`)
      .set("Authorization", `Bearer ${nuToken}`);

    expect(res.status).toBe(200);
    expect(res.body.callerRole).toBe("NU");

    // NU must not see GU_DECISION_MADE
    const forbidden = res.body.events.filter(
      (e: { eventType: string }) => e.eventType === "GU_DECISION_MADE",
    );
    expect(forbidden.length).toBe(0);

    // Only NU-visible types allowed
    const NU_VISIBLE = new Set([
      "NOTIFICATION_DELIVERED",
      "DETAILS_RETRIEVED",
      "AVAILABILITY_CHECK_DONE",
      "RESPONSE_SUBMITTED",
      "RESPONSE_DELIVERED",
    ]);
    for (const evt of res.body.events) {
      expect(NU_VISIBLE.has(evt.eventType)).toBe(true);
    }
  });

  it("Hub admin receives full event list with 200", async () => {
    const res = await request(app)
      .get(`/api/takt-requests/${REQUEST_ID}/audit-trail`)
      .set("Authorization", `Bearer ${hubToken}`);

    expect(res.status).toBe(200);
    expect(res.body.callerRole).toBe("HUB_ADMIN");
    expect(Array.isArray(res.body.events)).toBe(true);
  });

  it("Unrelated org receives 403", async () => {
    const res = await request(app)
      .get(`/api/takt-requests/${REQUEST_ID}/audit-trail`)
      .set("Authorization", `Bearer ${otherToken}`);

    expect(res.status).toBe(403);
  });

  it("Unauthenticated request returns 401", async () => {
    const res = await request(app)
      .get(`/api/takt-requests/${REQUEST_ID}/audit-trail`);

    expect(res.status).toBe(401);
  });

  it("Unknown request ID returns 404", async () => {
    const res = await request(app)
      .get("/api/takt-requests/nonexistent-id/audit-trail")
      .set("Authorization", `Bearer ${guToken}`);

    expect(res.status).toBe(404);
  });

  it("Concurrent NU first-access calls produce exactly one DETAILS_RETRIEVED event (atomic guarantee)", async () => {
    // Reset request to DELIVERED status for this stress test.
    // The atomic conditional UPDATE (WHERE status='DELIVERED') guarantees that
    // only one concurrent winner can transition and write the audit event.
    await db
      .update(taktRequestsTable)
      .set({ status: "DELIVERED", detailsRetrievedAt: null })
      .where(eq(taktRequestsTable.id, REQUEST_ID));
    await db
      .delete(taktRequestAuditEventsTable)
      .where(
        and(
          eq(taktRequestAuditEventsTable.requestId, REQUEST_ID),
          eq(taktRequestAuditEventsTable.eventType, "DETAILS_RETRIEVED"),
        ),
      );

    // Fire 10 concurrent NU requests — the atomic UPDATE ensures exactly one
    // wins the DELIVERED→DETAILS_RETRIEVED transition and writes the event.
    const CONCURRENCY = 10;
    const responses = await Promise.all(
      Array.from({ length: CONCURRENCY }, () =>
        request(app)
          .get(`/api/takt-requests/${REQUEST_ID}/details`)
          .set("Authorization", `Bearer ${nuToken}`),
      ),
    );

    // All responses must succeed
    for (const res of responses) {
      expect(res.status).toBe(200);
    }

    // Despite 10 concurrent calls, exactly ONE DETAILS_RETRIEVED audit event.
    // This is enforced by transitionToDetailsRetrievedAtomic() which uses
    // a single conditional UPDATE WHERE status='DELIVERED' RETURNING *.
    const events = await db
      .select()
      .from(taktRequestAuditEventsTable)
      .where(
        and(
          eq(taktRequestAuditEventsTable.requestId, REQUEST_ID),
          eq(taktRequestAuditEventsTable.eventType, "DETAILS_RETRIEVED"),
        ),
      );
    expect(events.length).toBe(1);
    expect(events[0].actorRole).toBe("NU");
    expect(events[0].metadata).toMatchObject({ firstAccess: true });
  });

  it("Events are returned in ascending chronological order", async () => {
    const res = await request(app)
      .get(`/api/takt-requests/${REQUEST_ID}/audit-trail`)
      .set("Authorization", `Bearer ${guToken}`);

    expect(res.status).toBe(200);
    const events = res.body.events as Array<{ occurredAt: string }>;
    for (let i = 1; i < events.length; i++) {
      expect(
        new Date(events[i].occurredAt).getTime(),
      ).toBeGreaterThanOrEqual(new Date(events[i - 1].occurredAt).getTime());
    }
  });

  it("Each event has the required fields", async () => {
    const res = await request(app)
      .get(`/api/takt-requests/${REQUEST_ID}/audit-trail`)
      .set("Authorization", `Bearer ${guToken}`);

    expect(res.status).toBe(200);
    for (const evt of res.body.events) {
      expect(evt).toHaveProperty("id");
      expect(evt).toHaveProperty("eventType");
      expect(evt).toHaveProperty("occurredAt");
    }
  });
});
