/**
 * AG decisions may publish public coordination facts, but only the AN inbound
 * may change AN-local projections and resource bookings.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray, or } from "drizzle-orm";
import {
  anDb as db,
  hubDb,
  anLeistungsanfrageResourceRequirementsTable,
  anLeistungsanfragenTable,
  anLeistungsantwortenTable,
  dataspaceExchangesTable,
  messageOutboxTable,
  organizationsTable,
  resourceBookingsTable,
  resourceTypesTable,
  resourcesTable,
} from "@workspace/db";
import {
  externalCoordinationDecisionSchema,
  type ExternalCoordinationDecision,
} from "../services/dataspace/external-contracts";
import { handleIncomingCoordinationDecision } from "../services/dataspace/inbound-exchange-service";
import { processIncomingCoordinationDecision } from "../services/dataspace/inbound-domain-service";
import { createAnServiceResponse } from "../services/nu-response-service";
import { AcceptedScheduleCapacityConflictError } from "../services/an-schedule-change-booking-service";

const PREFIX = "an-decision-inbound";
const AG = `${PREFIX}-ag`;
const AN = `${PREFIX}-an`;
const TYPE = `${PREFIX}-type`;
const RESOURCE = `${PREFIX}-resource`;
const SHIFTED_WINDOW = {
  start: "2026-10-15T08:00:00.000Z",
  end: "2026-10-22T17:00:00.000Z",
};

type RequirementFixture = {
  requiredCapacity?: number;
  utilizationPercent?: number;
  periodStart?: string;
  periodEnd?: string;
};

function shiftedFixture(yearMonth: string) {
  return {
    baseWindow: {
      start: `${yearMonth}-01T08:00:00.000Z`,
      end: `${yearMonth}-07T17:00:00.000Z`,
    },
    targetWindow: {
      start: `${yearMonth}-15T08:00:00.000Z`,
      end: `${yearMonth}-22T17:00:00.000Z`,
    },
    requirements: [
      { requiredCapacity: 4, periodStart: `${yearMonth}-16`, periodEnd: `${yearMonth}-18` },
      { requiredCapacity: 4, periodStart: `${yearMonth}-17`, periodEnd: `${yearMonth}-19` },
    ],
    oldBookings: [
      { start: `${yearMonth}-02T00:00:00.000Z`, end: `${yearMonth}-05T00:00:00.000Z` },
      { start: `${yearMonth}-03T00:00:00.000Z`, end: `${yearMonth}-06T00:00:00.000Z` },
    ],
  };
}

function decision(
  messageId: string,
  requestId: string,
  decisionType: ExternalCoordinationDecision["decisionType"],
  confirmedTimeWindow?: { start: string; end: string },
): ExternalCoordinationDecision {
  const accepted =
    decisionType === "CONFIRM_ACCEPTED" || decisionType === "ACCEPT_ALTERNATIVE";
  const targetWindow = confirmedTimeWindow ?? {
    start: decisionType === "ACCEPT_ALTERNATIVE"
      ? SHIFTED_WINDOW.start
      : "2026-10-01T08:00:00.000Z",
    end: decisionType === "ACCEPT_ALTERNATIVE"
      ? SHIFTED_WINDOW.end
      : "2026-10-07T17:00:00.000Z",
  };
  return {
    metadata: {
      messageId,
      correlationId: requestId,
      schemaVersion: "1.0",
      senderOrgId: AG,
      receiverOrgId: AN,
      createdAt: "2026-10-01T10:00:00.000Z",
    },
    requestId,
    requestVersion: 1,
    taktVersion: 1,
    decisionType,
    ...(accepted
      ? {
          confirmedTimeWindow: targetWindow,
        }
      : {}),
    ...(decisionType === "ACCEPT_ALTERNATIVE" ? { acceptedAlternativeId: "public-alt-1" } : {}),
    ...(decisionType === "CLOSE_WITHOUT_AGREEMENT" ? { closedAt: "2026-10-02T10:00:00.000Z" } : {}),
  };
}

async function createProjection(
  name: string,
  payloadSnapshot: Record<string, unknown> = {},
  requirements: RequirementFixture[] = [{}],
  status: "RECEIVED" | "UNDER_REVIEW" | "RESPONDED" = "RESPONDED",
) {
  const requestId = `${PREFIX}-${name}`;
  const [projection] = await db.insert(anLeistungsanfragenTable).values({
    externalLeistungsanfrageId: requestId,
    externalRequestVersion: 1,
    sourceMessageId: `${requestId}-request-message`,
    payloadHash: `${requestId}-hash`,
    correlationId: requestId,
    senderAgOrgId: AG,
    receiverAnOrgId: AN,
    projectReference: `${PREFIX}-project`,
    leistungReference: `${PREFIX}-leistung`,
    plannedStart: "2026-10-01",
    plannedEnd: "2026-10-07",
    payloadSnapshot,
    status,
  }).returning();
  await db.insert(anLeistungsanfrageResourceRequirementsTable).values(
    requirements.map((requirement, index) => ({
      id: `${requestId}-requirement-${index + 1}`,
      anLeistungsanfrageId: projection.id,
      externalResourceTypeCode: "WORKER",
      externalResourceTypeName: "Worker",
      localResourceTypeId: TYPE,
      requiredCapacity: String(requirement.requiredCapacity ?? 2),
      capacityUnit: "PERSONS",
      utilizationPercent: requirement.utilizationPercent ?? 100,
      periodStart: requirement.periodStart ?? "2026-10-01",
      periodEnd: requirement.periodEnd ?? "2026-10-07",
    })),
  );
  return { projection, requestId };
}

async function createShiftedProjection(
  name: string,
  yearMonth: string,
  status: "RECEIVED" | "UNDER_REVIEW" | "RESPONDED" = "RESPONDED",
) {
  const requestId = `${PREFIX}-${name}`;
  const fixture = shiftedFixture(yearMonth);
  return createProjection(
    name,
    {
      requestKind: "SCHEDULE_CHANGE",
      sourceRequestId: `${requestId}-root`,
      baseTimeWindow: fixture.baseWindow,
    },
    fixture.requirements,
    status,
  ).then((created) => ({ ...created, fixture }));
}

async function seedBooking(projectionId: string) {
  await db.insert(resourceBookingsTable).values({
    nuOrgId: AN,
    resourceTypeId: TYPE,
    quantity: 2,
    sourceType: "TAKT_REQUEST",
    sourceReferenceId: projectionId,
    startAt: new Date("2026-10-01T08:00:00.000Z"),
    endAt: new Date("2026-10-07T17:00:00.000Z"),
    utilizationPercent: 100,
    status: "CONFIRMED",
  });
}

async function seedShiftedChainBookings(
  projectionId: string,
  fixture: ReturnType<typeof shiftedFixture>,
) {
  await db.insert(resourceBookingsTable).values([
    {
      id: `${projectionId}-old-a`,
      nuOrgId: AN,
      resourceTypeId: TYPE,
      quantity: 4,
      sourceType: "TAKT_REQUEST",
      sourceReferenceId: projectionId,
      startAt: new Date(fixture.oldBookings[0].start),
      endAt: new Date(fixture.oldBookings[0].end),
      utilizationPercent: 100,
      status: "CONFIRMED",
    },
    {
      id: `${projectionId}-old-b`,
      nuOrgId: AN,
      resourceTypeId: TYPE,
      quantity: 4,
      sourceType: "TAKT_REQUEST",
      sourceReferenceId: projectionId,
      startAt: new Date(fixture.oldBookings[1].start),
      endAt: new Date(fixture.oldBookings[1].end),
      utilizationPercent: 100,
      status: "CONFIRMED",
    },
  ]);
}

async function seedTargetConflict(
  id: string,
  fixture: ReturnType<typeof shiftedFixture>,
) {
  await db.insert(resourceBookingsTable).values({
    id,
    nuOrgId: AN,
    resourceId: RESOURCE,
    resourceTypeId: TYPE,
    sourceType: "MANUAL_BLOCK",
    sourceReferenceId: id,
    startAt: new Date(`${fixture.requirements[1].periodStart}T00:00:00.000Z`),
    endAt: new Date(`${fixture.requirements[1].periodEnd}T00:00:00.000Z`),
    utilizationPercent: 100,
    status: "CONFIRMED",
  });
}

async function cleanup() {
  await db.delete(resourceBookingsTable).where(eq(resourceBookingsTable.nuOrgId, AN)).catch(() => {});
  await hubDb.delete(messageOutboxTable).where(or(
    eq(messageOutboxTable.senderOrgId, AG),
    eq(messageOutboxTable.senderOrgId, AN),
    eq(messageOutboxTable.recipientOrgId, AG),
    eq(messageOutboxTable.recipientOrgId, AN),
  )).catch(() => {});
  await hubDb.delete(dataspaceExchangesTable).where(or(
    eq(dataspaceExchangesTable.senderOrgId, AG),
    eq(dataspaceExchangesTable.receiverOrgId, AN),
  )).catch(() => {});
  await db.delete(anLeistungsanfragenTable).where(eq(anLeistungsanfragenTable.receiverAnOrgId, AN)).catch(() => {});
  await db.delete(resourcesTable).where(eq(resourcesTable.anOrgId, AN)).catch(() => {});
  await db.delete(resourceTypesTable).where(eq(resourceTypesTable.anOrgId, AN)).catch(() => {});
  await db.delete(organizationsTable).where(inArray(organizationsTable.id, [AG, AN])).catch(() => {});
}

beforeAll(async () => {
  await cleanup();
  await db.insert(organizationsTable).values([
    { id: AG, name: "Decision test AG", type: "AG" },
    { id: AN, name: "Decision test AN", type: "AN" },
  ]);
  await db.insert(resourceTypesTable).values({
    id: TYPE,
    anOrgId: AN,
    name: "Local workers",
    category: "PERSONNEL",
    active: true,
  });
  await db.insert(resourcesTable).values({
    id: RESOURCE,
    anOrgId: AN,
    resourceTypeId: TYPE,
    type: "CREW",
    name: "Local worker pool",
    capacity: 8,
    capacityUnit: "PERSONS",
    active: true,
  });
});

afterAll(cleanup);

describe("AN-local coordination-decision inbound", () => {
  it("confirms a booking only after the decision has crossed the AN inbound boundary", async () => {
    const { projection, requestId } = await createProjection("confirm");
    const payload = decision(`${requestId}-decision`, requestId, "CONFIRM_ACCEPTED");

    const before = await db.select().from(resourceBookingsTable).where(and(
      eq(resourceBookingsTable.nuOrgId, AN),
      eq(resourceBookingsTable.sourceReferenceId, projection.id),
    ));
    expect(before).toHaveLength(0);

    const first = await handleIncomingCoordinationDecision(payload, processIncomingCoordinationDecision);
    expect(first).toEqual({ duplicate: false, status: "PROCESSED" });
    const repeated = await handleIncomingCoordinationDecision(payload, processIncomingCoordinationDecision);
    expect(repeated).toEqual({ duplicate: true, status: "DUPLICATE" });

    const [updated] = await db.select({ status: anLeistungsanfragenTable.status })
      .from(anLeistungsanfragenTable).where(eq(anLeistungsanfragenTable.id, projection.id));
    expect(updated.status).toBe("CONFIRMED");
    const bookings = await db.select().from(resourceBookingsTable).where(and(
      eq(resourceBookingsTable.nuOrgId, AN),
      eq(resourceBookingsTable.sourceReferenceId, projection.id),
    ));
    expect(bookings).toHaveLength(1);
    expect(bookings[0]).toMatchObject({
      sourceReferenceId: projection.id,
      resourceTypeId: TYPE,
      quantity: "2.00",
      status: "CONFIRMED",
    });
  });

  it("applies an accepted alternative only in the AN context", async () => {
    const { projection, requestId } = await createProjection("alternative");
    await handleIncomingCoordinationDecision(
      decision(`${requestId}-decision`, requestId, "ACCEPT_ALTERNATIVE"),
      processIncomingCoordinationDecision,
    );
    const [booking] = await db.select().from(resourceBookingsTable).where(and(
      eq(resourceBookingsTable.nuOrgId, AN),
      eq(resourceBookingsTable.sourceReferenceId, projection.id),
    ));
    expect(booking.status).toBe("CONFIRMED");
    expect(booking.startAt.toISOString()).toBe("2026-10-15T08:00:00.000Z");
    expect(booking.endAt.toISOString()).toBe("2026-10-22T17:00:00.000Z");
  });

  it("preserves partially overlapping shifted requirement periods after an inbound AG acceptance", async () => {
    const { projection, requestId, fixture } = await createShiftedProjection(
      "shifted-inbound-success",
      "2027-06",
    );
    await seedShiftedChainBookings(projection.id, fixture);

    const result = await handleIncomingCoordinationDecision(
      decision(`${requestId}-decision`, requestId, "CONFIRM_ACCEPTED", fixture.targetWindow),
      processIncomingCoordinationDecision,
    );
    expect(result).toEqual({ duplicate: false, status: "PROCESSED" });

    const bookings = await db.select().from(resourceBookingsTable).where(and(
      eq(resourceBookingsTable.nuOrgId, AN),
      eq(resourceBookingsTable.sourceReferenceId, projection.id),
    ));
    expect(bookings.map((booking) => ({
      quantity: booking.quantity,
      start: booking.startAt.toISOString(),
      end: booking.endAt.toISOString(),
    })).sort((left, right) => left.start.localeCompare(right.start))).toEqual([
      {
        quantity: "4.00",
        start: "2027-06-16T00:00:00.000Z",
        end: "2027-06-19T00:00:00.000Z",
      },
      {
        quantity: "4.00",
        start: "2027-06-17T00:00:00.000Z",
        end: "2027-06-20T00:00:00.000Z",
      },
    ]);
  });

  it("keeps all prior bookings when an inbound AG acceptance rejects a shifted overlap", async () => {
    const { projection, requestId, fixture } = await createShiftedProjection(
      "shifted-inbound-conflict",
      "2027-07",
    );
    await seedShiftedChainBookings(projection.id, fixture);
    const conflictId = `${requestId}-manual-conflict`;
    await seedTargetConflict(conflictId, fixture);

    let published: Record<string, unknown> | undefined;
    const result = await handleIncomingCoordinationDecision(
      decision(`${requestId}-decision`, requestId, "CONFIRM_ACCEPTED", fixture.targetWindow),
      (incoming) => processIncomingCoordinationDecision(incoming, async (response) => {
        published = response as unknown as Record<string, unknown>;
      }),
    );
    expect(result).toEqual({ duplicate: false, status: "PROCESSED" });
    expect(published).toMatchObject({
      requestId,
      requestKind: "SCHEDULE_CHANGE",
      decision: "REJECTED",
      reasonCode: "NO_CAPACITY",
    });

    const bookings = await db.select().from(resourceBookingsTable).where(and(
      eq(resourceBookingsTable.nuOrgId, AN),
      inArray(resourceBookingsTable.sourceReferenceId, [projection.id, conflictId]),
    ));
    expect(bookings.map((booking) => booking.id).sort()).toEqual([
      `${projection.id}-old-a`,
      `${projection.id}-old-b`,
      conflictId,
    ].sort());
    expect(bookings.filter((booking) => booking.sourceReferenceId === projection.id)
      .map((booking) => booking.startAt.toISOString()).sort()).toEqual(
      fixture.oldBookings.map((booking) => booking.start).sort(),
    );
  });

  it("replaces bookings on shifted sub-periods for an AN-originated accepted response", async () => {
    const { projection, requestId, fixture } = await createShiftedProjection(
      "shifted-an-response-success",
      "2027-08",
      "UNDER_REVIEW",
    );
    await seedShiftedChainBookings(projection.id, fixture);

    const response = await createAnServiceResponse({
      anLeistungsanfrageId: projection.id,
      anOrgId: AN,
      userId: null,
      decision: "ACCEPTED",
      acceptedTimeWindow: fixture.targetWindow,
      outboundMessageId: `${requestId}-response`,
    });
    expect(response.payload).toMatchObject({
      requestId,
      requestKind: "SCHEDULE_CHANGE",
      decision: "ACCEPTED",
      acceptedTimeWindow: fixture.targetWindow,
    });

    const bookings = await db.select().from(resourceBookingsTable).where(and(
      eq(resourceBookingsTable.nuOrgId, AN),
      eq(resourceBookingsTable.sourceReferenceId, projection.id),
    ));
    expect(bookings.map((booking) => [
      booking.quantity,
      booking.startAt.toISOString(),
      booking.endAt.toISOString(),
    ]).sort()).toEqual([
      ["4.00", "2027-08-16T00:00:00.000Z", "2027-08-19T00:00:00.000Z"],
      ["4.00", "2027-08-17T00:00:00.000Z", "2027-08-20T00:00:00.000Z"],
    ]);
  });

  it("rolls back the AN response and every booking change when a shifted overlap is infeasible", async () => {
    const { projection, requestId, fixture } = await createShiftedProjection(
      "shifted-an-response-conflict",
      "2027-09",
      "UNDER_REVIEW",
    );
    await seedShiftedChainBookings(projection.id, fixture);
    const conflictId = `${requestId}-manual-conflict`;
    await seedTargetConflict(conflictId, fixture);

    await expect(createAnServiceResponse({
      anLeistungsanfrageId: projection.id,
      anOrgId: AN,
      userId: null,
      decision: "ACCEPTED",
      acceptedTimeWindow: fixture.targetWindow,
      outboundMessageId: `${requestId}-response`,
    })).rejects.toBeInstanceOf(AcceptedScheduleCapacityConflictError);

    const bookings = await db.select().from(resourceBookingsTable).where(and(
      eq(resourceBookingsTable.nuOrgId, AN),
      inArray(resourceBookingsTable.sourceReferenceId, [projection.id, conflictId]),
    ));
    expect(bookings.map((booking) => booking.id).sort()).toEqual([
      `${projection.id}-old-a`,
      `${projection.id}-old-b`,
      conflictId,
    ].sort());
    expect(await db.select().from(anLeistungsantwortenTable).where(eq(
      anLeistungsantwortenTable.anLeistungsanfrageId,
      projection.id,
    ))).toHaveLength(0);
    const [unchanged] = await db.select({ status: anLeistungsanfragenTable.status })
      .from(anLeistungsanfragenTable)
      .where(eq(anLeistungsanfragenTable.id, projection.id));
    expect(unchanged.status).toBe("UNDER_REVIEW");
  });

  it("publishes a privacy-safe rejection when an accepted schedule loses capacity", async () => {
    const requestId = `${PREFIX}-stale-capacity`;
    const { projection } = await createProjection("stale-capacity", {
      requestKind: "SCHEDULE_CHANGE",
      sourceRequestId: `${PREFIX}-root-request`,
      changeProposalId: requestId,
    });
    await db.insert(resourceBookingsTable).values({
      nuOrgId: AN,
      resourceTypeId: TYPE,
      quantity: 8,
      sourceType: "TAKT_REQUEST",
      sourceReferenceId: `${requestId}-competing-booking`,
      startAt: new Date("2026-10-01T08:00:00.000Z"),
      endAt: new Date("2026-10-07T17:00:00.000Z"),
      utilizationPercent: 100,
      status: "CONFIRMED",
    });

    let published: Record<string, unknown> | undefined;
    const payload = decision(`${requestId}-decision`, requestId, "CONFIRM_ACCEPTED");
    const first = await handleIncomingCoordinationDecision(
      payload,
      (incoming) => processIncomingCoordinationDecision(incoming, (response) => {
        published = response as unknown as Record<string, unknown>;
        return Promise.resolve();
      }),
    );
    expect(first).toEqual({ duplicate: false, status: "PROCESSED" });
    expect(published).toMatchObject({
      requestId,
      requestKind: "SCHEDULE_CHANGE",
      decision: "REJECTED",
      reasonCode: "NO_CAPACITY",
    });
    expect(published?.comment).toContain("new time window");
    expect(published).not.toHaveProperty("resourceId");
    expect(published).not.toHaveProperty("conflicts");

    const repeated = await handleIncomingCoordinationDecision(
      payload,
      (incoming) => processIncomingCoordinationDecision(incoming, () => {
        throw new Error("A duplicate decision must not publish again");
      }),
    );
    expect(repeated).toEqual({ duplicate: true, status: "DUPLICATE" });

    const bookings = await db.select().from(resourceBookingsTable).where(and(
      eq(resourceBookingsTable.nuOrgId, AN),
      inArray(resourceBookingsTable.sourceReferenceId, [
        projection.id,
        `${requestId}-competing-booking`,
      ]),
    ));
    expect(bookings).toHaveLength(1);
    expect(bookings[0]?.sourceReferenceId).toBe(`${requestId}-competing-booking`);
    expect(await db.select().from(anLeistungsantwortenTable).where(eq(
      anLeistungsantwortenTable.anLeistungsanfrageId,
      projection.id,
    ))).toHaveLength(1);
  });

  it.each([
    ["REQUEST_REVISION", "REVISION_REQUIRED"],
    ["CLOSE_WITHOUT_AGREEMENT", "CANCELLED"],
  ] as const)("cancels AN-local bookings for %s", async (decisionType, expectedStatus) => {
    const { projection, requestId } = await createProjection(decisionType.toLowerCase());
    await seedBooking(projection.id);
    await handleIncomingCoordinationDecision(
      decision(`${requestId}-decision`, requestId, decisionType),
      processIncomingCoordinationDecision,
    );
    const [updated] = await db.select({ status: anLeistungsanfragenTable.status })
      .from(anLeistungsanfragenTable).where(eq(anLeistungsanfragenTable.id, projection.id));
    expect(updated.status).toBe(expectedStatus);
    const [booking] = await db.select({ status: resourceBookingsTable.status })
      .from(resourceBookingsTable).where(eq(resourceBookingsTable.sourceReferenceId, projection.id));
    expect(booking.status).toBe("CANCELLED");
  });

  it("rejects private AN fields in the public decision contract", () => {
    const parsed = externalCoordinationDecisionSchema.safeParse({
      ...decision("public-contract-decision", "public-contract-request", "CONFIRM_ACCEPTED"),
      resourceId: "private-an-resource",
      internalResult: { conflicts: [] },
    });
    expect(parsed.success).toBe(false);
  });
});