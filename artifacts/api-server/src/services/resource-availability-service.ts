import { addCalendarDays, differenceInCalendarDays, iterateCalendarDays } from "../lib/calendar-date-utils";

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
  options: { requireConcreteAssignments?: boolean } = {},
): Array<T & { resourceId: string | null; quantity: number }> {
  const shiftDays = differenceInCalendarDays(
    oldWindowStart.toISOString().slice(0, 10),
    newWindowStart.toISOString().slice(0, 10),
  );
  const shift = (date: Date) => {
    return new Date(`${addCalendarDays(date.toISOString().slice(0, 10), shiftDays)}T${date.toISOString().slice(11)}`);
  };
  const date = (value: string) => new Date(`${value}T00:00:00Z`);
  const inclusiveEnd = (value: string) => {
    return date(addCalendarDays(value, 1));
  };
  const shiftDateOnly = (value: string | null) =>
    value === null ? null : addCalendarDays(value, shiftDays);
  const overlaps = (aStart: Date, aEnd: Date, bStart: Date, bEnd: Date) =>
    aStart < bEnd && aEnd > bStart;
  const assignedIntervals: Array<{ resourceId: string; startAt: Date; endAt: Date }> = [];
  const output: Array<T & { resourceId: string | null; quantity: number }> = [];

  for (const requirement of requirements) {
    if (!requirement.resourceTypeId || Number(requirement.requiredCapacity ?? 0) <= 0) continue;
    const oldStart = requirement.periodStart ? date(requirement.periodStart) : oldWindowStart;
    const oldEnd = requirement.periodEnd ? inclusiveEnd(requirement.periodEnd) : oldWindowEnd;
    const shiftedRequirementStart = shift(oldStart);
    const shiftedRequirementEnd = shift(oldEnd);
    const targetRequirement = {
      ...requirement,
      periodStart: shiftDateOnly(requirement.periodStart),
      periodEnd: shiftDateOnly(requirement.periodEnd),
    };
    let remaining = Number(requirement.requiredCapacity);
    const usedForRequirement = new Set<string>();
    const candidates = oldBookings.filter((booking) => {
      if (usedForRequirement.has(booking.id) || booking.resourceTypeId !== requirement.resourceTypeId) return false;
      if (!overlaps(booking.startAt, booking.endAt, oldStart, oldEnd)) return false;
      const resource = resources.find((item) => item.id === booking.resourceId);
      if (!resource?.active || resource.resourceTypeId !== requirement.resourceTypeId) return false;
      return !otherConfirmedBookings.some((other) =>
        other.resourceId === booking.resourceId &&
        overlaps(shiftedRequirementStart, shiftedRequirementEnd, other.startAt, other.endAt)) &&
        !assignedIntervals.some((assigned) =>
          assigned.resourceId === booking.resourceId &&
          overlaps(shiftedRequirementStart, shiftedRequirementEnd, assigned.startAt, assigned.endAt));
    });

    for (const candidate of candidates) {
      if (remaining <= 0) break;
      const resource = resources.find((item) => item.id === candidate.resourceId)!;
      const covered = (resource.capacity ?? 1) * (candidate.utilizationPercent / 100);
      if (covered <= 0) continue;
      usedForRequirement.add(candidate.id);
      assignedIntervals.push({
        resourceId: candidate.resourceId,
        startAt: shiftedRequirementStart,
        endAt: shiftedRequirementEnd,
      });
      const residual = Math.max(0, remaining - covered);
      output.push({ ...targetRequirement, resourceId: candidate.resourceId, quantity: 0 });
      remaining = residual;
    }

    if (remaining > 0) {
      if (options.requireConcreteAssignments) {
        throw Object.assign(
          new Error("CHANGE_PROPOSAL_NOT_FEASIBLE"),
          { code: "CHANGE_PROPOSAL_NOT_FEASIBLE", statusCode: 409 },
        );
      }
      output.push({ ...targetRequirement, resourceId: null, quantity: remaining });
    }
  }
  return output;
}

