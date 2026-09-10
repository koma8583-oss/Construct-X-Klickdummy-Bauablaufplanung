/**
 * Data Publication Service (Task #112).
 *
 * Implements the simulated Dataspace publication flow:
 *   1. buildContentSnapshot() — constructs a whitelist-scoped JSONB payload.
 *   2. computeContentHash()   — deterministic SHA-256 of the sorted snapshot.
 *   3. publishDataPublication() — end-to-end publish: snapshot → hash → save
 *                                 → notify each AN recipient via transport.
 *
 * Design rules (Dataspace principles):
 *   - No automatic publication. AG explicitly triggers publish().
 *   - Content is NEVER the raw DB row — only whitelisted fields.
 *   - Notifications carry only metadata (no content).
 *   - AN pulls content after explicit policy acceptance.
 *   - Published versions are immutable.
 */
import crypto from "node:crypto";
import {
  db,
  type MessageOutbox,
  type MessageDeliveryAttempt,
} from "@workspace/db";
import {
  dataPublicationsTable,
  dataPublicationRecipientsTable,
  policyTemplatesTable,
  projectsTable,
  projectMembershipsTable,
  takteTable,
  taktDependenciesTable,
  organizationsTable,
} from "@workspace/db";
import { eq, and, inArray } from "drizzle-orm";
import { createDataspaceExchange } from "./dataspace/dataspace-exchange-factory";
import {
  deliverLocalDataOffer,
  deliverLocalProjectInvitation,
  isLocalDataspaceTransport,
} from "./dataspace/local-dataspace-delivery";
import type {
  ExternalDataOffer,
  ExternalPolicySnapshot,
  ExternalProjectInvitation,
} from "./dataspace/external-contracts";
import {
  getHubOutboxMessage,
  enqueueHubMessageInTransaction,
  listHubDeliveryAttempts,
  listHubOutboxByCorrelation,
  listHubOutboxMessages,
} from "./hub-transport-service";

export class PublicationNotFoundError extends Error {
  constructor(id: string) {
    super(`DataPublication not found: ${id}`);
    this.name = "PublicationNotFoundError";
  }
}
export class PublicationStatusError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "PublicationStatusError";
  }
}
export class PublicationRecipientError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "PublicationRecipientError";
  }
}

export class PublicationDeliveryError extends Error {
  constructor(
    public readonly code: string,
    msg: string,
  ) {
    super(msg);
    this.name = "PublicationDeliveryError";
  }
}

export const MAX_PUBLICATION_DELIVERY_ATTEMPTS = 5;

function toDataPublicationDelivery(
  row: MessageOutbox,
  attemptHistory: MessageDeliveryAttempt[],
) {
  return {
    messageId: row.messageId,
    messageType: row.messageType as "DATA_OFFER_PUBLISHED",
    status: row.status,
    attemptCount: row.attemptCount,
    lastAttemptAt: row.lastAttemptAt,
    failureReason: row.failureReason,
    createdAt: row.createdAt,
    attemptHistory: attemptHistory.map((attempt) => ({
      attemptNumber: attempt.attemptNumber,
      status: attempt.status,
      attemptedAt: attempt.attemptedAt,
      failureReason: attempt.failureReason,
    })),
  };
}

export async function getDataPublicationDeliveries(
  publicationId: string,
  recipientOrgIds: string[],
) {
  const messageIds = recipientOrgIds.map(
    (anOrgId) => `dataspace-offer-${publicationId}-${anOrgId}`,
  );
  if (messageIds.length === 0) return new Map<string, ReturnType<typeof toDataPublicationDelivery>>();

  const outboxRows = await listHubOutboxMessages(messageIds);
  const attempts = await listHubDeliveryAttempts(messageIds);
  const attemptsByMessageId = new Map<string, MessageDeliveryAttempt[]>();
  for (const attempt of attempts) {
    const existing = attemptsByMessageId.get(attempt.messageId) ?? [];
    existing.push(attempt);
    attemptsByMessageId.set(attempt.messageId, existing);
  }

  return new Map(
    outboxRows.map((row) => [
      row.recipientOrgId,
      toDataPublicationDelivery(row, attemptsByMessageId.get(row.messageId) ?? []),
    ]),
  );
}

