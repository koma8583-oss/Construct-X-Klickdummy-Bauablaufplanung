import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { agDb as db } from "@workspace/db";
import {
  leistungenTable,
  leistungsanfragenTable,
  leistungsantwortenTable,
  leistungsantwortEntscheidungenTable,
  organizationsTable,
  projectsTable,
  serviceChangeProposalsTable,
  serviceConstraintsTable,
  serviceClarificationsTable,
  serviceReadinessChecksTable,
} from "@workspace/db";
import { deriveServiceCoordinationState } from "./service-coordination-state";

export type CoordinationTaskType =
  | "RESPOND_TO_REQUEST"
  | "DECIDE_RESPONSE"
  | "RESPOND_TO_CHANGE_PROPOSAL"
  | "RESOLVE_CONSTRAINT"
  | "ANSWER_CLARIFICATION"
  | "CONFIRM_READINESS";

export type CoordinationTask = {
  id: string;
  serviceRequestId: string;
  serviceName: string;
  partnerOrgId: string;
  partnerName: string;
  projectId: string | null;
  projectName: string | null;
  taskType: CoordinationTaskType;
  priority: "NORMAL" | "HIGH" | "CRITICAL";
  dueAt: string | null;
  status: "OVERDUE" | "DUE_TODAY" | "DUE_SOON" | "OPEN";
  summary: string;
  lastChangedAt: string;
  targetUrl: string;
};

function deadlineStatus(dueAt: Date | null, now: Date) {
  if (!dueAt) return "OPEN" as const;
  if (dueAt < now) return "OVERDUE" as const;
  const today = new Date(now);
  today.setHours(23, 59, 59, 999);
  if (dueAt <= today) return "DUE_TODAY" as const;
  const soon = new Date(now);
  soon.setDate(soon.getDate() + 3);
  if (dueAt <= soon) return "DUE_SOON" as const;
  return "OPEN" as const;
}

function priorityFor(status: CoordinationTask["status"], taskType: CoordinationTaskType): CoordinationTask["priority"] {
  if (status === "OVERDUE") return "CRITICAL";
  if (status === "DUE_TODAY") return "HIGH";
  if (taskType === "DECIDE_RESPONSE" || taskType === "RESPOND_TO_CHANGE_PROPOSAL") return "HIGH";
  return "NORMAL";
}

