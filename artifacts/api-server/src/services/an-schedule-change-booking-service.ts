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
  evaluateResourceRequirements,
} from "./resource-availability-service";
import { lockAnConfirmedCapacity } from "./an-capacity-lock-service";

export class AcceptedScheduleCapacityConflictError extends Error {
  constructor() {
    super("The accepted schedule is no longer feasible with current confirmed bookings");
    this.name = "AcceptedScheduleCapacityConflictError";
  }
}

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
  requiredQualification: string | null;
};

type BookingRef = {
  id: string;
  sourceReferenceId: string | null;
  sourceType: string;
  resourceTypeId: string | null;
  resourceId: string | null;
  startAt: Date;
  endAt: Date;
  utilizationPercent: number;
  quantity: string | null;
  status: "CONFIRMED";
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

  // Serialize every confirmed-booking decision for one AN. The feasibility
  // read and booking write below then observe a stable shared capacity pool,
  // so concurrent acceptances cannot both consume the same remaining units.
  await lockAnConfirmedCapacity(tx, projection.receiverAnOrgId);

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
    sourceType: resourceBookingsTable.sourceType,
    resourceTypeId: resourceBookingsTable.resourceTypeId,
    resourceId: resourceBookingsTable.resourceId,
    startAt: resourceBookingsTable.startAt,
    endAt: resourceBookingsTable.endAt,
    utilizationPercent: resourceBookingsTable.utilizationPercent,
    quantity: resourceBookingsTable.quantity,
    status: resourceBookingsTable.status,
  }).from(resourceBookingsTable).where(and(
    eq(resourceBookingsTable.nuOrgId, projection.receiverAnOrgId),
    eq(resourceBookingsTable.status, "CONFIRMED"),
  ));
  const chainBookings = previousBookings.filter((booking: BookingRef) =>
    booking.sourceType === "TAKT_REQUEST" &&
    chainProjectionIds.includes(booking.sourceReferenceId ?? ""),
  );
  const otherConfirmedBookings = previousBookings.filter((booking: BookingRef) =>
    booking.sourceType !== "TAKT_REQUEST" ||
    !chainProjectionIds.includes(booking.sourceReferenceId ?? ""),
  );
  const resources = await tx.select({
    id: resourcesTable.id,
    resourceTypeId: resourcesTable.resourceTypeId,
    type: resourcesTable.type,
    name: resourcesTable.name,
    capacity: resourcesTable.capacity,
    qualifications: resourcesTable.qualifications,
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
  const targetRequirements = input.useRequirementPeriods === false
    ? oldRequirements.map((requirement) => ({
      ...requirement,
      periodStart: null,
      periodEnd: null,
    }))
    : requirements.map((requirement) => ({
      ...requirement,
      resourceTypeId: requirement.localResourceTypeId,
    }));
  const feasibility = evaluateResourceRequirements({
    requirements: targetRequirements
      .filter((requirement): requirement is typeof requirement & { resourceTypeId: string } =>
        Boolean(requirement.resourceTypeId),
      )
      .map((requirement) => ({
        id: requirement.id,
        resourceTypeId: requirement.resourceTypeId,
        requiredCapacity: requirement.requiredCapacity,
        utilizationPercent: requirement.utilizationPercent,
        requiredQualification: requirement.requiredQualification,
        periodStart: requirement.periodStart,
        periodEnd: requirement.periodEnd,
      })),
    resources: resources.map((resource: any) => ({
      id: resource.id,
      resourceTypeId: resource.resourceTypeId,
      type: resource.type,
      name: resource.name,
      capacity: resource.capacity,
      qualifications: resource.qualifications,
    })),
    bookings: otherConfirmedBookings.map((booking: any) => ({
      id: booking.id,
      resourceId: booking.resourceId,
      resourceTypeId: booking.resourceTypeId,
      quantity: booking.quantity,
      startAt: booking.startAt,
      endAt: booking.endAt,
      status: booking.status,
      utilizationPercent: booking.utilizationPercent,
    })),
    windowStart: input.targetStart,
    windowEnd: input.targetEnd,
  });
  if (
    requirements.some((requirement) => !requirement.localResourceTypeId) ||
    feasibility.conflicts.length > 0
  ) {
    throw new AcceptedScheduleCapacityConflictError();
  }
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