async function reconcileLinkedProjectInvitation(
  publicationId: string,
  anOrgId: string,
  agOrgId: string,
  projectMembershipId: string,
): Promise<void> {
  const [membership] = await db
    .select({
      invitationId: projectMembershipsTable.invitationId,
    })
    .from(projectMembershipsTable)
    .where(and(
      eq(projectMembershipsTable.id, projectMembershipId),
      eq(projectMembershipsTable.dataPublicationId, publicationId),
      eq(projectMembershipsTable.anOrgId, anOrgId),
    ))
    .limit(1);
  if (!membership) {
    throw new PublicationDeliveryError(
      "PROJECT_INVITATION_DELIVERY_NOT_FOUND",
      "Die gekoppelte Projekteinladung wurde nicht gefunden.",
    );
  }

  const messageId = `project-invitation-${membership.invitationId}`;
  const invitationOutbox = await getHubOutboxMessage(messageId, {
    senderOrgId: agOrgId,
    recipientOrgId: anOrgId,
    messageType: "PROJECT_INVITATION",
  });
  if (!invitationOutbox) {
    throw new PublicationDeliveryError(
      "PROJECT_INVITATION_DELIVERY_NOT_FOUND",
      "Für den adressierten AN wurde keine Projekteinladung zugestellt.",
    );
  }

  const payload = invitationOutbox.payload as unknown as ExternalProjectInvitation;
  const exchange = createDataspaceExchange();
  let delivery = await deliverLocalProjectInvitation(payload, exchange);
  const currentInvitationOutbox = await getHubOutboxMessage(messageId);
  if (
    delivery.status === "PENDING" ||
    delivery.status === "FAILED" ||
    currentInvitationOutbox?.status !== "DELIVERED"
  ) {
    delivery = await exchange.retryProjectInvitation(messageId);
    if (delivery.status === "DELIVERED") {
      await deliverLocalProjectInvitation(payload, exchange);
    }
  }
  if (delivery.status !== "DELIVERED") {
    throw new PublicationDeliveryError(
      "PROJECT_INVITATION_DELIVERY_FAILED",
      delivery.error?.message ?? "Die gekoppelte Projekteinladung konnte nicht zugestellt werden.",
    );
  }
}