export interface ResourceAvailabilityResult {
  conflicts: Array<{
    resourceId: string;
    resourceName: string;
    conflictType: "MISSING_EQUIPMENT" | "MISSING_QUALIFICATION" | "CAPACITY_EXCEEDED";
    /** Stable IDs of confirmed reservations active in the conflicting segment. */
    bookingIds?: string[];
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
    /** Capacity is evaluated for this atomic time segment only. */
    totalCapacity: number;
    confirmedUsed: number;
    tentativeUsed: number;
    /**
     * Sum of all concurrent requirement demand in the segment after each
     * requirement's utilization percentage is applied. Requirements in
     * sequential segments do not consume capacity at the same time.
     */
    requiredCapacity: number;
    /** Residual confirmed capacity before applying this segment's demand. */
    availableCapacity: number;
    projectedAvailableCapacity: number;
  }>;
  requirementAvailability?: Array<{
    requirementId?: string;
    /** Effective demand after utilization is applied. */
    requiredCapacity: number;
    /**
     * Minimum residual capacity available to this requirement across all of
     * its segments after reserving the other concurrent requirements.
     */
    availableCapacity: number;
    feasible: boolean;
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
    return addCalendarDays(value, offsetDays);
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
  return parseDate(addCalendarDays(value, 1));
}

function overlaps(startAt: Date, endAt: Date, start: Date, end: Date): boolean {
  return startAt < end && endAt > start;
}

type CapacityDemand = {
  amount: number;
  qualification: string | null;
};

function normalizedQualification(value: string | null | undefined): string | null {
  const normalized = value?.trim().toLocaleLowerCase();
  return normalized ? normalized : null;
}

function resourceMatchesQualification(
  resource: ResourceAvailabilityResource,
  qualification: string | null,
): boolean {
  if (!qualification) return true;
  // A concrete qualification requirement must be proven by an explicit,
  // matching entry. Missing, null, empty, malformed, and unknown metadata is
  // therefore non-matching; only the no-requirement case is open.
  if (!Array.isArray(resource.qualifications)) return false;
  return resource.qualifications.some((value) =>
    typeof value === "string" && normalizedQualification(value) === qualification);
}

/**
 * Maximum bipartite allocation for one time segment. Requirements are nodes
 * on the left and concrete resources on the right; qualification edges are
 * the only permitted connections. This prevents a shared resource from being
 * counted once per qualification group.
 */
function maxAllocatableCapacity(
  demands: CapacityDemand[],
  resources: ResourceAvailabilityResource[],
  capacities: Map<string, number>,
): number {
  type Edge = { to: number; reverse: number; capacity: number };
  const source = 0;
  const demandOffset = 1;
  const resourceOffset = demandOffset + demands.length;
  const sink = resourceOffset + resources.length;
  const graph: Edge[][] = Array.from({ length: sink + 1 }, () => []);

  const addEdge = (from: number, to: number, capacity: number) => {
    const forward: Edge = { to, reverse: graph[to].length, capacity };
    const reverse: Edge = { to: from, reverse: graph[from].length, capacity: 0 };
    graph[from].push(forward);
    graph[to].push(reverse);
  };

  demands.forEach((demand, demandIndex) => {
    addEdge(source, demandOffset + demandIndex, Math.max(0, demand.amount));
    resources.forEach((resource, resourceIndex) => {
      if (resourceMatchesQualification(resource, demand.qualification)) {
        addEdge(demandOffset + demandIndex, resourceOffset + resourceIndex, Number.POSITIVE_INFINITY);
      }
    });
  });
  resources.forEach((resource, resourceIndex) => {
    addEdge(resourceOffset + resourceIndex, sink, Math.max(0, capacities.get(resource.id) ?? 0));
  });

  let flow = 0;
  const epsilon = 1e-9;
  while (true) {
    const parent: Array<{ node: number; edge: number } | null> = Array(graph.length).fill(null);
    const queue = [source];
    parent[source] = { node: source, edge: -1 };
    for (let cursor = 0; cursor < queue.length && parent[sink] === null; cursor += 1) {
      const node = queue[cursor];
      graph[node].forEach((edge, edgeIndex) => {
        if (parent[edge.to] === null && edge.capacity > epsilon) {
          parent[edge.to] = { node, edge: edgeIndex };
          queue.push(edge.to);
        }
      });
    }
    if (parent[sink] === null) break;
    let augment = Number.POSITIVE_INFINITY;
    for (let node = sink; node !== source;) {
      const previous = parent[node]!;
      augment = Math.min(augment, graph[previous.node][previous.edge].capacity);
      node = previous.node;
    }
    for (let node = sink; node !== source;) {
      const previous = parent[node]!;
      const edge = graph[previous.node][previous.edge];
      edge.capacity -= augment;
      graph[node][edge.reverse].capacity += augment;
      node = previous.node;
    }
    flow += augment;
  }
  return flow;
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
    requirementAvailability: [],
  };

