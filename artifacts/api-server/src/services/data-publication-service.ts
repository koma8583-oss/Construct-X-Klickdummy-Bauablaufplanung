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
import { db, messageOutboxTable } from "@workspace/db";
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
import { LocalHubTransport } from "../lib/transport/local-hub-transport";
import { createDataspaceExchange } from "./dataspace/dataspace-exchange-factory";
import {
  deliverLocalProjectInvitation,
  isLocalDataspaceTransport,
} from "./dataspace/local-dataspace-delivery";
import type { ExternalProjectInvitation } from "./dataspace/external-contracts";

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
  // PROJECT_OVERVIEW and PROJECT_COORDINATION_PACKAGE are project-level only
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
    return { ...snap, takte: [] };
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
          inArray(
            taktDependenciesTable.predecessorId,
            taktIds as [string, ...string[]],
          ),
        ),
      // backward: takt → its predecessors
      db
        .select()
        .from(taktDependenciesTable)
        .where(
          inArray(
            taktDependenciesTable.successorId,
            taktIds as [string, ...string[]],
          ),
        ),
    ]);

    for (const dep of forwardDeps) {
      const entry = depMap.get(dep.predecessorId) ?? {
        predecessors: [],
        successors: [],
      };
      entry.successors.push(dep.successorId);
      depMap.set(dep.predecessorId, entry);
    }
    for (const dep of backwardDeps) {
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
      obj.predecessors = depMap.get(t.id)?.predecessors ?? [];
    if (include.has("successors"))
      obj.successors = depMap.get(t.id)?.successors ?? [];
    if (include.has("resourceRequirements"))
      obj.resourceRequirements = t.requiredResources ?? null;
    if (include.has("executionNotes")) obj.executionNotes = (t as any).description ?? null;
    return obj;
  });

  return { ...snap, takte };
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