export async function retryDataPublicationDelivery(
  publicationId: string,
  anOrgId: string,
  agOrgId: string,
) {
  const [publication] = await db
    .select({
      id: dataPublicationsTable.id,
      agOrgId: dataPublicationsTable.agOrgId,
      status: dataPublicationsTable.status,
    })
    .from(dataPublicationsTable)
    .where(and(
      eq(dataPublicationsTable.id, publicationId),
      eq(dataPublicationsTable.agOrgId, agOrgId),
    ))
    .limit(1);
  if (!publication) {
    throw new PublicationNotFoundError(publicationId);
  }
  if (!["PUBLISHED", "SUSPENDED", "WITHDRAWN"].includes(publication.status)) {
    throw new PublicationDeliveryError(
      "PUBLICATION_DELIVERY_NOT_ACTIVE",
      `Die Datenbereitstellung kann nicht zugestellt werden (Status: ${publication.status}).`,
    );
  }

  const [recipient] = await db
    .select({
      id: dataPublicationRecipientsTable.id,
      projectMembershipId: dataPublicationRecipientsTable.projectMembershipId,
    })
    .from(dataPublicationRecipientsTable)
    .where(and(
      eq(dataPublicationRecipientsTable.publicationId, publicationId),
      eq(dataPublicationRecipientsTable.anOrgId, anOrgId),
    ))
    .limit(1);
  if (!recipient) {
    throw new PublicationDeliveryError(
      "PUBLICATION_RECIPIENT_NOT_FOUND",
      "Der adressierte Empfänger wurde nicht gefunden.",
    );
  }

  const lifecycleMessageId = publication.status === "PUBLISHED"
    ? `dataspace-offer-${publicationId}-${anOrgId}`
    : `dataspace-offer-${publicationId}-${anOrgId}-${publication.status.toLowerCase()}`;
  const messageIds = publication.status === "PUBLISHED"
    ? [lifecycleMessageId]
    : [lifecycleMessageId, `dataspace-offer-${publicationId}-${anOrgId}`];
  let messageId = messageIds[0];
  let outbox = await getHubOutboxMessage(messageId, {
    senderOrgId: agOrgId,
    recipientOrgId: anOrgId,
    messageType: "DATA_OFFER_PUBLISHED",
  });
  if (!outbox && messageIds.length > 1) {
    messageId = messageIds[1];
    outbox = await getHubOutboxMessage(messageId, {
      senderOrgId: agOrgId,
      recipientOrgId: anOrgId,
      messageType: "DATA_OFFER_PUBLISHED",
    });
  }
  if (!outbox) {
    throw new PublicationDeliveryError(
      "PUBLICATION_DELIVERY_NOT_FOUND",
      "Für diesen Empfänger wurde keine Datenangebot-Zustellung gefunden.",
    );
  }
  const [linkedMembership] = recipient.projectMembershipId
    ? await db
      .select({ invitationId: projectMembershipsTable.invitationId })
      .from(projectMembershipsTable)
      .where(and(
        eq(projectMembershipsTable.id, recipient.projectMembershipId),
        eq(projectMembershipsTable.dataPublicationId, publicationId),
        eq(projectMembershipsTable.anOrgId, anOrgId),
      ))
      .limit(1)
    : [];
  const linkedInvitationOutbox = linkedMembership
    ? await getHubOutboxMessage(
      `project-invitation-${linkedMembership.invitationId}`,
      {
        senderOrgId: agOrgId,
        recipientOrgId: anOrgId,
        messageType: "PROJECT_INVITATION",
      },
    )
    : null;
  const invitationNeedsRecovery = Boolean(
    linkedInvitationOutbox &&
    ["PENDING", "FAILED"].includes(linkedInvitationOutbox.status),
  );
  const canRecoverInvitationAfterOfferDelivery =
    outbox.status === "DELIVERED" && invitationNeedsRecovery;

  if (outbox.status !== "FAILED" && !canRecoverInvitationAfterOfferDelivery) {
    throw new PublicationDeliveryError(
      outbox.status === "SENT"
        ? "PUBLICATION_DELIVERY_RETRY_RACE"
        : "PUBLICATION_DELIVERY_NOT_RETRYABLE",
      outbox.status === "SENT"
        ? "Die Zustellung wird bereits von einem anderen Vorgang wiederholt."
        : `Die Zustellung kann nicht wiederholt werden (Status: ${outbox.status}).`,
    );
  }
  if (outbox.attemptCount >= MAX_PUBLICATION_DELIVERY_ATTEMPTS) {
    throw new PublicationDeliveryError(
      "PUBLICATION_DELIVERY_RETRY_EXHAUSTED",
      "Die Zustellung wurde nach fünf Versuchen aufgegeben. Bitte prüfen Sie den Dataspace-Connector.",
    );
  }

  const exchange = createDataspaceExchange();
  let result;
  if (outbox.status === "FAILED") {
    try {
      result = await exchange.retryDataOffer(messageId);
    } catch (error) {
      if (
        error instanceof Error &&
        /cannot be retried — current status is (?:SENT|DELIVERED)/.test(error.message)
      ) {
        throw new PublicationDeliveryError(
          "PUBLICATION_DELIVERY_RETRY_RACE",
          "Die Zustellung wird bereits von einem anderen Vorgang wiederholt.",
        );
      }
      throw error;
    }
  } else {
    result = {
      exchangeId: outbox.messageId,
      externalReference: outbox.messageId,
      status: outbox.status,
      sentAt: outbox.sentAt,
      deliveredAt: outbox.deliveredAt,
      attemptCount: outbox.attemptCount,
    };
  }

  if (result.status === "DELIVERED") {
    if (isLocalDataspaceTransport()) {
      const persisted = await getHubOutboxMessage(messageId, {
        senderOrgId: agOrgId,
        recipientOrgId: anOrgId,
        messageType: "DATA_OFFER_PUBLISHED",
      });
      if (persisted?.payload) {
        await deliverLocalDataOffer(
          persisted.payload as unknown as ExternalDataOffer,
          exchange,
        );
      }
    }
    await db
      .update(dataPublicationRecipientsTable)
      .set({ notifiedAt: new Date() })
      .where(eq(dataPublicationRecipientsTable.id, recipient.id));
    if (recipient.projectMembershipId) {
      if (
        linkedInvitationOutbox &&
        linkedInvitationOutbox.status === "FAILED" &&
        linkedInvitationOutbox.attemptCount >= MAX_PUBLICATION_DELIVERY_ATTEMPTS
      ) {
        throw new PublicationDeliveryError(
          "PROJECT_INVITATION_RETRY_EXHAUSTED",
          "Die gekoppelte Projekteinladung wurde nach fünf Versuchen aufgegeben.",
        );
      }
      await reconcileLinkedProjectInvitation(
        publicationId,
        anOrgId,
        agOrgId,
        recipient.projectMembershipId,
      );
    }
  }
  return result;
}

