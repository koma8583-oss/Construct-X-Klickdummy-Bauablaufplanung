import { differenceInCalendarDays, iterateCalendarDays, shiftCalendarDate } from "../lib/calendar-date-utils";

export interface ResourceAvailabilityRequirement {
  id?: string;
  resourceTypeId: string | null;
  requiredCapacity: string | number | null;
  utilizationPercent: number;
  requiredQualification: string | null;
  periodStart?: string | null;
  periodEnd?: string | null;
  notes?: string | null;
}

export interface ResourceAvailabilityResource {
  id: string;
  type: string;
  name: string;
  capacity: number | null;
  qualifications: unknown;
  resourceTypeId: string | null;
}

export interface ResourceAvailabilityBooking {
  id: string;
  resourceId: string | null;
  resourceTypeId: string | null;
  quantity: number | null;
  startAt: Date;
  endAt: Date;
  status: "CONFIRMED" | "CANCELLED" | "TENTATIVE";
  utilizationPercent: number;
}

export interface ConcreteAssignmentCandidate {
  id: string;
  resourceId: string;
  resourceTypeId: string | null;
  startAt: Date;
  endAt: Date;
  utilizationPercent: number;
}

export interface ConcreteAssignmentResource {
  id: string;
  resourceTypeId: string | null;
  capacity: number | null;
  active: boolean;
}

/**
 * Re-associate old concrete bookings with the requirement segments after a
 * schedule shift. A resource is only reused once and only when no other
 * confirmed booking occupies its shifted interval. Unmatched capacity is
 * returned as a type-level quantity so callers can safely recreate bookings.
 */
export function restoreConcreteResourceAssignments<
  T extends {
    resourceTypeId: string | null;
    requiredCapacity: string | number | null;
    utilizationPercent: number;
    periodStart: string | null;
    periodEnd: string | null;
  },
>(
  requirements: T[],
  oldBookings: ConcreteAssignmentCandidate[],
  resources: ConcreteAssignmentResource[],
  otherConfirmedBookings: Pick<ConcreteAssignmentCandidate, "resourceId" | "startAt" | "endAt">[],
  oldWindowStart: Date,
  oldWindowEnd: Date,
  newWindowStart: Date,
): Array<T & { resourceId: string | null; quantity: number }> {
  const shiftDays = differenceInCalendarDays(
    oldWindowStart.toISOString().slice(0, 10),
    newWindowStart.toISOString().slice(0, 10),
  );
  const shift = (date: Date) => {
    const shifted = new Date(date);
    shifted.setUTCDate(shifted.getUTCDate() + shiftDays);
    return shifted;
  };
  const date = (value: string) => new Date(`${value}T00:00:00Z`);
  const inclusiveEnd = (value: string) => {
    const result = date(value);
    result.setUTCDate(result.getUTCDate() + 1);
    return result;
  };
  const overlaps = (aStart: Date, aEnd: Date, bStart: Date, bEnd: Date) =>
    aStart < bEnd && aEnd > bStart;
  const used = new Set<string>();
  const output: Array<T & { resourceId: string | null; quantity: number }> = [];

  for (const requirement of requirements) {
    if (!requirement.resourceTypeId || Number(requirement.requiredCapacity ?? 0) <= 0) continue;
    const oldStart = requirement.periodStart ? date(requirement.periodStart) : oldWindowStart;
    const oldEnd = requirement.periodEnd ? inclusiveEnd(requirement.periodEnd) : oldWindowEnd;
    const candidate = oldBookings.find((booking) => {
      if (used.has(booking.id) || booking.resourceTypeId !== requirement.resourceTypeId) return false;
      if (!overlaps(booking.startAt, booking.endAt, oldStart, oldEnd)) return false;
      const resource = resources.find((item) => item.id === booking.resourceId);
      if (!resource?.active || resource.resourceTypeId !== requirement.resourceTypeId) return false;
      const shiftedStart = shift(booking.startAt);
      const shiftedEnd = shift(booking.endAt);
      return !otherConfirmedBookings.some((other) =>
        other.resourceId === booking.resourceId &&
        overlaps(shiftedStart, shiftedEnd, other.startAt, other.endAt));
    });
    if (!candidate) {
      output.push({ ...requirement, resourceId: null, quantity: Number(requirement.requiredCapacity) });
      continue;
    }
    used.add(candidate.id);
    const resource = resources.find((item) => item.id === candidate.resourceId)!;
    const utilization = requirement.utilizationPercent / 100;
    const covered = (resource.capacity ?? 1) * utilization;
    const required = Number(requirement.requiredCapacity);
    output.push({
      ...requirement,
      resourceId: candidate.resourceId,
      quantity: Math.max(0, required - covered / utilization),
    });
  }
  return output;
}

