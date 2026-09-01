import {
  anDb,
  anProjectInvitationsTable,
  messageOutboxTable,
} from "@workspace/db";
import { and, eq } from "drizzle-orm";
import type {
  ExternalProjectInvitation,
  ExternalDataOffer,
  ExternalProjectInvitationResponse,
} from "./dataspace/external-contracts";

export class AnProjectInvitationError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "AnProjectInvitationError";
  }
}

export async function storeIncomingProjectInvitation(payload: ExternalProjectInvitation) {
  if (payload.metadata.receiverOrgId === payload.metadata.senderOrgId) {
    throw new AnProjectInvitationError("INVITATION_PARTICIPANTS_INVALID", "Absender und Empfänger der Einladung dürfen nicht identisch sein.");
  }
  const existing = await anDb.select().from(anProjectInvitationsTable)
    .where(eq(anProjectInvitationsTable.invitationId, payload.invitationId))
    .limit(1);
  if (existing[0]) {
    const invitation = existing[0];
    if (
      invitation.correlationId !== payload.metadata.correlationId ||
      invitation.senderAgOrgId !== payload.metadata.senderOrgId ||
      invitation.receiverAnOrgId !== payload.metadata.receiverOrgId
    ) {
      throw new AnProjectInvitationError("INVITATION_CONFLICT", "Die eingegangene Einladung stimmt nicht mit der vorhandenen Einladung überein.");
    }
    const updates: Partial<typeof anProjectInvitationsTable.$inferInsert> = {
      ...(payload.senderOrganizationName !== undefined
        ? { senderAgOrgName: payload.senderOrganizationName }
        : {}),
      ...(payload.policySnapshot ? { policySnapshot: payload.policySnapshot } : {}),
      ...(payload.project.description !== undefined
        ? { projectDescription: payload.project.description }
        : {}),
      ...(payload.project.location !== undefined
        ? { projectLocation: payload.project.location }
        : {}),
      ...(payload.invitationMessage !== undefined
        ? { invitationMessage: payload.invitationMessage }
        : {}),
      ...(payload.validUntil !== undefined
        ? { invitationExpiresAt: new Date(payload.validUntil) }
        : {}),
      updatedAt: new Date(),
    };
    if (payload.dataOffer) {
      Object.assign(updates, {
        dataPublicationTitle: payload.dataOffer.title,
        selectedFields: payload.dataOffer.selectedFields,
        dataOfferSnapshot: payload.dataOffer as unknown as Record<string, unknown>,
        invitationExpiresAt: payload.dataOffer.validUntil
          ? new Date(payload.dataOffer.validUntil)
          : updates.invitationExpiresAt ?? invitation.invitationExpiresAt,
      });
    }
    if (Object.keys(updates).length > 1) {
      const [updated] = await anDb.update(anProjectInvitationsTable).set(updates)
        .where(eq(anProjectInvitationsTable.id, invitation.id)).returning();
      return updated ?? invitation;
    }
    return invitation;
  }

  const [created] = await anDb.insert(anProjectInvitationsTable).values({
    invitationId: payload.invitationId,
    correlationId: payload.metadata.correlationId,
    senderAgOrgId: payload.metadata.senderOrgId,
    senderAgOrgName: payload.senderOrganizationName ?? null,
    receiverAnOrgId: payload.metadata.receiverOrgId,
    projectReference: payload.project.projectReference,
    projectName: payload.project.projectName,
    projectDescription: payload.project.description ?? null,
    projectLocation: payload.project.location ?? null,
    invitationMessage: payload.invitationMessage ?? null,
    invitationExpiresAt: payload.validUntil ? new Date(payload.validUntil) : null,
    dataPublicationId: payload.dataOffer?.publicationId ?? null,
    dataPublicationTitle: payload.dataOffer?.title ?? null,
    selectedFields: payload.dataOffer?.selectedFields ?? null,
    dataOfferSnapshot: payload.dataOffer
      ? payload.dataOffer as unknown as Record<string, unknown>
      : null,
    policySnapshot: payload.policySnapshot ?? payload.dataOffer?.policy ?? {
      usagePurpose: payload.policy.usagePurpose,
      allowedConsumerParticipantId: payload.policy.allowedConsumerParticipantId,
    },
    status: "PENDING",
  }).returning();
  return created;
}

/**
 * Compatibility projection for the existing AN offer screens. The wire
 * contract is a data offer, not an invitation; this adapter keeps the current
 * local decision/content gates working until the AN projection table is
 * migrated independently.
 */
