import {
  agDb as db,
  organizationsTable,
  messageOutboxTable,
  projectsTable,
  takteTable,
  projectMembershipsTable,
  dataPublicationsTable,
  dataPublicationRecipientsTable,
  policyTemplatesTable,
} from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";
import {
  listDataspaceParticipants,
  resolveDataspaceParticipant,
} from "./dataspace/dataspace-participant-resolver";
import { createDataspaceExchange } from "./dataspace/dataspace-exchange-factory";
import {
  deliverLocalProjectInvitation,
  deliverLocalProjectInvitationResponse,
} from "./dataspace/local-dataspace-delivery";
import type { ExternalProjectInvitation, ExternalProjectInvitationResponse } from "./dataspace/external-contracts";
import {
  FIELD_WHITELISTS,
  buildContentSnapshot,
  computeContentHash,
} from "./data-publication-service";

export class ProjectMembershipError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "ProjectMembershipError";
  }
}

export async function listProjectParticipants(projectId: string, agOrgId: string) {
  const [project] = await db.select({ id: projectsTable.id })
    .from(projectsTable)
    .where(and(eq(projectsTable.id, projectId), eq(projectsTable.agOrgId, agOrgId)))
    .limit(1);
  if (!project) {
    throw new ProjectMembershipError("PROJECT_NOT_FOUND", "Projekt nicht gefunden.");
  }
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
  const memberships = await db.select().from(projectMembershipsTable).where(and(
    eq(projectMembershipsTable.projectId, projectId),
    eq(projectMembershipsTable.agOrgId, agOrgId),
  ));
  const messageIds = memberships.flatMap((m) => [
    `project-invitation-${m.invitationId}`,
    `project-invitation-response-${m.invitationId}-ACTIVE`,
    `project-invitation-response-${m.invitationId}-REJECTED`,
  ]);
  const deliveries = await db.select().from(messageOutboxTable)
    .where(inArray(messageOutboxTable.messageId, messageIds));
  const byMessageId = new Map(deliveries.map((row) => [row.messageId, row]));
  return memberships.map((membership) => ({
    ...membership,
    invitationDelivery: byMessageId.get(`project-invitation-${membership.invitationId}`) ?? null,
    responseDelivery: (
      byMessageId.get(`project-invitation-response-${membership.invitationId}-ACTIVE`) ??
      byMessageId.get(`project-invitation-response-${membership.invitationId}-REJECTED`) ??
      null
    ),
  }));
}

export async function listFailedProjectInvitationDeliveries(projectId: string, agOrgId: string) {
  const memberships = await listProjectMemberships(projectId, agOrgId);
  return memberships.flatMap((membership) => [
    membership.invitationDelivery,
    membership.responseDelivery,
  ].filter((delivery): delivery is NonNullable<typeof delivery> =>
    delivery != null &&
    ["PENDING", "FAILED"].includes(delivery.status) &&
    (delivery.messageType === "PROJECT_INVITATION" || delivery.messageType === "PROJECT_INVITATION_RESPONSE"),
  )).sort((a, b) => (b.lastAttemptAt?.getTime() ?? 0) - (a.lastAttemptAt?.getTime() ?? 0));
}

