import { and, eq, gt, isNull, lt, ne, or } from "drizzle-orm";
import {
  leistungenTable,
  leistungsanfragenTable,
  resourceBookingsTable,
  leistungsanfrageResourceRequirementsTable,
  leistungsVersionenTable,
  resourcesTable,
} from "@workspace/db";
import { shiftCalendarDate } from "../lib/calendar-date-utils";
import { restoreConcreteResourceAssignments } from "./resource-availability-service";

function dateOnly(value: Date | string): string {
  return (value instanceof Date ? value.toISOString() : value).slice(0, 10);
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
  },
) {
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

  const oldStart = requestRow.request.agreedStart;
  const oldEnd = requestRow.request.agreedEnd;
  const oldStartDate = oldStart.toISOString().slice(0, 10);
  const newStartDate = input.newStart.toISOString().slice(0, 10);
  const requirements: Array<{
    id: string;
    resourceTypeId: string | null;
    requiredCapacity: string | null;
    utilizationPercent: number;
    periodStart: string | null;
    periodEnd: string | null;
  }> = await tx.select({
    id: leistungsanfrageResourceRequirementsTable.id,
    resourceTypeId: leistungsanfrageResourceRequirementsTable.resourceTypeId,
    requiredCapacity: leistungsanfrageResourceRequirementsTable.requiredCapacity,
    utilizationPercent: leistungsanfrageResourceRequirementsTable.utilizationPercent,
    periodStart: leistungsanfrageResourceRequirementsTable.periodStart,
    periodEnd: leistungsanfrageResourceRequirementsTable.periodEnd,
  }).from(leistungsanfrageResourceRequirementsTable)
    .where(eq(leistungsanfrageResourceRequirementsTable.leistungsanfrageId, input.serviceRequestId));
  const shiftRequirements = requirements.map((requirement) => ({
    ...requirement,
    periodStart: requirement.periodStart ? shiftCalendarDate(requirement.periodStart, calendarDayDelta(oldStartDate, newStartDate)) : newStartDate,
    periodEnd: requirement.periodEnd ? shiftCalendarDate(requirement.periodEnd, calendarDayDelta(oldStartDate, newStartDate)) : input.newEnd.toISOString().slice(0, 10),
  }));
  const [service] = await tx.update(leistungenTable).set({
    plannedStart: dateOnly(input.newStart),
    plannedEnd: dateOnly(input.newEnd),
    version: requestRow.service.version + 1,
    lifecycleStatus: "CONFIRMED",
    status: "BESTAETIGT",
    updatedAt: new Date(),
  }).where(eq(leistungenTable.id, requestRow.service.id)).returning();

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
  const restored = restoreConcreteResourceAssignments(
    shiftRequirements,
    ownedBookings
      .filter((booking: { resourceId: string | null }) => booking.resourceId !== null)
      .map((booking: {
        id: string;
        resourceId: string | null;
        resourceTypeId: string | null;
        startAt: Date;
        endAt: Date;
        utilizationPercent: number;
      }) => ({
        id: booking.id,
        resourceId: booking.resourceId!,
        resourceTypeId: booking.resourceTypeId,
        startAt: booking.startAt,
        endAt: booking.endAt,
        utilizationPercent: booking.utilizationPercent,
      })),
    resources,
    otherConfirmedBookings
      .filter((booking: { resourceId: string | null }): booking is { resourceId: string; startAt: Date; endAt: Date } => booking.resourceId !== null),
    new Date(`${oldStartDate}T00:00:00Z`),
    new Date(`${oldEnd.toISOString().slice(0, 10)}T00:00:00Z`),
    new Date(`${newStartDate}T00:00:00Z`),
  );
  await tx.delete(resourceBookingsTable).where(and(
    eq(resourceBookingsTable.sourceType, "TAKT_REQUEST"),
    eq(resourceBookingsTable.sourceReferenceId, input.serviceRequestId),
    eq(resourceBookingsTable.status, "CONFIRMED"),
  ));
  if (shiftRequirements.length > 0) {
    await Promise.all(shiftRequirements.map((requirement) =>
      tx.update(leistungsanfrageResourceRequirementsTable).set({
        periodStart: requirement.periodStart,
        periodEnd: requirement.periodEnd,
        updatedAt: new Date(),
      }).where(eq(leistungsanfrageResourceRequirementsTable.id, requirement.id)),
    ));
  }
  const bookingValues = restored
    .filter((requirement) => requirement.resourceTypeId && Number(requirement.quantity) > 0)
    .map((requirement) => {
      const startAt = new Date(`${requirement.periodStart ?? newStartDate}T00:00:00Z`);
      const endAt = new Date(`${requirement.periodEnd ?? input.newEnd.toISOString().slice(0, 10)}T00:00:00Z`);
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
      plannedStart: input.newStart.toISOString().slice(0, 10),
      plannedEnd: input.newEnd.toISOString().slice(0, 10),
      version: requestRow.service.version + 1,
    },
    createdByUserId: null,
  });
  const [request] = await tx.update(leistungsanfragenTable).set({
    agreedStart: input.newStart,
    agreedEnd: input.newEnd,
    updatedAt: new Date(),
  }).where(eq(leistungsanfragenTable.id, input.serviceRequestId)).returning();
  return { request, service, updatedBookingCount: bookingValues.length };
}

function calendarDayDelta(from: string, to: string): number {
  const parse = (value: string) => Date.UTC(Number(value.slice(0, 4)), Number(value.slice(5, 7)) - 1, Number(value.slice(8, 10)));
  return Math.round((parse(to) - parse(from)) / 86_400_000);
}