// ── Whitelists ────────────────────────────────────────────────────────────────

export const FIELD_WHITELISTS: Record<string, readonly string[]> = {
  PROJECT_OVERVIEW: [
    // Core project identity
    "projectReference",
    "projectName",
    "projectStatus",
    "startDate",
    "endDate",
    "projectLocation",
    "projectDescription",
    // Summary coordination fields
    "milestones",
    "documentReferences",
  ],

  PROJECT_COORDINATION_PACKAGE: [
    // Core project identity
    "projectReference",
    "projectName",
    "projectStatus",
    "startDate",
    "endDate",
    "projectLocation",
    "projectDescription",
    // Coordination-specific
    "milestones",
    "logisticsConstraints",
    "coordinationConstraints",
    "interfaceDescriptions",
    "relevantTimeWindows",
    "documentReferences",
  ],

  PROJECT_MEMBERSHIP: [
    "projectReference",
    "projectName",
    "projectStatus",
    "projectLocation",
  ],

  TAKT_INFORMATION_PACKAGE: [
    // Projektdaten
    "projectReference",
    "projectName",
    "projectStatus",
    "startDate",
    "endDate",
    "projectLocation",
    "projectDescription",
    // Leistungsdaten
    "kurzbezeichnung",
    "workPackage",
    "trade",
    // Zeitplanung
    "plannedTimeWindow",
    "bufferTimeWindow",
    // Ausführung
    "location",
    "executionNotes",
    // Anordnungsbeziehungen
    "predecessors",
    "successors",
    // Ressourcen & Logistik
    "resourceRequirements",
  ],
} as const;

// Internal-only fields that must NEVER appear in any snapshot
const INTERNAL_ONLY_FIELDS = new Set([
  "internalNote",
  "costEstimate",
  "procurementPriority",
  "riskClassification",
  "internalBudget",
  "lvReference",
]);

// ── Snapshot builder ──────────────────────────────────────────────────────────

/**
 * Builds an immutable content snapshot from a whitelist.
 *
 * Rules:
 *   - Only fields in selectedFields AND in the product-type whitelist are included.
 *   - Internal-only fields are always excluded (double-checked here even if whitelisted).
 *   - No raw DB objects are serialised — each field is mapped explicitly.
 */
export async function buildContentSnapshot(
  dataProductType: keyof typeof FIELD_WHITELISTS,
  projectId: string,
  selectedFields: string[],
  selectedTaktIds?: string[] | null,
): Promise<Record<string, unknown>> {
  // Validate that every selectedField is in the whitelist and not internal-only
  const allowedFields = new Set(FIELD_WHITELISTS[dataProductType]);
  const safeFields = selectedFields.filter(
    (f) => allowedFields.has(f as never) && !INTERNAL_ONLY_FIELDS.has(f),
  );

  // Fetch the project row
  const [project] = await db
    .select()
    .from(projectsTable)
    .where(eq(projectsTable.id, projectId))
    .limit(1);

  if (!project) throw new Error(`Project ${projectId} not found`);

  const include = new Set(safeFields);

  if (dataProductType === "TAKT_INFORMATION_PACKAGE") {
    return buildTaktSnapshot(project, include, selectedTaktIds ?? []);
  }
  // Project-level products do not include individual Takte.
  return buildProjectSnapshot(project, include);
}

function buildProjectSnapshot(
  project: {
    id: string;
    name: string;
    description: string | null;
    location: string | null;
    status: string;
    startDate: string | null;
    endDate: string | null;
  },
  include: Set<string>,
): Record<string, unknown> {
  const snap: Record<string, unknown> = {};
  if (include.has("projectReference")) snap.projectReference = project.id;
  if (include.has("projectName")) snap.projectName = project.name;
  if (include.has("projectStatus")) snap.projectStatus = project.status;
  if (include.has("startDate")) snap.startDate = project.startDate ?? null;
  if (include.has("endDate")) snap.endDate = project.endDate ?? null;
  if (include.has("projectLocation")) snap.projectLocation = project.location ?? null;
  if (include.has("projectDescription")) snap.projectDescription = project.description ?? null;
  if (include.has("milestones")) snap.milestones = [];
  if (include.has("logisticsConstraints")) snap.logisticsConstraints = null;
  if (include.has("coordinationConstraints")) snap.coordinationConstraints = null;
  if (include.has("interfaceDescriptions")) snap.interfaceDescriptions = null;
  if (include.has("relevantTimeWindows")) snap.relevantTimeWindows = null;
  if (include.has("documentReferences")) snap.documentReferences = [];
  return snap;
}

