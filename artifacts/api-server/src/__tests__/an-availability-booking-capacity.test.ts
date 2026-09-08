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
  anLeistungsantwortenTable,
  availabilityChecksTable,
  organizationsTable,
  resourceBookingsTable,
  resourceTypesTable,
  resourcesTable,
} from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { runAnAvailabilityCheck } from "../services/an-leistungsanfrage-service";
import { evaluateResourceRequirements } from "../services/resource-availability-service";
import {
  AcceptedScheduleCapacityConflictError,
  applyAcceptedAnScheduleChange,
} from "../services/an-schedule-change-booking-service";

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
    bookingIds?: string[];
  }>;
  tentativeWarnings: Array<{
    resourceId: string;
    bookingId: string;
  }>;
  dailyAvailability?: Array<{
    date: string;
    requiredCapacity: number;
    availableCapacity: number;
  }>;
  requirementAvailability?: Array<{
    requirementId?: string;
    requiredCapacity: number;
    availableCapacity: number;
    feasible: boolean;
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

async function seedShiftedScheduleRequest(requestId: string) {
  const targetStart = "2027-06-08";
  const targetEnd = "2027-06-13";
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
    plannedStart: targetStart,
    plannedEnd: targetEnd,
    policySnapshot: { recipientOrganizationId: AN_ORG },
    payloadSnapshot: {
      requestId,
      requestKind: "SCHEDULE_CHANGE",
      sourceRequestId: requestId,
      baseTimeWindow: {
        start: WINDOW_START,
        end: "2027-06-06",
      },
    },
    status: "DETAILS_RETRIEVED",
  });
  await anDb.insert(anLeistungsanfrageResourceRequirementsTable).values([
    {
      id: `${requestId}-requirement-a`,
      anLeistungsanfrageId: `${requestId}-projection`,
      externalResourceTypeCode: "CREW",
      externalResourceTypeName: "Crew",
      localResourceTypeId: RESOURCE_TYPE,
      requiredCapacity: "4",
      capacityUnit: "PERSONS",
      utilizationPercent: 100,
      periodStart: "2027-06-09",
      periodEnd: "2027-06-11",
    },
    {
      id: `${requestId}-requirement-b`,
      anLeistungsanfrageId: `${requestId}-projection`,
      externalResourceTypeCode: "CREW",
      externalResourceTypeName: "Crew",
      localResourceTypeId: RESOURCE_TYPE,
      requiredCapacity: "4",
      capacityUnit: "PERSONS",
      utilizationPercent: 100,
      periodStart: "2027-06-10",
      periodEnd: "2027-06-12",
    },
  ]);
}

async function addBooking(input: {
  id: string;
  resourceId: string | null;
  sourceReferenceId?: string;
  sourceType?: "MANUAL_BLOCK" | "TAKT_REQUEST";
  quantity?: number;
  utilizationPercent?: number;
  status: "CONFIRMED" | "TENTATIVE" | "CANCELLED";
  startAt?: string;
  endAt?: string;
}) {
  await anDb.insert(resourceBookingsTable).values({
    id: input.id,
    nuOrgId: AN_ORG,
    resourceId: input.resourceId,
    resourceTypeId: RESOURCE_TYPE,
    sourceType: input.sourceType ?? "MANUAL_BLOCK",
    sourceReferenceId: input.sourceReferenceId ?? input.id,
    startAt: new Date(input.startAt ?? `${WINDOW_START}T00:00:00Z`),
    endAt: new Date(input.endAt ?? "2027-06-03T00:00:00Z"),
    utilizationPercent: input.utilizationPercent ?? 100,
    quantity: input.quantity,
    status: input.status,
  });
}

