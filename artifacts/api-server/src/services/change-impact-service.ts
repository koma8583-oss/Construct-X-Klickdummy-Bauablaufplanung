import { and, eq, inArray } from "drizzle-orm";
import { agDb as db } from "@workspace/db";
import {
  leistungenTable,
  leistungsanfragenTable,
  leistungsabhaengigkeitenTable,
} from "@workspace/db";
import { addCalendarDays, differenceInCalendarDays, toCalendarDate } from "../lib/calendar-date-utils";

export type ChangeImpact = {
  affectedServices: Array<{
    serviceRequestId: string;
    serviceName: string;
    currentStart: string | null;
    currentEnd: string | null;
    requiredEarliestStart: string;
    impactDays: number;
  }>;
};

export async function evaluateChangeImpact(input: {
  serviceRequestId: string;
  guOrgId: string;
  proposedStart: Date;
  proposedEnd: Date;
}): Promise<ChangeImpact> {
  // 1. Look up the Leistung associated with the source service request.
  const [sourceRequest] = await db
    .select({ leistungId: leistungsanfragenTable.leistungId, projectId: leistungenTable.projectId })
    .from(leistungsanfragenTable)
    .innerJoin(leistungenTable, eq(leistungsanfragenTable.leistungId, leistungenTable.id))
    .where(and(
      eq(leistungsanfragenTable.id, input.serviceRequestId),
      eq(leistungsanfragenTable.guOrgId, input.guOrgId),
    ))
    .limit(1);

  if (!sourceRequest) return { affectedServices: [] };

  // 2. Find all Leistung-level successors via leistungsabhaengigkeiten (canonical table).
  const leistungDeps = await db
    .select()
    .from(leistungsabhaengigkeitenTable)
    .where(eq(leistungsabhaengigkeitenTable.predecessorId, sourceRequest.leistungId));

  if (!leistungDeps.length) return { affectedServices: [] };

  const successorLeistungIds = leistungDeps.map((d) => d.successorId);

  // 3. Find active Leistungsanfragen for those successor Leistungen.
  const successorRequests = await db
    .select({
      request: leistungsanfragenTable,
      service: leistungenTable,
    })
    .from(leistungsanfragenTable)
    .innerJoin(leistungenTable, eq(leistungsanfragenTable.leistungId, leistungenTable.id))
    .where(and(
      inArray(leistungsanfragenTable.leistungId, successorLeistungIds),
      eq(leistungsanfragenTable.guOrgId, input.guOrgId),
      eq(leistungenTable.projectId, sourceRequest.projectId),
    ));

  const result: ChangeImpact["affectedServices"] = [];

  for (const { request: successor, service } of successorRequests) {
    // Find the matching leistung dependency for lag days.
    const dep = leistungDeps.find((d) => d.successorId === successor.leistungId);
    const lagDays = dep?.lagDays ?? 0;

    // Required earliest start of successor = proposed end of predecessor + lagDays + 1 day.
    const required = new Date(
      `${addCalendarDays(toCalendarDate(input.proposedEnd), lagDays + 1)}T00:00:00Z`,
    );

    const currentStart = successor.agreedStart;
    if (!currentStart || currentStart >= required) continue;

    const impactDays = differenceInCalendarDays(
      toCalendarDate(currentStart),
      toCalendarDate(required),
    );
    result.push({
      serviceRequestId: successor.id,
      serviceName: service.leistungsBezeichnung,
      currentStart: currentStart.toISOString(),
      currentEnd: successor.agreedEnd?.toISOString() ?? null,
      requiredEarliestStart: required.toISOString(),
      impactDays,
    });
  }

  return { affectedServices: result };
}
