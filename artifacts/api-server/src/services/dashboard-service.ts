import {
  agDb as db,
  anDb,
  dataPublicationRecipientsTable,
  dataPublicationsTable,
  anLeistungsanfragenTable,
  messageOutboxTable,
  organizationsTable,
  projectMembershipsTable,
  projectsTable,
  takteTable,
} from "@workspace/db";
import { and, asc, desc, eq, inArray, or } from "drizzle-orm";
import { getCoordinationTasks, type CoordinationTask } from "./coordination-task-service";
import { listAnProjectInvitations } from "./an-project-invitation-service";

type DashboardActionKind =
  | CoordinationTask["taskType"]
  | "REVIEW_PROJECT_INVITATION"
  | "REVIEW_DATA_OFFER"
  | "PUBLISH_DATA_OFFER"
  | "RETRY_INVITATION_DELIVERY"
  | "RETRY_DATA_OFFER_DELIVERY";

type DashboardAction = {
  id: string;
  kind: DashboardActionKind;
  title: string;
  description: string;
  projectId: string | null;
  projectName: string | null;
  partnerOrgId: string | null;
  partnerName: string | null;
  dueAt: string | null;
  status: "OVERDUE" | "DUE_TODAY" | "DUE_SOON" | "OPEN";
  targetUrl: string;
};

type ProjectCollaboration = {
  id: string;
  projectId: string;
  projectName: string;
  partnerOrgId: string;
  partnerName: string;
  membershipStatus: "INVITED" | "ACTIVE" | "REJECTED" | "REVOKED" | null;
  membershipLabel: string;
  dataOfferStatus: "NOT_PUBLISHED" | "PENDING_ACCEPTANCE" | "ACCEPTED" | "REJECTED" | "UNAVAILABLE";
  dataOfferLabel: string;
  publicationId: string | null;
  targetUrl: string;
};

type DashboardOperationalItem = {
  id: string;
  title: string;
  description: string;
  projectId: string | null;
  projectName: string | null;
  partnerName: string | null;
  startsAt: string | null;
  dueAt: string | null;
  targetUrl: string;
};

type OfferState = {
  publicationId: string | null;
  status: ProjectCollaboration["dataOfferStatus"];
  label: string;
};

function deadlineStatus(dueAt: Date | null, now: Date): DashboardAction["status"] {
  if (!dueAt) return "OPEN";
  if (dueAt < now) return "OVERDUE";
  const endOfToday = new Date(now);
  endOfToday.setHours(23, 59, 59, 999);
  if (dueAt <= endOfToday) return "DUE_TODAY";
  const soon = new Date(now);
  soon.setDate(soon.getDate() + 3);
  return dueAt <= soon ? "DUE_SOON" : "OPEN";
}

function membershipLabel(status: ProjectCollaboration["membershipStatus"]): string {
  switch (status) {
    case "INVITED": return "Einladung offen";
    case "ACTIVE": return "Mitgliedschaft aktiv";
    case "REJECTED": return "Einladung abgelehnt";
    case "REVOKED": return "Mitgliedschaft beendet";
    default: return "Noch keine Mitgliedschaft";
  }
}

function offerState(
  publication: typeof dataPublicationsTable.$inferSelect | undefined,
  recipient: typeof dataPublicationRecipientsTable.$inferSelect | undefined,
): OfferState {
  if (!publication || !recipient || publication.status === "DRAFT") {
    return { publicationId: null, status: "NOT_PUBLISHED", label: "Noch keine Datenfreigabe" };
  }
  if (publication.status !== "PUBLISHED") {
    return { publicationId: publication.id, status: "UNAVAILABLE", label: "Datenfreigabe derzeit nicht verfügbar" };
  }
  switch (recipient.status) {
    case "OFFERED":
      return { publicationId: publication.id, status: "PENDING_ACCEPTANCE", label: "Wartet auf Annahme durch AN" };
    case "ACCEPTED":
      return { publicationId: publication.id, status: "ACCEPTED", label: "Datenfreigabe angenommen" };
    case "REJECTED":
      return { publicationId: publication.id, status: "REJECTED", label: "Datenfreigabe abgelehnt" };
    default:
      return { publicationId: publication.id, status: "UNAVAILABLE", label: "Datenfreigabe nicht verfügbar" };
  }
}