export async function getCoordinationTasks(input: { orgId: string; role: "AG" | "AN" }): Promise<CoordinationTask[]> {
  const now = new Date();
  const requests = await db
    .select({
      request: leistungsanfragenTable,
      service: leistungenTable,
      project: projectsTable,
      partner: organizationsTable,
    })
    .from(leistungsanfragenTable)
    .innerJoin(
      leistungenTable,
      eq(leistungsanfragenTable.leistungId, leistungenTable.id),
    )
    .innerJoin(projectsTable, eq(leistungenTable.projectId, projectsTable.id))
    .innerJoin(
      organizationsTable,
      eq(
        input.role === "AG" ? leistungsanfragenTable.nuOrgId : leistungsanfragenTable.guOrgId,
        organizationsTable.id,
      ),
    )
    .where(
      eq(
        input.role === "AG" ? leistungsanfragenTable.guOrgId : leistungsanfragenTable.nuOrgId,
        input.orgId,
      ),
    )
    .orderBy(desc(leistungsanfragenTable.updatedAt));

  if (requests.length === 0) return [];
  const ids = requests.map(({ request }) => request.id);
  const [responses, decisions, proposals, constraints, clarifications, readiness] = await Promise.all([
    db.select().from(leistungsantwortenTable)
      .where(inArray(leistungsantwortenTable.leistungsanfrageId, ids))
      .orderBy(desc(leistungsantwortenTable.createdAt)),
    db.select().from(leistungsantwortEntscheidungenTable).where(inArray(leistungsantwortEntscheidungenTable.leistungsanfrageId, ids)),
    db.select().from(serviceChangeProposalsTable).where(
      and(inArray(serviceChangeProposalsTable.leistungsanfrageId, ids), eq(serviceChangeProposalsTable.status, "OPEN")),
    ),
    db.select().from(serviceConstraintsTable).where(
      and(inArray(serviceConstraintsTable.serviceRequestId, ids), eq(serviceConstraintsTable.status, "OPEN")),
    ),
    db.select().from(serviceClarificationsTable).where(
      and(inArray(serviceClarificationsTable.serviceRequestId, ids), eq(serviceClarificationsTable.status, "OPEN")),
    ),
    db.select().from(serviceReadinessChecksTable).where(inArray(serviceReadinessChecksTable.serviceRequestId, ids)),
  ]);
   const responseByRequest = new Map<string, typeof responses[number]>();
   for (const response of responses) {
     if (!responseByRequest.has(response.leistungsanfrageId)) responseByRequest.set(response.leistungsanfrageId, response);
   }
  const decisionByResponse = new Map(decisions.map((row) => [row.responseId, row]));
  const proposalByRequest = new Map(proposals.map((row) => [row.leistungsanfrageId, row]));
  const constraintsByRequest = new Map(constraints.map((row) => [row.serviceRequestId, row]));
  const clarificationByRequest = new Map(clarifications.map((row) => [row.serviceRequestId, row]));
  const readinessByRequest = new Map(readiness.map((row) => [row.serviceRequestId, row]));

  const tasks: CoordinationTask[] = [];
  for (const { request, service, project, partner } of requests) {
    const response = responseByRequest.get(request.id);
    const proposal = proposalByRequest.get(request.id);
    const lastChangedAt = new Date(Math.max(
      request.updatedAt.getTime(),
      response?.createdAt.getTime() ?? 0,
      proposal?.createdAt.getTime() ?? 0,
      proposal?.resolvedAt?.getTime() ?? 0,
    )).toISOString();
    const addTask = (taskType: CoordinationTaskType, dueAt: Date | null, summary: string) => {
      const status = deadlineStatus(dueAt, now);
      tasks.push({
        id: `${taskType}:${request.id}`,
        serviceRequestId: request.id,
        serviceName: service.leistungsBezeichnung,
        partnerOrgId: partner.id,
        partnerName: partner.name,
        projectId: project.id,
        projectName: project.name,
        taskType,
        priority: priorityFor(status, taskType),
        dueAt: dueAt?.toISOString() ?? null,
        status,
        summary,
        lastChangedAt,
        targetUrl: `/leistungsanfragen/${request.id}`,
      });
    };

    const constraint = constraintsByRequest.get(request.id);
    const clarification = clarificationByRequest.get(request.id);
    const check = readinessByRequest.get(request.id) ?? {
      scheduleConfirmed: false,
      siteReady: false,
      informationComplete: false,
      agReady: false,
      anReady: false,
    };
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);
    const agreedStart = request.agreedStart ? new Date(request.agreedStart) : null;
    const withinSevenDays = agreedStart
      && agreedStart.getTime() >= today.getTime()
      && agreedStart.getTime() <= today.getTime() + 7 * 86_400_000;
    const readinessNeedsConfirmation = !!withinSevenDays && (input.role === "AG"
      ? !(check.scheduleConfirmed && check.siteReady && check.informationComplete && check.agReady)
      : !check.anReady);
     const action = deriveServiceCoordinationState({
      requestStatus: request.status,
      hasResponse: !!response,
      hasDecision: !!response && decisionByResponse.has(response.id),
       openProposalProposer: proposal
         ? proposal.proposerOrgId === request.guOrgId ? "AG" : "AN"
         : null,
       clarificationWaitingFor: clarification
         ? clarification.askedByOrgId === request.guOrgId ? "AN" : "AG"
         : null,
       constraintResponsible: constraint
         ? constraint.responsibleOrgId === request.guOrgId ? "AG" : "AN"
         : null,
       readinessActionRequiredBy: withinSevenDays
         ? (check.scheduleConfirmed && check.siteReady && check.informationComplete && check.agReady
           ? (!check.anReady ? "AN" : null)
           : "AG")
         : null,
       responseRequiredBy: request.responseRequiredBy,
       decisionRequiredBy: request.guDecisionRequiredBy,
    });
    const taskDetails: Record<Exclude<CoordinationTaskType, "NO_ACTION">, { dueAt: Date | null; summary: string }> = {
      RESPOND_TO_REQUEST: { dueAt: request.responseRequiredBy ?? request.expiresAt, summary: `Antwort auf ${request.requestNumber} erforderlich` },
      DECIDE_RESPONSE: { dueAt: request.guDecisionRequiredBy, summary: `Antwort von ${partner.name} prüfen` },
      RESPOND_TO_CHANGE_PROPOSAL: { dueAt: null, summary: `Änderungsvorschlag von ${partner.name} beantworten` },
      ANSWER_CLARIFICATION: { dueAt: null, summary: `Klärungsfrage von ${partner.name} beantworten` },
      RESOLVE_CONSTRAINT: { dueAt: null, summary: `Risiko bei ${service.leistungsBezeichnung} bearbeiten` },
      CONFIRM_READINESS: { dueAt: request.agreedStart, summary: "Ausführungsbereitschaft bestätigen" },
    };
    if (action.nextAction !== "NO_ACTION") {
      const details = taskDetails[action.nextAction];
       if (action.nextActionOwner === input.role) {
         addTask(action.nextAction, action.actionRequiredBy ? new Date(action.actionRequiredBy) : details.dueAt, details.summary);
       }
    }
  }

  const statusOrder = { OVERDUE: 0, DUE_TODAY: 1, DUE_SOON: 2, OPEN: 3 };
  const priorityOrder = { CRITICAL: 0, HIGH: 1, NORMAL: 2 };
  return tasks.sort((a, b) =>
    statusOrder[a.status] - statusOrder[b.status] ||
    priorityOrder[a.priority] - priorityOrder[b.priority] ||
    new Date(b.lastChangedAt).getTime() - new Date(a.lastChangedAt).getTime(),
  );
}