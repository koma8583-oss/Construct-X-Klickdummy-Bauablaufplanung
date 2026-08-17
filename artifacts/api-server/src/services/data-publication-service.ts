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
import { db } from "@workspace/db";
import {
  dataPublicationsTable,
  dataPublicationRecipientsTable,
  policyTemplatesTable,
  projectsTable,
  takteTable,
  taktDependenciesTable,
  organizationsTable,
} from "@workspace/db";
import { eq, and, inArray } from "drizzle-orm";
import { LocalHubTransport } from "../lib/transport/local-hub-transport";

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

  return buildTaktSnapshot(project, include, selectedTaktIds ?? []);
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
  if (include.has("assignedTrade")) snap.assignedTrade = null; // populated per-request in future
  if (include.has("workPackageReference")) snap.workPackageReference = null;
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
    } catch {
      // Best-effort — delivery failure must not abort the publish
    }
  }
}
