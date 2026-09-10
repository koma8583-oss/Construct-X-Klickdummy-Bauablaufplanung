import { and, eq } from "drizzle-orm";
import { resourceBookingsTable, resourcesTable } from "@workspace/db";
import { addCalendarDays } from "../lib/calendar-date-utils";
import { evaluateResourceRequirements } from "./resource-availability-service";
import { lockAnConfirmedCapacity } from "./an-capacity-lock-service";

export interface BookingRequirement {
  resourceRequirementId?: string;
  resourceTypeId: string;
  quantity: number;
  utilizationPercent: number;
  periodStart: string | null;
  periodEnd: string | null;
}

export interface BookingWindow {
  start: Date;
  end: Date;
}

export interface PreservedBookingAssignment {
  resourceRequirementId: string;
  resourceId: string;
}

export class ConfirmedBookingCapacityConflictError extends Error {
  constructor() {
    super("The confirmed booking is no longer feasible with current confirmed bookings");
    this.name = "ConfirmedBookingCapacityConflictError";
  }
}

function toExclusiveEnd(periodEnd: string): Date {
  return new Date(`${addCalendarDays(periodEnd, 1)}T00:00:00Z`);
}

/**
 * Recheck one confirmed booking against the AN-local capacity pool. The
 * caller must hold the AN capacity lock before invoking this function.
 */
export async function assertConfirmedBookingCapacity(
  tx: any,
  input: {
    nuOrgId: string;
    resourceId?: string | null;
    resourceTypeId: string;
    quantity?: number | null;
    startAt: Date;
    endAt: Date;
    utilizationPercent: number;
    excludeBookingId?: string;
    additionalBookings?: Array<{
      id: string;
      resourceId: string | null;
      resourceTypeId: string | null;
      quantity: number | null;
      startAt: Date;
      endAt: Date;
      status: "CONFIRMED";
      utilizationPercent: number;
    }>;
  },
): Promise<void> {
  const [selectedResource] = input.resourceId
    ? await tx.select({
      id: resourcesTable.id,
      resourceTypeId: resourcesTable.resourceTypeId,
      type: resourcesTable.type,
      name: resourcesTable.name,
      capacity: resourcesTable.capacity,
      qualifications: resourcesTable.qualifications,
    }).from(resourcesTable).where(and(
      eq(resourcesTable.id, input.resourceId),
      eq(resourcesTable.anOrgId, input.nuOrgId),
      eq(resourcesTable.active, true),
    )).limit(1)
    : [null];
  const resources = await tx.select({
    id: resourcesTable.id,
    resourceTypeId: resourcesTable.resourceTypeId,
    type: resourcesTable.type,
    name: resourcesTable.name,
    capacity: resourcesTable.capacity,
    qualifications: resourcesTable.qualifications,
  }).from(resourcesTable).where(and(
    eq(resourcesTable.anOrgId, input.nuOrgId),
    eq(resourcesTable.active, true),
  ));
  const confirmedBookings = await tx.select().from(resourceBookingsTable).where(and(
    eq(resourceBookingsTable.nuOrgId, input.nuOrgId),
    eq(resourceBookingsTable.status, "CONFIRMED"),
  ));
  const bookings = [
    ...confirmedBookings,
    ...(input.additionalBookings ?? []),
  ].filter((booking: { id: string }) =>
    booking.id !== input.excludeBookingId);
  const feasibility = evaluateResourceRequirements({
    requirements: [{
      resourceTypeId: input.resourceTypeId,
      requiredCapacity: input.resourceId
        ? selectedResource?.capacity ?? 1
        : input.quantity ?? 0,
      utilizationPercent: input.utilizationPercent,
      requiredQualification: null,
      periodStart: null,
      periodEnd: null,
    }],
    resources,
    bookings: bookings.map((booking: typeof confirmedBookings[number]) => ({
      id: booking.id,
      resourceId: booking.resourceId,
      resourceTypeId: booking.resourceTypeId,
      quantity: booking.quantity ? Number(booking.quantity) : null,
      startAt: booking.startAt,
      endAt: booking.endAt,
      status: booking.status,
      utilizationPercent: booking.utilizationPercent,
    })),
    windowStart: input.startAt,
    windowEnd: input.endAt,
  });
  if (feasibility.conflicts.length > 0) {
    throw new ConfirmedBookingCapacityConflictError();
  }

  // The allocator checks the shared pool, while this check preserves the
  // caller's explicit concrete-resource assignment.
  if (selectedResource) {
    const selectedCapacity = selectedResource.capacity ?? 1;
    const overlappingUtilization = bookings
      .filter((booking: typeof confirmedBookings[number]) =>
        booking.resourceId === input.resourceId &&
        booking.startAt < input.endAt &&
        booking.endAt > input.startAt)
      .reduce(
        (sum: number, booking: typeof confirmedBookings[number]) =>
          sum + selectedCapacity * booking.utilizationPercent / 100,
        0,
      );
    const requestedUtilization = selectedCapacity * input.utilizationPercent / 100;
    if (overlappingUtilization + requestedUtilization > selectedCapacity + 1e-9) {
      throw new ConfirmedBookingCapacityConflictError();
    }
  }
}

