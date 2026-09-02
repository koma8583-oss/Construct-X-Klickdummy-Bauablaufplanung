/**
 * AN-local availability booking-capacity regression coverage.
 *
 * These tests call the AN-local Leistungsanfrage service directly rather than
 * the legacy TaktRequest availability service. Concrete bookings consume only
 * their assigned resource; type-level bookings reserve the shared type pool.
 *
 * Fixture prefix: "t362-"
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { anDb } from "@workspace/db";
import {
  anLeistungsanfrageResourceRequirementsTable,
  anLeistungsanfragenTable,
  availabilityChecksTable,
  organizationsTable,
  resourceBookingsTable,
  resourceTypesTable,
  resourcesTable,
} from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { runAnAvailabilityCheck } from "../services/an-leistungsanfrage-service";

const AG_ORG = "t362-ag-org";
const AN_ORG = "t362-an-org";
const RESOURCE_TYPE = "t362-crew-type";
const RESOURCE_A = "t362-crew-a";
const RESOURCE_B = "t362-crew-b";
const WINDOW_START = "2027-06-01";
const WINDOW_END = "2027-06-02";
const RESOURCE_IDS = [RESOURCE_A, RESOURCE_B] as const;

type InternalResult = {
  availableResources: Array<{
    resourceTypeId: string;
    quantity: number;
  }>;
  conflicts: Array<{
    conflictType: string;
    requiredCapacity?: number;
    availableCapacity?: number;
  }>;
  tentativeWarnings: Array<{
    resourceId: string;
    bookingId: string;
  }>;
};

async function seedRequest(requestId: string, requiredCapacity: number) {
  await anDb.insert(anLeistungsanfragenTable).values({
    id: `${requestId}-projection`,
    externalLeistungsanfrageId: requestId,
    externalRequestVersion: 1,
    sourceMessageId: `${requestId}-message`,
    payloadHash: `${requestId}-hash`,
    correlationId: requestId,
    senderAgOrgId: AG_ORG,
    receiverAnOrgId: AN_ORG,
    projectReference: `${requestId}-project`,
    leistungReference: `${requestId}-leistung`,
    plannedStart: WINDOW_START,
    plannedEnd: WINDOW_END,
    policySnapshot: { recipientOrganizationId: AN_ORG },
    payloadSnapshot: {
      requestId,
      plannedStart: WINDOW_START,
      plannedEnd: WINDOW_END,
    },
    status: "DETAILS_RETRIEVED",
  });
  await anDb.insert(anLeistungsanfrageResourceRequirementsTable).values({
    id: `${requestId}-requirement`,
    anLeistungsanfrageId: `${requestId}-projection`,
    externalResourceTypeCode: "CREW",
    externalResourceTypeName: "Crew",
    localResourceTypeId: RESOURCE_TYPE,
    requiredCapacity: requiredCapacity.toString(),
    capacityUnit: "PERSONS",
    utilizationPercent: 100,
    periodStart: WINDOW_START,
    periodEnd: WINDOW_END,
  });
}

async function addBooking(input: {
  id: string;
  resourceId: string | null;
  quantity?: number;
  utilizationPercent?: number;
  status: "CONFIRMED" | "TENTATIVE" | "CANCELLED";
}) {
  await anDb.insert(resourceBookingsTable).values({
    id: input.id,
    nuOrgId: AN_ORG,
    resourceId: input.resourceId,
    resourceTypeId: RESOURCE_TYPE,
    sourceType: "MANUAL_BLOCK",
    sourceReferenceId: input.id,
    startAt: new Date(`${WINDOW_START}T00:00:00Z`),
    endAt: new Date("2027-06-03T00:00:00Z"),
    utilizationPercent: input.utilizationPercent ?? 100,
    quantity: input.quantity,
    status: input.status,
  });
}

async function runCheck(requestId: string): Promise<{
  result: string;
  internal: InternalResult;
}> {
  const check = await runAnAvailabilityCheck(requestId, AN_ORG, null);
  if (!check) throw new Error(`AN-local projection not found for ${requestId}`);
  return {
    result: check.result ?? "UNKNOWN",
    internal: check.internalResultPayload as unknown as InternalResult,
  };
}

async function cleanupRequestRows() {
  await anDb.delete(resourceBookingsTable).where(eq(resourceBookingsTable.nuOrgId, AN_ORG));
  await anDb.delete(availabilityChecksTable).where(eq(availabilityChecksTable.nuOrgId, AN_ORG));
  await anDb.delete(anLeistungsanfrageResourceRequirementsTable).where(
    inArray(
      anLeistungsanfrageResourceRequirementsTable.anLeistungsanfrageId,
      anDb.select({ id: anLeistungsanfragenTable.id })
        .from(anLeistungsanfragenTable)
        .where(eq(anLeistungsanfragenTable.receiverAnOrgId, AN_ORG)),
    ),
  );
  await anDb.delete(anLeistungsanfragenTable).where(eq(anLeistungsanfragenTable.receiverAnOrgId, AN_ORG));
}

beforeAll(async () => {
  // Remove rows from a prior interrupted run before recreating fixed fixtures.
  await cleanupRequestRows();
  await anDb.insert(organizationsTable).values([
    { id: AG_ORG, name: "T362 AG", type: "AG" },
    { id: AN_ORG, name: "T362 AN", type: "AN" },
  ]).onConflictDoNothing();
  await anDb.insert(resourceTypesTable).values({
    id: RESOURCE_TYPE,
    anOrgId: AN_ORG,
    name: "T362 Crew",
    category: "CREW",
    code: "T362-CREW",
    capacityUnit: "PERSONS",
  }).onConflictDoNothing();
  await anDb.insert(resourcesTable).values([
    {
      id: RESOURCE_A,
      anOrgId: AN_ORG,
      resourceTypeId: RESOURCE_TYPE,
      type: "CREW",
      name: "T362 Crew A",
      capacity: 4,
      capacityUnit: "PERSONS",
      active: true,
    },
    {
      id: RESOURCE_B,
      anOrgId: AN_ORG,
      resourceTypeId: RESOURCE_TYPE,
      type: "CREW",
      name: "T362 Crew B",
      capacity: 4,
      capacityUnit: "PERSONS",
      active: true,
    },
  ]).onConflictDoNothing();
});

afterEach(async () => {
  await cleanupRequestRows();
});

afterAll(async () => {
  await cleanupRequestRows();
  await anDb.delete(resourcesTable).where(eq(resourcesTable.anOrgId, AN_ORG));
  await anDb.delete(resourceTypesTable).where(eq(resourceTypesTable.anOrgId, AN_ORG));
  await anDb.delete(organizationsTable).where(inArray(organizationsTable.id, [AG_ORG, AN_ORG]));
});

describe("runAnAvailabilityCheck — booking capacity semantics", () => {
  it("concrete bookings consume only the assigned resource, not its sibling", async () => {
    const requestId = "t362-concrete-sibling";
    await seedRequest(requestId, 4);
    await addBooking({
      id: "t362-concrete-booking",
      resourceId: RESOURCE_A,
      quantity: 4,
      status: "CONFIRMED",
    });

    const check = await runCheck(requestId);

    expect(check.result).toBe("FEASIBLE");
    expect(check.internal.availableResources).toEqual([
      expect.objectContaining({ resourceTypeId: RESOURCE_TYPE, quantity: 4 }),
    ]);
    expect(check.internal.conflicts).toEqual([]);
  });

  it("type-level bookings reserve shared capacity once and apply utilization", async () => {
    const requestId = "t362-type-level";
    await seedRequest(requestId, 6);
    await addBooking({
      id: "t362-type-booking",
      resourceId: null,
      quantity: 4,
      utilizationPercent: 50,
      status: "CONFIRMED",
    });

    const check = await runCheck(requestId);

    // Two resources provide 8 units; the type booking consumes 2 at 50%.
    expect(check.result).toBe("FEASIBLE");
    expect(check.internal.availableResources).toEqual([
      expect.objectContaining({ resourceTypeId: RESOURCE_TYPE, quantity: 6 }),
    ]);
  });

  it("concrete booking utilization reduces only its resource capacity", async () => {
    const requestId = "t362-concrete-utilization";
    await seedRequest(requestId, 6);
    await addBooking({
      id: "t362-half-utilization",
      resourceId: RESOURCE_A,
      quantity: 4,
      utilizationPercent: 50,
      status: "CONFIRMED",
    });

    const check = await runCheck(requestId);

    // Resource A has 2 units left and sibling B has 4.
    expect(check.result).toBe("FEASIBLE");
    expect(check.internal.availableResources).toEqual([
      expect.objectContaining({ resourceTypeId: RESOURCE_TYPE, quantity: 6 }),
    ]);
  });

  it("tentative bookings produce warnings without consuming confirmed capacity", async () => {
    const requestId = "t362-tentative";
    await seedRequest(requestId, 8);
    await addBooking({
      id: "t362-tentative-booking",
      resourceId: RESOURCE_A,
      quantity: 4,
      status: "TENTATIVE",
    });

    const check = await runCheck(requestId);

    expect(check.result).toBe("FEASIBLE");
    expect(check.internal.availableResources).toEqual([
      expect.objectContaining({ resourceTypeId: RESOURCE_TYPE, quantity: 8 }),
    ]);
    expect(check.internal.tentativeWarnings).toEqual([
      expect.objectContaining({
        resourceId: RESOURCE_A,
        bookingId: "t362-tentative-booking",
      }),
    ]);
  });

  it("cancelled bookings do not consume AN-local capacity", async () => {
    const requestId = "t362-cancelled";
    await seedRequest(requestId, 8);
    await addBooking({
      id: "t362-cancelled-booking",
      resourceId: RESOURCE_A,
      quantity: 4,
      status: "CANCELLED",
    });

    const check = await runCheck(requestId);

    expect(check.result).toBe("FEASIBLE");
    expect(check.internal.availableResources).toEqual([
      expect.objectContaining({ resourceTypeId: RESOURCE_TYPE, quantity: 8 }),
    ]);
    expect(check.internal.tentativeWarnings).toEqual([]);
  });
});