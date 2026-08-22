import { and, eq } from "drizzle-orm";
import { resourceBookingsTable } from "@workspace/db";

export interface BookingRequirement {
  resourceRequirementId?: string;
  resourceTypeId: string;
  quantity: number;
  utilizationPercent: number;
  periodStart: string | null;
  periodEnd: string | null;
}

export interface PreservedBookingAssignment {
  resourceRequirementId: string;
  resourceId: string;
}

function toExclusiveEnd(periodEnd: string): Date {
  const end = new Date(`${periodEnd}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() + 1);
  return end;
}

/**
 * The single persistence path from unaggregated requirement segments to
 * confirmed request bookings. Feasibility decisions remain with the caller.
 */
export async function applyConfirmedBookingsFromRequirements(
  tx: any,
  input: {
    serviceRequestId: string;
    nuOrgId: string;
    requirements: BookingRequirement[];
    preservedAssignments?: PreservedBookingAssignment[];
    replaceExisting?: boolean;
  },
) {
  const assignments = new Map(
    (input.preservedAssignments ?? []).map((assignment) => [
      assignment.resourceRequirementId,
      assignment.resourceId,
    ]),
  );

  if (input.replaceExisting !== false) {
    await tx.delete(resourceBookingsTable).where(and(
      eq(resourceBookingsTable.sourceType, "TAKT_REQUEST"),
      eq(resourceBookingsTable.sourceReferenceId, input.serviceRequestId),
      eq(resourceBookingsTable.status, "CONFIRMED"),
    ));
  }

  const values = input.requirements
    .filter((requirement) => requirement.resourceTypeId && requirement.quantity > 0)
    .map((requirement) => {
      const resourceId = requirement.resourceRequirementId
        ? assignments.get(requirement.resourceRequirementId) ?? null
        : null;
      return {
        nuOrgId: input.nuOrgId,
        resourceId,
        resourceTypeId: requirement.resourceTypeId,
        quantity: resourceId ? null : requirement.quantity,
        sourceType: "TAKT_REQUEST" as const,
        sourceReferenceId: input.serviceRequestId,
        startAt: new Date(`${requirement.periodStart ?? ""}T00:00:00Z`),
        endAt: toExclusiveEnd(requirement.periodEnd ?? requirement.periodStart ?? ""),
        utilizationPercent: requirement.utilizationPercent,
        status: "CONFIRMED" as const,
      };
    });

  if (values.length > 0) await tx.insert(resourceBookingsTable).values(values);
  return values;
}