/**
 * The single persistence path from unaggregated requirement segments to
 * confirmed request bookings.
 */
export async function applyConfirmedBookingsFromRequirements(
  tx: any,
  input: {
    serviceRequestId: string;
    nuOrgId: string;
    requirements: BookingRequirement[];
    preservedAssignments?: PreservedBookingAssignment[];
    replaceExisting?: boolean;
    fallbackWindow?: BookingWindow;
  },
) {
  const assignments = new Map(
    (input.preservedAssignments ?? []).map((assignment) => [
      assignment.resourceRequirementId,
      assignment.resourceId,
    ]),
  );

  await lockAnConfirmedCapacity(tx, input.nuOrgId);
  if (input.replaceExisting !== false) {
    await tx.delete(resourceBookingsTable).where(and(
      eq(resourceBookingsTable.sourceType, "TAKT_REQUEST"),
      eq(resourceBookingsTable.sourceReferenceId, input.serviceRequestId),
      eq(resourceBookingsTable.status, "CONFIRMED"),
    ));
  }
  const pendingAssignments = input.requirements
    .filter((requirement) => requirement.resourceTypeId && requirement.quantity > 0)
    .map((requirement, index) => {
      const resourceId = requirement.resourceRequirementId
        ? assignments.get(requirement.resourceRequirementId) ?? null
        : null;
      const startAt = requirement.periodStart
        ? new Date(`${requirement.periodStart}T00:00:00Z`)
        : input.fallbackWindow?.start ?? new Date(NaN);
      const endAt = requirement.periodEnd
        ? toExclusiveEnd(requirement.periodEnd)
        : input.fallbackWindow?.end ?? new Date(NaN);
      return {
        requirement,
        booking: {
          id: `${input.serviceRequestId}-pending-${index}`,
          resourceId,
          resourceTypeId: requirement.resourceTypeId,
          quantity: resourceId ? null : requirement.quantity,
          startAt,
          endAt,
          status: "CONFIRMED" as const,
          utilizationPercent: requirement.utilizationPercent,
        },
      };
    });

  // Validate the complete batch against all sibling bookings. In particular,
  // a type-level segment must consume the same pool as a concrete assignment
  // even when the type-level segment appears first in the request.
  for (const [index, pendingAssignment] of pendingAssignments.entries()) {
    const { requirement, booking } = pendingAssignment;
    await assertConfirmedBookingCapacity(tx, {
      nuOrgId: input.nuOrgId,
      resourceId: booking.resourceId,
      resourceTypeId: requirement.resourceTypeId,
      quantity: requirement.quantity,
      startAt: booking.startAt,
      endAt: booking.endAt,
      utilizationPercent: requirement.utilizationPercent,
      additionalBookings: pendingAssignments
        .filter((_, siblingIndex) => siblingIndex !== index)
        .map(({ booking: siblingBooking }) => siblingBooking),
    });
  }

  const values = pendingAssignments.map(({ booking }) => ({
    nuOrgId: input.nuOrgId,
    resourceId: booking.resourceId,
    resourceTypeId: booking.resourceTypeId,
    quantity: booking.quantity,
    sourceType: "TAKT_REQUEST" as const,
    sourceReferenceId: input.serviceRequestId,
    startAt: booking.startAt,
    endAt: booking.endAt,
    utilizationPercent: booking.utilizationPercent,
    status: "CONFIRMED" as const,
  }));

  if (values.length > 0) await tx.insert(resourceBookingsTable).values(values);
  return values;
}