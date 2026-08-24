import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  leistungenTable, leistungsanfragenTable, leistungsantwortenTable, leistungsantwortEntscheidungenTable,
  organizationsTable, serviceChangeProposalsTable, serviceConstraintsTable, serviceClarificationsTable,
  serviceReadinessChecksTable, leistungsabhaengigkeitenTable,
} from "@workspace/db";
import { deriveServiceCoordinationState } from "./service-coordination-state";
import { maxDate } from "./service-change-proposal-service";

export async function getProjectCoordinationBoard(input: { projectId: string; agOrgId: string }) {
  const rows = await db.select({ request: leistungsanfragenTable, service: leistungenTable, partner: organizationsTable })
    .from(leistungsanfragenTable)
    .innerJoin(leistungenTable, eq(leistungsanfragenTable.leistungId, leistungenTable.id))
    .innerJoin(organizationsTable, eq(leistungsanfragenTable.nuOrgId, organizationsTable.id))
    .where(and(eq(leistungenTable.projectId, input.projectId), eq(leistungsanfragenTable.guOrgId, input.agOrgId)));
  const ids = rows.map(({ request }) => request.id);
  if (!ids.length) return [];
  const [proposals, constraints, clarifications, readiness, dependencies, responses, decisions] = await Promise.all([
    db.select().from(serviceChangeProposalsTable).where(inArray(serviceChangeProposalsTable.leistungsanfrageId, ids)).orderBy(desc(serviceChangeProposalsTable.createdAt)),
    db.select().from(serviceConstraintsTable).where(inArray(serviceConstraintsTable.serviceRequestId, ids)),
    db.select().from(serviceClarificationsTable).where(inArray(serviceClarificationsTable.serviceRequestId, ids)),
    db.select().from(serviceReadinessChecksTable).where(inArray(serviceReadinessChecksTable.serviceRequestId, ids)),
    db.select().from(leistungsabhaengigkeitenTable)
      .where(and(
        eq(leistungsabhaengigkeitenTable.projectId, input.projectId),
        inArray(leistungsabhaengigkeitenTable.predecessorId, rows.map(({ service }) => service.id)),
      )),
    db.select().from(leistungsantwortenTable)
      .where(inArray(leistungsantwortenTable.leistungsanfrageId, ids))
      .orderBy(desc(leistungsantwortenTable.createdAt)),
    db.select().from(leistungsantwortEntscheidungenTable).where(inArray(leistungsantwortEntscheidungenTable.leistungsanfrageId, ids)),
  ]);
  const proposalsBy = new Map(proposals.map((row) => [row.leistungsanfrageId, row]));
  const readinessBy = new Map(readiness.map((row) => [row.serviceRequestId, row]));
  return rows.map(({ request, service, partner }) => {
   const proposal = proposals.find((row) => row.leistungsanfrageId === request.id && row.status === "OPEN");
    const response = responses
      .filter((row) => row.leistungsanfrageId === request.id)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
    const constraint = constraints.find((row) => row.serviceRequestId === request.id);
    const clarification = clarifications.find((row) => row.serviceRequestId === request.id);
    const action = deriveServiceCoordinationState({
      requestStatus: request.status,
      hasResponse: !!response,
      hasDecision: !!response && decisions.some((decision) => decision.responseId === response.id),
      openProposalProposer: proposal
        ? proposal.proposerOrgId === request.guOrgId ? "AG" : "AN"
        : null,
      clarificationWaitingFor: clarification
        ? clarification.askedByOrgId === request.guOrgId ? "AN" : "AG"
        : null,
      constraintResponsible: constraint
        ? constraint.responsibleOrgId === request.guOrgId ? "AG" : "AN"
        : null,
    });
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
       nextActionOwner: action.nextActionOwner ?? "NONE",
       nextAction: action.nextAction,
       actionRequiredBy: action.actionRequiredBy,
      responseRequiredBy: request.responseRequiredBy?.toISOString() ?? null,
       openConstraintCount: constraints.filter((row) => row.serviceRequestId === request.id && row.status === "OPEN").length,
       openClarificationCount: clarifications.filter((row) => row.serviceRequestId === request.id && row.status === "OPEN").length,
       readinessStatus: request.agreedStart && request.agreedEnd && !check ? "NOT_READY" : readinessStatus,
       dependencyImpactCount: dependencies.filter((row) => row.predecessorId === service.id).length,
       lastChangedAt: (maxDate(
         request.updatedAt,
         response?.createdAt,
         ...decisions.filter((row) => row.leistungsanfrageId === request.id).flatMap((row) => [row.createdAt, row.decidedAt]),
         ...proposals.filter((row) => row.leistungsanfrageId === request.id).flatMap((row) => [row.createdAt, row.resolvedAt]),
         ...constraints.filter((row) => row.serviceRequestId === request.id).flatMap((row) => [row.createdAt, row.updatedAt, row.resolvedAt]),
         ...clarifications.filter((row) => row.serviceRequestId === request.id).flatMap((row) => [row.createdAt, row.updatedAt, row.answeredAt]),
         readinessBy.get(request.id)?.updatedAt,
       ) ?? request.updatedAt).toISOString(),
    };
  });
}