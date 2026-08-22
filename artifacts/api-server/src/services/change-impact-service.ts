import { and, eq } from "drizzle-orm";
import { db } from "@workspace/db";
import { leistungenTable, leistungsanfragenTable, serviceDependenciesTable } from "@workspace/db";

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
  proposedStart: Date;
  proposedEnd: Date;
}): Promise<ChangeImpact> {
  const dependencies = await db.select().from(serviceDependenciesTable)
    .where(eq(serviceDependenciesTable.predecessorServiceRequestId, input.serviceRequestId));
  const result: ChangeImpact["affectedServices"] = [];
  for (const dependency of dependencies) {
    const [successor] = await db.select({ request: leistungsanfragenTable, service: leistungenTable })
      .from(leistungsanfragenTable)
      .innerJoin(leistungenTable, eq(leistungsanfragenTable.leistungId, leistungenTable.id))
      .where(eq(leistungsanfragenTable.id, dependency.successorServiceRequestId))
      .limit(1);
    if (!successor) continue;
    const required = new Date(input.proposedEnd);
    required.setDate(required.getDate() + dependency.lagDays + 1);
    const currentStart = successor.request.agreedStart;
    if (!currentStart || currentStart >= required) continue;
    const impactDays = Math.ceil((required.getTime() - currentStart.getTime()) / 86_400_000);
    result.push({
      serviceRequestId: successor.request.id,
      serviceName: successor.service.leistungsBezeichnung,
      currentStart: currentStart.toISOString(),
      currentEnd: successor.request.agreedEnd?.toISOString() ?? null,
      requiredEarliestStart: required.toISOString(),
      impactDays,
    });
  }
  return { affectedServices: result };
}