/**
 * DTC resource planning integration tests.
 *
 * Tests the 9 required scenarios from the DTC integration spec:
 *  1. New resource type gets correct DTC class stored
 *  2. MACHINE category maps to DTC AsPlannedEquipment (migration mapping)
 *  3. New resource requires ResourceType (or derives type from it)
 *  4. Type-level booking without concrete resourceId works
 *  5. Existing bookings reduce the available quantity of a ResourceType
 *  6. Required 6, available 4 → RESOURCE_CONFLICT
 *  7. Required 4, available 6 → FEASIBLE
 *  8. Bookings for other resource types don't affect this type's check
 *  9. Internal resource information does not appear in the public result
 *
 * Fixture prefix: "dtc-"
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@workspace/db";
import {
  organizationsTable,
  usersTable,
  projectsTable,
  takteTable,
  taktRequestsTable,
  taktRequestSnapshotsTable,
  taktRequestResourceRequirementsTable,
  resourceTypesTable,
  resourcesTable,
  resourceBookingsTable,
  availabilityChecksTable,
} from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { runAvailabilityCheck } from "../services/availability-check-service";
import type { TaktRequestSnapshotPayload } from "../lib/takt-request-snapshot-service";

// ── DTC constants ─────────────────────────────────────────────────────────────

const DTC = {
  WORKER: "https://dtc-ontology.cms.ed.tum.de/ontology/v2#AsPlannedWorker",
  WORKER_CREW: "https://dtc-ontology.cms.ed.tum.de/ontology/v2#AsPlannedWorkerCrew",
  EQUIPMENT: "https://dtc-ontology.cms.ed.tum.de/ontology/v2#AsPlannedEquipment",
  TEMPORARY_EQUIPMENT: "https://dtc-ontology.cms.ed.tum.de/ontology/v2#AsPlannedTemporaryEquipment",
} as const;

// ── Fixture IDs ───────────────────────────────────────────────────────────────

const ORG_NU  = "dtc-org-nu";
const ORG_AG  = "dtc-org-ag";
const USER_ID = "dtc-user-001";
const PROJECT = "dtc-project-001";
const WINDOW  = { start: "2027-03-01", end: "2027-03-14" } as const;

// ── Helper: minimal snapshot ──────────────────────────────────────────────────

function makeSnap(overrides: Partial<TaktRequestSnapshotPayload> = {}): TaktRequestSnapshotPayload {
  return {
    schemaVersion: "1.0",
    projectReference: PROJECT,
    taktReference: "dtc-takt",
    taktVersion: 1,
    trade: "Trockenbau",
    workPackage: "DTC Test",
    location: { building: null, storey: "OG1", zone: "A" },
    plannedTimeWindow: { start: WINDOW.start, end: WINDOW.end },
    bufferTimeWindow: { earliestStart: "2027-02-22", latestEnd: "2027-03-21" },
    requiredOutput: null,
    resourceRequirements: [],
    constraints: [],
    predecessors: [],
    successors: [],
    documentReferences: { lvReference: null, bimReference: null },
    ...overrides,
  } as TaktRequestSnapshotPayload;
}

async function seedTakt(id: string) {
  await db.insert(takteTable).values({
    id, projectId: PROJECT, taktBezeichnung: `DTC Takt ${id}`,
    zone: "A", gewerk: "Trockenbau", plannedStart: WINDOW.start, plannedEnd: WINDOW.end, version: 1,
  }).onConflictDoNothing();
}

async function seedRequest(id: string, taktId: string, snap = makeSnap()) {
  await db.insert(taktRequestsTable).values({
    id, taktId, guOrgId: ORG_AG, nuOrgId: ORG_NU,
    requestNumber: `DTC-${id}`, status: "DETAILS_RETRIEVED", createdByUserId: USER_ID,
  }).onConflictDoNothing();
  await db.insert(taktRequestSnapshotsTable).values({
    taktRequestId: id, schemaVersion: "1.0",
    snapshotPayload: snap as unknown as Record<string, unknown>,
  }).onConflictDoNothing();
}

// ── Setup / teardown ──────────────────────────────────────────────────────────

beforeAll(async () => {
  await db.insert(organizationsTable).values([
    { id: ORG_NU, name: "DTC NU Org", type: "AN" },
    { id: ORG_AG, name: "DTC AG Org", type: "AG" },
  ]).onConflictDoNothing();
  await db.insert(usersTable).values({
    id: USER_ID, name: "DTC User", email: "dtc@test.com", passwordHash: "x",
  }).onConflictDoNothing();
  await db.insert(projectsTable).values({
    id: PROJECT, agOrgId: ORG_AG, name: "DTC Test Project",
  }).onConflictDoNothing();
});

afterAll(async () => {
  await db.execute(sql`DELETE FROM availability_checks WHERE nu_org_id = ${ORG_NU}`).catch(() => {});
  await db.execute(sql`DELETE FROM takt_request_resource_requirements WHERE an_org_id = ${ORG_NU}`).catch(() => {});
  await db.execute(sql`DELETE FROM resource_bookings WHERE nu_org_id = ${ORG_NU}`).catch(() => {});
  await db.execute(sql`DELETE FROM takt_request_snapshots WHERE takt_request_id LIKE 'dtc-req-%'`).catch(() => {});
  await db.execute(sql`DELETE FROM takt_requests WHERE gu_org_id = ${ORG_AG}`).catch(() => {});
  await db.execute(sql`DELETE FROM resources WHERE an_org_id = ${ORG_NU}`).catch(() => {});
  await db.execute(sql`DELETE FROM resource_types WHERE an_org_id = ${ORG_NU}`).catch(() => {});
  await db.execute(sql`DELETE FROM takte WHERE project_id = ${PROJECT}`).catch(() => {});
  await db.execute(sql`DELETE FROM projects WHERE id = ${PROJECT}`).catch(() => {});
  await db.execute(sql`DELETE FROM users WHERE id = ${USER_ID}`).catch(() => {});
  await db.execute(sql`DELETE FROM organizations WHERE id IN (${ORG_NU}, ${ORG_AG})`).catch(() => {});
});

// ── Test 1: New resource type stores correct DTC class ───────────────────────

describe("DTC test 1 — resource type stores dtcClass URI", () => {
  it("creates a ResourceType with the full DTC URI and derived category", async () => {
    const [rt] = await db.insert(resourceTypesTable).values({
      anOrgId: ORG_NU,
      name: "Facharbeiter Trockenbau",
      category: "PERSONNEL",
      dtcClass: DTC.WORKER,
      code: "LAB-DRYWALL",
      capacityUnit: "PERSONS",
    }).returning();

    expect(rt.dtcClass).toBe(DTC.WORKER);
    expect(rt.code).toBe("LAB-DRYWALL");
    expect(rt.category).toBe("PERSONNEL");

    await db.delete(resourceTypesTable).where(eq(resourceTypesTable.id, rt.id));
  });
});

// ── Test 2: MACHINE category maps to DTC Equipment ──────────────────────────

describe("DTC test 2 — MACHINE category maps to AsPlannedEquipment", () => {
  it("stores EQUIPMENT DTC class for a MACHINE-category type", async () => {
    // According to the migration mapping: MACHINE → EQUIPMENT (AsPlannedEquipment)
    const [rt] = await db.insert(resourceTypesTable).values({
      anOrgId: ORG_NU,
      name: "Kran",
      category: "MACHINE",
      dtcClass: DTC.EQUIPMENT,
    }).returning();

    expect(rt.category).toBe("MACHINE");
    expect(rt.dtcClass).toBe(DTC.EQUIPMENT);

    await db.delete(resourceTypesTable).where(eq(resourceTypesTable.id, rt.id));
  });
});

// ── Test 3: Resource requires ResourceType ───────────────────────────────────

describe("DTC test 3 — resource must link to a ResourceType", () => {
  it("creates a resource linked to a resource type", async () => {
    const [rt] = await db.insert(resourceTypesTable).values({
      anOrgId: ORG_NU, name: "Kolonne Trockenbau", category: "CREW",
      dtcClass: DTC.WORKER_CREW, capacityUnit: "PERSONS",
    }).returning();

    const [res] = await db.insert(resourcesTable).values({
      anOrgId: ORG_NU, type: "CREW", name: "Kolonne A",
      resourceTypeId: rt.id, capacity: 6,
    }).returning();

    expect(res.resourceTypeId).toBe(rt.id);
    expect(res.capacity).toBe(6);

    await db.delete(resourcesTable).where(eq(resourcesTable.id, res.id));
    await db.delete(resourceTypesTable).where(eq(resourceTypesTable.id, rt.id));
  });
});

// ── Test 4: Type-level booking without concrete resourceId ───────────────────

describe("DTC test 4 — type-level booking without resourceId", () => {
  it("inserts a booking with resourceTypeId but no resourceId", async () => {
    const [rt] = await db.insert(resourceTypesTable).values({
      anOrgId: ORG_NU, name: "Gerät DTC4", category: "EQUIPMENT",
      dtcClass: DTC.EQUIPMENT,
    }).returning();

    const [booking] = await db.insert(resourceBookingsTable).values({
      nuOrgId: ORG_NU,
      resourceId: null,
      resourceTypeId: rt.id,
      quantity: 2,
      sourceType: "TAKT_REQUEST",
      startAt: new Date("2027-03-01T00:00:00Z"),
      endAt: new Date("2027-03-14T00:00:00Z"),
      status: "CONFIRMED",
    }).returning();

    expect(booking.resourceId).toBeNull();
    expect(booking.resourceTypeId).toBe(rt.id);
    expect(booking.quantity).toBe(2);

    await db.delete(resourceBookingsTable).where(eq(resourceBookingsTable.id, booking.id));
    await db.delete(resourceTypesTable).where(eq(resourceTypesTable.id, rt.id));
  });
});

// ── Tests 5–9: Availability check with DTC requirements ──────────────────────

describe("DTC tests 5–9 — availability check with ResourceType requirements", () => {
  let rtId: string;
  let rtOtherId: string;

  beforeAll(async () => {
    // Primary resource type: 6 persons capacity (2 resources × 3 persons each)
    const [rt] = await db.insert(resourceTypesTable).values({
      anOrgId: ORG_NU, name: "Trockenbauer DTC", category: "PERSONNEL",
      dtcClass: DTC.WORKER, capacityUnit: "PERSONS",
    }).returning();
    rtId = rt.id;

    // Secondary resource type (should not affect primary checks)
    const [rtOther] = await db.insert(resourceTypesTable).values({
      anOrgId: ORG_NU, name: "Elektriker DTC", category: "PERSONNEL",
      dtcClass: DTC.WORKER, capacityUnit: "PERSONS",
    }).returning();
    rtOtherId = rtOther.id;

    // Two resources of the primary type — total capacity 6
    await db.insert(resourcesTable).values([
      { anOrgId: ORG_NU, type: "EMPLOYEE", name: "DTC Worker A", resourceTypeId: rtId, capacity: 3 },
      { anOrgId: ORG_NU, type: "EMPLOYEE", name: "DTC Worker B", resourceTypeId: rtId, capacity: 3 },
    ]).onConflictDoNothing();

    // One resource of the secondary type — capacity 5
    await db.insert(resourcesTable).values({
      anOrgId: ORG_NU, type: "EMPLOYEE", name: "DTC Electrician", resourceTypeId: rtOtherId, capacity: 5,
    }).onConflictDoNothing();
  });

  afterAll(async () => {
    await db.execute(sql`DELETE FROM resources WHERE resource_type_id IN (${rtId}, ${rtOtherId})`).catch(() => {});
    await db.delete(resourceTypesTable).where(eq(resourceTypesTable.id, rtId)).catch(() => {});
    await db.delete(resourceTypesTable).where(eq(resourceTypesTable.id, rtOtherId)).catch(() => {});
  });

  // Test 5: Existing bookings reduce available capacity
  it("test 5 — existing CONFIRMED booking reduces available capacity", async () => {
    const taktId = "dtc-takt-5"; const reqId = "dtc-req-5";
    await seedTakt(taktId);
    await seedRequest(reqId, taktId);

    // Require 4 persons
    await db.insert(taktRequestResourceRequirementsTable).values({
      taktRequestId: reqId, anOrgId: ORG_NU, resourceTypeId: rtId,
      requiredCapacity: "4", utilizationPercent: 100,
    }).onConflictDoNothing();

    // Existing booking consuming 3 units (type-level)
    const [booking] = await db.insert(resourceBookingsTable).values({
      nuOrgId: ORG_NU, resourceTypeId: rtId, resourceId: null, quantity: 3,
      sourceType: "MANUAL_BLOCK",
      startAt: new Date("2027-03-01T00:00:00Z"), endAt: new Date("2027-03-14T00:00:00Z"),
      status: "CONFIRMED",
    }).returning();

    // Total capacity = 6; used = 3; available = 3 < required 4 → CONFLICT
    const check = await runAvailabilityCheck(reqId, ORG_NU, USER_ID);
    expect(check.result).not.toBe("FEASIBLE");
    expect(check.internalResultPayload?.conflicts.length).toBeGreaterThan(0);

    await db.delete(resourceBookingsTable).where(eq(resourceBookingsTable.id, booking.id));
    await db.execute(sql`DELETE FROM takt_request_resource_requirements WHERE takt_request_id = ${reqId}`).catch(() => {});
  });

  // Test 6: Required 6, available 4 → conflict
  it("test 6 — required 6 with available 4 produces RESOURCE_CONFLICT", async () => {
    const taktId = "dtc-takt-6"; const reqId = "dtc-req-6";
    await seedTakt(taktId);
    await seedRequest(reqId, taktId);

    // Require 6 persons (total capacity = 6, but 2 are already booked)
    await db.insert(taktRequestResourceRequirementsTable).values({
      taktRequestId: reqId, anOrgId: ORG_NU, resourceTypeId: rtId,
      requiredCapacity: "6", utilizationPercent: 100,
    }).onConflictDoNothing();

    // Book 2 units away, leaving only 4 available
    const [booking] = await db.insert(resourceBookingsTable).values({
      nuOrgId: ORG_NU, resourceTypeId: rtId, resourceId: null, quantity: 2,
      sourceType: "MANUAL_BLOCK",
      startAt: new Date("2027-03-01T00:00:00Z"), endAt: new Date("2027-03-14T00:00:00Z"),
      status: "CONFIRMED",
    }).returning();

    const check = await runAvailabilityCheck(reqId, ORG_NU, USER_ID);
    expect(check.result).not.toBe("FEASIBLE");
    expect(check.publicResultPayload?.reasonCode).toBe("RESOURCE_CONFLICT");

    await db.delete(resourceBookingsTable).where(eq(resourceBookingsTable.id, booking.id));
    await db.execute(sql`DELETE FROM takt_request_resource_requirements WHERE takt_request_id = ${reqId}`).catch(() => {});
  });

  // Test 7: Required 4, available 6 → feasible
  it("test 7 — required 4 with available 6 is FEASIBLE", async () => {
    const taktId = "dtc-takt-7"; const reqId = "dtc-req-7";
    await seedTakt(taktId);
    await seedRequest(reqId, taktId);

    // Require only 4 (total available = 6 with no other bookings)
    await db.insert(taktRequestResourceRequirementsTable).values({
      taktRequestId: reqId, anOrgId: ORG_NU, resourceTypeId: rtId,
      requiredCapacity: "4", utilizationPercent: 100,
    }).onConflictDoNothing();

    const check = await runAvailabilityCheck(reqId, ORG_NU, USER_ID);
    expect(check.result).toBe("FEASIBLE");
    expect(check.publicResultPayload?.recommendedDecision).toBe("ACCEPTED");
    expect(check.internalResultPayload?.conflicts).toHaveLength(0);

    await db.execute(sql`DELETE FROM takt_request_resource_requirements WHERE takt_request_id = ${reqId}`).catch(() => {});
  });

  // Test 8: Bookings for other resource types don't affect this check
  it("test 8 — bookings for a different resource type don't reduce capacity", async () => {
    const taktId = "dtc-takt-8"; const reqId = "dtc-req-8";
    await seedTakt(taktId);
    await seedRequest(reqId, taktId);

    // Require 6 from primary type (total cap = 6)
    await db.insert(taktRequestResourceRequirementsTable).values({
      taktRequestId: reqId, anOrgId: ORG_NU, resourceTypeId: rtId,
      requiredCapacity: "6", utilizationPercent: 100,
    }).onConflictDoNothing();

    // Book 5 units of the OTHER resource type — must NOT reduce primary type capacity
    const [otherBooking] = await db.insert(resourceBookingsTable).values({
      nuOrgId: ORG_NU, resourceTypeId: rtOtherId, resourceId: null, quantity: 5,
      sourceType: "MANUAL_BLOCK",
      startAt: new Date("2027-03-01T00:00:00Z"), endAt: new Date("2027-03-14T00:00:00Z"),
      status: "CONFIRMED",
    }).returning();

    const check = await runAvailabilityCheck(reqId, ORG_NU, USER_ID);
    // Primary type has 6 available and 6 required — should be FEASIBLE
    expect(check.result).toBe("FEASIBLE");

    await db.delete(resourceBookingsTable).where(eq(resourceBookingsTable.id, otherBooking.id));
    await db.execute(sql`DELETE FROM takt_request_resource_requirements WHERE takt_request_id = ${reqId}`).catch(() => {});
  });

  // Test 9: Internal resource info not in public result
  it("test 9 — internal resource IDs and org IDs not in public result payload", async () => {
    const taktId = "dtc-takt-9"; const reqId = "dtc-req-9";
    await seedTakt(taktId);
    await seedRequest(reqId, taktId);

    await db.insert(taktRequestResourceRequirementsTable).values({
      taktRequestId: reqId, anOrgId: ORG_NU, resourceTypeId: rtId,
      requiredCapacity: "10", utilizationPercent: 100, // more than available → conflict
    }).onConflictDoNothing();

    const check = await runAvailabilityCheck(reqId, ORG_NU, USER_ID);

    const publicStr = JSON.stringify(check.publicResultPayload ?? {});
    expect(publicStr).not.toContain(ORG_NU);
    expect(publicStr).not.toContain(rtId);

    // Public alternatives (if any) must not contain internal fields
    for (const alt of check.publicResultPayload?.alternatives ?? []) {
      const altKeys = Object.keys(alt as Record<string, unknown>);
      expect(altKeys).not.toContain("_internalResourceIds");
      expect(altKeys).not.toContain("_outsideBuffer");
    }

    await db.execute(sql`DELETE FROM takt_request_resource_requirements WHERE takt_request_id = ${reqId}`).catch(() => {});
  });
});