  const daily: NonNullable<ResourceAvailabilityResult["dailyAvailability"]> = [];
  const groups = new Map<string, ResourceAvailabilityRequirement[]>();
  for (const requirement of requirements) {
    if (!requirement.resourceTypeId) continue;
    groups.set(requirement.resourceTypeId, [...(groups.get(requirement.resourceTypeId) ?? []), requirement]);
  }
  for (const [resourceTypeId, groupedRequirements] of groups) {
    const typeResources = resources.filter((resource) => resource.resourceTypeId === resourceTypeId);
    const typeBookings = bookings.filter((booking) => booking.resourceTypeId === resourceTypeId);
    const boundaries = [...new Set([
      windowStart.getTime(),
      windowEnd.getTime(),
      ...groupedRequirements.flatMap((item) => [
        (item.periodStart ? parseDate(item.periodStart) : windowStart).getTime(),
        (item.periodEnd ? inclusiveEnd(item.periodEnd) : windowEnd).getTime(),
      ]),
      ...typeBookings.flatMap((booking) => [booking.startAt.getTime(), booking.endAt.getTime()]),
    ])].sort((left, right) => left - right);
    // Use the requirement object as the key. IDs are optional at this layer,
    // and using "" for every anonymous requirement would make one demand
    // overwrite another in overlapping groups.
    const availabilityByRequirement = new Map<ResourceAvailabilityRequirement, number>();
    const requiredByRequirement = new Map<ResourceAvailabilityRequirement, number>();
    const groupSegments: Array<{
      start: Date;
      end: Date;
      hardFeasible: boolean;
      confirmedUsed: number;
      tentativeUsed: number;
      requiredCapacity: number;
      confirmedBookingIds: string[];
    }> = [];
    let groupHasConflict = false;

    for (let index = 0; index < boundaries.length - 1; index += 1) {
      const segmentStart = new Date(boundaries[index]);
      const segmentEnd = new Date(boundaries[index + 1]);
      if (segmentEnd <= segmentStart) continue;
      const activeRequirements = groupedRequirements.filter((item) =>
        overlaps(
          item.periodStart ? parseDate(item.periodStart) : windowStart,
          item.periodEnd ? inclusiveEnd(item.periodEnd) : windowEnd,
          segmentStart,
          segmentEnd,
        ));
      if (activeRequirements.length === 0) continue;
      const activeBookings = typeBookings.filter((booking) =>
        overlaps(booking.startAt, booking.endAt, segmentStart, segmentEnd));
      const concreteConfirmed = activeBookings.filter((booking) =>
        booking.status === "CONFIRMED" && booking.resourceId !== null);
      const concreteTentative = activeBookings.filter((booking) =>
        booking.status === "TENTATIVE" && booking.resourceId !== null);
      const confirmedTypeDemands: CapacityDemand[] = activeBookings
        .filter((booking) => booking.status === "CONFIRMED" && booking.resourceId === null)
        .map((booking) => ({
          amount: (booking.quantity ?? 0) * booking.utilizationPercent / 100,
          qualification: null,
        }));
      const tentativeTypeDemands: CapacityDemand[] = activeBookings
        .filter((booking) => booking.status === "TENTATIVE" && booking.resourceId === null)
        .map((booking) => ({
          amount: (booking.quantity ?? 0) * booking.utilizationPercent / 100,
          qualification: null,
        }));
      const confirmedCapacity = new Map(typeResources.map((resource) => [
        resource.id,
        Math.max(0, (resource.capacity ?? 1) - concreteConfirmed
          .filter((booking) => booking.resourceId === resource.id)
          .reduce((sum, booking) => sum + (resource.capacity ?? 1) * booking.utilizationPercent / 100, 0)),
      ]));
      const projectedCapacity = new Map(typeResources.map((resource) => [
        resource.id,
        Math.max(0, (confirmedCapacity.get(resource.id) ?? 0) - concreteTentative
          .filter((booking) => booking.resourceId === resource.id)
          .reduce((sum, booking) => sum + (resource.capacity ?? 1) * booking.utilizationPercent / 100, 0)),
      ]));
      const requirementDemands = activeRequirements.map((item) => ({
        amount: Number(item.requiredCapacity ?? 0) * item.utilizationPercent / 100,
        qualification: normalizedQualification(item.requiredQualification),
      }));
      const confirmedDemands = [...requirementDemands, ...confirmedTypeDemands];
      const projectedDemands = [...confirmedDemands, ...tentativeTypeDemands];
      const hardDemand = requirementDemands.reduce((sum, demand) => sum + demand.amount, 0);
      const confirmedUsed = typeResources.reduce((sum, resource) =>
        sum + (resource.capacity ?? 1) - (confirmedCapacity.get(resource.id) ?? 0), 0) +
        confirmedTypeDemands.reduce((sum, demand) => sum + demand.amount, 0);
      const tentativeUsed = typeResources.reduce((sum, resource) =>
        sum + (confirmedCapacity.get(resource.id) ?? 0) - (projectedCapacity.get(resource.id) ?? 0), 0) +
        tentativeTypeDemands.reduce((sum, demand) => sum + demand.amount, 0);
      const hardFlow = maxAllocatableCapacity(confirmedDemands, typeResources, confirmedCapacity);
      const projectedFlow = maxAllocatableCapacity(projectedDemands, typeResources, projectedCapacity);
      const hardFeasible = hardFlow + 1e-9 >= confirmedDemands.reduce((sum, demand) => sum + demand.amount, 0);
      const projectedFeasible = projectedFlow + 1e-9 >= projectedDemands.reduce((sum, demand) => sum + demand.amount, 0);
      const totalCapacity = typeResources.reduce((sum, resource) => sum + (resource.capacity ?? 1), 0);
      const availableCapacity = Math.max(0, totalCapacity - confirmedUsed);
      const projectedAvailableCapacity = Math.max(0, availableCapacity - tentativeUsed);
      const activeRequired = activeRequirements.reduce((sum, item) =>
        sum + Number(item.requiredCapacity ?? 0) * item.utilizationPercent / 100, 0);
      groupSegments.push({
        start: segmentStart,
        end: segmentEnd,
        hardFeasible,
        confirmedUsed,
        tentativeUsed,
        requiredCapacity: activeRequired,
        confirmedBookingIds: activeBookings
          .filter((booking) => booking.status === "CONFIRMED")
          .map((booking) => booking.id),
      });
      if (!hardFeasible) groupHasConflict = true;
      for (const requirement of activeRequirements) {
        const demand = Number(requirement.requiredCapacity ?? 0) * requirement.utilizationPercent / 100;
        const otherDemand = activeRequirements.reduce((sum, item) =>
          sum + Number(item.requiredCapacity ?? 0) * item.utilizationPercent / 100, 0) - demand;
        const previous = availabilityByRequirement.get(requirement);
        const availableForRequirement = Math.max(0, availableCapacity - otherDemand);
        if (previous === undefined || availableForRequirement < previous) {
          availabilityByRequirement.set(requirement, availableForRequirement);
        }
        requiredByRequirement.set(requirement, demand);
      }
      if (!projectedFeasible) {
        for (const booking of activeBookings.filter((item) => item.status === "TENTATIVE")) {
          if (!result.tentativeWarnings.some((warning) => warning.bookingId === booking.id)) {
            result.tentativeWarnings.push({
              resourceId: booking.resourceId ?? resourceTypeId,
              bookingId: booking.id,
              overlapStart: booking.startAt.toISOString(),
              overlapEnd: booking.endAt.toISOString(),
            });
          }
        }
      }
      daily.push({
        resourceTypeId,
        requiredQualification: activeRequirements.length === 1
          ? activeRequirements[0].requiredQualification ?? null
          : null,
        date: segmentStart.toISOString().slice(0, 10),
        totalCapacity,
        confirmedUsed,
        tentativeUsed,
        requiredCapacity: activeRequired,
        availableCapacity,
        projectedAvailableCapacity,
      });
    }
    const missing = groupedRequirements.filter((requirement) =>
      normalizedQualification(requirement.requiredQualification) &&
      !typeResources.some((resource) => resourceMatchesQualification(
        resource,
        normalizedQualification(requirement.requiredQualification),
      )));
    for (const requirement of missing) {
      const qualification = requirement.requiredQualification!.trim();
      if (!result.missingQualifications.includes(qualification)) result.missingQualifications.push(qualification);
    }
    if (typeResources.length === 0) {
      result.conflicts.push({
        resourceId: resourceTypeId,
        resourceName: groupedRequirements[0].notes ?? `ResourceType ${resourceTypeId}`,
        conflictType: "MISSING_EQUIPMENT",
        isTentative: false,
        overlapUtilizationSum: 0,
      });
    } else if (missing.length > 0) {
      result.conflicts.push({
        resourceId: resourceTypeId,
        resourceName: groupedRequirements[0].notes ?? `ResourceType ${resourceTypeId}`,
        conflictType: "MISSING_QUALIFICATION",
        missingQualification: missing[0].requiredQualification!.trim(),
        isTentative: false,
        overlapUtilizationSum: 0,
      });
    } else if (groupHasConflict) {
      result.conflicts.push({
        resourceId: resourceTypeId,
        resourceName: groupedRequirements[0].notes ?? `ResourceType ${resourceTypeId}`,
        conflictType: "CAPACITY_EXCEEDED",
        isTentative: false,
        overlapUtilizationSum: Math.round(Math.max(...groupSegments.map((segment) => segment.confirmedUsed), 0)),
        bookingIds: [...new Set(
          groupSegments
            .filter((segment) => !segment.hardFeasible)
            .flatMap((segment) => segment.confirmedBookingIds),
        )].sort(),
      });
    } else {
      for (const segment of groupedRequirements) {
        result.bookingRequirements.push({
          ...(segment.id ? { resourceRequirementId: segment.id } : {}),
          resourceTypeId,
          quantity: Number(segment.requiredCapacity ?? 0),
          utilizationPercent: segment.utilizationPercent,
          periodStart: segment.periodStart ?? null,
          periodEnd: segment.periodEnd ?? null,
          requiredQualification: segment.requiredQualification ?? null,
        });
        const availableCapacity = availabilityByRequirement.get(segment) ??
          Number(segment.requiredCapacity ?? 0);
        result.requirementAvailability!.push({
          ...(segment.id ? { requirementId: segment.id } : {}),
          requiredCapacity: requiredByRequirement.get(segment) ?? 0,
          availableCapacity,
          feasible: availableCapacity + 1e-9 >=
            (requiredByRequirement.get(segment) ?? 0),
        });
        result.availableResources.push({
          resourceId: null,
          resourceType: "DTC_TYPE",
          resourceTypeId: resourceTypeId,
          quantity: availableCapacity,
          utilizationPercent: segment.utilizationPercent,
          periodStart: segment.periodStart ?? null,
          periodEnd: segment.periodEnd ?? null,
        });
      }
    }
    if (groupHasConflict) {
      for (const segment of groupedRequirements) {
        result.requirementAvailability!.push({
          ...(segment.id ? { requirementId: segment.id } : {}),
          requiredCapacity: requiredByRequirement.get(segment) ??
            Number(segment.requiredCapacity ?? 0) * segment.utilizationPercent / 100,
          availableCapacity: availabilityByRequirement.get(segment) ?? 0,
          feasible: false,
        });
      }
    }
  }
  result.dailyAvailability = daily;

  return result;
}