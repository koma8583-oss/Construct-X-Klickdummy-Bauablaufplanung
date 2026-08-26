import { and, eq } from "drizzle-orm";
import {
  leistungenTable,
  leistungsanfragenTable,
  leistungsanfrageResourceRequirementsTable,
  leistungsVersionenTable,
} from "@workspace/db";
import { shiftRequirementsToWindow } from "./resource-availability-service";

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

/**
 * Apply the AG-owned part of an accepted schedule change.
 *
 * Resource inventories, availability and resource bookings deliberately do not
 * appear here. They are private AN data and are updated only by the AN-local
 * response workflow. This transaction is called only after that response has
 * crossed the Dataspace inbound boundary.
 */
export async function applyAcceptedScheduleChange(
  tx: any,
  input: {
    serviceRequestId: string;
    newStart: Date;
    newEnd: Date;
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
  if (input.newEnd <= input.newStart) {
    throw Object.assign(new Error("Ende muss nach dem Beginn liegen"), { statusCode: 400 });
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

  const shiftedRequirements = shiftRequirementsToWindow(
    requirements,
    requestRow.request.agreedStart,
    input.newStart,
  ).map((requirement) => ({
    ...requirement,
    periodStart: requirement.periodStart ?? dateOnly(input.newStart),
    periodEnd: requirement.periodEnd ?? dateOnly(input.newEnd),
  }));

  const nextVersion = requestRow.service.version + 1;
  await tx.update(leistungenTable).set({
    plannedStart: dateOnly(input.newStart),
    plannedEnd: dateOnly(input.newEnd),
    version: nextVersion,
    lifecycleStatus: "CONFIRMED",
    status: "BESTAETIGT",
    updatedAt: new Date(),
  }).where(eq(leistungenTable.id, requestRow.service.id));

  for (const requirement of shiftedRequirements) {
    await tx.update(leistungsanfrageResourceRequirementsTable).set({
      periodStart: requirement.periodStart,
      periodEnd: requirement.periodEnd,
      updatedAt: new Date(),
    }).where(eq(leistungsanfrageResourceRequirementsTable.id, requirement.id));
  }

  await tx.insert(leistungsVersionenTable).values({
    leistungId: requestRow.service.id,
    version: nextVersion,
    sourceType: "MANUAL_EDIT",
    sourceRequestId: input.serviceRequestId,
    snapshotPayload: {
      ...(requestRow.service as unknown as Record<string, unknown>),
      plannedStart: dateOnly(input.newStart),
      plannedEnd: dateOnly(input.newEnd),
      version: nextVersion,
    },
    createdByUserId: null,
  });

  const [request] = await tx.update(leistungsanfragenTable).set({
    agreedStart: input.newStart,
    agreedEnd: input.newEnd,
    updatedAt: new Date(),
  }).where(eq(leistungsanfragenTable.id, input.serviceRequestId)).returning();

  return {
    request,
    service: requestRow.service,
    updatedBookingCount: 0,
  };
}