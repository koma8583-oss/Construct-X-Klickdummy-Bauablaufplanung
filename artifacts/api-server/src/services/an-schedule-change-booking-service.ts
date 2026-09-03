import {
  anLeistungsanfrageResourceRequirementsTable,
  anLeistungsanfragenTable,
  resourceBookingsTable,
  resourcesTable,
} from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";
import { addCalendarDays } from "../lib/calendar-date-utils";
import {
  restoreConcreteResourceAssignments,
  shiftRequirementsToWindow,
} from "./resource-availability-service";

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function baseWindow(snapshot: Record<string, unknown>, fallback: { start: string; end: string }) {
  const value = objectRecord(snapshot.baseTimeWindow);
  return {
    start: typeof value.start === "string" ? value.start : fallback.start,
    end: typeof value.end === "string" ? value.end : fallback.end,
  };
}

type ProjectionRef = {
  id: string;
  externalLeistungsanfrageId: string;
  payloadSnapshot: unknown;
};

type RequirementRef = {
  id: string;
  localResourceTypeId: string | null;
  requiredCapacity: string | null;
  utilizationPercent: number;
  periodStart: string | null;
  periodEnd: string | null;
};

type BookingRef = {
  id: string;
  sourceReferenceId: string | null;
  resourceTypeId: string | null;
  resourceId: string | null;
  startAt: Date;
  endAt: Date;
  utilizationPercent: number;
};

/**
 * Replace the AN-owned confirmed bookings after a schedule has been
 * accepted. The caller supplies its already-open AN transaction so the
 * response/projection and booking replacement commit together.
 */