export async function retryProjectInvitationDelivery(messageId: string, agOrgId: string) {
  const [outbox] = await db.select().from(messageOutboxTable)
    .where(and(
      eq(messageOutboxTable.messageId, messageId),
      eq(messageOutboxTable.senderOrgId, agOrgId),
    )).limit(1);
  if (!outbox || !["PROJECT_INVITATION", "PROJECT_INVITATION_RESPONSE"].includes(outbox.messageType)) {
    throw new ProjectMembershipError("PROJECT_INVITATION_DELIVERY_NOT_FOUND", "Zustellung der Projekteinladung nicht gefunden.");
  }
  if (!["PENDING", "FAILED"].includes(outbox.status)) {
    throw new ProjectMembershipError("PROJECT_INVITATION_DELIVERY_NOT_RETRYABLE", `Die Zustellung kann nicht wiederholt werden (Status: ${outbox.status}).`);
  }
  if (outbox.attemptCount >= 5) {
    throw new ProjectMembershipError("PROJECT_INVITATION_RETRY_EXHAUSTED", "Die Zustellung wurde nach fünf Versuchen aufgegeben. Bitte prüfen Sie den Dataspace-Connector.");
  }
  const payload = outbox.payload as unknown as ExternalProjectInvitation | ExternalProjectInvitationResponse;
  const exchange = createDataspaceExchange();
  // publish establishes the exchange adapter record if a process stopped
  // immediately after the transactional outbox commit; retry then drains the
  // persisted envelope without creating another business row.
  const published = outbox.messageType === "PROJECT_INVITATION"
    ? await deliverLocalProjectInvitation(payload as ExternalProjectInvitation, exchange)
    : await deliverLocalProjectInvitationResponse(payload as ExternalProjectInvitationResponse, exchange);
  const result = published.status === "DELIVERED"
    ? published
    : await exchange.retryProjectInvitation(messageId);
  if (published.status !== "DELIVERED" && result.status === "DELIVERED") {
    if (outbox.messageType === "PROJECT_INVITATION") {
      await deliverLocalProjectInvitation(payload as ExternalProjectInvitation, exchange);
    } else {
      await deliverLocalProjectInvitationResponse(payload as ExternalProjectInvitationResponse, exchange);
    }
  }
  if (result.status === "FAILED" && (result.attemptCount ?? 0) >= 5) {
    throw new ProjectMembershipError("PROJECT_INVITATION_RETRY_EXHAUSTED", "Die Zustellung wurde nach fünf Versuchen aufgegeben. Bitte prüfen Sie den Dataspace-Connector.");
  }
  return result;
}

