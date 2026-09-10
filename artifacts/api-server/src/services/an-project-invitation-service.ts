import {
  anDb,
  anProjectInvitationsTable,
  type DataOfferLifecycleStatus,
} from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { isDeepStrictEqual } from "node:util";
import type {
  ExternalProjectInvitation,
  ExternalDataOffer,
  ExternalProjectInvitationResponse,
} from "./dataspace/external-contracts";
import { enqueueHubMessageInTransaction } from "./hub-transport-service";

export class AnProjectInvitationError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "AnProjectInvitationError";
  }
}

function isLegacyInvitationPolicySnapshot(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return true;
  const keys = Object.keys(value as Record<string, unknown>);
  return keys.every((key) =>
    key === "usagePurpose" || key === "allowedConsumerParticipantId"
  );
}

export type LocalDataOfferPublicationStatus =
  | DataOfferLifecycleStatus
  | "EXPIRED"
  | "UNKNOWN";

export function parseDataOfferLifecycleStatus(
  value: unknown,
): DataOfferLifecycleStatus | "UNKNOWN" {
  if (value === "PUBLISHED" || value === "SUSPENDED" || value === "WITHDRAWN") {
    return value;
  }
  return "UNKNOWN";
}

function requireDataOfferLifecycleStatus(value: unknown): DataOfferLifecycleStatus {
  const status = parseDataOfferLifecycleStatus(value);
  if (status === "UNKNOWN") {
    throw new AnProjectInvitationError(
      "DATA_OFFER_LIFECYCLE_INVALID",
      "Das Datenangebot enthält einen unbekannten Veröffentlichungsstatus.",
    );
  }
  return status;
}

function immutableDataOfferSnapshot(value: Record<string, unknown>): Record<string, unknown> {
  // Keep the original publication status as historical snapshot data. The
  // mutable source of truth is data_offer_lifecycle_status; status is excluded
  // only from conflict comparisons so lifecycle propagation cannot mutate the
  // immutable snapshot.
  return { ...value };
}

/**
 * Resolve the local offer state without trusting malformed JSONB values.
 * Unknown state is intentionally preserved as UNKNOWN so callers can fail
 * closed instead of accidentally treating a corrupt projection as published.
 */
export function getDataOfferPublicationStatus(
  invitation: typeof anProjectInvitationsTable.$inferSelect,
  now = new Date(),
): LocalDataOfferPublicationStatus {
  const snapshot = invitation.dataOfferSnapshot ?? {};
  const rawStatus = invitation.dataOfferLifecycleStatus
    ?? (snapshot as Record<string, unknown>).status;
  const lifecycleStatus = parseDataOfferLifecycleStatus(rawStatus);
  if (lifecycleStatus === "UNKNOWN") return "UNKNOWN";

  let validUntil = invitation.invitationExpiresAt;
  if (Object.prototype.hasOwnProperty.call(snapshot, "validUntil")) {
    const snapshotValidUntil = (snapshot as Record<string, unknown>).validUntil;
    if (snapshotValidUntil === null) {
      validUntil = null;
    } else if (
      typeof snapshotValidUntil === "string"
      && !Number.isNaN(Date.parse(snapshotValidUntil))
    ) {
      validUntil = new Date(snapshotValidUntil);
    } else {
      return "UNKNOWN";
    }
  }

  if (lifecycleStatus === "PUBLISHED" && validUntil && validUntil <= now) {
    return "EXPIRED";
  }
  return lifecycleStatus;
}

/**
 * Message metadata is intentionally excluded from this comparison. A retry
 * can have a new delivery message id, but the published offer itself must not
 * change once it has been projected locally.
 */
