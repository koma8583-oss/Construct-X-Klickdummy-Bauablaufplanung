import { and, eq, inArray } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  leistungenTable, leistungsanfragenTable, leistungsantwortenTable, leistungsantwortEntscheidungenTable,
  organizationsTable, serviceChangeProposalsTable, serviceConstraintsTable, serviceClarificationsTable,
  serviceReadinessChecksTable, serviceDependenciesTable,
} from "@workspace/db";
import { deriveCoordinationState } from "./service-change-proposal-service";

export async function getProjectCoordinationBoard(input: { projectId: string; agOrgId: string }) {
  const rows = await db.select({ request: leistungsanfragenTable, service: leistungenTable, partner: organizationsTable })
    .from(leistungsanfragenTable)
    .innerJoin(leistungenTable, eq(leistungsanfragenTable.leistungId, leistungenTable.id))
    .innerJoin(organizationsTable, eq(leistungsanfragenTable.nuOrgId, organizationsTable.id))
    .where(and(eq(leistungenTable.projectId, input.projectId), eq(leistungsanfragenTable.guOrgId, input.agOrgId)));
  const ids = rows.map(({ request }) => request.id);
  if (!ids.length) return [];
  const [proposals, constraints, clarifications, readiness, dependencies] = await Promise.all([
    db.select().from(serviceChangeProposalsTable).where(and(inArray(serviceChangeProposalsTable.leistungsanfrageId, ids), eq(serviceChangeProposalsTable.status, "OPEN"))),
    db.select().from(serviceConstraintsTable).where(and(inArray(serviceConstraintsTable.serviceRequestId, ids), eq(serviceConstraintsTable.status, "OPEN"))),
    db.select().from(serviceClarificationsTable).where(and(inArray(serviceClarificationsTable.serviceRequestId, ids), eq(serviceClarificationsTable.status, "OPEN"))),
    db.select().from(serviceReadinessChecksTable).where(inArray(serviceReadinessChecksTable.serviceRequestId, ids)),
    db.select().from(serviceDependenciesTable).where(inArray(serviceDependenciesTable.predecessorServiceRequestId, ids)),
  ]);
  const proposalsBy = new Map(proposals.map((row) => [row.leistungsanfrageId, row]));
  const readinessBy = new Map(readiness.map((row) => [row.serviceRequestId, row]));
  return rows.map(({ request, service, partner }) => {
    const proposal = proposalsBy.get(request.id);
    const state = deriveCoordinationState({ openProposal: proposal, currentAgreement: { start: request.agreedStart, end: request.agreedEnd }, guOrgId: request.guOrgId, nuOrgId: request.nuOrgId });
    const check = readinessBy.get(request.id);
    const readinessStatus = !check ? "NOT_APPLICABLE" : check.scheduleConfirmed && check.siteReady && check.informationComplete && check.agReady && check.anReady ? "READY" : "NOT_READY";
    return {
      serviceRequestId: request.id,
      serviceName: service.leistungsBezeichnung,
      partnerOrgId: partner.id,
      partnerName: partner.name,
      agreedStart: request.agreedStart?.toISOString() ?? null,
      agreedEnd: request.agreedEnd?.toISOString() ?? null,
      proposedStart: proposal?.start.toISOString() ?? null,
      proposedEnd: proposal?.end.toISOString() ?? null,
      proposalInitiator: proposal ? proposal.proposerOrgId === request.guOrgId ? "AG" : "AN" : null,
      nextActionOwner: state.nextActionOwner ?? "NONE",
      nextAction: state.nextActionOwner === "AG" ? "AG entscheiden" : state.nextActionOwner === "AN" ? "AN antworten" : "Keine Aktion",
      responseRequiredBy: request.responseRequiredBy?.toISOString() ?? null,
      openConstraintCount: constraints.filter((row) => row.serviceRequestId === request.id).length,
      openClarificationCount: clarifications.filter((row) => row.serviceRequestId === request.id).length,
      readinessStatus,
      dependencyImpactCount: dependencies.filter((row) => row.predecessorServiceRequestId === request.id).length,
      lastChangedAt: request.updatedAt.toISOString(),
    };
  });
}