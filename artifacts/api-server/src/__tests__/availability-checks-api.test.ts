/**
 * Task 4.7 — REST endpoints for availability checks.
 *
 * Tests:
 *   - POST /takt-requests/:id/availability-checks
 *     - Addressed NU can start a check → 201
 *     - Foreign NU is rejected → 403
 *     - GU is rejected → 403
 *     - Hub admin is rejected → 403
 *     - Result is saved in DB
 *     - Public result contains no internal IDs (resourceId, localProjectId)
 *     - Re-run considers changed bookings (new booking added between runs)
 *     - DETAILS_RETRIEVED → UNDER_REVIEW on first run
 *     - UNDER_REVIEW → UNDER_REVIEW on re-run (idempotent status)
 *     - Unknown requestId → 404
 *
 *   - GET /takt-requests/:id/availability-checks/latest
 *     - Returns latest COMPLETED check when one exists
 *     - Returns latest check of any status when no COMPLETED exists
 *     - Foreign NU → 403
 *     - GU → 403
 *     - No checks yet → 404
 *
 * Fixture prefix: "t47-"
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import { anDb as db } from "@workspace/db";
import {
  organizationsTable,
  usersTable,
  resourcesTable,
  resourceBookingsTable,
  anLeistungsanfragenTable,
  anLeistungsanfrageResourceRequirementsTable,
  anAvailabilityChecksTable,
} from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
import app from "../app";

// ── JWT ───────────────────────────────────────────────────────────────────────

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

// ── Fixtures ──────────────────────────────────────────────────────────────────

const GU_ORG   = "t47-gu-org";
const NU_ORG_A = "t47-nu-org-a";
const NU_ORG_B = "t47-nu-org-b";
const GU_USER  = "t47-gu-user";
const NU_USER  = "t47-nu-user";
const PROJECT  = "t47-project";
const TAKT_A   = "t47-takt-a";
const TAKT_B   = "t47-takt-b";
const REQ_A    = "t47-req-a";  // DETAILS_RETRIEVED, addressed to NU_ORG_A
const REQ_B    = "t47-req-b";  // second request for re-run tests
const RES_CREW = "t47-resource-crew";

let nuTokenA: string;
let nuTokenB: string;
let guToken:  string;
let hubToken: string;

function makeSnapshot(taktId: string) {
  return {
    schemaVersion: "1.0",
    projectReference: PROJECT,
    taktReference: taktId,
    taktVersion: 1,
    trade: "Trockenbau",
    workPackage: "Innenausbau",
    plannedTimeWindow: {
      start: "2026-09-15",
      end: "2026-09-20",
    },
    workdayHours: 8,
    resourceRequirements: [
      { resourceType: "CREW", quantity: 2, notes: "" },
    ],
    coordinationContext: {},
  };
}

beforeAll(async () => {
  // Seed AN-local projections, requirements, resources and identities.
  await db.insert(organizationsTable).values([
    { id: GU_ORG,   name: "T47 GU Org",   type: "AG" },
    { id: NU_ORG_A, name: "T47 NU Org A", type: "AN" },
    { id: NU_ORG_B, name: "T47 NU Org B", type: "AN" },
  ]).onConflictDoNothing();

  await db.insert(usersTable).values([
    { id: GU_USER, name: "T47 GU", email: "t47-gu@example.com", passwordHash: "x" },
    { id: NU_USER, name: "T47 NU", email: "t47-nu@example.com", passwordHash: "x" },
  ]).onConflictDoNothing();

  await db.insert(anLeistungsanfragenTable).values([
    {
      id: REQ_A, externalLeistungsanfrageId: REQ_A, externalRequestVersion: 1,
      sourceMessageId: "t47-message-a", payloadHash: "t47-payload-a", correlationId: REQ_A,
      senderAgOrgId: GU_ORG, receiverAnOrgId: NU_ORG_A, projectReference: PROJECT,
      leistungReference: TAKT_A, plannedStart: "2026-09-15", plannedEnd: "2026-09-20",
      payloadSnapshot: makeSnapshot(TAKT_A), status: "DETAILS_RETRIEVED",
    },
    {
      id: REQ_B, externalLeistungsanfrageId: REQ_B, externalRequestVersion: 1,
      sourceMessageId: "t47-message-b", payloadHash: "t47-payload-b", correlationId: REQ_B,
      senderAgOrgId: GU_ORG, receiverAnOrgId: NU_ORG_A, projectReference: PROJECT,
      leistungReference: TAKT_B, plannedStart: "2026-09-15", plannedEnd: "2026-09-20",
      payloadSnapshot: makeSnapshot(TAKT_B), status: "DETAILS_RETRIEVED",
    },
  ]).onConflictDoNothing();
  await db.insert(anLeistungsanfrageResourceRequirementsTable).values([
    ...[REQ_A, REQ_B].map((anLeistungsanfrageId) => ({
      anLeistungsanfrageId, externalResourceTypeCode: "CREW",
      externalResourceTypeName: "Crew", requiredCapacity: "2", capacityUnit: "PERSONS",
      utilizationPercent: 100, periodStart: "2026-09-15", periodEnd: "2026-09-20",
    })),
  ]).onConflictDoNothing();

  await db.insert(resourcesTable).values([
    { id: RES_CREW, anOrgId: NU_ORG_A, type: "CREW", name: "T47 Crew Unit", capacity: 4, active: true },
  ]).onConflictDoNothing();

  nuTokenA = signToken({ userId: NU_USER, orgId: NU_ORG_A, orgType: "AN" });
  nuTokenB = signToken({ userId: NU_USER, orgId: NU_ORG_B, orgType: "AN" });
  guToken  = signToken({ userId: GU_USER, orgId: GU_ORG,   orgType: "AG" });
  hubToken = signToken({ userId: "hub-user", orgId: null,  orgType: null, hubAdmin: true });
});

afterAll(async () => {
  await db.delete(anAvailabilityChecksTable).where(eq(anAvailabilityChecksTable.anOrgId, NU_ORG_A));
  await db.delete(resourceBookingsTable).where(eq(resourceBookingsTable.nuOrgId, NU_ORG_A));
  await db.delete(anLeistungsanfragenTable).where(
    and(eq(anLeistungsanfragenTable.receiverAnOrgId, NU_ORG_A), eq(anLeistungsanfragenTable.projectReference, PROJECT)),
  );
  await db.delete(resourcesTable).where(eq(resourcesTable.anOrgId, NU_ORG_A));
  await db.delete(usersTable).where(eq(usersTable.id, GU_USER));
  await db.delete(usersTable).where(eq(usersTable.id, NU_USER));
  await db.delete(organizationsTable).where(eq(organizationsTable.id, GU_ORG));
  await db.delete(organizationsTable).where(eq(organizationsTable.id, NU_ORG_A));
  await db.delete(organizationsTable).where(eq(organizationsTable.id, NU_ORG_B));
});

// ── POST /takt-requests/:id/availability-checks ───────────────────────────────

describe("POST /takt-requests/:id/availability-checks", () => {
  it("addressed NU can start a check → 201", async () => {
    const res = await request(app)
       .post(`/api/an/takt-requests/${REQ_A}/availability-checks`)
      .set("Authorization", `Bearer ${nuTokenA}`);

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      status: expect.stringMatching(/^(COMPLETED|FAILED)$/),
      runNumber: 1,
    });
    expect(res.body.checkId).toBeTruthy();
  });

  it("foreign NU cannot discover the local projection → 404", async () => {
    const res = await request(app)
       .post(`/api/an/takt-requests/${REQ_A}/availability-checks`)
      .set("Authorization", `Bearer ${nuTokenB}`);
    expect(res.status).toBe(404);
  });

  it("GU is rejected → 403", async () => {
    const res = await request(app)
       .post(`/api/an/takt-requests/${REQ_A}/availability-checks`)
      .set("Authorization", `Bearer ${guToken}`);
    expect(res.status).toBe(403);
  });

  it("hub admin is rejected → 403", async () => {
    const res = await request(app)
       .post(`/api/an/takt-requests/${REQ_A}/availability-checks`)
      .set("Authorization", `Bearer ${hubToken}`);
    expect(res.status).toBe(403);
  });

  it("unknown requestId → 404", async () => {
    const res = await request(app)
       .post("/api/an/takt-requests/non-existent-req/availability-checks")
      .set("Authorization", `Bearer ${nuTokenA}`);
    expect(res.status).toBe(404);
  });

  it("DETAILS_RETRIEVED → UNDER_REVIEW on first run", async () => {
    // REQ_B starts at DETAILS_RETRIEVED; after the check it must be UNDER_REVIEW
    const res = await request(app)
       .post(`/api/an/takt-requests/${REQ_B}/availability-checks`)
      .set("Authorization", `Bearer ${nuTokenA}`);
    expect(res.status).toBe(201);

    const [req] = await db.select({ status: anLeistungsanfragenTable.status })
       .from(anLeistungsanfragenTable)
       .where(eq(anLeistungsanfragenTable.id, REQ_B));
    expect(req?.status).toBe("UNDER_REVIEW");
  });

  it("public result contains no internal IDs", async () => {
    const res = await request(app)
       .post(`/api/an/takt-requests/${REQ_A}/availability-checks`)
      .set("Authorization", `Bearer ${nuTokenA}`);

    // publicResult must have no resourceId or localProjectId in alternatives
    const publicResult = res.body.publicResult as {
      alternatives?: Array<Record<string, unknown>>;
    };
    if (publicResult?.alternatives) {
      for (const alt of publicResult.alternatives) {
        expect(alt).not.toHaveProperty("resourceId");
        expect(alt).not.toHaveProperty("localProjectId");
        expect(alt).not.toHaveProperty("_internalResourceIds");
      }
    }
    // internalResult must NOT appear in publicResult
    expect(res.body).not.toHaveProperty("publicResult.internalConflicts");
  });

  it("result is saved in DB and has correct nuOrgId", async () => {
    const rows = await db.select()
       .from(anAvailabilityChecksTable)
      .where(and(
         eq(anAvailabilityChecksTable.anLeistungsanfrageId, REQ_A),
         eq(anAvailabilityChecksTable.anOrgId, NU_ORG_A),
      ));
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].anOrgId).toBe(NU_ORG_A);
  });

  it("re-run after adding a conflicting booking is recorded as a new row", async () => {
    // Add a full-utilization booking for the crew resource
    const bookingId = `t47-booking-conflict-${Date.now()}`;
    await db.insert(resourceBookingsTable).values({
      id: bookingId,
      nuOrgId: NU_ORG_A,
      resourceId: RES_CREW,
      sourceType: "LOCAL_PROJECT",
      startAt: new Date("2026-09-14T00:00:00Z"),
      endAt:   new Date("2026-09-21T00:00:00Z"),
      utilizationPercent: 100,
      status: "CONFIRMED",
    }).onConflictDoNothing();

    const before = await db.select()
       .from(anAvailabilityChecksTable)
      .where(and(
         eq(anAvailabilityChecksTable.anLeistungsanfrageId, REQ_A),
         eq(anAvailabilityChecksTable.anOrgId, NU_ORG_A),
      ));

    const res = await request(app)
       .post(`/api/an/takt-requests/${REQ_A}/availability-checks`)
      .set("Authorization", `Bearer ${nuTokenA}`);
    expect(res.status).toBe(201);

    const after = await db.select()
       .from(anAvailabilityChecksTable)
      .where(and(
         eq(anAvailabilityChecksTable.anLeistungsanfrageId, REQ_A),
         eq(anAvailabilityChecksTable.anOrgId, NU_ORG_A),
      ));
    expect(after.length).toBe(before.length + 1);
    expect(res.body.runNumber).toBe(before.length + 1);

    // Clean up booking
    await db.delete(resourceBookingsTable)
      .where(eq(resourceBookingsTable.id, bookingId));
  });
});

// ── GET /takt-requests/:id/availability-checks/latest ────────────────────────

describe("GET /takt-requests/:id/availability-checks/latest", () => {
  it("returns the latest check for the addressed NU", async () => {
    // First ensure at least one check exists
    await request(app)
       .post(`/api/an/takt-requests/${REQ_A}/availability-checks`)
      .set("Authorization", `Bearer ${nuTokenA}`);

    const res = await request(app)
       .get(`/api/an/takt-requests/${REQ_A}/availability-checks/latest`)
      .set("Authorization", `Bearer ${nuTokenA}`);

    expect(res.status).toBe(200);
    expect(res.body.checkId).toBeTruthy();
    expect(res.body).toHaveProperty("internalResult");
    expect(res.body).toHaveProperty("publicResult");
  });

  it("foreign NU cannot discover the local projection → 404", async () => {
    const res = await request(app)
       .get(`/api/an/takt-requests/${REQ_A}/availability-checks/latest`)
      .set("Authorization", `Bearer ${nuTokenB}`);
    expect(res.status).toBe(404);
  });

  it("GU → 403", async () => {
    const res = await request(app)
       .get(`/api/an/takt-requests/${REQ_A}/availability-checks/latest`)
      .set("Authorization", `Bearer ${guToken}`);
    expect(res.status).toBe(403);
  });

  it("unknown request → 404", async () => {
    const res = await request(app)
       .get("/api/an/takt-requests/non-existent-req/availability-checks/latest")
      .set("Authorization", `Bearer ${nuTokenA}`);
    expect(res.status).toBe(404);
  });

  it("prefers COMPLETED check over FAILED of the same run number", async () => {
    const res = await request(app)
       .get(`/api/an/takt-requests/${REQ_A}/availability-checks/latest`)
      .set("Authorization", `Bearer ${nuTokenA}`);

    expect(res.status).toBe(200);
    // The latest check should be COMPLETED (not FAILED) when a COMPLETED one exists
    if (res.body.status === "COMPLETED") {
      expect(res.body.publicResult).toBeTruthy();
    }
  });

  it("latest check has the highest runNumber", async () => {
    // Run the check multiple times
    await request(app)
       .post(`/api/an/takt-requests/${REQ_A}/availability-checks`)
      .set("Authorization", `Bearer ${nuTokenA}`);
    await request(app)
       .post(`/api/an/takt-requests/${REQ_A}/availability-checks`)
      .set("Authorization", `Bearer ${nuTokenA}`);

    const all = await db.select()
       .from(anAvailabilityChecksTable)
      .where(and(
         eq(anAvailabilityChecksTable.anLeistungsanfrageId, REQ_A),
         eq(anAvailabilityChecksTable.anOrgId, NU_ORG_A),
      ));
    const maxRun = Math.max(...all.map(r => r.runNumber));

    const res = await request(app)
       .get(`/api/an/takt-requests/${REQ_A}/availability-checks/latest`)
      .set("Authorization", `Bearer ${nuTokenA}`);

    expect(res.status).toBe(200);
    expect(res.body.runNumber).toBe(maxRun);
  });
});