function protectedDataOfferContent(value: Record<string, unknown>) {
  return {
    publicationId: value.publicationId ?? null,
    projectReference: value.projectReference ?? null,
    projectName: value.projectName ?? null,
    title: value.title ?? null,
    dataProductType: value.dataProductType ?? null,
    publicationVersion: value.publicationVersion ?? null,
    contentHash: value.contentHash ?? null,
    selectedFields: value.selectedFields ?? null,
    detailsRef: value.detailsRef ?? null,
    validFrom: value.validFrom ?? null,
    validUntil: value.validUntil ?? null,
    accessPolicy: value.accessPolicy ?? null,
    usagePolicy: value.usagePolicy ?? value.policy ?? null,
    contentSnapshot: value.contentSnapshot ?? null,
  };
}

function dataOfferContentMatches(
  stored: Record<string, unknown> | null | undefined,
  incoming: Record<string, unknown>,
): boolean {
  if (!stored) return false;
  return isDeepStrictEqual(
    protectedDataOfferContent(stored),
    protectedDataOfferContent(incoming),
  );
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
    const mayUpgradeLegacySnapshot =
      Boolean(payload.policySnapshot) &&
      isLegacyInvitationPolicySnapshot(invitation.policySnapshot);
    if (
      payload.policySnapshot &&
      !mayUpgradeLegacySnapshot &&
      !isDeepStrictEqual(invitation.policySnapshot, payload.policySnapshot)
    ) {
      throw new AnProjectInvitationError(
        "INVITATION_POLICY_SNAPSHOT_CONFLICT",
        "Die Policy der eingegangenen Einladung weicht vom unveränderlichen Policy-Snapshot ab.",
      );
    }
    const mayUpgradeLegacyDataOffer =
      Boolean(payload.dataOffer) && invitation.dataOfferSnapshot === null;
    const incomingDataOfferLifecycleStatus = payload.dataOffer
      ? requireDataOfferLifecycleStatus(payload.dataOffer.status ?? "PUBLISHED")
      : null;
    if (
      payload.dataOffer &&
      !mayUpgradeLegacyDataOffer &&
      !dataOfferContentMatches(
        invitation.dataOfferSnapshot,
        payload.dataOffer as unknown as Record<string, unknown>,
      )
    ) {
      throw new AnProjectInvitationError(
        "DATA_OFFER_SNAPSHOT_CONFLICT",
        "Das Datenangebot weicht vom unveränderlichen Datenangebots-Snapshot ab.",
      );
    }
    const updates: Partial<typeof anProjectInvitationsTable.$inferInsert> = {
      ...(payload.senderOrganizationName !== undefined
        ? { senderAgOrgName: payload.senderOrganizationName }
        : {}),
      ...(mayUpgradeLegacySnapshot ? { policySnapshot: payload.policySnapshot } : {}),
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
    if (payload.dataOffer && mayUpgradeLegacyDataOffer) {
      Object.assign(updates, {
        dataPublicationTitle: payload.dataOffer.title,
        selectedFields: payload.dataOffer.selectedFields,
        dataOfferSnapshot: immutableDataOfferSnapshot(
          payload.dataOffer as unknown as Record<string, unknown>,
        ),
        dataOfferLifecycleStatus: incomingDataOfferLifecycleStatus,
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
      ? immutableDataOfferSnapshot(payload.dataOffer as unknown as Record<string, unknown>)
      : null,
    dataOfferLifecycleStatus: payload.dataOffer
      ? requireDataOfferLifecycleStatus(payload.dataOffer.status ?? "PUBLISHED")
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
  const incomingLifecycleStatus = requireDataOfferLifecycleStatus(payload.status);
  const invitationId = `data-offer:${payload.publicationId}:${payload.metadata.receiverOrgId}`;
  const [existing] = await anDb.select().from(anProjectInvitationsTable)
    .where(eq(anProjectInvitationsTable.dataPublicationId, payload.publicationId))
    .limit(1);
  if (existing) {
    if (
      existing.senderAgOrgId !== payload.metadata.senderOrgId ||
      existing.receiverAnOrgId !== payload.metadata.receiverOrgId ||
      existing.projectReference !== payload.projectReference ||
      existing.correlationId !== payload.metadata.correlationId
    ) {
      throw new AnProjectInvitationError("DATA_OFFER_CONFLICT", "Das Datenangebot stimmt nicht mit der vorhandenen Projektion überein.");
    }
    const mayUpgradeLegacyDataOffer = existing.dataOfferSnapshot === null;
    if (
      !mayUpgradeLegacyDataOffer
      && !dataOfferContentMatches(
        existing.dataOfferSnapshot,
        payload as unknown as Record<string, unknown>,
      )
    ) {
      throw new AnProjectInvitationError(
        "DATA_OFFER_SNAPSHOT_CONFLICT",
        "Das Datenangebot weicht vom unveränderlichen Datenangebots-Snapshot ab.",
      );
    }
    const existingLifecycleStatus = parseDataOfferLifecycleStatus(
      existing.dataOfferLifecycleStatus
        ?? (existing.dataOfferSnapshot as Record<string, unknown> | null)?.status,
    );
    if (existingLifecycleStatus === "UNKNOWN" && !mayUpgradeLegacyDataOffer) {
      throw new AnProjectInvitationError(
        "DATA_OFFER_LIFECYCLE_CONFLICT",
        "Der lokale Status des Datenangebots ist unbekannt und bleibt aus Sicherheitsgründen gesperrt.",
      );
    }
    const nextLifecycleStatus = mayUpgradeLegacyDataOffer
      ? incomingLifecycleStatus
      : nextDataOfferLifecycleStatus(
        existingLifecycleStatus as DataOfferLifecycleStatus,
        incomingLifecycleStatus,
      );
    const updates: Partial<typeof anProjectInvitationsTable.$inferInsert> = {
      dataOfferLifecycleStatus: nextLifecycleStatus,
      updatedAt: new Date(),
    };
    if (mayUpgradeLegacyDataOffer) {
      Object.assign(updates, {
        dataPublicationTitle: payload.title,
        selectedFields: payload.selectedFields,
        dataOfferSnapshot: immutableDataOfferSnapshot(
          payload as unknown as Record<string, unknown>,
        ),
        policySnapshot: payload.accessPolicy,
        invitationExpiresAt: payload.validUntil ? new Date(payload.validUntil) : null,
      });
    }
    if (!mayUpgradeLegacyDataOffer && existingLifecycleStatus === nextLifecycleStatus) {
      return existing;
    }
    const [updated] = await anDb.update(anProjectInvitationsTable).set(updates)
      .where(eq(anProjectInvitationsTable.id, existing.id)).returning();
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
    dataOfferSnapshot: immutableDataOfferSnapshot(payload as unknown as Record<string, unknown>),
    dataOfferLifecycleStatus: incomingLifecycleStatus,
    policySnapshot: payload.accessPolicy,
    status: "PENDING",
  }).returning();
  return created;
}

function nextDataOfferLifecycleStatus(
  current: DataOfferLifecycleStatus,
  incoming: DataOfferLifecycleStatus,
): DataOfferLifecycleStatus {
  if (current === incoming) return current;
  if (current === "PUBLISHED") return incoming;
  if (current === "SUSPENDED" && incoming === "WITHDRAWN") return incoming;
  throw new AnProjectInvitationError(
    "DATA_OFFER_LIFECYCLE_CONFLICT",
    `Der Datenangebotsstatus darf nicht von ${current} auf ${incoming} zurückgesetzt werden.`,
  );
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

  const saved = await anDb.transaction(async (tx) => {
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
    await enqueueHubMessageInTransaction(tx, {
      messageId,
      schemaVersion: "1.0",
      messageType: "PROJECT_INVITATION_RESPONSE",
      senderOrgId: input.anOrgId,
      recipientOrgId: invitation.senderAgOrgId,
      correlationId: invitation.correlationId,
      payload: payload as unknown as Record<string, unknown>,
      status: "PENDING",
    });
    return row;
  });
  return { invitation: saved, payload };
}