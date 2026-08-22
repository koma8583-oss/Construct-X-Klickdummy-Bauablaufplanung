import { and, eq } from "drizzle-orm";
import {
  leistungenTable,
  leistungsanfragenTable,
  resourceBookingsTable,
} from "@workspace/db";

function dateOnly(value: Date | string): string {
  return (value instanceof Date ? value.toISOString() : value).slice(0, 10);
}

function shiftDate(value: Date, deltaMs: number): Date {
  return new Date(value.getTime() + deltaMs);
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
  const deltaMs = input.newStart.getTime() - oldStart.getTime();
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
  for (const booking of ownedBookings) {
    await tx.update(resourceBookingsTable).set({
      startAt: shiftDate(booking.startAt, deltaMs),
      endAt: shiftDate(booking.endAt, deltaMs),
      updatedAt: new Date(),
    }).where(eq(resourceBookingsTable.id, booking.id));
  }

  const [request] = await tx.update(leistungsanfragenTable).set({
    agreedStart: input.newStart,
    agreedEnd: input.newEnd,
    updatedAt: new Date(),
  }).where(eq(leistungsanfragenTable.id, input.serviceRequestId)).returning();
  return { request, service, updatedBookingCount: ownedBookings.length };
}