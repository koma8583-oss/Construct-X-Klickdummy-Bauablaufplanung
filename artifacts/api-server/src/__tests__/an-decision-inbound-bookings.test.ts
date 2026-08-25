/**
 * AG decisions may publish public coordination facts, but only the AN inbound
 * may change AN-local projections and resource bookings.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray, or } from "drizzle-orm";
import {
  anDb as db,
  anLeistungsanfrageResourceRequirementsTable,
  anLeistungsanfragenTable,
  dataspaceExchangesTable,
  organizationsTable,
  resourceBookingsTable,
  resourceTypesTable,
} from "@workspace/db";
import {
  externalCoordinationDecisionSchema,
  type ExternalCoordinationDecision,
} from "../services/dataspace/external-contracts";
import { handleIncomingCoordinationDecision } from "../services/dataspace/inbound-exchange-service";
import { processIncomingCoordinationDecision } from "../services/dataspace/inbound-domain-service";

const PREFIX = "an-decision-inbound";
const AG = `${PREFIX}-ag`;
const AN = `${PREFIX}-an`;
const TYPE = `${PREFIX}-type`;

function decision(
  messageId: string,
  requestId: string,
  decisionType: ExternalCoordinationDecision["decisionType"],
): ExternalCoordinationDecision {
  const accepted =
    decisionType === "CONFIRM_ACCEPTED" || decisionType === "ACCEPT_ALTERNATIVE";
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
          confirmedTimeWindow: {
            start: decisionType === "ACCEPT_ALTERNATIVE"
              ? "2026-10-15T08:00:00.000Z"
              : "2026-10-01T08:00:00.000Z",
            end: decisionType === "ACCEPT_ALTERNATIVE"
              ? "2026-10-22T17:00:00.000Z"
              : "2026-10-07T17:00:00.000Z",
          },
        }
      : {}),
    ...(decisionType === "ACCEPT_ALTERNATIVE" ? { acceptedAlternativeId: "public-alt-1" } : {}),
    ...(decisionType === "CLOSE_WITHOUT_AGREEMENT" ? { closedAt: "2026-10-02T10:00:00.000Z" } : {}),
  };
}

async function createProjection(name: string) {
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
    payloadSnapshot: {},
    status: "RESPONDED",
  }).returning();
  await db.insert(anLeistungsanfrageResourceRequirementsTable).values({
    anLeistungsanfrageId: projection.id,
    externalResourceTypeCode: "WORKER",
    externalResourceTypeName: "Worker",
    localResourceTypeId: TYPE,
    requiredCapacity: "2",
    capacityUnit: "PERSONS",
    utilizationPercent: 100,
    periodStart: "2026-10-01",
    periodEnd: "2026-10-07",
  });
  return { projection, requestId };
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

async function cleanup() {
  await db.delete(resourceBookingsTable).where(eq(resourceBookingsTable.nuOrgId, AN)).catch(() => {});
  await db.delete(dataspaceExchangesTable).where(or(
    eq(dataspaceExchangesTable.senderOrgId, AG),
    eq(dataspaceExchangesTable.receiverOrgId, AN),
  )).catch(() => {});
  await db.delete(anLeistungsanfragenTable).where(eq(anLeistungsanfragenTable.receiverAnOrgId, AN)).catch(() => {});
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