async function buildTaktSnapshot(
  project: {
    id: string;
    name: string;
    description: string | null;
    location: string | null;
    status: string;
    startDate: string | null;
    endDate: string | null;
  },
  include: Set<string>,
  taktIds: string[],
): Promise<Record<string, unknown>> {
  // Project-level fields always populate the top-level snapshot object
  const snap: Record<string, unknown> = {};
  if (include.has("projectReference")) snap.projectReference = project.id;
  if (include.has("projectName")) snap.projectName = project.name;
  if (include.has("projectStatus")) snap.projectStatus = project.status;
  if (include.has("startDate")) snap.startDate = project.startDate ?? null;
  if (include.has("endDate")) snap.endDate = project.endDate ?? null;
  if (include.has("projectLocation")) snap.projectLocation = project.location ?? null;
  if (include.has("projectDescription")) snap.projectDescription = project.description ?? null;

  if (taktIds.length === 0) {
    return { ...snap, leistungen: [] };
  }

  const taktRows = await db
    .select()
    .from(takteTable)
    .where(
      and(
        inArray(takteTable.id, taktIds as [string, ...string[]]),
        eq(takteTable.projectId, project.id),
      ),
    );
  const releasedIds = new Set(taktRows.map((t) => t.id));

  // Fetch predecessors/successors for included takte if needed.
  // We need both directions:
  //   - rows where predecessorId ∈ taktIds → the takt IS a predecessor (populates successors list)
  //   - rows where successorId   ∈ taktIds → the takt HAS a predecessor (populates predecessors list)
  let depMap: Map<string, { predecessors: string[]; successors: string[] }> =
    new Map();
  if (include.has("predecessors") || include.has("successors")) {
    const [forwardDeps, backwardDeps] = await Promise.all([
      // forward: takt → its successors
      db
        .select()
        .from(taktDependenciesTable)
        .where(
          and(
            eq(taktDependenciesTable.projectId, project.id),
            inArray(taktDependenciesTable.predecessorId, taktIds as [string, ...string[]]),
          ),
        ),
      // backward: takt → its predecessors
      db
        .select()
        .from(taktDependenciesTable)
        .where(
          and(
            eq(taktDependenciesTable.projectId, project.id),
            inArray(taktDependenciesTable.successorId, taktIds as [string, ...string[]]),
          ),
        ),
    ]);

    for (const dep of forwardDeps) {
      if (!releasedIds.has(dep.predecessorId) || !releasedIds.has(dep.successorId)) continue;
      const entry = depMap.get(dep.predecessorId) ?? {
        predecessors: [],
        successors: [],
      };
      entry.successors.push(dep.successorId);
      depMap.set(dep.predecessorId, entry);
    }
    for (const dep of backwardDeps) {
      if (!releasedIds.has(dep.predecessorId) || !releasedIds.has(dep.successorId)) continue;
      const entry = depMap.get(dep.successorId) ?? {
        predecessors: [],
        successors: [],
      };
      entry.predecessors.push(dep.predecessorId);
      depMap.set(dep.successorId, entry);
    }
  }

  const takte = taktRows.map((t) => {
    const obj: Record<string, unknown> = {};
    const leistungReference = t.id;
    obj.leistungReference = leistungReference;
    if (include.has("location")) obj.location = t.zone;
    if (include.has("kurzbezeichnung")) obj.kurzbezeichnung = t.kurzbezeichnung;
    if (include.has("trade")) obj.trade = t.gewerk;
    if (include.has("workPackage")) obj.workPackage = t.taktBezeichnung;
    if (include.has("plannedTimeWindow"))
      obj.plannedTimeWindow = {
        start: t.plannedStart,
        end: t.plannedEnd,
      };
    if (include.has("bufferTimeWindow"))
      obj.bufferTimeWindow = {
        earliestStart: t.earliestStart ?? null,
        latestEnd: t.latestEnd ?? null,
      };
    if (include.has("predecessors"))
       obj.predecessors = (depMap.get(t.id)?.predecessors ?? []).filter((id) => releasedIds.has(id));
    if (include.has("successors"))
       obj.successors = (depMap.get(t.id)?.successors ?? []).filter((id) => releasedIds.has(id));
    if (include.has("resourceRequirements"))
      obj.resourceRequirements = t.requiredResources ?? null;
    if (include.has("executionNotes")) obj.executionNotes = (t as any).description ?? null;
    return obj;
  });

  return { ...snap, leistungen: takte };
}