function taskToAction(task: CoordinationTask): DashboardAction {
  return {
    id: `task:${task.id}`,
    kind: task.taskType,
    title: task.summary,
    description: task.projectName
      ? `${task.projectName} · ${task.partnerName}`
      : task.partnerName,
    projectId: task.projectId,
    projectName: task.projectName,
    partnerOrgId: task.partnerOrgId,
    partnerName: task.partnerName,
    dueAt: task.dueAt,
    status: task.status,
    targetUrl: task.targetUrl,
  };
}

function actionRank(action: DashboardAction): number {
  const statusRank = { OVERDUE: 0, DUE_TODAY: 1, DUE_SOON: 2, OPEN: 3 };
  const kindRank: Record<DashboardActionKind, number> = {
    DECIDE_RESPONSE: 0,
    RESPOND_TO_CHANGE_PROPOSAL: 1,
    CONFIRM_READINESS: 2,
    RESPOND_TO_REQUEST: 3,
    RESOLVE_CONSTRAINT: 4,
    ANSWER_CLARIFICATION: 5,
    REVIEW_PROJECT_INVITATION: 6,
    REVIEW_DATA_OFFER: 7,
    PUBLISH_DATA_OFFER: 8,
    RETRY_INVITATION_DELIVERY: 9,
    RETRY_DATA_OFFER_DELIVERY: 10,
  };
  return statusRank[action.status] * 20 + kindRank[action.kind];
}

function payloadString(payload: unknown, key: string): string | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const value = (payload as Record<string, unknown>)[key];
  return typeof value === "string" ? value : null;
}

async function getAgProjectCollaborations(agOrgId: string) {
  const [projects, memberships, publications] = await Promise.all([
    db.select().from(projectsTable)
      .where(eq(projectsTable.agOrgId, agOrgId))
      .orderBy(asc(projectsTable.name)),
    db.select({
      membership: projectMembershipsTable,
      projectName: projectsTable.name,
      partner: organizationsTable,
    })
      .from(projectMembershipsTable)
      .innerJoin(projectsTable, eq(projectMembershipsTable.projectId, projectsTable.id))
      .innerJoin(organizationsTable, eq(projectMembershipsTable.anOrgId, organizationsTable.id))
      .where(eq(projectMembershipsTable.agOrgId, agOrgId)),
    db.select().from(dataPublicationsTable).where(eq(dataPublicationsTable.agOrgId, agOrgId)),
  ]);
  const agProjects = projects;
  const projectIds = agProjects.map((project) => project.id);
  const scopedPublications = publications.filter((publication) =>
    projectIds.includes(publication.projectId),
  );
  const publicationIds = scopedPublications.map((publication) => publication.id);
  const recipients = publicationIds.length
    ? await db.select().from(dataPublicationRecipientsTable)
      .where(inArray(dataPublicationRecipientsTable.publicationId, publicationIds as [string, ...string[]]))
    : [];
  const publicationById = new Map(scopedPublications.map((publication) => [publication.id, publication]));
  const recipientByPair = new Map<string, typeof recipients[number]>();
  for (const recipient of recipients) {
    const publication = publicationById.get(recipient.publicationId);
    if (!publication) continue;
    const key = `${publication.projectId}:${recipient.anOrgId}`;
    const existing = recipientByPair.get(key);
    const existingPublication = existing ? publicationById.get(existing.publicationId) : undefined;
    if (!existing || (existingPublication?.createdAt ?? new Date(0)) < publication.createdAt) {
      recipientByPair.set(key, recipient);
    }
  }

  return memberships
    .filter(({ membership }) => projectIds.includes(membership.projectId))
    .map(({ membership, projectName, partner }) => {
      const recipient = recipientByPair.get(`${membership.projectId}:${membership.anOrgId}`);
      const publication = recipient ? publicationById.get(recipient.publicationId) : undefined;
      const offer = offerState(publication, recipient);
      return {
        id: membership.id,
        projectId: membership.projectId,
        projectName,
        partnerOrgId: membership.anOrgId,
        partnerName: partner.name,
        membershipStatus: membership.status,
        membershipLabel: membershipLabel(membership.status),
        dataOfferStatus: offer.status,
        dataOfferLabel: offer.label,
        publicationId: offer.publicationId,
        targetUrl: `/projects/${membership.projectId}`,
      } satisfies ProjectCollaboration;
    });
}

