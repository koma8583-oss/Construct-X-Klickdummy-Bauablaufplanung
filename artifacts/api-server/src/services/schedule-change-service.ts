import { and, eq, gt, isNull, lt, ne, or } from "drizzle-orm";
import {
  leistungenTable,
  leistungsanfragenTable,
  resourceBookingsTable,
  leistungsanfrageResourceRequirementsTable,
  leistungsVersionenTable,
  resourcesTable,
} from "@workspace/db";
import { evaluateAvailabilityWindow } from "./availability-check-service";
import { shiftRequirementsToWindow, restoreConcreteResourceAssignments } from "./resource-availability-service";

function dateOnly(value: Date | string): string {
  return (value instanceof Date ? value.toISOString() : value).slice(0, 10);
}

type ScheduleRequirement = {
  id: string;
  resourceTypeId: string | null;
  requiredCapacity: string | null;
  utilizationPercent: number;
  requiredQualification: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  notes: string | null;
};

export type PreparedScheduleChange = {
  request: typeof leistungsanfragenTable.$inferSelect;
  service: typeof leistungenTable.$inferSelect;
  currentAgreementStart: Date;
  currentAgreementEnd: Date;
  targetStart: Date;
  targetEnd: Date;
  shiftedRequirements: ScheduleRequirement[];
  ownedBookings: Array<typeof resourceBookingsTable.$inferSelect>;
  restoredBookings: Array<{
    resourceId: string | null;
    resourceTypeId: string | null;
    quantity: number;
    utilizationPercent: number;
    periodStart: string | null;
    periodEnd: string | null;
  }>;
};

/**
 * Loads and validates the complete target state without changing business
 * data. The returned shifted requirements are the single source of truth for
 * availability, persistence and booking recreation.
 */
export async function prepareAcceptedScheduleChange(
  tx: any,
  input: {
    serviceRequestId: string;
    newStart: Date;
    newEnd: Date;
  },
): Promise<PreparedScheduleChange> {
  const [requestRow] = await tx.select({
    request: leistungsanfragenTable,
    service: leistungenTable,
  }).from(leistungsanfragenTable)
    .innerJoin(leistungenTable, eq(leistungsanfragenTable.leistungId, leistungenTable.id))
    .where(eq(leistungsanfragenTable.id, input.serviceRequestId))
    .limit(1);
  if (!requestRow) throw Object.assign(new Error("Leistungsanfrage nicht gefunden"), { statusCode: 404 });
  if (!requestRow.request.agreedStart || !requestRow.request.agreedEnd) {
    throw Object.assign(new Error("Eine Terminänderung benötigt eine bestehende Vereinbarung"), { statusCode: 422 });
  }
  if (input.newEnd < input.newStart) {
    throw Object.assign(new Error("Ende muss am oder nach dem Beginn liegen"), { statusCode: 400 });
  }

  const requirements: ScheduleRequirement[] = await tx.select({
    id: leistungsanfrageResourceRequirementsTable.id,
    resourceTypeId: leistungsanfrageResourceRequirementsTable.resourceTypeId,
    requiredCapacity: leistungsanfrageResourceRequirementsTable.requiredCapacity,
    utilizationPercent: leistungsanfrageResourceRequirementsTable.utilizationPercent,
    requiredQualification: leistungsanfrageResourceRequirementsTable.requiredQualification,
    periodStart: leistungsanfrageResourceRequirementsTable.periodStart,
    periodEnd: leistungsanfrageResourceRequirementsTable.periodEnd,
    notes: leistungsanfrageResourceRequirementsTable.notes,
  }).from(leistungsanfrageResourceRequirementsTable)
    .where(eq(leistungsanfrageResourceRequirementsTable.leistungsanfrageId, input.serviceRequestId));

  const currentStartDate = dateOnly(requestRow.request.agreedStart);
  const targetStartDate = dateOnly(input.newStart);
  const shiftedRequirements = shiftRequirementsToWindow(
    requirements,
    requestRow.request.agreedStart,
    input.newStart,
  ).map((requirement) => ({
    ...requirement,
    periodStart: requirement.periodStart ?? targetStartDate,
    periodEnd: requirement.periodEnd ?? dateOnly(input.newEnd),
  }));

  const ownedBookings = await tx.select().from(resourceBookingsTable).where(and(
    eq(resourceBookingsTable.sourceType, "TAKT_REQUEST"),
    eq(resourceBookingsTable.sourceReferenceId, input.serviceRequestId),
    eq(resourceBookingsTable.status, "CONFIRMED"),
  ));
  const resources = await tx.select({
    id: resourcesTable.id,
    resourceTypeId: resourcesTable.resourceTypeId,
    capacity: resourcesTable.capacity,
    active: resourcesTable.active,
  }).from(resourcesTable).where(eq(resourcesTable.anOrgId, requestRow.request.nuOrgId));
  const otherConfirmedBookings = await tx.select({
    resourceId: resourceBookingsTable.resourceId,
    startAt: resourceBookingsTable.startAt,
    endAt: resourceBookingsTable.endAt,
  }).from(resourceBookingsTable).where(and(
    eq(resourceBookingsTable.nuOrgId, requestRow.request.nuOrgId),
    eq(resourceBookingsTable.status, "CONFIRMED"),
    or(
      ne(resourceBookingsTable.sourceReferenceId, input.serviceRequestId),
      isNull(resourceBookingsTable.sourceReferenceId),
    ),
    gt(resourceBookingsTable.endAt, input.newStart),
    lt(resourceBookingsTable.startAt, input.newEnd),
  ));

  const availability = await evaluateAvailabilityWindow(
    input.serviceRequestId,
    requestRow.request.nuOrgId,
    input.newStart,
    input.newEnd,
    input.serviceRequestId,
    shiftedRequirements,
    tx,
  );
  if (availability.conflicts.some((conflict) => !conflict.isTentative)) {
    throw Object.assign(new Error("CHANGE_PROPOSAL_NOT_FEASIBLE"), {
      statusCode: 409,
      code: "CHANGE_PROPOSAL_NOT_FEASIBLE",
      availability,
    });
  }

  const restoredBookings = restoreConcreteResourceAssignments(
    shiftedRequirements,
    ownedBookings
      .filter((booking: { resourceId: string | null }) => booking.resourceId !== null)
      .map((booking: typeof ownedBookings[number]) => ({
        id: booking.id,
        resourceId: booking.resourceId!,
        resourceTypeId: booking.resourceTypeId,
        startAt: booking.startAt,
        endAt: booking.endAt,
        utilizationPercent: booking.utilizationPercent,
      })),
    resources,
    otherConfirmedBookings.filter(
      (booking: { resourceId: string | null }): booking is { resourceId: string; startAt: Date; endAt: Date } =>
        booking.resourceId !== null,
    ),
    new Date(`${currentStartDate}T00:00:00Z`),
    new Date(`${dateOnly(requestRow.request.agreedEnd)}T00:00:00Z`),
    new Date(`${targetStartDate}T00:00:00Z`),
  );

  return {
    request: requestRow.request,
    service: requestRow.service,
    currentAgreementStart: requestRow.request.agreedStart,
    currentAgreementEnd: requestRow.request.agreedEnd,
    targetStart: input.newStart,
    targetEnd: input.newEnd,
    shiftedRequirements,
    ownedBookings,
    restoredBookings,
  };
}

