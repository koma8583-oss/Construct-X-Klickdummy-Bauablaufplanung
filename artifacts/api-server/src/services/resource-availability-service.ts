export interface ResourceAvailabilityRequirement {
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
  missingQualifications: string[];
  tentativeWarnings: Array<{
    resourceId: string;
    bookingId: string;
    overlapStart: string;
    overlapEnd: string;
  }>;
}

export function shiftRequirementsToWindow<
  T extends { periodStart?: string | null; periodEnd?: string | null },
>(requirements: T[], originalWindowStart: Date, targetWindowStart: Date): T[] {
  const offsetDays = Math.round(
    (targetWindowStart.getTime() - originalWindowStart.getTime()) / (24 * 60 * 60 * 1000),
  );
  const shift = (value?: string | null) => {
    if (!value) return value;
    const date = parseDate(value);
    date.setUTCDate(date.getUTCDate() + offsetDays);
    return date.toISOString().slice(0, 10);
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
  };

  for (const requirement of requirements) {
    if (!requirement.resourceTypeId) continue;

    const typeResources = resources.filter(
      (resource) => resource.resourceTypeId === requirement.resourceTypeId,
    );
    const normalizedQualification = requirement.requiredQualification?.trim().toLocaleLowerCase();
    const eligibleResources = normalizedQualification
      ? typeResources.filter((resource) =>
          Array.isArray(resource.qualifications) &&
          (resource.qualifications as string[]).some(
            (qualification) =>
              qualification.trim().toLocaleLowerCase() === normalizedQualification,
          ),
        )
      : typeResources;

    if (eligibleResources.length === 0) {
      result.conflicts.push({
        resourceId: requirement.resourceTypeId,
        resourceName: requirement.notes ?? `ResourceType ${requirement.resourceTypeId}`,
        conflictType: normalizedQualification ? "MISSING_QUALIFICATION" : "MISSING_EQUIPMENT",
        missingQualification: normalizedQualification
          ? requirement.requiredQualification!.trim()
          : "Keine Ressource dieses Typs vorhanden",
        isTentative: false,
        overlapUtilizationSum: 0,
      });
      if (normalizedQualification) result.missingQualifications.push(requirement.requiredQualification!.trim());
      continue;
    }

    const effectiveStart = requirement.periodStart ? parseDate(requirement.periodStart) : windowStart;
    const effectiveEnd = requirement.periodEnd ? inclusiveEnd(requirement.periodEnd) : windowEnd;
    const requirementBookings = bookings.filter((booking) =>
      overlaps(booking.startAt, booking.endAt, effectiveStart, effectiveEnd),
    );
    const totalCapacity = eligibleResources.reduce(
      (sum, resource) => sum + (resource.capacity ?? 1),
      0,
    );
    const requiredCapacity = Number(requirement.requiredCapacity ?? 0);
    const effectiveRequired = requiredCapacity * requirement.utilizationPercent / 100;

    const usedCapacity = requirementBookings
      .filter((booking) => booking.status === "CONFIRMED")
      .reduce((sum, booking) => {
        if (booking.resourceId === null) {
          return booking.resourceTypeId === requirement.resourceTypeId
            ? sum + ((booking.quantity ?? 0) * booking.utilizationPercent) / 100
            : sum;
        }
        const resource = eligibleResources.find((candidate) => candidate.id === booking.resourceId);
        return resource
          ? sum + ((resource.capacity ?? 1) * booking.utilizationPercent) / 100
          : sum;
      }, 0);

    if (totalCapacity - usedCapacity < effectiveRequired) {
      result.conflicts.push({
        resourceId: requirement.resourceTypeId,
        resourceName: requirement.notes ?? `ResourceType ${requirement.resourceTypeId}`,
        conflictType: "CAPACITY_EXCEEDED",
        isTentative: false,
        overlapUtilizationSum: Math.round(usedCapacity),
      });
      continue;
    }

    result.availableResources.push({
      resourceId: null,
      resourceType: "DTC_TYPE",
      resourceTypeId: requirement.resourceTypeId,
      quantity: requiredCapacity,
      utilizationPercent: requirement.utilizationPercent,
      periodStart: requirement.periodStart ?? null,
      periodEnd: requirement.periodEnd ?? null,
    });

    const tentativeUsed = requirementBookings
      .filter((booking) => booking.status === "TENTATIVE")
      .reduce((sum, booking) => {
        if (booking.resourceId === null) {
          return booking.resourceTypeId === requirement.resourceTypeId
            ? sum + ((booking.quantity ?? 0) * booking.utilizationPercent) / 100
            : sum;
        }
        const resource = eligibleResources.find((candidate) => candidate.id === booking.resourceId);
        return resource
          ? sum + ((resource.capacity ?? 1) * booking.utilizationPercent) / 100
          : sum;
      }, 0);
    if (usedCapacity + tentativeUsed + effectiveRequired > totalCapacity) {
      for (const booking of requirementBookings.filter((item) => item.status === "TENTATIVE")) {
        result.tentativeWarnings.push({
          resourceId: booking.resourceId ?? requirement.resourceTypeId,
          bookingId: booking.id,
          overlapStart: booking.startAt.toISOString(),
          overlapEnd: booking.endAt.toISOString(),
        });
      }
    }
  }

  return result;
}