export async function getAgDashboard(agOrgId: string) {
  const [projects, memberships, publications, collaborations, tasks, failedMessages, upcomingTakte] = await Promise.all([
    db.select().from(projectsTable).where(eq(projectsTable.agOrgId, agOrgId)).orderBy(asc(projectsTable.name)),
    db.select().from(projectMembershipsTable).where(eq(projectMembershipsTable.agOrgId, agOrgId)),
    db.select().from(dataPublicationsTable).where(eq(dataPublicationsTable.agOrgId, agOrgId)),
    getAgProjectCollaborations(agOrgId),
    getCoordinationTasks({ orgId: agOrgId, role: "AG" }),
    db.select().from(messageOutboxTable).where(and(
      eq(messageOutboxTable.senderOrgId, agOrgId),
      eq(messageOutboxTable.status, "FAILED"),
      or(
        eq(messageOutboxTable.messageType, "PROJECT_INVITATION"),
        eq(messageOutboxTable.messageType, "DATA_OFFER_PUBLISHED"),
      ),
    )),
    db.select({
      takt: takteTable,
      projectName: projectsTable.name,
      projectId: projectsTable.id,
    })
      .from(takteTable)
      .innerJoin(projectsTable, eq(takteTable.projectId, projectsTable.id))
      .where(and(
        eq(projectsTable.agOrgId, agOrgId),
        eq(takteTable.lifecycleStatus, "CONFIRMED"),
      ))
      .orderBy(asc(takteTable.plannedStart))
      .limit(8),
  ]);

  const activeProjectIds = projects.filter((project) => project.status === "ACTIVE").map((project) => project.id);
  const agProjectIds = new Set(projects.map((project) => project.id));
  const ownMemberships = memberships.filter((membership) => agProjectIds.has(membership.projectId));
  const ownPublications = publications.filter((publication) => agProjectIds.has(publication.projectId));
  const publicationIds = ownPublications.map((publication) => publication.id);
  const recipients = publicationIds.length
    ? await db.select().from(dataPublicationRecipientsTable)
      .where(inArray(dataPublicationRecipientsTable.publicationId, publicationIds as [string, ...string[]]))
    : [];
  const publicationById = new Map(ownPublications.map((publication) => [publication.id, publication]));
  const membershipByInvitationId = new Map(ownMemberships.map((membership) => [membership.invitationId, membership]));
  const collaborationByPair = new Map(collaborations.map((collaboration) => [
    `${collaboration.projectId}:${collaboration.partnerOrgId}`,
    collaboration,
  ]));
  const actions = tasks.map(taskToAction);
  for (const collaboration of collaborations) {
    if (collaboration.membershipStatus === "ACTIVE" && collaboration.dataOfferStatus === "NOT_PUBLISHED") {
      actions.push({
        id: `publish-data:${collaboration.id}`,
        kind: "PUBLISH_DATA_OFFER",
        title: "Daten für AN freigeben",
        description: `${collaboration.projectName} · ${collaboration.partnerName} hat eine aktive Mitgliedschaft, aber noch keine Datenfreigabe.`,
        projectId: collaboration.projectId,
        projectName: collaboration.projectName,
        partnerOrgId: collaboration.partnerOrgId,
        partnerName: collaboration.partnerName,
        dueAt: null,
        status: "OPEN",
        targetUrl: `/projects/${collaboration.projectId}`,
      });
    } else if (collaboration.dataOfferStatus === "PENDING_ACCEPTANCE") {
      actions.push({
        id: `offer:${collaboration.id}`,
        kind: "REVIEW_DATA_OFFER",
        title: "Offene Datenfreigabe prüfen",
        description: `${collaboration.projectName} · ${collaboration.partnerName} hat die Freigabe noch nicht angenommen.`,
        projectId: collaboration.projectId,
        projectName: collaboration.projectName,
        partnerOrgId: collaboration.partnerOrgId,
        partnerName: collaboration.partnerName,
        dueAt: null,
        status: "OPEN",
        targetUrl: "/data-room",
      });
    }
  }
  for (const message of failedMessages) {
    const invitationId = message.messageId.startsWith("project-invitation-")
      ? message.messageId.slice("project-invitation-".length)
      : null;
    const membership = invitationId ? membershipByInvitationId.get(invitationId) : undefined;
    const publicationId = payloadString(message.payload, "publicationId");
    const publication = publicationId ? publicationById.get(publicationId) : undefined;
    if (message.messageType === "PROJECT_INVITATION" && membership) {
      const project = projects.find((item) => item.id === membership.projectId);
      actions.push({
        id: `retry-invitation:${message.messageId}`,
        kind: "RETRY_INVITATION_DELIVERY",
        title: "Fehlgeschlagene Einladung erneut zustellen",
        description: `${project?.name ?? "Projekt"} · Nachricht an den Projektpartner konnte nicht zugestellt werden.`,
        projectId: membership.projectId,
        projectName: project?.name ?? null,
        partnerOrgId: membership.anOrgId,
        partnerName: null,
        dueAt: null,
        status: "OPEN",
        targetUrl: `/projects/${membership.projectId}`,
      });
    } else if (message.messageType === "DATA_OFFER_PUBLISHED" && publication) {
      actions.push({
        id: `retry-data-offer:${message.messageId}`,
        kind: "RETRY_DATA_OFFER_DELIVERY",
        title: "Fehlgeschlagene Datenfreigabe erneut zustellen",
        description: `${publication.title} · Zustellung an mindestens einen Empfänger ist fehlgeschlagen.`,
        projectId: publication.projectId,
        projectName: projects.find((item) => item.id === publication.projectId)?.name ?? null,
        partnerOrgId: null,
        partnerName: null,
        dueAt: null,
        status: "OPEN",
        targetUrl: "/data-room",
      });
    }
  }

  const operationalOutlook: DashboardOperationalItem[] = upcomingTakte.map(({ takt, projectName, projectId }) => ({
    id: `takt:${takt.id}`,
    title: `${takt.taktBezeichnung} · ${takt.gewerk}`,
    description: takt.zone ? `Zone ${takt.zone}` : "Bestätigte Leistung",
    projectId,
    projectName,
    partnerName: null,
    startsAt: takt.plannedStart,
    dueAt: takt.plannedEnd,
    targetUrl: `/projects/${projectId}/takte/${takt.id}`,
  }));

  actions.sort((left, right) => actionRank(left) - actionRank(right));
  return {
    kpis: {
      openTasks: tasks.length,
      overdueTasks: tasks.filter((task) => task.status === "OVERDUE").length,
      openInvitations: ownMemberships.filter((membership) => membership.status === "INVITED").length,
      pendingDataOffers: recipients.filter((recipient) =>
        recipient.status === "OFFERED" && publicationById.get(recipient.publicationId)?.status === "PUBLISHED",
      ).length,
    },
    activeProjectsCount: activeProjectIds.length,
    nextActions: actions.slice(0, 12),
    projectCollaborations: collaborations,
    operationalOutlook,
  };
}