export async function applyAcceptedAnScheduleChange(
  tx: any,
  input: {
    projectionId: string;
    targetStart: Date;
    targetEnd: Date;
    note: string;
    useRequirementPeriods?: boolean;
  },
) {
  const [projection] = await tx.select().from(anLeistungsanfragenTable)
    .where(eq(anLeistungsanfragenTable.id, input.projectionId))
    .limit(1);
  if (!projection) throw new Error("AN schedule-change projection could not be found");

  const snapshot = projection.payloadSnapshot as Record<string, unknown>;
  const sourceRequestId = typeof snapshot.sourceRequestId === "string"
    ? snapshot.sourceRequestId
    : projection.externalLeistungsanfrageId;
  const allProjections: ProjectionRef[] = await tx.select({
    id: anLeistungsanfragenTable.id,
    externalLeistungsanfrageId: anLeistungsanfragenTable.externalLeistungsanfrageId,
    payloadSnapshot: anLeistungsanfragenTable.payloadSnapshot,
  }).from(anLeistungsanfragenTable).where(eq(
    anLeistungsanfragenTable.receiverAnOrgId,
    projection.receiverAnOrgId,
  ));
  const chainProjectionRows = allProjections.filter((candidate: ProjectionRef) => {
    const candidateSnapshot = candidate.payloadSnapshot as { sourceRequestId?: string } | null;
    return candidate.externalLeistungsanfrageId === sourceRequestId ||
      candidate.externalLeistungsanfrageId === projection.externalLeistungsanfrageId ||
      candidateSnapshot?.sourceRequestId === sourceRequestId;
  });
  const chainProjectionIds = chainProjectionRows.map((candidate: ProjectionRef) => candidate.id);
  if (!chainProjectionIds.includes(projection.id)) chainProjectionIds.push(projection.id);

  const requirements: RequirementRef[] = await tx.select().from(anLeistungsanfrageResourceRequirementsTable)
    .where(eq(anLeistungsanfrageResourceRequirementsTable.anLeistungsanfrageId, projection.id));
  const fallbackWindow = {
    start: projection.plannedStart,
    end: projection.plannedEnd,
  };
  const previousWindow = baseWindow(snapshot, fallbackWindow);
  const oldWindowStart = new Date(previousWindow.start);
  const oldWindowEnd = new Date(previousWindow.end);
  const targetWindowStart = input.targetStart;

  const previousBookings: BookingRef[] = await tx.select({
    id: resourceBookingsTable.id,
    sourceReferenceId: resourceBookingsTable.sourceReferenceId,
    resourceTypeId: resourceBookingsTable.resourceTypeId,
    resourceId: resourceBookingsTable.resourceId,
    startAt: resourceBookingsTable.startAt,
    endAt: resourceBookingsTable.endAt,
    utilizationPercent: resourceBookingsTable.utilizationPercent,
  }).from(resourceBookingsTable).where(and(
    eq(resourceBookingsTable.nuOrgId, projection.receiverAnOrgId),
    eq(resourceBookingsTable.sourceType, "TAKT_REQUEST"),
    eq(resourceBookingsTable.status, "CONFIRMED"),
  ));
  const chainBookings = previousBookings.filter((booking: BookingRef) =>
    chainProjectionIds.includes(booking.sourceReferenceId ?? ""),
  );
  const otherConfirmedBookings = previousBookings.filter((booking: BookingRef) =>
    !chainProjectionIds.includes(booking.sourceReferenceId ?? ""),
  );
  const resources = await tx.select({
    id: resourcesTable.id,
    resourceTypeId: resourcesTable.resourceTypeId,
    capacity: resourcesTable.capacity,
    active: resourcesTable.active,
  }).from(resourcesTable).where(and(
    eq(resourcesTable.anOrgId, projection.receiverAnOrgId),
    eq(resourcesTable.active, true),
  ));

  const oldRequirements = shiftRequirementsToWindow<RequirementRef & { resourceTypeId: string | null }>(
    requirements.map((requirement) => ({
      ...requirement,
      resourceTypeId: requirement.localResourceTypeId,
    })) as Array<RequirementRef & { resourceTypeId: string | null }>,
    targetWindowStart,
    oldWindowStart,
  );
  const assignments = restoreConcreteResourceAssignments(
    oldRequirements,
    chainBookings.filter((booking): booking is BookingRef & { resourceId: string } =>
      Boolean(booking.resourceId && booking.resourceTypeId),
    ),
    resources,
    otherConfirmedBookings.filter((booking): booking is BookingRef & { resourceId: string } =>
      Boolean(booking.resourceId),
    ),
    oldWindowStart,
    oldWindowEnd,
    targetWindowStart,
  );

  await tx.delete(resourceBookingsTable).where(and(
    eq(resourceBookingsTable.nuOrgId, projection.receiverAnOrgId),
    eq(resourceBookingsTable.sourceType, "TAKT_REQUEST"),
    inArray(resourceBookingsTable.sourceReferenceId, chainProjectionIds),
    eq(resourceBookingsTable.status, "CONFIRMED"),
  ));

  const values = assignments
    .filter((assignment) =>
      Boolean(assignment.resourceId) || (
        Boolean(assignment.resourceTypeId) && assignment.quantity > 0
      ),
    )
    .map((assignment) => ({
      nuOrgId: projection.receiverAnOrgId,
      resourceId: assignment.resourceId,
      resourceTypeId: assignment.resourceTypeId,
      quantity: assignment.resourceId ? null : assignment.quantity,
      sourceType: "TAKT_REQUEST" as const,
      sourceReferenceId: projection.id,
      startAt: input.useRequirementPeriods !== false && assignment.periodStart
        ? new Date(`${assignment.periodStart}T00:00:00Z`)
        : input.targetStart,
      endAt: input.useRequirementPeriods !== false && assignment.periodEnd
        ? new Date(`${addCalendarDays(assignment.periodEnd, 1)}T00:00:00Z`)
        : input.targetEnd,
      utilizationPercent: assignment.utilizationPercent,
      status: "CONFIRMED" as const,
      note: input.note,
    }));
  if (values.length) await tx.insert(resourceBookingsTable).values(values);

  await tx.update(anLeistungsanfragenTable).set({
    status: "CONFIRMED",
    updatedAt: new Date(),
  }).where(eq(anLeistungsanfragenTable.id, projection.id));
  return values;
}