// ── Content hash ──────────────────────────────────────────────────────────────

/**
 * Deterministic SHA-256 hex digest of a content snapshot.
 * Uses the same stableStringify as LocalHubTransport for consistency.
 */
export function computeContentHash(snapshot: Record<string, unknown>): string {
  const canonical = stableStringify(snapshot);
  return crypto.createHash("sha256").update(canonical, "utf8").digest("hex");
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value))
    return `[${(value as unknown[]).map(stableStringify).join(",")}]`;
  const sorted = Object.keys(value as Record<string, unknown>)
    .sort()
    .map(
      (k) =>
        `${JSON.stringify(k)}:${stableStringify(
          (value as Record<string, unknown>)[k],
        )}`,
    )
    .join(",");
  return `{${sorted}}`;
}

// ── Publish ───────────────────────────────────────────────────────────────────

function createPublicationDataOffer(input: {
  publication: typeof dataPublicationsTable.$inferSelect;
  policy: typeof policyTemplatesTable.$inferSelect;
  recipientOrgId: string;
  projectName: string;
  senderOrgId: string;
  createdAt: Date;
  status?: "PUBLISHED" | "SUSPENDED" | "WITHDRAWN";
  contentHash?: string;
  contentSnapshot?: Record<string, unknown>;
}): ExternalDataOffer {
  const { publication, policy, recipientOrgId, projectName, senderOrgId, createdAt } = input;
  const lifecycleSuffix = input.status && input.status !== "PUBLISHED"
    ? `-${input.status.toLowerCase()}`
    : "";
  const accessPolicy: ExternalPolicySnapshot = {
    policyId: `publication-access:${publication.id}`,
    templateId: policy.id,
    templateVersion: 1,
    code: policy.code,
    name: policy.name,
    description: policy.description ?? policy.purpose,
    permissions: policy.permissions,
    prohibitions: policy.prohibitions,
    provider: { organizationId: senderOrgId, userId: null },
    recipientOrganizationId: recipientOrgId,
    purpose: "DATA_PUBLICATION_ACCESS",
    projectReference: publication.projectId,
    workPackageReference: null,
    validFrom: (publication.validFrom ?? createdAt).toISOString(),
    validUntil: publication.validUntil?.toISOString() ?? null,
    createdAt: createdAt.toISOString(),
  };
  return {
    metadata: {
      messageId: `dataspace-offer-${publication.id}-${recipientOrgId}${lifecycleSuffix}`,
      correlationId: `data-offer:${publication.id}:${recipientOrgId}`,
      schemaVersion: "1.0",
      senderOrgId,
      receiverOrgId: recipientOrgId,
      createdAt: createdAt.toISOString(),
    },
    publicationId: publication.id,
    projectReference: publication.projectId,
    projectName,
    title: publication.title,
    dataProductType: publication.dataProductType,
    publicationVersion: publication.version,
    status: input.status ?? "PUBLISHED",
    ...((input.contentHash ?? publication.contentHash)
      ? { contentHash: input.contentHash ?? publication.contentHash! }
      : {}),
    selectedFields: (publication.selectedFields as string[]) ?? [],
    detailsRef: `/api/an/data-offers/${publication.id}`,
    validFrom: (publication.validFrom ?? createdAt).toISOString(),
    ...(publication.validUntil ? { validUntil: publication.validUntil.toISOString() } : {}),
    accessPolicy,
    usagePolicy: {
      id: `publication-usage:${publication.id}`,
      templateId: policy.id,
      templateVersion: 1,
      code: policy.code,
      name: policy.name,
      purpose: policy.purpose,
      permissions: policy.permissions,
      prohibitions: policy.prohibitions,
      validityRule: policy.validityRule,
      retentionRule: policy.retentionRule,
    },
    ...(input.contentSnapshot ? { contentSnapshot: input.contentSnapshot } : {}),
  };
}

