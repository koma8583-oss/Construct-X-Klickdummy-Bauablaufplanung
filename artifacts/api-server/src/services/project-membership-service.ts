import {
  db,
  organizationsTable,
  projectsTable,
  takteTable,
  projectMembershipsTable,
} from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";
import {
  listDataspaceParticipants,
  resolveDataspaceParticipant,
} from "./dataspace/dataspace-participant-resolver";
import { createDataspaceExchange } from "./dataspace/dataspace-exchange-factory";
import type { ExternalProjectInvitation, ExternalProjectInvitationResponse } from "./dataspace/external-contracts";

export class ProjectMembershipError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "ProjectMembershipError";
  }
}

export async function listProjectParticipants(projectId: string) {
  const participants = await listDataspaceParticipants("AN");
  const memberships = await db.select({
    anOrgId: projectMembershipsTable.anOrgId,
    status: projectMembershipsTable.status,
  }).from(projectMembershipsTable)
    .where(eq(projectMembershipsTable.projectId, projectId));
  const statusByOrg = new Map(memberships.map((m) => [m.anOrgId, m.status]));
  return participants.map((participant) => ({
    ...participant,
    membershipStatus: participant.localOrgId ? statusByOrg.get(participant.localOrgId) ?? null : null,
    selectable: participant.identityStatus === "VERIFIED"
      && !["INVITED", "ACTIVE"].includes(statusByOrg.get(participant.localOrgId ?? "") ?? ""),
  }));
}

export async function listProjectMemberships(projectId: string, agOrgId: string) {
  return db.select().from(projectMembershipsTable).where(and(
    eq(projectMembershipsTable.projectId, projectId),
    eq(projectMembershipsTable.agOrgId, agOrgId),
  ));
}

export async function listPendingProjectInvitations(anOrgId: string) {
  return db.select({
    membership: projectMembershipsTable,
    project: projectsTable,
    agOrganization: organizationsTable,
  }).from(projectMembershipsTable)
    .innerJoin(projectsTable, eq(projectMembershipsTable.projectId, projectsTable.id))
    .innerJoin(organizationsTable, eq(projectMembershipsTable.agOrgId, organizationsTable.id))
    .where(and(
      eq(projectMembershipsTable.anOrgId, anOrgId),
      eq(projectMembershipsTable.status, "INVITED"),
    ));
}

export async function assertActiveProjectMembership(projectId: string, anOrgId: string) {
  const [membership] = await db.select({ id: projectMembershipsTable.id })
    .from(projectMembershipsTable)
    .where(and(
      eq(projectMembershipsTable.projectId, projectId),
      eq(projectMembershipsTable.anOrgId, anOrgId),
      eq(projectMembershipsTable.status, "ACTIVE"),
    )).limit(1);
  if (!membership) {
    throw new ProjectMembershipError(
      "PROJECT_MEMBERSHIP_NOT_ACTIVE",
      "Der Nachunternehmer ist kein aktives Projektmitglied. Senden Sie zuerst eine Projekteinladung.",
    );
  }
  return membership;
}

export async function inviteParticipant(input: {
  projectId: string;
  agOrgId: string;
  anOrgId: string;
  invitationMessage?: string;
  validUntil?: Date;
}) {
  const [project] = await db.select().from(projectsTable)
    .where(and(eq(projectsTable.id, input.projectId), eq(projectsTable.agOrgId, input.agOrgId))).limit(1);
  if (!project) throw new ProjectMembershipError("PROJECT_NOT_FOUND", "Projekt nicht gefunden.");

  const participant = await resolveDataspaceParticipant(input.anOrgId);
  if (!participant || participant.organizationType !== "AN" || participant.identityStatus !== "VERIFIED") {
    throw new ProjectMembershipError("PROJECT_PARTICIPANT_NOT_VERIFIED", "Der Teilnehmer ist nicht verifiziert.");
  }
  if (participant.localOrgId === input.agOrgId) {
    throw new ProjectMembershipError("PROJECT_PARTICIPANT_INVALID", "Die eigene Organisation kann nicht eingeladen werden.");
  }

  const [existing] = await db.select().from(projectMembershipsTable).where(and(
    eq(projectMembershipsTable.projectId, input.projectId),
    eq(projectMembershipsTable.anOrgId, input.anOrgId),
  )).limit(1);
  if (existing?.status === "INVITED") {
    throw new ProjectMembershipError("PROJECT_INVITATION_ALREADY_EXISTS", "Für diesen AN besteht bereits eine offene Einladung.");
  }
  if (existing?.status === "ACTIVE") {
    throw new ProjectMembershipError("PROJECT_MEMBERSHIP_ALREADY_ACTIVE", "Der AN ist bereits Projektpartner.");
  }
  if (existing) {
    throw new ProjectMembershipError("PROJECT_INVITATION_ALREADY_RESOLVED", "Die bestehende Projektbeziehung ist bereits abgeschlossen.");
  }

  const invitationId = crypto.randomUUID();
  const correlationId = `project-membership:${input.projectId}:${input.anOrgId}:${invitationId}`;
  const messageId = `project-invitation-${invitationId}`;
  const now = new Date();
  const [membership] = await db.transaction(async (tx) => {
    const [created] = await tx.insert(projectMembershipsTable).values({
      projectId: input.projectId,
      agOrgId: input.agOrgId,
      anOrgId: input.anOrgId,
      anParticipantId: participant.participantId,
      status: "INVITED",
      invitationId,
      correlationId,
      invitationMessage: input.invitationMessage ?? null,
      invitationExpiresAt: input.validUntil ?? null,
      invitedAt: now,
    }).returning();
    return [created];
  });
  const exchange = createDataspaceExchange();
  await exchange.publishProjectInvitation({
    metadata: {
      messageId,
      correlationId,
      schemaVersion: "1.0",
      senderOrgId: input.agOrgId,
      receiverOrgId: input.anOrgId,
      createdAt: now.toISOString(),
    },
    invitationId,
    project: {
      projectReference: project.id,
      projectName: project.name,
      ...(project.description ? { description: project.description } : {}),
      ...(project.location ? { location: project.location } : {}),
    },
    requestedRole: "CONTRACTOR",
    purpose: "PROJECT_COLLABORATION",
    ...(input.invitationMessage ? { invitationMessage: input.invitationMessage } : {}),
    ...(input.validUntil ? { validUntil: input.validUntil.toISOString() } : {}),
    policy: {
      usagePurpose: "PROJECT_MEMBERSHIP",
      allowedConsumerParticipantId: participant.participantId,
    },
  });
  return membership;
}