function actionStatusForRequest(responseRequiredBy: string | null, now: Date): DashboardAction["status"] {
  const date = responseRequiredBy ? new Date(responseRequiredBy) : null;
  return date && !Number.isNaN(date.getTime()) ? deadlineStatus(date, now) : "OPEN";
}

export async function getAnDashboard(anOrgId: string) {
  const [invitations, requests] = await Promise.all([
    listAnProjectInvitations(anOrgId),
    anDb.select().from(anLeistungsanfragenTable)
      .where(eq(anLeistungsanfragenTable.receiverAnOrgId, anOrgId))
      .orderBy(desc(anLeistungsanfragenTable.receivedAt)),
  ]);
  const now = new Date();
  const openInvitations = invitations.filter((invitation) => invitation.status === "PENDING");
  const offers = invitations.filter((invitation) => invitation.dataPublicationId);
  const newOffers = offers.filter((invitation) => invitation.status === "PENDING");
  const actionableStatuses = new Set(["RECEIVED", "DETAILS_RETRIEVED", "UNDER_REVIEW", "REVISION_REQUIRED"]);
  const openRequests = requests.filter((request) => actionableStatuses.has(request.status));
  const nextActions: DashboardAction[] = openRequests.map((request) => {
    const snapshot = request.payloadSnapshot as Record<string, unknown>;
    const requiredBy = typeof snapshot.responseRequiredBy === "string" ? snapshot.responseRequiredBy : null;
    const status = actionStatusForRequest(requiredBy, now);
    const projectName = typeof snapshot.projectName === "string" ? snapshot.projectName : null;
    const serviceName = typeof snapshot.kurzbezeichnung === "string"
      ? snapshot.kurzbezeichnung
      : typeof snapshot.workPackage === "string" ? snapshot.workPackage : request.leistungReference;
    return {
      id: `request:${request.externalLeistungsanfrageId}`,
      kind: "RESPOND_TO_REQUEST",
      title: status === "OVERDUE" ? "Überfällige Leistungsanfrage beantworten" : "Leistungsanfrage beantworten",
      description: `${serviceName}${projectName ? ` · ${projectName}` : ""}`,
      projectId: request.projectReference,
      projectName,
      partnerOrgId: request.senderAgOrgId,
      partnerName: typeof snapshot.senderOrganizationName === "string" ? snapshot.senderOrganizationName : null,
      dueAt: requiredBy,
      status,
      targetUrl: `/leistungsanfragen/${request.externalLeistungsanfrageId}`,
    };
  });
  const invitationViews = openInvitations.map((invitation) => ({
    id: invitation.id,
    projectName: invitation.projectName,
    agName: invitation.senderAgOrgName ?? "Auftraggeber",
    status: invitation.status,
    createdAt: invitation.createdAt.toISOString(),
    targetUrl: "/leistungsanfragen?category=INVITATIONS",
  }));
  const dataOfferViews = newOffers.map((invitation) => {
    const snapshot = invitation.dataOfferSnapshot ?? {};
    const policy = snapshot.policy && typeof snapshot.policy === "object"
      ? snapshot.policy as Record<string, unknown>
      : {};
    const publicationStatus = snapshot.status === "SUSPENDED" || snapshot.status === "WITHDRAWN"
      ? snapshot.status
      : invitation.invitationExpiresAt && invitation.invitationExpiresAt < now ? "EXPIRED" : "PUBLISHED";
    return {
      publicationId: invitation.dataPublicationId ?? invitation.id,
      title: typeof snapshot.title === "string" ? snapshot.title : invitation.dataPublicationTitle ?? invitation.projectName,
      projectName: invitation.projectName,
      agName: invitation.senderAgOrgName ?? "Auftraggeber",
      publicationStatus,
      recipientStatus: "OFFERED" as const,
      policyAcceptedAt: invitation.policyAcceptedAt?.toISOString() ?? null,
      targetUrl: `/data-offers?publicationId=${encodeURIComponent(invitation.dataPublicationId ?? invitation.id)}`,
      policyName: typeof policy.name === "string" ? policy.name : "Nutzungsbedingungen",
    };
  });
  const collaborations: ProjectCollaboration[] = invitations.map((invitation) => ({
    id: invitation.id,
    projectId: invitation.projectReference,
    projectName: invitation.projectName,
    partnerOrgId: invitation.senderAgOrgId,
    partnerName: invitation.senderAgOrgName ?? "Auftraggeber",
    membershipStatus: invitation.dataPublicationId
      ? invitation.status === "PENDING" ? "ACTIVE" : invitation.status === "ACCEPTED" ? "ACTIVE" : "REJECTED"
      : invitation.status === "PENDING" ? "INVITED" : invitation.status === "ACCEPTED" ? "ACTIVE" : "REJECTED",
    membershipLabel: invitation.dataPublicationId
      ? invitation.status === "PENDING" ? "Mitgliedschaft aktiv" : invitation.status === "ACCEPTED" ? "Mitgliedschaft aktiv" : "Beziehung abgelehnt"
      : invitation.status === "PENDING" ? "Einladung offen" : invitation.status === "ACCEPTED" ? "Mitgliedschaft aktiv" : "Einladung abgelehnt",
    dataOfferStatus: invitation.dataPublicationId
      ? invitation.status === "PENDING" ? "PENDING_ACCEPTANCE" : invitation.status === "ACCEPTED" ? "ACCEPTED" : "REJECTED"
      : "NOT_PUBLISHED",
    dataOfferLabel: invitation.dataPublicationId
      ? invitation.status === "PENDING" ? "Wartet auf Nutzungsbedingungen" : invitation.status === "ACCEPTED" ? "Datenfreigabe angenommen" : "Datenfreigabe abgelehnt"
      : "Noch keine Datenfreigabe",
    publicationId: invitation.dataPublicationId,
    targetUrl: invitation.dataPublicationId
      ? `/data-offers?publicationId=${encodeURIComponent(invitation.dataPublicationId)}`
      : "/leistungsanfragen?category=INVITATIONS",
  }));
  const operationalOutlook: DashboardOperationalItem[] = openRequests
    .filter((request) => request.plannedStart)
    .sort((left, right) => left.plannedStart.localeCompare(right.plannedStart))
    .slice(0, 8)
    .map((request) => {
      const snapshot = request.payloadSnapshot as Record<string, unknown>;
      const requiredBy = typeof snapshot.responseRequiredBy === "string" ? snapshot.responseRequiredBy : null;
      return {
        id: `request:${request.externalLeistungsanfrageId}`,
        title: typeof snapshot.kurzbezeichnung === "string"
          ? snapshot.kurzbezeichnung
          : request.leistungReference,
        description: typeof snapshot.projectName === "string" ? snapshot.projectName : "Offene Leistungsanfrage",
        projectId: request.projectReference,
        projectName: typeof snapshot.projectName === "string" ? snapshot.projectName : null,
        partnerName: typeof snapshot.senderOrganizationName === "string" ? snapshot.senderOrganizationName : null,
        startsAt: request.plannedStart,
        dueAt: requiredBy,
        targetUrl: `/leistungsanfragen/${request.externalLeistungsanfrageId}`,
      };
    });

  nextActions.sort((left, right) => actionRank(left) - actionRank(right));
  return {
    kpis: {
      openInvitations: openInvitations.length,
      newDataOffers: newOffers.length,
      openRequests: openRequests.length,
      criticalDeadlines: nextActions.filter((action) => action.status === "OVERDUE" || action.status === "DUE_TODAY").length,
    },
    openInvitations: invitationViews,
    newDataOffers: dataOfferViews,
    nextActions: nextActions.slice(0, 12),
    projectCollaborations: collaborations,
    operationalOutlook,
  };
}