/**
 * Publish a DRAFT DataPublication.
 *
 * Steps (per Dataspace spec):
 *   1. Load publication + validate DRAFT status + validate recipients exist.
 *   2. Build content snapshot via whitelist.
 *   3. Compute deterministic SHA-256 hash.
 *   4. Atomically: save snapshot/hash, set status=PUBLISHED, set publishedAt.
 *   5. For each recipient: set notifiedAt, send DATA_OFFER_PUBLISHED notification.
 *
 * Notifications carry NO content — only metadata references.
 */
export async function publishDataPublication(
  publicationId: string,
  publishedByUserId: string,
  agOrgId: string,
): Promise<void> {
  // 1. Load publication
  const [pub] = await db
    .select()
    .from(dataPublicationsTable)
    .where(eq(dataPublicationsTable.id, publicationId))
    .limit(1);

  if (!pub) throw new PublicationNotFoundError(publicationId);
  if (pub.agOrgId !== agOrgId)
    throw new PublicationNotFoundError(publicationId); // hide existence
  if (pub.status !== "DRAFT")
    throw new PublicationStatusError(
      `Cannot publish a publication with status "${pub.status}". Only DRAFT may be published.`,
    );

  // Load recipients
  const recipients = await db
    .select()
    .from(dataPublicationRecipientsTable)
    .where(eq(dataPublicationRecipientsTable.publicationId, publicationId));

  if (recipients.length === 0)
    throw new PublicationRecipientError(
      "Cannot publish: at least one recipient is required.",
    );

  // Load policy template
  const [policy] = await db
    .select()
    .from(policyTemplatesTable)
    .where(eq(policyTemplatesTable.id, pub.policyTemplateId))
    .limit(1);
  if (!policy) throw new Error("Policy template not found");
  const [project] = await db
    .select({ name: projectsTable.name })
    .from(projectsTable)
    .where(eq(projectsTable.id, pub.projectId))
    .limit(1);
  if (!project) throw new Error("Publication project not found");

  // 2. Build content snapshot
  const snapshot = await buildContentSnapshot(
    pub.dataProductType as keyof typeof FIELD_WHITELISTS,
    pub.projectId,
    (pub.selectedFields as string[]) ?? [],
    (pub.selectedTaktIds as string[] | null) ?? undefined,
  );

  // 3. Hash
  const contentHash = computeContentHash(snapshot);

  // 4. Persist snapshot + transition to PUBLISHED and pre-create every
  // transport envelope in the same PostgreSQL transaction. Delivery itself is
  // intentionally post-commit; a worker/retry can drain the durable PENDING
  // rows after a process crash.
  const now = new Date();
  const notifications = await db.transaction(async (tx) => {
    await tx
      .update(dataPublicationsTable)
      .set({
        contentSnapshot: snapshot,
        contentHash,
        status: "PUBLISHED",
        publishedAt: now,
        validFrom: pub.validFrom ?? now,
        publishedByUserId,
      })
      .where(eq(dataPublicationsTable.id, publicationId));

    const prepared: Array<{
      recipientId: string;
      payload: ExternalDataOffer;
    }> = [];
    for (const recipient of recipients) {
      const payload = createPublicationDataOffer({
        publication: pub,
        policy,
        recipientOrgId: recipient.anOrgId,
        projectName: project.name,
        senderOrgId: agOrgId,
        createdAt: now,
        contentHash,
        contentSnapshot: snapshot,
      });
      await enqueueHubMessageInTransaction(tx, {
        messageId: payload.metadata.messageId,
        schemaVersion: payload.metadata.schemaVersion,
        messageType: "DATA_OFFER_PUBLISHED",
        senderOrgId: payload.metadata.senderOrgId,
        recipientOrgId: payload.metadata.receiverOrgId,
        correlationId: payload.metadata.correlationId,
        payload: payload as unknown as Record<string, unknown>,
        status: "PENDING",
      });
      prepared.push({ recipientId: recipient.id, payload });
    }
    return prepared;
  });

  // 5. Dispatch only after the domain transaction commits.
  for (const { recipientId, payload } of notifications) {
    try {
      const exchange = createDataspaceExchange();
      const delivery = await deliverLocalDataOffer(
        payload,
        exchange,
        isLocalDataspaceTransport() ? snapshot : undefined,
      );

      if (delivery.status === "DELIVERED") {
        await db
          .update(dataPublicationRecipientsTable)
          .set({ notifiedAt: now })
          .where(eq(dataPublicationRecipientsTable.id, recipientId));
      }
    } catch (error) {
      console.warn("[dataspace] data-offer delivery failed", {
        publicationId,
        recipientOrgId: payload.metadata.receiverOrgId,
        error: error instanceof Error ? error.message : String(error),
      });
      // Best-effort — delivery failure must not abort the publish
    }
  }
}