async function addRequirement(
  requestId: string,
  requirementId: string,
  requiredCapacity: number,
  periodStart = WINDOW_START,
  periodEnd = WINDOW_END,
  utilizationPercent = 100,
) {
  await anDb.insert(anLeistungsanfrageResourceRequirementsTable).values({
    id: requirementId,
    anLeistungsanfrageId: `${requestId}-projection`,
    externalResourceTypeCode: "CREW",
    externalResourceTypeName: "Crew",
    localResourceTypeId: RESOURCE_TYPE,
    requiredCapacity: requiredCapacity.toString(),
    capacityUnit: "PERSONS",
    utilizationPercent,
    periodStart,
    periodEnd,
  });
}

async function runCheck(requestId: string): Promise<{
  result: string;
  internal: InternalResult;
  public: Record<string, unknown>;
}> {
  const check = await runAnAvailabilityCheck(requestId, AN_ORG, null);
  if (!check) throw new Error(`AN-local projection not found for ${requestId}`);
  return {
    result: check.result ?? "UNKNOWN",
    internal: check.internalResultPayload as unknown as InternalResult,
    public: check.publicResultPayload as unknown as Record<string, unknown>,
  };
}

async function cleanupRequestRows() {
  await anDb.delete(resourceBookingsTable).where(eq(resourceBookingsTable.nuOrgId, AN_ORG));
  await anDb.delete(availabilityChecksTable).where(eq(availabilityChecksTable.nuOrgId, AN_ORG));
  await anDb.delete(anLeistungsantwortenTable).where(
    inArray(
      anLeistungsantwortenTable.anLeistungsanfrageId,
      anDb.select({ id: anLeistungsanfragenTable.id })
        .from(anLeistungsanfragenTable)
        .where(eq(anLeistungsanfragenTable.receiverAnOrgId, AN_ORG)),
    ),
  );
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
  it("rejects a stale feasible alternative before creating an over-capacity booking", async () => {
    const requestId = "t362-stale-alternative";
    await seedRequest(requestId, 8);
    expect((await runCheck(requestId)).result).toBe("FEASIBLE");
    const [beforeAcceptance] = await anDb.select({ status: anLeistungsanfragenTable.status })
      .from(anLeistungsanfragenTable)
      .where(eq(anLeistungsanfragenTable.id, `${requestId}-projection`));

    await addBooking({
      id: "t362-capacity-consumed-after-check",
      resourceId: null,
      quantity: 4,
      status: "CONFIRMED",
    });

    await expect(anDb.transaction((tx) => applyAcceptedAnScheduleChange(tx, {
      projectionId: `${requestId}-projection`,
      targetStart: new Date(`${WINDOW_START}T00:00:00Z`),
      targetEnd: new Date("2027-06-03T00:00:00Z"),
      note: "accept stale alternative",
    }))).rejects.toBeInstanceOf(AcceptedScheduleCapacityConflictError);

    const bookings = await anDb.select().from(resourceBookingsTable)
      .where(eq(resourceBookingsTable.nuOrgId, AN_ORG));
    expect(bookings).toHaveLength(1);
    expect(bookings[0]?.id).toBe("t362-capacity-consumed-after-check");
    const [projection] = await anDb.select({ status: anLeistungsanfragenTable.status })
      .from(anLeistungsanfragenTable)
      .where(eq(anLeistungsanfragenTable.id, `${requestId}-projection`));
    expect(projection?.status).toBe(beforeAcceptance?.status);
  });

  it("allows only one concurrent acceptance to consume the shared pool", async () => {
    const firstRequestId = "t362-concurrent-first";
    const secondRequestId = "t362-concurrent-second";
    await seedRequest(firstRequestId, 6);
    await seedRequest(secondRequestId, 6);

    const accept = (requestId: string) => anDb.transaction((tx) =>
      applyAcceptedAnScheduleChange(tx, {
        projectionId: `${requestId}-projection`,
        targetStart: new Date(`${WINDOW_START}T00:00:00Z`),
        targetEnd: new Date("2027-06-03T00:00:00Z"),
        note: "concurrent acceptance",
      }),
    );
    const results = await Promise.allSettled([
      accept(firstRequestId),
      accept(secondRequestId),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected");
    expect(rejected).toMatchObject({
      status: "rejected",
      reason: expect.any(AcceptedScheduleCapacityConflictError),
    });
    const bookings = await anDb.select().from(resourceBookingsTable)
      .where(eq(resourceBookingsTable.nuOrgId, AN_ORG));
    expect(bookings).toHaveLength(1);
    expect(bookings[0]?.quantity).toBe("6.00");
  });

  it("preserves and counts a manual booking whose source reference matches the projection", async () => {
    const requestId = "t362-manual-reference-collision";
    await seedRequest(requestId, 8);
    await addBooking({
      id: "t362-manual-reference-collision-booking",
      resourceId: null,
      sourceReferenceId: `${requestId}-projection`,
      sourceType: "MANUAL_BLOCK",
      quantity: 4,
      status: "CONFIRMED",
    });

    await expect(anDb.transaction((tx) => applyAcceptedAnScheduleChange(tx, {
      projectionId: `${requestId}-projection`,
      targetStart: new Date(`${WINDOW_START}T00:00:00Z`),
      targetEnd: new Date("2027-06-03T00:00:00Z"),
      note: "accept with colliding manual source reference",
    }))).rejects.toBeInstanceOf(AcceptedScheduleCapacityConflictError);

    const bookings = await anDb.select().from(resourceBookingsTable)
      .where(eq(resourceBookingsTable.nuOrgId, AN_ORG));
    expect(bookings).toHaveLength(1);
    expect(bookings[0]).toMatchObject({
      id: "t362-manual-reference-collision-booking",
      sourceType: "MANUAL_BLOCK",
      sourceReferenceId: `${requestId}-projection`,
      status: "CONFIRMED",
    });
  });

  it("rejects an infeasible shifted overlap before replacing any bookings", async () => {
    const requestId = "t362-shifted-overlap-conflict";
    await seedShiftedScheduleRequest(requestId);
    await addBooking({
      id: "t362-shifted-overlap-block",
      resourceId: RESOURCE_A,
      sourceType: "MANUAL_BLOCK",
      startAt: "2027-06-10T00:00:00Z",
      endAt: "2027-06-11T00:00:00Z",
      status: "CONFIRMED",
    });

    await expect(anDb.transaction((tx) => applyAcceptedAnScheduleChange(tx, {
      projectionId: `${requestId}-projection`,
      targetStart: new Date("2027-06-08T00:00:00Z"),
      targetEnd: new Date("2027-06-13T00:00:00Z"),
      note: "reject shifted overlap",
      useRequirementPeriods: true,
    }))).rejects.toBeInstanceOf(AcceptedScheduleCapacityConflictError);

    const bookings = await anDb.select().from(resourceBookingsTable)
      .where(eq(resourceBookingsTable.nuOrgId, AN_ORG));
    expect(bookings).toHaveLength(1);
    expect(bookings[0]?.id).toBe("t362-shifted-overlap-block");
  });

  it("recreates concrete bookings on the shifted requirement sub-periods", async () => {
    const requestId = "t362-shifted-overlap-recreation";
    await seedShiftedScheduleRequest(requestId);
    await addBooking({
      id: "t362-shifted-concrete-a",
      resourceId: RESOURCE_A,
      sourceType: "TAKT_REQUEST",
      sourceReferenceId: `${requestId}-projection`,
      startAt: "2027-06-02T00:00:00Z",
      endAt: "2027-06-05T00:00:00Z",
      status: "CONFIRMED",
    });
    await addBooking({
      id: "t362-shifted-concrete-b",
      resourceId: RESOURCE_B,
      sourceType: "TAKT_REQUEST",
      sourceReferenceId: `${requestId}-projection`,
      startAt: "2027-06-03T00:00:00Z",
      endAt: "2027-06-06T00:00:00Z",
      status: "CONFIRMED",
    });

    await anDb.transaction((tx) => applyAcceptedAnScheduleChange(tx, {
      projectionId: `${requestId}-projection`,
      targetStart: new Date("2027-06-08T00:00:00Z"),
      targetEnd: new Date("2027-06-13T00:00:00Z"),
      note: "recreate shifted requirements",
      useRequirementPeriods: true,
    }));

    const bookings = await anDb.select().from(resourceBookingsTable)
      .where(eq(resourceBookingsTable.nuOrgId, AN_ORG));
    expect(bookings).toHaveLength(2);
    expect(bookings.map((booking) => [
      booking.resourceId,
      booking.startAt.toISOString(),
      booking.endAt.toISOString(),
    ]).sort()).toEqual([
      [RESOURCE_A, "2027-06-09T00:00:00.000Z", "2027-06-12T00:00:00.000Z"],
      [RESOURCE_B, "2027-06-10T00:00:00.000Z", "2027-06-13T00:00:00.000Z"],
    ]);
  });

  it("does not reuse one shared resource across competing qualifications", () => {
    const result = evaluateResourceRequirements({
      requirements: [
        {
          id: "qualification-a-demand",
          resourceTypeId: "qualification-shared-type",
          requiredCapacity: 5,
          utilizationPercent: 100,
          requiredQualification: "A",
          periodStart: WINDOW_START,
          periodEnd: WINDOW_END,
        },
        {
          id: "qualification-b-demand",
          resourceTypeId: "qualification-shared-type",
          requiredCapacity: 5,
          utilizationPercent: 100,
          requiredQualification: "B",
          periodStart: WINDOW_START,
          periodEnd: WINDOW_END,
        },
      ],
      resources: [{
        id: "qualification-shared-resource",
        resourceTypeId: "qualification-shared-type",
        type: "CREW",
        name: "Shared qualified crew",
        capacity: 8,
        qualifications: ["A", "B"],
      }],
      bookings: [],
      windowStart: new Date(`${WINDOW_START}T00:00:00Z`),
      windowEnd: new Date("2027-06-03T00:00:00Z"),
    });

    expect(result.conflicts).toEqual([
      expect.objectContaining({ conflictType: "CAPACITY_EXCEEDED" }),
    ]);
  });

  it("allocates mixed qualified resources without double-consuming the overlap", () => {
    const resources = [
      { id: "only-a", resourceTypeId: "mixed-type", type: "CREW", name: "A", capacity: 4, qualifications: ["A"] },
      { id: "both", resourceTypeId: "mixed-type", type: "CREW", name: "A+B", capacity: 4, qualifications: ["A", "B"] },
      { id: "only-b", resourceTypeId: "mixed-type", type: "CREW", name: "B", capacity: 4, qualifications: ["B"] },
    ];
    const base = {
      resourceTypeId: "mixed-type",
      utilizationPercent: 100,
      periodStart: WINDOW_START,
      periodEnd: WINDOW_END,
    };
    const feasible = evaluateResourceRequirements({
      requirements: [
        { ...base, id: "mixed-a-feasible", requiredCapacity: 4, requiredQualification: "A" },
        { ...base, id: "mixed-b-feasible", requiredCapacity: 4, requiredQualification: "B" },
      ],
      resources,
      bookings: [],
      windowStart: new Date(`${WINDOW_START}T00:00:00Z`),
      windowEnd: new Date("2027-06-03T00:00:00Z"),
    });
    const infeasible = evaluateResourceRequirements({
      requirements: [
        { ...base, id: "mixed-a-infeasible", requiredCapacity: 8, requiredQualification: "A" },
        { ...base, id: "mixed-b-infeasible", requiredCapacity: 8, requiredQualification: "B" },
      ],
      resources,
      bookings: [],
      windowStart: new Date(`${WINDOW_START}T00:00:00Z`),
      windowEnd: new Date("2027-06-03T00:00:00Z"),
    });

    expect(feasible.conflicts).toEqual([]);
    expect(infeasible.conflicts).toEqual([
      expect.objectContaining({ conflictType: "CAPACITY_EXCEEDED" }),
    ]);
  });

  it.each([
    ["null qualification metadata", null],
    ["missing qualification metadata", undefined],
    ["empty qualification metadata", []],
    ["different qualification metadata", ["OTHER"]],
  ])("fails closed for %s when a qualification is required", (_label, qualifications) => {
    const result = evaluateResourceRequirements({
      requirements: [{
        id: "qualification-required",
        resourceTypeId: "qualification-required-type",
        requiredCapacity: 1,
        utilizationPercent: 100,
        requiredQualification: "SCC",
        periodStart: WINDOW_START,
        periodEnd: WINDOW_END,
      }],
      resources: [{
        id: "qualification-unproven-resource",
        resourceTypeId: "qualification-required-type",
        type: "CREW",
        name: "Unproven crew",
        capacity: 4,
        qualifications,
      }],
      bookings: [],
      windowStart: new Date(`${WINDOW_START}T00:00:00Z`),
      windowEnd: new Date("2027-06-03T00:00:00Z"),
    });

    expect(result.conflicts).toEqual([
      expect.objectContaining({
        conflictType: "MISSING_QUALIFICATION",
        missingQualification: "SCC",
      }),
    ]);
    expect(result.missingQualifications).toEqual(["SCC"]);
  });

  it("does not let unproven resources make a qualified mixed pool feasible", () => {
    const result = evaluateResourceRequirements({
      requirements: [{
        id: "mixed-qualified-demand",
        resourceTypeId: "mixed-qualification-type",
        requiredCapacity: 7,
        utilizationPercent: 100,
        requiredQualification: "SCC",
        periodStart: WINDOW_START,
        periodEnd: WINDOW_END,
      }],
      resources: [
        {
          id: "mixed-unproven-resource",
          resourceTypeId: "mixed-qualification-type",
          type: "CREW",
          name: "Unproven crew",
          capacity: 4,
          qualifications: null,
        },
        {
          id: "mixed-other-qualified-resource",
          resourceTypeId: "mixed-qualification-type",
          type: "CREW",
          name: "Other qualified crew",
          capacity: 4,
          qualifications: ["OTHER"],
        },
      ],
      bookings: [],
      windowStart: new Date(`${WINDOW_START}T00:00:00Z`),
      windowEnd: new Date("2027-06-03T00:00:00Z"),
    });

    expect(result.conflicts).toEqual([
      expect.objectContaining({
        conflictType: "MISSING_QUALIFICATION",
        missingQualification: "SCC",
      }),
    ]);
    expect(result.bookingRequirements).toHaveLength(0);
  });

  it("keeps resources without qualification requirements usable", () => {
    const result = evaluateResourceRequirements({
      requirements: [{
        id: "qualification-optional",
        resourceTypeId: "qualification-optional-type",
        requiredCapacity: 4,
        utilizationPercent: 100,
        requiredQualification: null,
        periodStart: WINDOW_START,
        periodEnd: WINDOW_END,
      }],
      resources: [{
        id: "qualification-optional-resource",
        resourceTypeId: "qualification-optional-type",
        type: "CREW",
        name: "Unqualified but usable crew",
        capacity: 4,
        qualifications: null,
      }],
      bookings: [],
      windowStart: new Date(`${WINDOW_START}T00:00:00Z`),
      windowEnd: new Date("2027-06-03T00:00:00Z"),
    });

    expect(result.conflicts).toEqual([]);
    expect(result.bookingRequirements).toEqual([
      expect.objectContaining({
        resourceTypeId: "qualification-optional-type",
        requiredQualification: null,
      }),
    ]);
  });

  it("uses the peak demand in a partial overlap and records the segment accounting", () => {
    const result = evaluateResourceRequirements({
      requirements: [
        {
          id: "partial-overlap-a",
          resourceTypeId: "partial-overlap-type",
          requiredCapacity: 6,
          utilizationPercent: 100,
          requiredQualification: null,
          periodStart: "2027-06-01",
          periodEnd: "2027-06-02",
        },
        {
          id: "partial-overlap-b",
          resourceTypeId: "partial-overlap-type",
          requiredCapacity: 3,
          utilizationPercent: 100,
          requiredQualification: null,
          periodStart: "2027-06-02",
          periodEnd: "2027-06-03",
        },
      ],
      resources: [
        { id: "partial-overlap-a-resource", resourceTypeId: "partial-overlap-type", type: "CREW", name: "A", capacity: 4, qualifications: null },
        { id: "partial-overlap-b-resource", resourceTypeId: "partial-overlap-type", type: "CREW", name: "B", capacity: 4, qualifications: null },
      ],
      bookings: [],
      windowStart: new Date("2027-06-01T00:00:00Z"),
      windowEnd: new Date("2027-06-04T00:00:00Z"),
    });

    expect(result.conflicts).toEqual([
      expect.objectContaining({ conflictType: "CAPACITY_EXCEEDED" }),
    ]);
    expect(result.dailyAvailability).toEqual([
      expect.objectContaining({ date: "2027-06-01", requiredCapacity: 6, availableCapacity: 8 }),
      expect.objectContaining({ date: "2027-06-02", requiredCapacity: 9, availableCapacity: 8 }),
      expect.objectContaining({ date: "2027-06-03", requiredCapacity: 3, availableCapacity: 8 }),
    ]);
    expect(result.requirementAvailability).toEqual(expect.arrayContaining([
      expect.objectContaining({
        requirementId: "partial-overlap-a",
        requiredCapacity: 6,
        availableCapacity: 5,
        feasible: false,
      }),
      expect.objectContaining({
        requirementId: "partial-overlap-b",
        requiredCapacity: 3,
        availableCapacity: 2,
        feasible: false,
      }),
    ]));
  });

  it("does not sum requirements that occupy sequential periods", () => {
    const result = evaluateResourceRequirements({
      requirements: [
        {
          id: "sequential-a",
          resourceTypeId: "sequential-type",
          requiredCapacity: 8,
          utilizationPercent: 100,
          requiredQualification: null,
          periodStart: "2027-06-01",
          periodEnd: "2027-06-01",
        },
        {
          id: "sequential-b",
          resourceTypeId: "sequential-type",
          requiredCapacity: 8,
          utilizationPercent: 100,
          requiredQualification: null,
          periodStart: "2027-06-02",
          periodEnd: "2027-06-02",
        },
      ],
      resources: [
        { id: "sequential-a-resource", resourceTypeId: "sequential-type", type: "CREW", name: "A", capacity: 4, qualifications: null },
        { id: "sequential-b-resource", resourceTypeId: "sequential-type", type: "CREW", name: "B", capacity: 4, qualifications: null },
      ],
      bookings: [],
      windowStart: new Date("2027-06-01T00:00:00Z"),
      windowEnd: new Date("2027-06-03T00:00:00Z"),
    });

    expect(result.conflicts).toEqual([]);
    expect(result.dailyAvailability).toEqual([
      expect.objectContaining({ date: "2027-06-01", requiredCapacity: 8 }),
      expect.objectContaining({ date: "2027-06-02", requiredCapacity: 8 }),
    ]);
  });

  it("accumulates simultaneous requirements of the same resource type", async () => {
    const requestId = "t362-simultaneous-requirements";
    await seedRequest(requestId, 5);
    await addRequirement(requestId, `${requestId}-second`, 5);

    const check = await runCheck(requestId);

    expect(check.result).not.toBe("FEASIBLE");
    expect(check.internal.conflicts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        conflictType: "CAPACITY_EXCEEDED",
        requiredCapacity: 5,
        availableCapacity: 3,
      }),
    ]));
    expect(check.internal.dailyAvailability).toEqual(expect.arrayContaining([
      expect.objectContaining({ requiredCapacity: 10, availableCapacity: 8 }),
    ]));
  });

  it("explains capacity conflicts with overlapping concrete and type-level reservation IDs", async () => {
    const requestId = "t362-conflict-provenance";
    await seedRequest(requestId, 8);
    await addBooking({
      id: "t362-conflict-concrete",
      resourceId: RESOURCE_A,
      quantity: 4,
      status: "CONFIRMED",
    });
    await addBooking({
      id: "t362-conflict-type",
      resourceId: null,
      quantity: 2,
      utilizationPercent: 100,
      status: "CONFIRMED",
    });

    const check = await runCheck(requestId);

    expect(check.result).toBe("FEASIBLE_WITH_ALTERNATIVES");
    expect(check.internal.conflicts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        conflictType: "CAPACITY_EXCEEDED",
        bookingIds: ["t362-conflict-concrete", "t362-conflict-type"],
      }),
    ]));
    expect(JSON.stringify(check.public)).not.toContain("t362-conflict-concrete");
    expect(JSON.stringify(check.public)).not.toContain("t362-conflict-type");
  });

  it("uses the peak segment instead of summing bookings that never overlap", async () => {
    const requestId = "t362-sequential-bookings";
    await seedRequest(requestId, 4);
    await addBooking({
      id: "t362-morning-booking",
      resourceId: null,
      quantity: 4,
      status: "CONFIRMED",
      startAt: "2027-06-01T00:00:00Z",
      endAt: "2027-06-01T12:00:00Z",
    });
    await addBooking({
      id: "t362-afternoon-booking",
      resourceId: null,
      quantity: 4,
      status: "CONFIRMED",
      startAt: "2027-06-01T12:00:00Z",
      endAt: "2027-06-02T00:00:00Z",
    });

    const check = await runCheck(requestId);

    expect(check.result).toBe("FEASIBLE");
    expect(check.internal.availableResources).toEqual([
      expect.objectContaining({ resourceTypeId: RESOURCE_TYPE, quantity: 4 }),
    ]);
  });

  it("evaluates mixed concrete and type reservations in their shared peak segment", async () => {
    const requestId = "t362-mixed-peak";
    await seedRequest(requestId, 3);
    await addBooking({
      id: "t362-mixed-concrete",
      resourceId: RESOURCE_A,
      quantity: 4,
      status: "CONFIRMED",
      startAt: "2027-06-01T00:00:00Z",
      endAt: "2027-06-01T12:00:00Z",
    });
    await addBooking({
      id: "t362-mixed-type",
      resourceId: null,
      quantity: 2,
      utilizationPercent: 50,
      status: "CONFIRMED",
      startAt: "2027-06-01T06:00:00Z",
      endAt: "2027-06-01T18:00:00Z",
    });

    const check = await runCheck(requestId);

    // A is fully occupied and the type reservation consumes one of B's four units.
    expect(check.result).toBe("FEASIBLE");
    expect(check.internal.availableResources).toEqual([
      expect.objectContaining({ resourceTypeId: RESOURCE_TYPE, quantity: 3 }),
    ]);
  });

  it("honors requirement utilization while evaluating concurrent demand", async () => {
    const requestId = "t362-requirement-utilization";
    await seedRequest(requestId, 4);
    await addRequirement(requestId, `${requestId}-half`, 8, WINDOW_START, WINDOW_END, 50);

    const check = await runCheck(requestId);

    expect(check.result).toBe("FEASIBLE");
    expect(check.internal.availableResources).toEqual([
      expect.objectContaining({ resourceTypeId: RESOURCE_TYPE, quantity: 4 }),
      expect.objectContaining({ resourceTypeId: RESOURCE_TYPE, quantity: 4 }),
    ]);
  });

  it("does not let boundary-touching reservations consume a segment", async () => {
    const requestId = "t362-boundary-touching";
    await seedRequest(requestId, 8);
    await addBooking({
      id: "t362-before-window",
      resourceId: null,
      quantity: 8,
      status: "CONFIRMED",
      startAt: "2027-05-31T00:00:00Z",
      endAt: "2027-06-01T00:00:00Z",
    });

    const check = await runCheck(requestId);

    expect(check.result).toBe("FEASIBLE");
    expect(check.internal.availableResources).toEqual([
      expect.objectContaining({ resourceTypeId: RESOURCE_TYPE, quantity: 8 }),
    ]);
  });

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

  it("sums multiple overlapping type-level reservations against the shared pool", async () => {
    const requestId = "t362-multiple-type-level";
    await seedRequest(requestId, 5);
    await addBooking({
      id: "t362-type-booking-a",
      resourceId: null,
      quantity: 1,
      status: "CONFIRMED",
    });
    await addBooking({
      id: "t362-type-booking-b",
      resourceId: null,
      quantity: 2,
      status: "CONFIRMED",
    });

    const check = await runCheck(requestId);

    // Two resources provide 8 units; both shared reservations consume 3.
    expect(check.result).toBe("FEASIBLE");
    expect(check.internal.availableResources).toEqual([
      expect.objectContaining({ resourceTypeId: RESOURCE_TYPE, quantity: 5 }),
    ]);
    expect(check.internal.conflicts).toEqual([]);
  });

  it("subtracts overlapping concrete and type-level reservations from residual capacity", async () => {
    const requestId = "t362-concrete-and-type-level";
    await seedRequest(requestId, 2);
    await addBooking({
      id: "t362-concrete-full",
      resourceId: RESOURCE_A,
      quantity: 4,
      status: "CONFIRMED",
    });
    await addBooking({
      id: "t362-type-overlap",
      resourceId: null,
      quantity: 2,
      status: "CONFIRMED",
    });

    const check = await runCheck(requestId);

    // Resource A is full; the shared reservation leaves two units on B.
    expect(check.result).toBe("FEASIBLE");
    expect(check.internal.availableResources).toEqual([
      expect.objectContaining({ resourceTypeId: RESOURCE_TYPE, quantity: 2 }),
    ]);
    expect(check.internal.conflicts).toEqual([]);
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

  it("emits one warning per overlapping tentative booking even across requirements", async () => {
    const requestId = "t362-multiple-tentative";
    await seedRequest(requestId, 7);
    await addRequirement(requestId, `${requestId}-second-requirement`, 1);
    await addBooking({
      id: "t362-tentative-concrete",
      resourceId: RESOURCE_A,
      quantity: 4,
      status: "TENTATIVE",
    });
    await addBooking({
      id: "t362-tentative-type",
      resourceId: null,
      quantity: 2,
      status: "TENTATIVE",
    });

    const check = await runCheck(requestId);

    expect(check.result).toBe("FEASIBLE");
    expect(check.internal.tentativeWarnings).toHaveLength(2);
    expect(check.internal.tentativeWarnings.map((warning) => warning.bookingId)).toEqual([
      "t362-tentative-concrete",
      "t362-tentative-type",
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

  it("excludes cancelled reservations while counting overlapping active reservations", async () => {
    const requestId = "t362-cancelled-with-active";
    await seedRequest(requestId, 6);
    await addBooking({
      id: "t362-cancelled-type",
      resourceId: null,
      quantity: 4,
      status: "CANCELLED",
    });
    await addBooking({
      id: "t362-active-type",
      resourceId: null,
      quantity: 2,
      status: "CONFIRMED",
    });

    const check = await runCheck(requestId);

    // Only the active reservation consumes the shared 8-unit pool.
    expect(check.result).toBe("FEASIBLE");
    expect(check.internal.availableResources).toEqual([
      expect.objectContaining({ resourceTypeId: RESOURCE_TYPE, quantity: 6 }),
    ]);
    expect(check.internal.tentativeWarnings).toEqual([]);
  });
});