export interface ResourceAvailabilityResult {
  conflicts: Array<{
    resourceId: string;
    resourceName: string;
    conflictType: "MISSING_EQUIPMENT" | "MISSING_QUALIFICATION" | "CAPACITY_EXCEEDED";
    missingQualification?: string;
    isTentative: boolean;
    overlapUtilizationSum: number;
  }>;
  availableResources: Array<{
    resourceId: null;
    resourceType: "DTC_TYPE";
    resourceTypeId: string;
    quantity: number;
    utilizationPercent: number;
    periodStart: string | null;
    periodEnd: string | null;
  }>;
  /** Unaggregated requirement segments used to create automatic bookings. */
  bookingRequirements: Array<{
    resourceRequirementId?: string;
    resourceTypeId: string;
    quantity: number;
    utilizationPercent: number;
    periodStart: string | null;
    periodEnd: string | null;
    requiredQualification: string | null;
  }>;
  missingQualifications: string[];
  tentativeWarnings: Array<{
    resourceId: string;
    bookingId: string;
    overlapStart: string;
    overlapEnd: string;
  }>;
  dailyAvailability?: Array<{
    resourceTypeId: string;
    requiredQualification: string | null;
    date: string;
    totalCapacity: number;
    confirmedUsed: number;
    tentativeUsed: number;
    requiredCapacity: number;
    availableCapacity: number;
    projectedAvailableCapacity: number;
  }>;
}

export function shiftRequirementsToWindow<
  T extends { periodStart?: string | null; periodEnd?: string | null },
>(requirements: T[], currentWindowStart: Date, targetWindowStart: Date): T[] {
  const offsetDays = differenceInCalendarDays(
    currentWindowStart.toISOString().slice(0, 10),
    targetWindowStart.toISOString().slice(0, 10),
  );
  const shift = (value?: string | null) => {
    if (!value) return value;
    return shiftCalendarDate(value, offsetDays);
  };
  return requirements.map((requirement) => ({
    ...requirement,
    periodStart: shift(requirement.periodStart),
    periodEnd: shift(requirement.periodEnd),
  }));
}

function parseDate(value: string): Date {
  return new Date(`${value}T00:00:00Z`);
}

function inclusiveEnd(value: string): Date {
  const end = parseDate(value);
  end.setUTCDate(end.getUTCDate() + 1);
  return end;
}

function overlaps(startAt: Date, endAt: Date, start: Date, end: Date): boolean {
  return startAt < end && endAt > start;
}