async function resolveInvitation(id: string, anOrgId: string, decision: "ACTIVE" | "REJECTED", message?: string) {
  const now = new Date();
  const [membership] = await db.select().from(projectMembershipsTable)
    .where(and(eq(projectMembershipsTable.id, id), eq(projectMembershipsTable.anOrgId, anOrgId))).limit(1);
  if (!membership) throw new ProjectMembershipError("PROJECT_INVITATION_NOT_FOUND", "Einladung nicht gefunden.");
  if (membership.status === decision) return membership;
  if (membership.status !== "INVITED") {
    throw new ProjectMembershipError("PROJECT_INVITATION_ALREADY_RESOLVED", "Die Einladung wurde bereits beantwortet.");
  }
  if (membership.invitationExpiresAt && membership.invitationExpiresAt <= now) {
    throw new ProjectMembershipError("PROJECT_INVITATION_EXPIRED", "Die Einladung ist abgelaufen.");
  }
  const responseMessageId = `project-invitation-response-${membership.invitationId}-${decision}`;
  const [updated] = await db.transaction(async (tx) => {
    const [row] = await tx.update(projectMembershipsTable).set({
      status: decision,
      respondedAt: now,
      acceptedAt: decision === "ACTIVE" ? now : null,
      rejectedAt: decision === "REJECTED" ? now : null,
      updatedAt: now,
    }).where(and(
      eq(projectMembershipsTable.id, id),
      eq(projectMembershipsTable.anOrgId, anOrgId),
      eq(projectMembershipsTable.status, "INVITED"),
    )).returning();
    if (!row) throw new ProjectMembershipError("PROJECT_INVITATION_ALREADY_RESOLVED", "Die Einladung wurde bereits beantwortet.");
    return [row];
  });
  const exchange = createDataspaceExchange();
  await exchange.publishProjectInvitationResponse({
    metadata: {
      messageId: responseMessageId,
      correlationId: membership.correlationId,
      schemaVersion: "1.0",
      senderOrgId: anOrgId,
      receiverOrgId: membership.agOrgId,
      createdAt: now.toISOString(),
    },
    invitationId: membership.invitationId,
    projectReference: membership.projectId,
    decision: decision === "ACTIVE" ? "ACCEPTED" : "REJECTED",
    ...(message ? { message } : {}),
    respondedAt: now.toISOString(),
  });
  return updated;
}

export function acceptInvitation(id: string, anOrgId: string) {
  return resolveInvitation(id, anOrgId, "ACTIVE");
}

export function rejectInvitation(id: string, anOrgId: string, message?: string) {
  return resolveInvitation(id, anOrgId, "REJECTED", message);
}

export async function revokeMembership(id: string, agOrgId: string) {
  const [existing] = await db.select().from(projectMembershipsTable).where(and(
    eq(projectMembershipsTable.id, id),
    eq(projectMembershipsTable.agOrgId, agOrgId),
  )).limit(1);
  if (existing?.status === "REVOKED") return existing;
  const [updated] = await db.update(projectMembershipsTable).set({
    status: "REVOKED",
    revokedAt: new Date(),
    updatedAt: new Date(),
  }).where(and(
    eq(projectMembershipsTable.id, id),
    eq(projectMembershipsTable.agOrgId, agOrgId),
    // Both pending invitations and active memberships may be revoked.
    // Resolved memberships cannot be silently reactivated.
    inArray(projectMembershipsTable.status, ["INVITED", "ACTIVE"]),
  )).returning();
  if (!updated) throw new ProjectMembershipError("PROJECT_MEMBERSHIP_NOT_FOUND", "Aktive Projektmitgliedschaft nicht gefunden.");
  return updated;
}