/**
 * Propagate a publication lifecycle change through the same Dataspace inbound
 * path that created the AN-local offer. The AN route therefore never needs to
 * consult AG publication tables to learn that an offer was suspended or
 * withdrawn.
 */
export async function syncDataPublicationProjection(
  publicationId: string,
  agOrgId: string,
  status: "PUBLISHED" | "SUSPENDED" | "WITHDRAWN",
): Promise<void> {
  if (!isLocalDataspaceTransport()) return;

  const [pub] = await db.select().from(dataPublicationsTable).where(and(
    eq(dataPublicationsTable.id, publicationId),
    eq(dataPublicationsTable.agOrgId, agOrgId),
  )).limit(1);
  if (!pub) return;
  const [policy] = await db.select().from(policyTemplatesTable)
    .where(eq(policyTemplatesTable.id, pub.policyTemplateId)).limit(1);
  const [project] = await db.select({
    name: projectsTable.name,
  }).from(projectsTable).where(eq(projectsTable.id, pub.projectId)).limit(1);
  if (!policy || !project) return;

  const recipients = await db.select().from(dataPublicationRecipientsTable)
    .where(eq(dataPublicationRecipientsTable.publicationId, publicationId));
  for (const recipient of recipients) {
    const now = new Date();
    const payload = createPublicationDataOffer({
      publication: pub,
      policy,
      recipientOrgId: recipient.anOrgId,
      projectName: project.name,
      senderOrgId: agOrgId,
      // Lifecycle envelopes must reproduce the original immutable offer
      // content. The transport timestamp may change, but policy snapshot
      // timestamps must remain those of the published offer.
      createdAt: pub.publishedAt ?? pub.createdAt,
      status,
      contentHash: pub.contentHash ?? undefined,
      contentSnapshot: pub.contentSnapshot ?? undefined,
    });
    try {
      const exchange = createDataspaceExchange();
      const delivery = await deliverLocalDataOffer(payload, exchange);
      if (delivery.status === "PENDING" || delivery.status === "FAILED") {
        const retry = await exchange.retryDataOffer(payload.metadata.messageId);
        if (retry.status === "DELIVERED") {
          await deliverLocalDataOffer(payload, exchange);
        }
      }
    } catch (error) {
      // The publication state is already committed. Do not hide a failed
      // lifecycle projection: the local delivery marks its outbox row FAILED,
      // and the recipient retry endpoint can replay the persisted envelope.
      console.warn("[dataspace] publication lifecycle delivery failed", {
        publicationId,
        recipientOrgId: recipient.anOrgId,
        status,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}

/**
 * Send notifications for a publication that was already prepared and
 * committed by the combined invitation transaction. The snapshot and status
 * are deliberately not written here.
 */
export async function publishCombinedDataPublicationNotifications(
  publicationId: string,
  agOrgId: string,
  now = new Date(),
): Promise<void> {
  const [pub] = await db.select().from(dataPublicationsTable).where(
    and(eq(dataPublicationsTable.id, publicationId), eq(dataPublicationsTable.agOrgId, agOrgId)),
  ).limit(1);
  if (!pub || pub.status !== "PUBLISHED") {
    throw new PublicationStatusError("Combined data publication is not active.");
  }
  const outboxRows = await listHubOutboxByCorrelation(
    publicationId,
    "DATA_OFFER_PUBLISHED",
  );
  for (const outbox of outboxRows) {
    if (!["PENDING", "FAILED"].includes(outbox.status)) continue;
    try {
      const result = await createDataspaceExchange().retryDataOffer(outbox.messageId);
      if (result.status !== "DELIVERED") continue;
      await db.update(dataPublicationRecipientsTable).set({ notifiedAt: now }).where(
        and(
          eq(dataPublicationRecipientsTable.publicationId, publicationId),
          eq(dataPublicationRecipientsTable.anOrgId, outbox.recipientOrgId),
        ),
      );
    } catch {
      // The pre-created outbox row remains retryable after a crash or connector failure.
    }
  }
}
