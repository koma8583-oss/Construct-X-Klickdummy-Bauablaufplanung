/**
 * AG decision / AN booking boundary regression tests.
 *
 * Tests:
 *   1. AG acceptance must not use a private availability check to book AN resources.
 *   2. AG alternative acceptance must not re-evaluate or book AN resources.
 *   3. The decision remains valid without a completed availability check.
 *
 * Fixture prefix: "t185-"
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import { agDb as db } from "@workspace/db";
import {
  organizationsTable,
  usersTable,
  projectsTable,
  takteTable,
  taktRequestsTable,
  taktRequestSnapshotsTable,
  taktResponsesTable,
  taktResponseAlternativesTable,
  taktResponseDecisionsTable,
  taktVersionsTable,
  messageOutboxTable,
  messageInboxTable,
  projectContractorsTable,
  resourcesTable,
  resourceBookingsTable,
  availabilityChecksTable,
} from "@workspace/db";
import { eq, and, inArray } from "drizzle-orm";
import app from "../app";

// ── JWT helpers ───────────────────────────────────────────────────────────────

const JWT_SECRET =
  process.env.JWT_SECRET ?? "taktkoord-jwt-dev-secret-change-in-prod";

function sign(p: {
  userId: string;
  orgId: string | null;
  orgType: "AG" | "AN" | null;
  hubAdmin?: boolean;
}): string {
  return jwt.sign({ ...p, hubAdmin: p.hubAdmin ?? false }, JWT_SECRET, {
    expiresIn: "1h",
  });
}

// ── Fixture IDs ───────────────────────────────────────────────────────────────

const GU_ORG   = "t185-gu-org";
const NU_ORG   = "t185-nu-org";
const GU_USER  = "t185-gu-user";
const NU_USER  = "t185-nu-user";
const PROJECT  = "t185-project";
const TAKT     = "t185-takt";
const RES_A    = "t185-resource-a";
const RES_B    = "t185-resource-b";

const guToken = sign({ userId: GU_USER, orgId: GU_ORG, orgType: "AG" });

// Populated during beforeAll
let reqConfirmId  = "";   // request for CONFIRM_ACCEPTED test
let reqAltId      = "";   // request for ACCEPT_ALTERNATIVE test
let reqNoCheckId  = "";   // request for no-availability-check test
let altRowId      = "";   // takt_response_alternatives PK for reqAlt

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Delete all resource_bookings rows for a given taktRequestId. */
async function deleteBookingsForRequest(taktRequestId: string) {
  await db
    .delete(resourceBookingsTable)
    .where(
      and(
        eq(resourceBookingsTable.sourceType, "TAKT_REQUEST"),
        eq(resourceBookingsTable.sourceReferenceId, taktRequestId),
      ),
    )
    .catch(() => {});
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeAll(async () => {
  // ── Pre-cleanup (crash-safe) ───────────────────────────────────────────────
  await db.delete(resourceBookingsTable)
    .where(eq(resourceBookingsTable.nuOrgId, NU_ORG)).catch(() => {});
  await db.delete(availabilityChecksTable)
    .where(eq(availabilityChecksTable.nuOrgId, NU_ORG)).catch(() => {});
  await db.delete(taktVersionsTable)
    .where(eq(taktVersionsTable.taktId, TAKT)).catch(() => {});
  await db.delete(taktResponseDecisionsTable)
    .where(eq(taktResponseDecisionsTable.guOrgId, GU_ORG)).catch(() => {});

  const stale = await db.select({ id: taktRequestsTable.id })
    .from(taktRequestsTable)
    .where(eq(taktRequestsTable.taktId, TAKT))
    .catch(() => [] as { id: string }[]);
  const staleIds = stale.map((r) => r.id);
  if (staleIds.length > 0) {
    const staleResps = await db.select({ id: taktResponsesTable.id })
      .from(taktResponsesTable)
      .where(inArray(taktResponsesTable.taktRequestId, staleIds))
      .catch(() => [] as { id: string }[]);
    const staleRespIds = staleResps.map((r) => r.id);
    if (staleRespIds.length > 0) {
      await db.delete(taktResponseAlternativesTable)
        .where(inArray(taktResponseAlternativesTable.responseId, staleRespIds)).catch(() => {});
    }
    await db.delete(taktResponsesTable)
      .where(inArray(taktResponsesTable.taktRequestId, staleIds)).catch(() => {});
    await db.delete(taktRequestSnapshotsTable)
      .where(inArray(taktRequestSnapshotsTable.taktRequestId, staleIds)).catch(() => {});
  }
  await db.delete(taktRequestsTable).where(eq(taktRequestsTable.taktId, TAKT)).catch(() => {});
  await db.delete(takteTable).where(eq(takteTable.id, TAKT)).catch(() => {});
  await db.delete(resourcesTable).where(eq(resourcesTable.anOrgId, NU_ORG)).catch(() => {});
  await db.delete(projectContractorsTable).where(eq(projectContractorsTable.projectId, PROJECT)).catch(() => {});
  await db.delete(projectsTable).where(eq(projectsTable.id, PROJECT)).catch(() => {});
  for (const email of ["t185-gu@test.com", "t185-nu@test.com"]) {
    await db.delete(usersTable).where(eq(usersTable.email, email)).catch(() => {});
  }
  for (const id of [GU_ORG, NU_ORG]) {
    await db.delete(organizationsTable).where(eq(organizationsTable.id, id)).catch(() => {});
  }

  // ── Organisations ──────────────────────────────────────────────────────────
  await db.insert(organizationsTable).values([
    { id: GU_ORG, name: "t185 GU", type: "AG" as const },
    { id: NU_ORG, name: "t185 NU", type: "AN" as const },
  ]).onConflictDoNothing();

  // ── Users ──────────────────────────────────────────────────────────────────
  await db.insert(usersTable).values([
    { id: GU_USER, email: "t185-gu@test.com", name: "GU185", passwordHash: "x" },
    { id: NU_USER, email: "t185-nu@test.com", name: "NU185", passwordHash: "x" },
  ]).onConflictDoNothing();

  // ── Project + contractor ───────────────────────────────────────────────────
  await db.insert(projectsTable).values({
    id: PROJECT,
    agOrgId: GU_ORG,
    name: "t185 Project",
    status: "ACTIVE" as const,
    startDate: "2026-10-01",
    endDate: "2026-12-31",
  }).onConflictDoNothing();

  await db.insert(projectContractorsTable).values({
    projectId: PROJECT,
    anOrgId: NU_ORG,
  }).onConflictDoNothing();

  // ── Takt ───────────────────────────────────────────────────────────────────
  await db.insert(takteTable).values({
    id: TAKT,
    projectId: PROJECT,
    taktBezeichnung: "t185 Takt",
    zone: "Z1",
    gewerk: "Elektro",
    plannedStart: "2026-11-01",
    plannedEnd: "2026-11-07",
    lifecycleStatus: "IN_COORDINATION" as const,
  }).onConflictDoNothing();

  // ── Resources ──────────────────────────────────────────────────────────────
  await db.insert(resourcesTable).values([
    { id: RES_A, anOrgId: NU_ORG, type: "EMPLOYEE" as const, name: "t185 Worker A" },
    { id: RES_B, anOrgId: NU_ORG, type: "EMPLOYEE" as const, name: "t185 Worker B" },
  ]).onConflictDoNothing();

  // ── Request 1: CONFIRM_ACCEPTED scenario ──────────────────────────────────
  // TaktResponse: ACCEPTED with acceptedStart/End
  const [rConf] = await db.insert(taktRequestsTable).values({
    taktId: TAKT, taktVersion: 1, guOrgId: GU_ORG, nuOrgId: NU_ORG,
    requestNumber: "TKR-18500-0001",
    status: "UNDER_REVIEW" as const,
    createdByUserId: GU_USER,
  }).returning();
  reqConfirmId = rConf.id;

  await db.insert(taktResponsesTable).values({
    taktRequestId: reqConfirmId,
    decision: "ACCEPTED" as const,
    acceptedStart: new Date("2026-11-01T08:00:00Z"),
    acceptedEnd:   new Date("2026-11-07T17:00:00Z"),
    createdByUserId: NU_USER,
  });

  // Completed availability check for reqConfirm — resources RES_A and RES_B available
  await db.insert(availabilityChecksTable).values({
    nuOrgId: NU_ORG,
    taktRequestId: reqConfirmId,
    status: "COMPLETED" as const,
    result: "FEASIBLE" as const,
    runNumber: 1,
    checkedAt: new Date(),
    internalResultPayload: {
      conflicts: [],
      availableResources: [
        { resourceId: RES_A, resourceType: "EMPLOYEE" },
        { resourceId: RES_B, resourceType: "EMPLOYEE" },
      ],
      missingQualifications: [],
      unavailableEquipment: [],
      tentativeWarnings: [],
    },
    publicResultPayload: {
      recommendedDecision: "ACCEPTED",
      reasonCode: "FEASIBLE",
      alternatives: [],
    },
  });

  // ── Request 2: ACCEPT_ALTERNATIVE scenario ────────────────────────────────
  // TaktResponse: ALTERNATIVES_PROPOSED with one alternative
  const [rAlt] = await db.insert(taktRequestsTable).values({
    taktId: TAKT, taktVersion: 1, guOrgId: GU_ORG, nuOrgId: NU_ORG,
    requestNumber: "TKR-18500-0002",
    status: "UNDER_REVIEW" as const,
    createdByUserId: GU_USER,
  }).returning();
  reqAltId = rAlt.id;

  const [respAlt] = await db.insert(taktResponsesTable).values({
    taktRequestId: reqAltId,
    decision: "ALTERNATIVES_PROPOSED" as const,
    comment: "Nur alternative Zeitfenster verfügbar",
    createdByUserId: NU_USER,
  }).returning();

  const [altRow] = await db.insert(taktResponseAlternativesTable).values({
    responseId: respAlt.id,
    alternativeId: "ALT-185-001",
    rank: 1,
    proposedStart: new Date("2026-11-10T08:00:00Z"),
    proposedEnd:   new Date("2026-11-14T17:00:00Z"),
  }).returning();
  altRowId = altRow.id;

  // Completed availability check for reqAlt — only RES_A available
  await db.insert(availabilityChecksTable).values({
    nuOrgId: NU_ORG,
    taktRequestId: reqAltId,
    status: "COMPLETED" as const,
    result: "FEASIBLE_WITH_ALTERNATIVES" as const,
    runNumber: 1,
    checkedAt: new Date(),
    internalResultPayload: {
      conflicts: [],
      availableResources: [
        { resourceId: RES_A, resourceType: "EMPLOYEE" },
      ],
      missingQualifications: [],
      unavailableEquipment: [],
      tentativeWarnings: [],
    },
    publicResultPayload: {
      recommendedDecision: "ALTERNATIVES_PROPOSED",
      reasonCode: "RESOURCE_CONFLICT",
      alternatives: [
        {
          alternativeId: "ALT-185-001",
          rank: 1,
          timeWindow: { start: "2026-11-10T08:00:00Z", end: "2026-11-14T17:00:00Z" },
          crewSize: 2,
          conditions: null,
        },
      ],
    },
  });

  // ── Request 3: No availability check scenario ─────────────────────────────
  // TaktResponse: ACCEPTED, but NO availability check exists → no bookings
  const [rNoCheck] = await db.insert(taktRequestsTable).values({
    taktId: TAKT, taktVersion: 1, guOrgId: GU_ORG, nuOrgId: NU_ORG,
    requestNumber: "TKR-18500-0003",
    status: "UNDER_REVIEW" as const,
    createdByUserId: GU_USER,
  }).returning();
  reqNoCheckId = rNoCheck.id;

  await db.insert(taktResponsesTable).values({
    taktRequestId: reqNoCheckId,
    decision: "ACCEPTED" as const,
    acceptedStart: new Date("2026-11-20T08:00:00Z"),
    acceptedEnd:   new Date("2026-11-26T17:00:00Z"),
    createdByUserId: NU_USER,
  });
  // Intentionally: no availability check inserted for reqNoCheckId
});

// ── Teardown ──────────────────────────────────────────────────────────────────

afterAll(async () => {
  // Bookings first (reference resources + takt_requests)
  await db.delete(resourceBookingsTable)
    .where(eq(resourceBookingsTable.nuOrgId, NU_ORG)).catch(() => {});
  // Availability checks
  await db.delete(availabilityChecksTable)
    .where(eq(availabilityChecksTable.nuOrgId, NU_ORG)).catch(() => {});
  // Versions (reference takt)
  await db.delete(taktVersionsTable)
    .where(eq(taktVersionsTable.taktId, TAKT)).catch(() => {});
  // Decisions
  await db.delete(taktResponseDecisionsTable)
    .where(eq(taktResponseDecisionsTable.guOrgId, GU_ORG)).catch(() => {});
  // Alternatives
  for (const reqId of [reqConfirmId, reqAltId, reqNoCheckId]) {
    if (!reqId) continue;
    const resps = await db.select({ id: taktResponsesTable.id })
      .from(taktResponsesTable)
      .where(eq(taktResponsesTable.taktRequestId, reqId))
      .catch(() => [] as { id: string }[]);
    for (const r of resps) {
      await db.delete(taktResponseAlternativesTable)
        .where(eq(taktResponseAlternativesTable.responseId, r.id)).catch(() => {});
    }
    await db.delete(taktResponsesTable)
      .where(eq(taktResponsesTable.taktRequestId, reqId)).catch(() => {});
    await db.delete(taktRequestSnapshotsTable)
      .where(eq(taktRequestSnapshotsTable.taktRequestId, reqId)).catch(() => {});
    await db.delete(taktRequestsTable)
      .where(eq(taktRequestsTable.id, reqId)).catch(() => {});
  }
  await db.delete(resourcesTable)
    .where(eq(resourcesTable.anOrgId, NU_ORG)).catch(() => {});
  await db.delete(takteTable).where(eq(takteTable.id, TAKT)).catch(() => {});
  await db.delete(projectContractorsTable)
    .where(eq(projectContractorsTable.projectId, PROJECT)).catch(() => {});
  await db.delete(projectsTable).where(eq(projectsTable.id, PROJECT)).catch(() => {});
  // Outbox/inbox (FK on sender_org_id / recipient_org_id)
  await db.delete(messageInboxTable)
    .where(eq(messageInboxTable.senderOrgId, GU_ORG)).catch(() => {});
  await db.delete(messageOutboxTable)
    .where(eq(messageOutboxTable.senderOrgId, GU_ORG)).catch(() => {});
  for (const email of ["t185-gu@test.com", "t185-nu@test.com"]) {
    await db.delete(usersTable).where(eq(usersTable.email, email)).catch(() => {});
  }
  for (const id of [GU_ORG, NU_ORG]) {
    await db.delete(organizationsTable).where(eq(organizationsTable.id, id)).catch(() => {});
  }
});

// ── Test 1: AG acceptance never creates AN resource bookings ──────────────────

describe("CONFIRM_ACCEPTED — AN booking boundary", () => {
  it("does not create AN resource_bookings even when a private availability check exists", async () => {
    const res = await request(app)
      .post(`/api/takt-requests/${reqConfirmId}/gu-decisions`)
      .set("Authorization", `Bearer ${guToken}`)
      .send({
        decisionType: "CONFIRM_ACCEPTED",
        comment: "Bestätigt.",
      });

    expect(res.status).toBe(201);
    expect(res.body.decisionType).toBe("CONFIRM_ACCEPTED");

    // A private check must not become a cross-domain booking source.
    const bookings = await db
      .select()
      .from(resourceBookingsTable)
      .where(
        and(
          eq(resourceBookingsTable.sourceType, "TAKT_REQUEST"),
          eq(resourceBookingsTable.sourceReferenceId, reqConfirmId),
        ),
      );

    expect(bookings).toHaveLength(0);
  });
});

// ── Test 2: AG alternative acceptance never re-evaluates or books AN resources

describe("ACCEPT_ALTERNATIVE — AN booking boundary", () => {
  it("does not create AN resource_bookings from the alternative or global availability data", async () => {
    const res = await request(app)
      .post(`/api/takt-requests/${reqAltId}/gu-decisions`)
      .set("Authorization", `Bearer ${guToken}`)
      .send({
        decisionType: "ACCEPT_ALTERNATIVE",
        acceptedAlternativeId: altRowId,
        comment: "Alternative 1 akzeptiert.",
      });

    expect(res.status).toBe(201);
    expect(res.body.decisionType).toBe("ACCEPT_ALTERNATIVE");
    expect(res.body.acceptedAlternativeId).toBe(altRowId);

    const bookings = await db
      .select()
      .from(resourceBookingsTable)
      .where(
        and(
          eq(resourceBookingsTable.sourceType, "TAKT_REQUEST"),
          eq(resourceBookingsTable.sourceReferenceId, reqAltId),
        ),
      );

    expect(bookings).toHaveLength(0);
  });
});

// ── Test 3: No availability check → graceful no-op ───────────────────────────

describe("CONFIRM_ACCEPTED with no availability check — graceful no-op", () => {
  it("creates the GU decision successfully but creates NO resource_bookings", async () => {
    const res = await request(app)
      .post(`/api/takt-requests/${reqNoCheckId}/gu-decisions`)
      .set("Authorization", `Bearer ${guToken}`)
      .send({
        decisionType: "CONFIRM_ACCEPTED",
        comment: "Kein Verfügbarkeitscheck vorhanden.",
      });

    // Decision must still succeed
    expect(res.status).toBe(201);
    expect(res.body.decisionType).toBe("CONFIRM_ACCEPTED");
    expect(res.body.updatedRequestStatus).toBe("ACCEPTED");

    // No resource_bookings should have been created
    const bookings = await db
      .select()
      .from(resourceBookingsTable)
      .where(
        and(
          eq(resourceBookingsTable.sourceType, "TAKT_REQUEST"),
          eq(resourceBookingsTable.sourceReferenceId, reqNoCheckId),
        ),
      );

    expect(bookings).toHaveLength(0);
  });
});