export async function storeIncomingDataOffer(payload: ExternalDataOffer) {
  if (payload.metadata.senderOrgId === payload.metadata.receiverOrgId) {
    throw new AnProjectInvitationError("DATA_OFFER_PARTICIPANTS_INVALID", "Absender und Empfänger des Datenangebots dürfen nicht identisch sein.");
  }
  const invitationId = `data-offer:${payload.publicationId}:${payload.metadata.receiverOrgId}`;
  const [existing] = await anDb.select().from(anProjectInvitationsTable)
    .where(eq(anProjectInvitationsTable.dataPublicationId, payload.publicationId))
    .limit(1);
  if (existing) {
    if (
      existing.senderAgOrgId !== payload.metadata.senderOrgId ||
      existing.receiverAnOrgId !== payload.metadata.receiverOrgId ||
      existing.projectReference !== payload.projectReference
    ) {
      throw new AnProjectInvitationError("DATA_OFFER_CONFLICT", "Das Datenangebot stimmt nicht mit der vorhandenen Projektion überein.");
    }
    const [updated] = await anDb.update(anProjectInvitationsTable).set({
      dataPublicationTitle: payload.title,
      selectedFields: payload.selectedFields,
      dataOfferSnapshot: payload as unknown as Record<string, unknown>,
      policySnapshot: payload.accessPolicy,
      invitationExpiresAt: payload.validUntil ? new Date(payload.validUntil) : null,
      updatedAt: new Date(),
    }).where(eq(anProjectInvitationsTable.id, existing.id)).returning();
    return updated ?? existing;
  }
  const [created] = await anDb.insert(anProjectInvitationsTable).values({
    invitationId,
    correlationId: payload.metadata.correlationId,
    senderAgOrgId: payload.metadata.senderOrgId,
    receiverAnOrgId: payload.metadata.receiverOrgId,
    projectReference: payload.projectReference,
    projectName: payload.projectName,
    invitationExpiresAt: payload.validUntil ? new Date(payload.validUntil) : null,
    dataPublicationId: payload.publicationId,
    dataPublicationTitle: payload.title,
    selectedFields: payload.selectedFields,
    dataOfferSnapshot: payload as unknown as Record<string, unknown>,
    policySnapshot: payload.accessPolicy,
    status: "PENDING",
  }).returning();
  return created;
}

export async function listAnProjectInvitations(anOrgId: string) {
  return anDb.select().from(anProjectInvitationsTable)
    .where(and(
      eq(anProjectInvitationsTable.receiverAnOrgId, anOrgId),
    ));
}

export async function decideAnProjectInvitation(input: {
  id: string;
  anOrgId: string;
  action: "accept" | "reject";
  policyAccepted?: boolean;
  message?: string;
}) {
  const [invitation] = await anDb.select().from(anProjectInvitationsTable)
    .where(and(
      eq(anProjectInvitationsTable.id, input.id),
      eq(anProjectInvitationsTable.receiverAnOrgId, input.anOrgId),
    ))
    .limit(1);
  if (!invitation) throw new AnProjectInvitationError("PROJECT_INVITATION_NOT_FOUND", "Projekteinladung nicht gefunden.");
  if (invitation.status !== "PENDING") {
    throw new AnProjectInvitationError("PROJECT_INVITATION_ALREADY_RESOLVED", "Die Einladung wurde bereits beantwortet.");
  }
  const now = new Date();
  if (invitation.invitationExpiresAt && invitation.invitationExpiresAt <= now) {
    throw new AnProjectInvitationError("PROJECT_INVITATION_EXPIRED", "Die Einladung ist abgelaufen.");
  }
  if (input.action === "accept" && input.policyAccepted !== true) {
    throw new AnProjectInvitationError(
      "POLICY_ACCEPTANCE_REQUIRED",
      "Die Projekteinladung kann nur zusammen mit der Policy akzeptiert werden.",
    );
  }

  const decision = input.action === "accept" ? "ACCEPTED" : "REJECTED";
  const messageId = `project-invitation-response-${invitation.invitationId}-${decision}`;
  const payload: ExternalProjectInvitationResponse = {
    metadata: {
      messageId,
      correlationId: invitation.correlationId,
      schemaVersion: "1.0",
      senderOrgId: input.anOrgId,
      receiverOrgId: invitation.senderAgOrgId,
      createdAt: now.toISOString(),
    },
    invitationId: invitation.invitationId,
    projectReference: invitation.projectReference,
    ...(invitation.dataPublicationId ? { dataPublicationId: invitation.dataPublicationId } : {}),
    decision,
    policyAccepted: input.action === "accept",
    ...(input.message ? { message: input.message } : {}),
    respondedAt: now.toISOString(),
  };

  const [updated] = await anDb.transaction(async (tx) => {
    const [row] = await tx.update(anProjectInvitationsTable).set({
      status: input.action === "accept" ? "ACCEPTED" : "REJECTED",
      policyAcceptedAt: input.action === "accept" ? now : null,
      respondedAt: now,
      rejectedAt: input.action === "reject" ? now : null,
      updatedAt: now,
    }).where(and(
      eq(anProjectInvitationsTable.id, invitation.id),
      eq(anProjectInvitationsTable.status, "PENDING"),
    )).returning();
    if (!row) throw new AnProjectInvitationError("PROJECT_INVITATION_ALREADY_RESOLVED", "Die Einladung wurde bereits beantwortet.");
    await tx.insert(messageOutboxTable).values({
      messageId,
      schemaVersion: "1.0",
      messageType: "PROJECT_INVITATION_RESPONSE",
      senderOrgId: input.anOrgId,
      recipientOrgId: invitation.senderAgOrgId,
      correlationId: invitation.correlationId,
      payload: payload as unknown as Record<string, unknown>,
      status: "PENDING",
    });
    return [row];
  });
  return { invitation: updated, payload };
}