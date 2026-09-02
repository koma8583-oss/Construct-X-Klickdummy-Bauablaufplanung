import {
  anDb,
  anProjectInvitationsTable,
  messageOutboxTable,
} from "@workspace/db";
import { and, eq } from "drizzle-orm";
import type { ExternalDataOfferResponse } from "./dataspace/external-contracts";

export class AnDataOfferError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "AnDataOfferError";
  }
}

/**
 * Decide an independently published data offer. The local projection table is
 * reused for the PoC, but this service never calls the invitation decision
 * service and emits DATA_OFFER_RESPONSE instead of PROJECT_INVITATION_RESPONSE.
 */
export async function decideAnDataOffer(input: {
  publicationId: string;
  anOrgId: string;
  action: "accept" | "reject";
  message?: string;
}) {
  const [offer] = await anDb.select().from(anProjectInvitationsTable)
    .where(and(
      eq(anProjectInvitationsTable.dataPublicationId, input.publicationId),
      eq(anProjectInvitationsTable.receiverAnOrgId, input.anOrgId),
    ))
    .limit(1);
  if (!offer) {
    throw new AnDataOfferError("DATA_OFFER_NOT_FOUND", "Leistungsfreigabe nicht gefunden.");
  }
  if (!offer.dataPublicationId) {
    throw new AnDataOfferError("DATA_OFFER_NOT_FOUND", "Leistungsfreigabe nicht gefunden.");
  }
  if (offer.status !== "PENDING") {
    throw new AnDataOfferError(
      "DATA_OFFER_ALREADY_RESOLVED",
      "Die Leistungsfreigabe wurde bereits beantwortet.",
    );
  }
  const now = new Date();
  if (offer.invitationExpiresAt && offer.invitationExpiresAt <= now) {
    throw new AnDataOfferError("DATA_OFFER_EXPIRED", "Die Leistungsfreigabe ist abgelaufen.");
  }
  if (input.action === "accept") {
    const snapshot = offer.dataOfferSnapshot;
    const status = snapshot && typeof snapshot === "object" && "status" in snapshot
      ? snapshot.status
      : "PUBLISHED";
    if (status !== "PUBLISHED") {
      throw new AnDataOfferError("DATA_OFFER_UNAVAILABLE", "Die Leistungsfreigabe ist nicht verfügbar.");
    }
  }

  const decision = input.action === "accept" ? "ACCEPTED" : "REJECTED";
  const payload: ExternalDataOfferResponse = {
    metadata: {
      messageId: `data-offer-response-${offer.dataPublicationId}-${input.anOrgId}-${decision}`,
      correlationId: offer.correlationId,
      schemaVersion: "1.0",
      senderOrgId: input.anOrgId,
      receiverOrgId: offer.senderAgOrgId,
      createdAt: now.toISOString(),
    },
    publicationId: offer.dataPublicationId,
    projectReference: offer.projectReference,
    decision,
    ...(input.action === "accept" ? { policyAccepted: true } : {}),
    ...(input.message ? { message: input.message } : {}),
    respondedAt: now.toISOString(),
  };

  const [updated] = await anDb.transaction(async (tx) => {
    const [row] = await tx.update(anProjectInvitationsTable).set({
      status: decision,
      policyAcceptedAt: input.action === "accept" ? now : null,
      respondedAt: now,
      rejectedAt: input.action === "reject" ? now : null,
      updatedAt: now,
    }).where(and(
      eq(anProjectInvitationsTable.id, offer.id),
      eq(anProjectInvitationsTable.status, "PENDING"),
    )).returning();
    if (!row) {
      throw new AnDataOfferError(
        "DATA_OFFER_ALREADY_RESOLVED",
        "Die Leistungsfreigabe wurde bereits beantwortet.",
      );
    }
    await tx.insert(messageOutboxTable).values({
      messageId: payload.metadata.messageId,
      schemaVersion: "1.0",
      messageType: "DATA_OFFER_RESPONSE",
      senderOrgId: input.anOrgId,
      recipientOrgId: offer.senderAgOrgId,
      correlationId: offer.correlationId,
      payload: payload as unknown as Record<string, unknown>,
      status: "PENDING",
    });
    return [row];
  });

  return { offer: updated, payload };
}