export async function listPendingProjectInvitations(anOrgId: string) {
  const invitations = await db.select({
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
  return Promise.all(invitations.map(async (invitation) => {
    if (!invitation.membership.dataPublicationId) return { ...invitation, dataOffer: null };
    const [publication] = await db.select().from(dataPublicationsTable).where(
      eq(dataPublicationsTable.id, invitation.membership.dataPublicationId),
    ).limit(1);
    const [recipient] = await db.select().from(dataPublicationRecipientsTable).where(and(
      eq(dataPublicationRecipientsTable.publicationId, invitation.membership.dataPublicationId),
      eq(dataPublicationRecipientsTable.projectMembershipId, invitation.membership.id),
      eq(dataPublicationRecipientsTable.anOrgId, anOrgId),
    )).limit(1);
    const [policy] = publication ? await db.select().from(policyTemplatesTable).where(
      eq(policyTemplatesTable.id, publication.policyTemplateId),
    ).limit(1) : [];
    return {
      ...invitation,
      dataOffer: publication && recipient ? {
        publicationId: publication.id,
        title: publication.title,
        description: publication.description,
        selectedFields: publication.selectedFields,
        validFrom: publication.validFrom,
        validUntil: publication.validUntil,
        publicationStatus: publication.status,
        recipientStatus: recipient.status,
        policy: policy ? {
          id: policy.id,
          code: policy.code,
          name: policy.name,
          purpose: policy.purpose,
          permissions: policy.permissions,
          prohibitions: policy.prohibitions,
          validityRule: policy.validityRule,
          retentionRule: policy.retentionRule,
        } : null,
      } : null,
    };
  }));
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
  anOrgId?: string;
  participantId?: string;
  invitationMessage?: string;
  validUntil?: Date;
}) {
  const [project] = await db.select().from(projectsTable)
    .where(and(eq(projectsTable.id, input.projectId), eq(projectsTable.agOrgId, input.agOrgId))).limit(1);
  if (!project) throw new ProjectMembershipError("PROJECT_NOT_FOUND", "Projekt nicht gefunden.");

  const participant = await resolveDataspaceParticipant(input.anOrgId ?? input.participantId ?? "");
  if (!participant || participant.organizationType !== "AN" || participant.identityStatus !== "VERIFIED") {
    throw new ProjectMembershipError("PROJECT_PARTICIPANT_NOT_VERIFIED", "Der Teilnehmer ist nicht verifiziert.");
  }
  if (participant.localOrgId === input.agOrgId) {
    throw new ProjectMembershipError("PROJECT_PARTICIPANT_INVALID", "Die eigene Organisation kann nicht eingeladen werden.");
  }

  const anOrgId = participant.localOrgId ?? input.anOrgId;
  if (!anOrgId) {
    throw new ProjectMembershipError("PROJECT_PARTICIPANT_UNMAPPED", "Der Datenraumteilnehmer ist keiner lokalen Organisation zugeordnet.");
  }
  const [existing] = await db.select().from(projectMembershipsTable).where(and(
    eq(projectMembershipsTable.projectId, input.projectId),
    eq(projectMembershipsTable.anOrgId, anOrgId),
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
  const correlationId = `project-membership:${input.projectId}:${anOrgId}:${invitationId}`;
  const messageId = `project-invitation-${invitationId}`;
  const now = new Date();
  const invitationPayload: ExternalProjectInvitation = {
    metadata: {
      messageId,
      correlationId,
      schemaVersion: "1.0",
      senderOrgId: input.agOrgId,
      receiverOrgId: anOrgId,
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
  };
  const [membership] = await db.transaction(async (tx) => {
    const [created] = await tx.insert(projectMembershipsTable).values({
      projectId: input.projectId,
      agOrgId: input.agOrgId,
      anOrgId,
      anParticipantId: participant.participantId,
      status: "INVITED",
      invitationId,
      correlationId,
      invitationMessage: input.invitationMessage ?? null,
      invitationExpiresAt: input.validUntil ?? null,
      invitedAt: now,
    }).returning();
    await tx.insert(messageOutboxTable).values({
      messageId,
      schemaVersion: "1.0",
      messageType: "PROJECT_INVITATION",
      senderOrgId: input.agOrgId,
      recipientOrgId: anOrgId,
      correlationId,
      payload: invitationPayload as unknown as Record<string, unknown>,
      status: "PENDING",
    });
    return [created];
  });
  const exchange = createDataspaceExchange();
  const delivery = await deliverLocalProjectInvitation(invitationPayload, exchange);
  if (delivery.status === "PENDING") {
    const retry = await exchange.retryProjectInvitation(messageId);
    if (retry.status === "DELIVERED") {
      await deliverLocalProjectInvitation(invitationPayload, exchange);
    }
  }
  return membership;
}

export type CreateProjectInvitationPackageInput = {
  projectId: string;
  agOrgId: string;
  participantIds: string[];
  policyTemplateId: string;
  selectedFields: string[];
  title: string;
  description?: string;
  invitationMessage?: string;
  validFrom?: Date;
  validUntil?: Date;
  idempotencyKey?: string;
};

/**
 * Creates the project memberships and their data offer as one business
 * operation. The transaction contains no transport calls. Both invitation
 * messages and data-offer notifications are dispatched only after commit.
 */
export async function createProjectInvitationPackage(input: CreateProjectInvitationPackageInput) {
  const [project] = await db.select().from(projectsTable).where(and(
    eq(projectsTable.id, input.projectId),
    eq(projectsTable.agOrgId, input.agOrgId),
  )).limit(1);
  if (!project) throw new ProjectMembershipError("PROJECT_NOT_FOUND", "Projekt nicht gefunden.");

  const [policy] = await db.select().from(policyTemplatesTable).where(and(
    eq(policyTemplatesTable.id, input.policyTemplateId),
    eq(policyTemplatesTable.active, true),
  )).limit(1);
  if (!policy) throw new ProjectMembershipError("PROJECT_POLICY_NOT_FOUND", "Die ausgewählte Policy ist nicht verfügbar.");

  const allowedFields = new Set(FIELD_WHITELISTS.TAKT_INFORMATION_PACKAGE);
  const invalidFields = input.selectedFields.filter((field) => !allowedFields.has(field));
  if (invalidFields.length > 0) {
    throw new ProjectMembershipError(
      "PROJECT_INVITATION_FIELDS_NOT_ALLOWED",
      `Nicht erlaubte Datenfelder: ${invalidFields.join(", ")}`,
    );
  }
  if (input.selectedFields.length === 0) {
    throw new ProjectMembershipError("PROJECT_INVITATION_FIELDS_REQUIRED", "Mindestens ein Datenfeld muss freigegeben werden.");
  }
  if (input.validFrom && input.validUntil && input.validUntil < input.validFrom) {
    throw new ProjectMembershipError("PROJECT_INVITATION_INVALID_VALIDITY", "Das Ende der Gültigkeit muss nach dem Beginn liegen.");
  }

  const participantIds = [...new Set(input.participantIds)];
  if (participantIds.length === 0) {
    throw new ProjectMembershipError("PROJECT_PARTICIPANT_REQUIRED", "Mindestens ein Dataspace-Teilnehmer muss ausgewählt werden.");
  }

  const participants = await Promise.all(
    participantIds.map((participantId) => resolveDataspaceParticipant(participantId)),
  );
  const resolved = participants.map((participant, index) => {
    if (!participant || participant.organizationType !== "AN" || participant.identityStatus !== "VERIFIED" ||
        !participant.localOrgId) {
      throw new ProjectMembershipError(
        "PROJECT_PARTICIPANT_NOT_VERIFIED",
        `Der Dataspace-Teilnehmer ${participantIds[index]} ist nicht verifiziert oder keiner lokalen Organisation zugeordnet.`,
      );
    }
    return participant;
  });
  const anOrgIds = resolved.map((participant) => participant.localOrgId!);
  if (new Set(anOrgIds).size !== anOrgIds.length) {
    throw new ProjectMembershipError("PROJECT_PARTICIPANT_DUPLICATE", "Ein Teilnehmer wurde mehrfach ausgewählt.");
  }

  const idempotencyKey = input.idempotencyKey?.trim() || crypto.randomUUID();
  const existingPublication = await db.select().from(dataPublicationsTable).where(and(
    eq(dataPublicationsTable.projectId, input.projectId),
    eq(dataPublicationsTable.agOrgId, input.agOrgId),
    eq(dataPublicationsTable.projectInvitationId, idempotencyKey),
  )).limit(1);
  if (existingPublication[0]) {
    const existingMemberships = await db.select().from(projectMembershipsTable).where(
      eq(projectMembershipsTable.dataPublicationId, existingPublication[0].id),
    );
    const sameParticipants = existingMemberships.length === anOrgIds.length &&
      existingMemberships.every((membership) => anOrgIds.includes(membership.anOrgId));
    const sameFields = JSON.stringify([...existingPublication[0].selectedFields].sort()) ===
      JSON.stringify([...input.selectedFields].sort());
    if (!sameParticipants || !sameFields ||
        existingPublication[0].policyTemplateId !== input.policyTemplateId ||
        existingPublication[0].title !== input.title) {
      throw new ProjectMembershipError(
        "PROJECT_INVITATION_IDEMPOTENCY_CONFLICT",
        "Der Idempotenzschlüssel wurde bereits für einen anderen Einladungsauftrag verwendet.",
      );
    }
    await dispatchProjectInvitationPackage(existingPublication[0].id, input.agOrgId);
    return {
      projectInvitationId: idempotencyKey,
      publicationId: existingPublication[0].id,
      status: existingPublication[0].status,
      memberships: existingMemberships,
      idempotent: true,
    };
  }

  const existingMemberships = await db.select({
    id: projectMembershipsTable.id,
    anOrgId: projectMembershipsTable.anOrgId,
    status: projectMembershipsTable.status,
  }).from(projectMembershipsTable).where(and(
    eq(projectMembershipsTable.projectId, input.projectId),
    inArray(projectMembershipsTable.anOrgId, anOrgIds as [string, ...string[]]),
  ));
  const blockedMemberships = existingMemberships.filter((membership) =>
    membership.status === "INVITED" || membership.status === "ACTIVE",
  );
  if (blockedMemberships.length > 0) {
    throw new ProjectMembershipError(
      blockedMemberships.some((membership) => membership.status === "ACTIVE")
        ? "PROJECT_MEMBERSHIP_ALREADY_ACTIVE"
        : "PROJECT_INVITATION_ALREADY_EXISTS",
      "Für mindestens einen ausgewählten AN besteht bereits eine Projektbeziehung.",
    );
  }

  // Build and hash before opening the write transaction so a snapshot failure
  // cannot leave behind a half-prepared invitation package.
  const snapshot = await buildContentSnapshot(
    "TAKT_INFORMATION_PACKAGE",
    input.projectId,
    input.selectedFields,
  );
  const contentHash = computeContentHash(snapshot);
  const publicationId = crypto.randomUUID();
  const now = new Date();
  const invitationRows: Array<{
    membership: typeof projectMembershipsTable.$inferSelect;
    payload: ExternalProjectInvitation;
  }> = [];

  try {
  await db.transaction(async (tx) => {
    const [publication] = await tx.insert(dataPublicationsTable).values({
      id: publicationId,
      agOrgId: input.agOrgId,
      projectId: input.projectId,
      projectInvitationId: idempotencyKey,
      dataProductType: "TAKT_INFORMATION_PACKAGE",
      title: input.title,
      description: input.description ?? null,
      version: 1,
      schemaVersion: "1.0",
      status: "PUBLISHED",
      policyTemplateId: input.policyTemplateId,
      selectedFields: input.selectedFields,
      selectedTaktIds: null,
      contentSnapshot: snapshot,
      contentHash,
      validFrom: input.validFrom ?? now,
      validUntil: input.validUntil ?? null,
      publishedAt: now,
    }).returning();

    for (const participant of resolved) {
      const anOrgId = participant.localOrgId!;
      const invitationId = crypto.randomUUID();
      const correlationId = `project-membership:${input.projectId}:${anOrgId}:${invitationId}`;
      const messageId = `project-invitation-${invitationId}`;
      const previousMembership = existingMemberships.find((membership) => membership.anOrgId === anOrgId);
      const [membership] = previousMembership
        ? await tx.update(projectMembershipsTable).set({
            anParticipantId: participant.participantId,
            dataPublicationId: publication.id,
            status: "INVITED",
            invitationId,
            correlationId,
            invitationMessage: input.invitationMessage ?? null,
            invitationExpiresAt: input.validUntil ?? null,
            invitedAt: now,
            respondedAt: null,
            acceptedAt: null,
            rejectedAt: null,
            revokedAt: null,
            updatedAt: now,
          }).where(and(
            eq(projectMembershipsTable.id, previousMembership.id),
            inArray(projectMembershipsTable.status, ["REJECTED", "REVOKED"]),
          )).returning()
        : await tx.insert(projectMembershipsTable).values({
            projectId: input.projectId,
            agOrgId: input.agOrgId,
            anOrgId,
            anParticipantId: participant.participantId,
            dataPublicationId: publication.id,
            status: "INVITED",
            invitationId,
            correlationId,
            invitationMessage: input.invitationMessage ?? null,
            invitationExpiresAt: input.validUntil ?? null,
            invitedAt: now,
          }).returning();
      if (!membership) {
        throw new ProjectMembershipError(
          "PROJECT_INVITATION_ALREADY_EXISTS",
          "Die Projektbeziehung wurde zwischenzeitlich geändert. Bitte laden Sie die Seite neu.",
        );
      }

      await tx.insert(dataPublicationRecipientsTable).values({
        publicationId: publication.id,
        projectMembershipId: membership.id,
        anOrgId,
      });
      const dataOfferMessageId = `dataspace-offer-${publication.id}-${anOrgId}`;
      await tx.insert(messageOutboxTable).values({
        messageId: dataOfferMessageId,
        schemaVersion: "1.0",
        messageType: "DATA_OFFER_PUBLISHED",
        senderOrgId: input.agOrgId,
        recipientOrgId: anOrgId,
        correlationId: publication.id,
        payload: {
          publicationId: publication.id,
          projectReference: publication.projectId,
          dataProductType: publication.dataProductType,
          publicationVersion: publication.version,
          policyCode: policy.code,
          validUntil: publication.validUntil?.toISOString() ?? null,
          detailsRef: `/api/an/data-offers/${publication.id}`,
          title: publication.title,
        },
        status: "PENDING",
      });

      const invitationPayload: ExternalProjectInvitation = {
        metadata: {
          messageId,
          correlationId,
          schemaVersion: "1.0",
          senderOrgId: input.agOrgId,
          receiverOrgId: anOrgId,
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
          templateId: policy.id,
          templateCode: policy.code,
          templateName: policy.name,
          purpose: policy.purpose,
          permissions: policy.permissions,
          prohibitions: policy.prohibitions,
        },
        dataOffer: {
          publicationId: publication.id,
          title: publication.title,
          selectedFields: input.selectedFields,
          validFrom: (input.validFrom ?? now).toISOString(),
          ...(input.validUntil ? { validUntil: input.validUntil.toISOString() } : {}),
        },
      };
      await tx.insert(messageOutboxTable).values({
        messageId,
        schemaVersion: "1.0",
        messageType: "PROJECT_INVITATION",
        senderOrgId: input.agOrgId,
        recipientOrgId: anOrgId,
        correlationId,
        payload: invitationPayload as unknown as Record<string, unknown>,
        status: "PENDING",
      });
      invitationRows.push({ membership, payload: invitationPayload });
    }
  });
  } catch (error) {
    // The unique idempotency key is the concurrency guard. A concurrent
    // request that won the race is returned as the same completed operation.
    const code = (error as { cause?: { code?: string }; code?: string }).cause?.code ??
      (error as { code?: string }).code;
    if (code === "23505") {
      const [winner] = await db.select().from(dataPublicationsTable).where(and(
        eq(dataPublicationsTable.projectId, input.projectId),
        eq(dataPublicationsTable.agOrgId, input.agOrgId),
        eq(dataPublicationsTable.projectInvitationId, idempotencyKey),
      )).limit(1);
      if (winner) {
        const memberships = await db.select().from(projectMembershipsTable).where(
          eq(projectMembershipsTable.dataPublicationId, winner.id),
        );
        await dispatchProjectInvitationPackage(winner.id, input.agOrgId);
        return {
          projectInvitationId: idempotencyKey,
          publicationId: winner.id,
          status: winner.status,
          memberships,
          idempotent: true,
        };
      }
    }
    throw error;
  }

  await dispatchProjectInvitationPackage(publicationId, input.agOrgId, invitationRows);

  const memberships = await db.select().from(projectMembershipsTable).where(
    eq(projectMembershipsTable.dataPublicationId, publicationId),
  );
  return {
    projectInvitationId: idempotencyKey,
    publicationId,
    status: "PUBLISHED" as const,
    memberships,
    idempotent: false,
  };
}

async function dispatchProjectInvitationPackage(
  publicationId: string,
  agOrgId: string,
  preparedRows?: Array<{ membership: typeof projectMembershipsTable.$inferSelect; payload: ExternalProjectInvitation }>,
) {
  const rows = preparedRows ?? await db.select().from(messageOutboxTable).where(and(
    eq(messageOutboxTable.correlationId, publicationId),
    eq(messageOutboxTable.messageType, "PROJECT_INVITATION"),
    eq(messageOutboxTable.senderOrgId, agOrgId),
  )).then((outboxRows) => outboxRows.map((outbox) => ({
    membership: null,
    payload: outbox.payload as unknown as ExternalProjectInvitation,
  })));
  if (!rows) return;
  const exchange = createDataspaceExchange();
  for (const row of rows) {
    const delivery = await deliverLocalProjectInvitation(row.payload, exchange);
    if (delivery.status === "PENDING" || delivery.status === "FAILED") {
      const retry = await exchange.retryProjectInvitation(row.payload.metadata.messageId).catch(() => undefined);
      // A pre-created transactional outbox row makes the first local send
      // return PENDING. Once its retry delivers technically, invoke the local
      // inbound leg too so the AN receives its own immutable invitation view.
      if (retry?.status === "DELIVERED") {
        await deliverLocalProjectInvitation(row.payload, exchange);
      }
    }
  }
  const { publishCombinedDataPublicationNotifications } = await import("./data-publication-service");
  await publishCombinedDataPublicationNotifications(publicationId, agOrgId);
}

async function resolveInvitation(
  id: string,
  anOrgId: string,
  decision: "ACTIVE" | "REJECTED",
  message?: string,
  policyAccepted?: boolean,
) {
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
  let linkedRecipient: typeof dataPublicationRecipientsTable.$inferSelect | undefined;
  let linkedPublication: typeof dataPublicationsTable.$inferSelect | undefined;
  if (membership.dataPublicationId) {
    [linkedRecipient] = await db.select().from(dataPublicationRecipientsTable).where(and(
      eq(dataPublicationRecipientsTable.publicationId, membership.dataPublicationId),
      eq(dataPublicationRecipientsTable.projectMembershipId, membership.id),
      eq(dataPublicationRecipientsTable.anOrgId, anOrgId),
    )).limit(1);
    [linkedPublication] = await db.select().from(dataPublicationsTable).where(
      eq(dataPublicationsTable.id, membership.dataPublicationId),
    ).limit(1);
    if (!linkedRecipient || !linkedPublication || linkedPublication.status !== "PUBLISHED") {
      throw new ProjectMembershipError("PROJECT_INVITATION_DATA_OFFER_UNAVAILABLE", "Das zugehörige Datenangebot ist nicht mehr aktiv.");
    }
    if (linkedPublication.validFrom && linkedPublication.validFrom > now) {
      throw new ProjectMembershipError("PROJECT_INVITATION_NOT_YET_VALID", "Die Projekteinladung kann erst ab Beginn der Datenfreigabe angenommen werden.");
    }
    if (decision === "ACTIVE" && policyAccepted !== true) {
      throw new ProjectMembershipError("PROJECT_POLICY_CONFIRMATION_REQUIRED", "Bitte bestätigen Sie die Nutzungsrichtlinie ausdrücklich, bevor Sie die Einladung annehmen.");
    }
  }
  const responseMessageId = `project-invitation-response-${membership.invitationId}-${decision}`;
  const responsePayload: ExternalProjectInvitationResponse = {
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
  };
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
    if (linkedRecipient) {
      const [recipient] = await tx.update(dataPublicationRecipientsTable).set({
        status: decision === "ACTIVE" ? "ACCEPTED" : "REJECTED",
        policyAcceptedAt: decision === "ACTIVE" ? now : null,
        policyRejectedAt: decision === "REJECTED" ? now : null,
        updatedAt: now,
      }).where(and(
        eq(dataPublicationRecipientsTable.id, linkedRecipient.id),
        eq(dataPublicationRecipientsTable.status, "OFFERED"),
      )).returning();
      if (!recipient) {
        throw new ProjectMembershipError("PROJECT_INVITATION_ALREADY_RESOLVED", "Das verknüpfte Datenangebot wurde bereits beantwortet.");
      }
    }
    await tx.insert(messageOutboxTable).values({
      messageId: responseMessageId,
      schemaVersion: "1.0",
      messageType: "PROJECT_INVITATION_RESPONSE",
      senderOrgId: anOrgId,
      recipientOrgId: membership.agOrgId,
      correlationId: membership.correlationId,
      payload: responsePayload as unknown as Record<string, unknown>,
      status: "PENDING",
    });
    return [row];
  });
  const exchange = createDataspaceExchange();
  const delivery = await deliverLocalProjectInvitationResponse(responsePayload, exchange);
  if (delivery.status === "PENDING") {
    await exchange.retryProjectInvitation(responseMessageId);
  }
  return updated;
}

export function acceptInvitation(id: string, anOrgId: string, policyAccepted?: boolean) {
  return resolveInvitation(id, anOrgId, "ACTIVE", undefined, policyAccepted);
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