const transport = new LocalHubTransport();

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

  // 2. Build content snapshot
  const snapshot = await buildContentSnapshot(
    pub.dataProductType as keyof typeof FIELD_WHITELISTS,
    pub.projectId,
    (pub.selectedFields as string[]) ?? [],
    (pub.selectedTaktIds as string[] | null) ?? undefined,
  );

  // 3. Hash
  const contentHash = computeContentHash(snapshot);

  // 4. Persist snapshot + transition to PUBLISHED
  const now = new Date();
  await db
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

  // 5. Notify each recipient
  for (const recipient of recipients) {
    // Notification payload — NO content, only references
    const notificationPayload = {
      publicationId,
      projectReference: pub.projectId,
      dataProductType: pub.dataProductType,
      publicationVersion: pub.version,
      policyCode: policy.code,
      validUntil: pub.validUntil?.toISOString() ?? null,
      detailsRef: `/api/an/data-offers/${publicationId}`,
      title: pub.title,
    };

    const messageId = `dataspace-offer-${publicationId}-${recipient.anOrgId}`;

    try {
      await transport.send({
        messageId,
        schemaVersion: "1.0",
        messageType: "DATA_OFFER_PUBLISHED",
        senderOrgId: agOrgId,
        recipientOrgId: recipient.anOrgId,
        correlationId: publicationId,
        createdAt: now,
        causationId: null,
        payload: notificationPayload,
      });

      await db
        .update(dataPublicationRecipientsTable)
        .set({ notifiedAt: now })
        .where(eq(dataPublicationRecipientsTable.id, recipient.id));

      // The AN offer view is backed exclusively by Dataspace-delivered local
      // projections. Standalone publications do not have the combined
      // invitation dispatcher, so the local transport needs the same inbound
      // package to create the AN-side offer and policy snapshot.
      console.error("publication delivery branch", {
        local: isLocalDataspaceTransport(),
        projectId: pub.projectId,
      });
      if (isLocalDataspaceTransport()) {
        const [project] = await db.select({
          id: projectsTable.id,
          name: projectsTable.name,
          description: projectsTable.description,
          location: projectsTable.location,
        }).from(projectsTable).where(eq(projectsTable.id, pub.projectId)).limit(1);
        const [membership] = await db.select({
          invitationId: projectMembershipsTable.invitationId,
          correlationId: projectMembershipsTable.correlationId,
          anParticipantId: projectMembershipsTable.anParticipantId,
        }).from(projectMembershipsTable).where(and(
          eq(projectMembershipsTable.projectId, pub.projectId),
          eq(projectMembershipsTable.agOrgId, agOrgId),
          eq(projectMembershipsTable.anOrgId, recipient.anOrgId),
          eq(projectMembershipsTable.status, "ACTIVE"),
        )).limit(1);
        console.error("publication delivery project", { found: Boolean(project) });
        if (project) {
          const policySnapshot = {
            policyId: `publication-policy:${publicationId}`,
            templateId: policy.id,
            templateVersion: 1,
            code: policy.code,
            name: policy.name,
            description: policy.description ?? policy.purpose,
            permissions: policy.permissions,
            prohibitions: policy.prohibitions,
            provider: { organizationId: agOrgId, userId: null },
            recipientOrganizationId: recipient.anOrgId,
            purpose: policy.purpose,
            projectReference: pub.projectId,
            workPackageReference: null,
            validFrom: (pub.validFrom ?? now).toISOString(),
            validUntil: pub.validUntil?.toISOString() ?? null,
            createdAt: now.toISOString(),
          };
          const invitationPayload: ExternalProjectInvitation = {
            metadata: {
              messageId: `data-offer-invitation-${publicationId}-${recipient.anOrgId}`,
              correlationId: `data-offer:${publicationId}:${recipient.anOrgId}`,
              schemaVersion: "1.0",
              senderOrgId: agOrgId,
              receiverOrgId: recipient.anOrgId,
              createdAt: now.toISOString(),
            },
            invitationId: `data-offer:${publicationId}:${recipient.anOrgId}`,
            project: {
              projectReference: project.id,
              projectName: project.name,
              ...(project.description ? { description: project.description } : {}),
              ...(project.location ? { location: project.location } : {}),
            },
            requestedRole: "CONTRACTOR",
            purpose: "PROJECT_COLLABORATION",
            policy: {
              usagePurpose: "PROJECT_MEMBERSHIP",
              allowedConsumerParticipantId: membership?.anParticipantId ?? `local:${recipient.anOrgId}`,
            },
            policySnapshot,
            dataOffer: {
              publicationId,
              title: pub.title,
              dataProductType: pub.dataProductType,
              publicationVersion: pub.version,
              status: "PUBLISHED",
              contentHash,
              contentSnapshot: snapshot,
              selectedFields: (pub.selectedFields as string[]) ?? [],
              validFrom: (pub.validFrom ?? now).toISOString(),
              ...(pub.validUntil ? { validUntil: pub.validUntil.toISOString() } : {}),
              policy: {
                id: policy.id,
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
            },
          };
          const exchange = createDataspaceExchange();
          const delivery = await deliverLocalProjectInvitation(invitationPayload, exchange);
          if (delivery.status === "PENDING" || delivery.status === "FAILED") {
            const retry = await exchange.retryProjectInvitation(invitationPayload.metadata.messageId);
            if (retry.status === "DELIVERED") {
              await deliverLocalProjectInvitation(invitationPayload, exchange);
            }
          }
        }
      }
    } catch (error) {
      console.error("data publication local delivery failed", error);
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
    id: projectsTable.id,
    name: projectsTable.name,
    description: projectsTable.description,
    location: projectsTable.location,
  }).from(projectsTable).where(eq(projectsTable.id, pub.projectId)).limit(1);
  if (!policy || !project) return;

  const recipients = await db.select().from(dataPublicationRecipientsTable)
    .where(eq(dataPublicationRecipientsTable.publicationId, publicationId));
  for (const recipient of recipients) {
    const [membership] = await db.select({
      anParticipantId: projectMembershipsTable.anParticipantId,
    }).from(projectMembershipsTable).where(and(
      eq(projectMembershipsTable.projectId, pub.projectId),
      eq(projectMembershipsTable.agOrgId, agOrgId),
      eq(projectMembershipsTable.anOrgId, recipient.anOrgId),
      eq(projectMembershipsTable.status, "ACTIVE"),
    )).limit(1);
    const now = new Date();
    const policySnapshot = {
      policyId: `publication-policy:${publicationId}`,
      templateId: policy.id,
      templateVersion: 1,
      code: policy.code,
      name: policy.name,
      description: policy.description ?? policy.purpose,
      permissions: policy.permissions,
      prohibitions: policy.prohibitions,
      provider: { organizationId: agOrgId, userId: null },
      recipientOrganizationId: recipient.anOrgId,
      purpose: policy.purpose,
      projectReference: pub.projectId,
      workPackageReference: null,
      validFrom: (pub.validFrom ?? now).toISOString(),
      validUntil: pub.validUntil?.toISOString() ?? null,
      createdAt: now.toISOString(),
    };
    const payload: ExternalProjectInvitation = {
      metadata: {
        messageId: `data-offer-status-${publicationId}-${recipient.anOrgId}-${status}`,
        correlationId: `data-offer:${publicationId}:${recipient.anOrgId}`,
        schemaVersion: "1.0",
        senderOrgId: agOrgId,
        receiverOrgId: recipient.anOrgId,
        createdAt: now.toISOString(),
      },
      invitationId: `data-offer:${publicationId}:${recipient.anOrgId}`,
      project: {
        projectReference: project.id,
        projectName: project.name,
        ...(project.description ? { description: project.description } : {}),
        ...(project.location ? { location: project.location } : {}),
      },
      requestedRole: "CONTRACTOR",
      purpose: "PROJECT_COLLABORATION",
      policy: {
        usagePurpose: "PROJECT_MEMBERSHIP",
        allowedConsumerParticipantId: membership?.anParticipantId ?? `local:${recipient.anOrgId}`,
      },
      policySnapshot,
      dataOffer: {
        publicationId,
        title: pub.title,
        dataProductType: pub.dataProductType,
        publicationVersion: pub.version,
        status,
        contentHash: pub.contentHash ?? undefined,
        contentSnapshot: pub.contentSnapshot ?? undefined,
        selectedFields: (pub.selectedFields as string[]) ?? [],
        validFrom: (pub.validFrom ?? now).toISOString(),
        ...(pub.validUntil ? { validUntil: pub.validUntil.toISOString() } : {}),
        policy: {
          id: policy.id,
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
      },
    };
    try {
      const exchange = createDataspaceExchange();
      const delivery = await deliverLocalProjectInvitation(payload, exchange);
      if (delivery.status === "PENDING" || delivery.status === "FAILED") {
        const retry = await exchange.retryProjectInvitation(payload.metadata.messageId);
        if (retry.status === "DELIVERED") {
          await deliverLocalProjectInvitation(payload, exchange);
        }
      }
    } catch {
      // The publication state is already committed; a later delivery retry can
      // reconcile the AN projection without rolling back the AG transition.
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
  const outboxRows = await db.select().from(messageOutboxTable).where(and(
    eq(messageOutboxTable.correlationId, publicationId),
    eq(messageOutboxTable.messageType, "DATA_OFFER_PUBLISHED"),
  ));
  for (const outbox of outboxRows) {
    if (!["PENDING", "FAILED"].includes(outbox.status)) continue;
    try {
      const result = await transport.retry(outbox.messageId);
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