export function evaluateResourceRequirements({
  requirements,
  resources,
  bookings,
  windowStart,
  windowEnd,
}: {
  requirements: ResourceAvailabilityRequirement[];
  resources: ResourceAvailabilityResource[];
  bookings: ResourceAvailabilityBooking[];
  windowStart: Date;
  windowEnd: Date;
}): ResourceAvailabilityResult {
  const result: ResourceAvailabilityResult = {
    conflicts: [],
    availableResources: [],
    missingQualifications: [],
    tentativeWarnings: [],
    bookingRequirements: [],
  };

  const daily: NonNullable<ResourceAvailabilityResult["dailyAvailability"]> = [];
  const groups = new Map<string, ResourceAvailabilityRequirement[]>();
  for (const requirement of requirements) {
    if (!requirement.resourceTypeId) continue;
    const key = `${requirement.resourceTypeId}:${requirement.requiredQualification?.trim().toLocaleLowerCase() ?? ""}`;
    groups.set(key, [...(groups.get(key) ?? []), requirement]);
  }
  const dayKey = (date: Date) => date.toISOString().slice(0, 10);
  const daysFor = (start: Date, end: Date) =>
    iterateCalendarDays(dayKey(start), dayKey(new Date(end.getTime() - 1)))
      .map((day) => parseDate(day));

  for (const groupedRequirements of groups.values()) {
    const requirement = groupedRequirements[0];
    const typeResources = resources.filter((resource) => resource.resourceTypeId === requirement.resourceTypeId);
    const normalizedQualification = requirement.requiredQualification?.trim().toLocaleLowerCase();
    const eligibleResources = normalizedQualification
      ? typeResources.filter((resource) => Array.isArray(resource.qualifications) &&
        (resource.qualifications as string[]).some((qualification) =>
          qualification.trim().toLocaleLowerCase() === normalizedQualification))
      : typeResources;
    if (eligibleResources.length === 0) {
      result.conflicts.push({
        resourceId: requirement.resourceTypeId!,
        resourceName: requirement.notes ?? `ResourceType ${requirement.resourceTypeId}`,
        conflictType: normalizedQualification ? "MISSING_QUALIFICATION" : "MISSING_EQUIPMENT",
        missingQualification: normalizedQualification ? requirement.requiredQualification!.trim() : "Keine Ressource dieses Typs vorhanden",
        isTentative: false,
        overlapUtilizationSum: 0,
      });
      if (normalizedQualification) result.missingQualifications.push(requirement.requiredQualification!.trim());
      continue;
    }
    const totalCapacity = eligibleResources.reduce((sum, resource) => sum + (resource.capacity ?? 1), 0);
    const start = new Date(Math.min(...groupedRequirements.map((item) => (item.periodStart ? parseDate(item.periodStart) : windowStart).getTime())));
    const end = new Date(Math.max(...groupedRequirements.map((item) => (item.periodEnd ? inclusiveEnd(item.periodEnd) : windowEnd).getTime())));
    let groupHasConflict = false;
    for (const day of daysFor(start, end)) {
      const dayStart = day;
      const dayEnd = new Date(day);
      dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);
      const requiredCapacity = groupedRequirements.reduce((sum, item) => {
        const itemStart = item.periodStart ? parseDate(item.periodStart) : windowStart;
        const itemEnd = item.periodEnd ? inclusiveEnd(item.periodEnd) : windowEnd;
        return overlaps(itemStart, itemEnd, dayStart, dayEnd)
          ? sum + Number(item.requiredCapacity ?? 0) * item.utilizationPercent / 100
          : sum;
      }, 0);
      if (requiredCapacity === 0) continue;
      const dayBookings = bookings.filter((booking) =>
        booking.resourceTypeId === requirement.resourceTypeId &&
        overlaps(booking.startAt, booking.endAt, dayStart, dayEnd));
      const usedFor = (status: "CONFIRMED" | "TENTATIVE") => dayBookings
        .filter((booking) => booking.status === status)
        .reduce((sum, booking) => {
          if (booking.resourceId === null) return sum + (booking.quantity ?? 0) * booking.utilizationPercent / 100;
          const resource = eligibleResources.find((candidate) => candidate.id === booking.resourceId);
          return sum + (resource ? (resource.capacity ?? 1) * booking.utilizationPercent / 100 : 0);
        }, 0);
      const confirmedUsed = usedFor("CONFIRMED");
      const tentativeUsed = usedFor("TENTATIVE");
      daily.push({
        resourceTypeId: requirement.resourceTypeId!,
        requiredQualification: requirement.requiredQualification ?? null,
        date: dayKey(day), totalCapacity, confirmedUsed, tentativeUsed,
        requiredCapacity, availableCapacity: totalCapacity - confirmedUsed,
        projectedAvailableCapacity: totalCapacity - confirmedUsed - tentativeUsed,
      });
      if (totalCapacity - confirmedUsed < requiredCapacity) {
        groupHasConflict = true;
      }
      if (totalCapacity - confirmedUsed - tentativeUsed < requiredCapacity) {
        for (const booking of dayBookings.filter((item) => item.status === "TENTATIVE")) {
          if (!result.tentativeWarnings.some((warning) => warning.bookingId === booking.id)) {
            result.tentativeWarnings.push({
              resourceId: booking.resourceId ?? requirement.resourceTypeId!,
              bookingId: booking.id,
              overlapStart: booking.startAt.toISOString(),
              overlapEnd: booking.endAt.toISOString(),
            });
          }
        }
      }
    }
    if (groupHasConflict) {
      const groupDays = daily.filter((item) => item.requiredCapacity > 0 && item.date >= dayKey(start) && item.date < dayKey(end));
      result.conflicts.push({
        resourceId: requirement.resourceTypeId!,
        resourceName: requirement.notes ?? `ResourceType ${requirement.resourceTypeId}`,
        conflictType: "CAPACITY_EXCEEDED",
        isTentative: false,
        overlapUtilizationSum: Math.round(Math.max(...groupDays.map((item) => item.confirmedUsed), 0)),
      });
    } else {
      for (const segment of groupedRequirements) {
        result.bookingRequirements.push({
          ...(segment.id ? { resourceRequirementId: segment.id } : {}),
          resourceTypeId: requirement.resourceTypeId!,
          quantity: Number(segment.requiredCapacity ?? 0),
          utilizationPercent: segment.utilizationPercent,
          periodStart: segment.periodStart ?? null,
          periodEnd: segment.periodEnd ?? null,
          requiredQualification: segment.requiredQualification ?? null,
        });
      }
      const first = groupedRequirements[0];
      result.availableResources.push({
        resourceId: null,
        resourceType: "DTC_TYPE",
        resourceTypeId: requirement.resourceTypeId!,
        quantity: groupedRequirements.reduce((sum, item) => sum + Number(item.requiredCapacity ?? 0), 0),
        utilizationPercent: first.utilizationPercent,
        periodStart: first.periodStart ?? null,
        periodEnd: first.periodEnd ?? null,
      });
    }
  }
  result.dailyAvailability = daily;

  return result;
}