/**
 * Applies an accepted service-request schedule change as one transaction.
 * The transaction is supplied by the caller so proposal status, agreement,
 * plan dates and request-owned bookings cannot be partially committed.
 */
export async function applyAcceptedScheduleChange(
  tx: any,
  input: {
    serviceRequestId: string;
    newStart: Date;
    newEnd: Date;
    initiatedBy: "AG" | "AN";
    proposalId?: string;
    prepared?: PreparedScheduleChange;
  },
) {
  const prepared = input.prepared ?? await prepareAcceptedScheduleChange(tx, input);
  const requestRow = { request: prepared.request, service: prepared.service };
  const newStartDate = dateOnly(prepared.targetStart);
  const [service] = await tx.update(leistungenTable).set({
      plannedStart: dateOnly(prepared.targetStart),
      plannedEnd: dateOnly(prepared.targetEnd),
    version: requestRow.service.version + 1,
    lifecycleStatus: "CONFIRMED",
    status: "BESTAETIGT",
    updatedAt: new Date(),
  }).where(eq(leistungenTable.id, requestRow.service.id)).returning();

  await tx.delete(resourceBookingsTable).where(and(
    eq(resourceBookingsTable.sourceType, "TAKT_REQUEST"),
    eq(resourceBookingsTable.sourceReferenceId, input.serviceRequestId),
    eq(resourceBookingsTable.status, "CONFIRMED"),
  ));
  if (prepared.shiftedRequirements.length > 0) {
    await Promise.all(prepared.shiftedRequirements.map((requirement) =>
      tx.update(leistungsanfrageResourceRequirementsTable).set({
        periodStart: requirement.periodStart,
        periodEnd: requirement.periodEnd,
        updatedAt: new Date(),
      }).where(eq(leistungsanfrageResourceRequirementsTable.id, requirement.id)),
    ));
  }
  const bookingValues = prepared.restoredBookings
    .filter((requirement) => requirement.resourceTypeId && Number(requirement.quantity) > 0)
    .map((requirement) => {
      const startAt = new Date(`${requirement.periodStart ?? newStartDate}T00:00:00Z`);
      const endAt = new Date(`${requirement.periodEnd ?? dateOnly(prepared.targetEnd)}T00:00:00Z`);
      endAt.setUTCDate(endAt.getUTCDate() + 1);
      return {
        nuOrgId: requestRow.request.nuOrgId,
        resourceId: requirement.resourceId,
        resourceTypeId: requirement.resourceTypeId,
        sourceType: "TAKT_REQUEST" as const,
        sourceReferenceId: input.serviceRequestId,
        startAt,
        endAt,
        utilizationPercent: requirement.utilizationPercent,
        quantity: requirement.resourceId ? null : Number(requirement.quantity),
        status: "CONFIRMED" as const,
      };
    });
  if (bookingValues.length > 0) {
    await tx.insert(resourceBookingsTable).values(bookingValues);
  }

  await tx.insert(leistungsVersionenTable).values({
    leistungId: requestRow.service.id,
    version: requestRow.service.version + 1,
    sourceType: "MANUAL_EDIT",
    sourceRequestId: input.serviceRequestId,
    snapshotPayload: {
      ...(requestRow.service as unknown as Record<string, unknown>),
      plannedStart: prepared.targetStart.toISOString().slice(0, 10),
      plannedEnd: prepared.targetEnd.toISOString().slice(0, 10),
      version: requestRow.service.version + 1,
    },
    createdByUserId: null,
  });
  const [request] = await tx.update(leistungsanfragenTable).set({
    agreedStart: prepared.targetStart,
    agreedEnd: prepared.targetEnd,
    updatedAt: new Date(),
  }).where(eq(leistungsanfragenTable.id, input.serviceRequestId)).returning();
  return { request, service, updatedBookingCount: bookingValues.length };
}