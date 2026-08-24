/**
 * TaktRequestSnapshotService — Task 3.5.
 *
 * Builds an immutable, whitelist-scoped snapshot of a Takt and atomically
 * creates a TaktRequest + TaktRequestSnapshot in a single DB transaction.
 *
 * Design decisions:
 *   - Snapshot is built from an explicit whitelist of fields. The full Takt
 *     database row is NEVER serialised directly.
 *   - Confidential fields excluded: project plan, other NUs' data, internal
 *     GU comments, cost/contract data, employee data, NU resource details.
 *   - Resources in the DB (resources table) belong to NU orgs — they are
 *     NEVER included. Only the GU's `requiredResources` description is included.
 *   - `buildTaktRequestSnapshot` is a pure function (no DB) — testable in isolation.
 *   - `createTaktRequestWithSnapshot` is the single transactional entry point
 *     for all domain services that need to create a coordinated TaktRequest.
 */
import { db } from "@workspace/db";
import {
  takteTable,
  projectsTable,
  projectContractorsTable,
  taktDependenciesTable,
  taktRequestsTable,
  taktRequestSnapshotsTable,
} from "@workspace/db";
import { eq, and } from "drizzle-orm";
import type { Takt } from "@workspace/db";
import type { TaktDependency } from "@workspace/db";
import { withCanonicalTakt } from "./legacy-takt-mappers";
import { assertActiveProjectMembership } from "../services/project-membership-service";

// ── Snapshot payload type ─────────────────────────────────────────────────────

/** The JSON shape stored in takt_request_snapshots.snapshot_payload. Schema version "1.0". */
export interface TaktRequestSnapshotPayload {
  schemaVersion: "1.0";
  /** Project identifier — the project this Takt belongs to */
  projectReference: string;
  /** Physical location of the project site (from projects.location) — nullable */
  projectLocation: string | null;
  /** Human-readable description of the project (from projects.description) — nullable */
  projectDescription: string | null;
  /** Takt identifier */
  taktReference: string;
  /** Takt version at the time of snapshot creation */
  taktVersion: number;
  /** Trade / Gewerk (e.g. "Rohbau", "Trockenbau") */
  trade: string;
  /** Work package name */
  workPackage: string;
  /** Physical location of the Takt */
  location: {
    building: string | null;
    storey: string | null;
    zone: string;
  };
  /** Planned execution time window */
  plannedTimeWindow: {
    start: string; // ISO 8601 date string (date-only: YYYY-MM-DD)
    end: string;
  };
  /** Optional buffer window (earliest/latest dates) */
  bufferTimeWindow: {
    earliestStart: string | null;
    latestEnd: string | null;
  } | null;
  /** Free-text description of required output / work scope — nullable */
  requiredOutput: string | null;
  /** GU-stated resource requirements (not NU-internal resource assignments) */
  resourceRequirements: Array<{
    resourceType: "CREW" | "EQUIPMENT" | "OTHER";
    notes: string;
  }>;
  /** Work constraints derived from the Takt description — may be empty */
  constraints: string[];
  /** Direct predecessors (finish-to-start / other dependency types) */
  predecessors: Array<{
    taktId: string;
    dependencyType: string;
    lagDays: number;
  }>;
  /** Direct successors */
  successors: Array<{
    taktId: string;
    dependencyType: string;
    lagDays: number;
  }>;
  /** Document references attached to the Takt */
  documentReferences: {
    lvReference: string | null;
    bimReference: string | null;
  };
}

// ── Domain errors ─────────────────────────────────────────────────────────────

export class TaktNotFoundError extends Error {
  readonly taktId: string;
  constructor(taktId: string) {
    super(`Takt not found: ${taktId}`);
    this.name = "TaktNotFoundError";
    this.taktId = taktId;
  }
}

export class ProjectNotFoundError extends Error {
  readonly projectId: string;
  constructor(projectId: string) {
    super(`Project not found: ${projectId}`);
    this.name = "ProjectNotFoundError";
    this.projectId = projectId;
  }
}

export class UnauthorizedSnapshotError extends Error {
  readonly guOrgId: string;
  readonly projectOwnerOrgId: string;
  constructor(guOrgId: string, projectOwnerOrgId: string) {
    super(
      `Organisation ${guOrgId} is not the AG owner of this project (owner: ${projectOwnerOrgId}). ` +
        `Only the project owner may create TaktRequests.`,
    );
    this.name = "UnauthorizedSnapshotError";
    this.guOrgId = guOrgId;
    this.projectOwnerOrgId = projectOwnerOrgId;
  }
}

export class NuNotContractorError extends Error {
  readonly nuOrgId: string;
  readonly projectId: string;
  constructor(nuOrgId: string, projectId: string) {
    super(
      `Organisation ${nuOrgId} is not a registered contractor on project ${projectId}. ` +
        `Add the NU to the project before creating a TaktRequest.`,
    );
    this.name = "NuNotContractorError";
    this.nuOrgId = nuOrgId;
    this.projectId = projectId;
  }
}

export class InvalidTaktForSnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidTaktForSnapshotError";
  }
}

// Re-export for convenience
export { DuplicateSnapshotError } from "./takt-request-repository";

// ── Pure builder (no DB) ───────────────────────────────────────────────────────

/**
 * Builds a TaktRequestSnapshotPayload from explicit whitelisted fields.
 *
 * This function is pure: it takes fully-resolved data and returns a payload
 * object. It never reads from the database or performs I/O.
 *
 * Whitelist: only fields explicitly listed here are included in the snapshot.
 * No spread of full Takt/Project objects. Confidential data is excluded by
 * omission, not by blacklist.
 *
 * ── GU-INTERNAL FIELDS — PERMANENTLY EXCLUDED FROM SNAPSHOT ────────────────
 * The following Takt columns are GU-internal and must NEVER appear in the
 * snapshot payload released to the NU. Exclusion is enforced by the whitelist
 * principle: these fields are simply not referenced below.
 *
 *   takt.internalNote          — internal GU notes
 *   takt.costEstimate          — internal budget / cost estimate
 *   takt.procurementPriority   — internal procurement priority (HIGH/MEDIUM/LOW)
 *   takt.riskClassification    — internal risk classification (A/B/C)
 *
 * See docs/data-ownership.md § "Takt field classification" for the policy.
 * ────────────────────────────────────────────────────────────────────────────
 */
export function buildTaktRequestSnapshot(input: {
  takt: Takt;
  projectId: string;
  projectLocation?: string | null;
  projectDescription?: string | null;
  predecessors: TaktDependency[];
  successors: TaktDependency[];
}): TaktRequestSnapshotPayload {
  const { takt, projectId, projectLocation, projectDescription, predecessors, successors } = input;

  // Validate required fields before building
  if (!takt.plannedStart || !takt.plannedEnd) {
    throw new InvalidTaktForSnapshotError(
      `Takt ${takt.id} is missing plannedStart or plannedEnd — cannot build snapshot.`,
    );
  }
  if (takt.plannedEnd < takt.plannedStart) {
    throw new InvalidTaktForSnapshotError(
      `Takt ${takt.id}: plannedEnd (${takt.plannedEnd}) must not be before plannedStart (${takt.plannedStart}).`,
    );
  }
  if (takt.version < 1) {
    throw new InvalidTaktForSnapshotError(
      `Takt ${takt.id}: version must be >= 1, got ${takt.version}.`,
    );
  }

  const payload: TaktRequestSnapshotPayload = {
    schemaVersion: "1.0",

    // ── Whitelisted identification fields ─────────────────────────────────────
    projectReference: projectId,
    projectLocation: projectLocation ?? null,
    projectDescription: projectDescription ?? null,
    taktReference: takt.id,
    taktVersion: takt.version,

    // ── Whitelisted work description fields ───────────────────────────────────
    trade: takt.gewerk,
    workPackage: takt.taktBezeichnung,

    // ── Location: zone is the only current field; building/storey are reserved
    location: {
      building: null,   // Not in current schema — placeholder for future
      storey: null,     // Not in current schema — placeholder for future
      zone: takt.zone,
    },

    // ── Time windows (date-only strings, no time component in current schema) ──
    plannedTimeWindow: {
      start: takt.plannedStart,
      end: takt.plannedEnd,
    },
    bufferTimeWindow:
      takt.earliestStart != null || takt.latestEnd != null
        ? {
            earliestStart: takt.earliestStart ?? null,
            latestEnd: takt.latestEnd ?? null,
          }
        : null,

    // ── Required output: use description field if present ─────────────────────
    requiredOutput: takt.description ?? null,

    // ── GU-stated resource requirements (NOT NU's internal resources) ─────────
    // requiredResources is a free-text field on the Takt; we wrap it in the
    // typed structure expected by the snapshot schema.
    resourceRequirements: takt.requiredResources
      ? [{ resourceType: "CREW" as const, notes: takt.requiredResources }]
      : [],

    // ── Constraints: empty until Takt model gains a dedicated constraints field
    constraints: [],

    // ── Dependencies (whitelisted fields only — no internal IDs leaked) ────────
    predecessors: predecessors.map((dep) => ({
      taktId: dep.predecessorId,
      dependencyType: dep.type,
      lagDays: dep.lagDays,
    })),
    successors: successors.map((dep) => ({
      taktId: dep.successorId,
      dependencyType: dep.type,
      lagDays: dep.lagDays,
    })),

    // ── Document references (identifiers only — not full documents) ───────────
    documentReferences: {
      lvReference: takt.lvReference ?? null,
      bimReference: takt.bimReference ?? null,
    },
  };

  return payload;
}

// ── Transactional service ─────────────────────────────────────────────────────

export interface CreateTaktRequestWithSnapshotInput {
  taktId: string;
  guOrgId: string;
  nuOrgId: string;
  requestNumber: string;
  responseRequiredBy?: Date;
  createdByUserId: string;
  /** Optional human-readable subject for the coordination notification */
  subject?: string;
  /** Optional free-text message from GU to NU */
  message?: string;
  /**
   * Optional FK to the data_publications entry (type TAKT_INFORMATION_PACKAGE)
   * whose content was shared with the NU. When set, the NU must accept the
   * linked policy before the snapshot details can be retrieved.
   */
  dataPublicationId?: string;
}

export interface CreateTaktRequestWithSnapshotResult {
  request: {
    id: string;
    taktId: string;
    taktVersion: number;
    guOrgId: string;
    nuOrgId: string;
    requestNumber: string;
    status: string;
    responseRequiredBy: Date | null;
    createdAt: Date;
  };
  snapshot: {
    id: string;
    taktRequestId: string;
    schemaVersion: string;
    snapshotPayload: TaktRequestSnapshotPayload;
    createdAt: Date;
  };
}

/**
 * Atomically creates a TaktRequest (in DRAFT status) and its immutable
 * TaktRequestSnapshot in a single DB transaction.
 *
 * Validations (in order):
 *   1. Takt exists
 *   2. Project exists
 *   3. guOrgId is the AG owner of the project
 *   4. nuOrgId is a registered contractor on the project
 *   5. Takt has valid time window (start < end, version >= 1)
 *
 * The snapshot is built via buildTaktRequestSnapshot() — a pure whitelist
 * function — then persisted inside the same transaction as the request row.
 *
 * Throws DuplicateSnapshotError if a snapshot already exists for this request
 * (only possible on DB-level retries or manual inserts; guarded by UNIQUE).
 */
export async function createTaktRequestWithSnapshot(
  input: CreateTaktRequestWithSnapshotInput,
): Promise<CreateTaktRequestWithSnapshotResult> {
  // ── Step 1: Load Takt ─────────────────────────────────────────────────────
  const [takt] = await db
    .select()
    .from(takteTable)
    .where(eq(takteTable.id, input.taktId))
    .limit(1);

  if (!takt) throw new TaktNotFoundError(input.taktId);

  // ── Step 2: Load Project ──────────────────────────────────────────────────
  const [project] = await db
    .select()
    .from(projectsTable)
    .where(eq(projectsTable.id, takt.projectId))
    .limit(1);

  if (!project) throw new ProjectNotFoundError(takt.projectId);

  // ── Step 3: GU ownership check ────────────────────────────────────────────
  if (project.agOrgId !== input.guOrgId) {
    throw new UnauthorizedSnapshotError(input.guOrgId, project.agOrgId);
  }

  // Membership is the sole project-participation gate. Contractor rows carry
  // trade/work-package assignment data, not a second AN consent decision.
  await assertActiveProjectMembership(takt.projectId, input.nuOrgId);

  // ── Step 4: Load dependencies ─────────────────────────────────────────────
  const predecessors = await db
    .select()
    .from(taktDependenciesTable)
    .where(eq(taktDependenciesTable.successorId, input.taktId));

  const successors = await db
    .select()
    .from(taktDependenciesTable)
    .where(eq(taktDependenciesTable.predecessorId, input.taktId));

  // ── Step 6: Build snapshot payload (pure — may throw InvalidTaktForSnapshotError)
  const basePayload = buildTaktRequestSnapshot({
    takt: withCanonicalTakt(takt),
    projectId: project.id,
    projectLocation: project.location ?? null,
    projectDescription: project.description ?? null,
    predecessors,
    successors,
  });

  // Merge optional coordination context into the snapshot.
  // subject/message are GU-to-NU communication metadata; they are stored
  // here so the send endpoint can include them in the notification without
  // needing a separate DB lookup or a schema change to takt_requests.
  const snapshotPayload: Record<string, unknown> = {
    ...(basePayload as unknown as Record<string, unknown>),
    ...(input.subject != null || input.message != null
      ? {
          coordinationContext: {
            subject: input.subject ?? null,
            message: input.message ?? null,
          },
        }
      : {}),
  };

  // ── Step 7: Atomically persist request + snapshot ─────────────────────────
  return db.transaction(async (tx) => {
    const requestId = crypto.randomUUID();
    const snapshotId = crypto.randomUUID();
    const now = new Date();

    const [requestRow] = await tx
      .insert(taktRequestsTable)
      .values({
        id: requestId,
        taktId: input.taktId,
        taktVersion: takt.version,
        guOrgId: input.guOrgId,
        nuOrgId: input.nuOrgId,
        requestNumber: input.requestNumber,
        status: "DRAFT",
        responseRequiredBy: input.responseRequiredBy ?? null,
        createdByUserId: input.createdByUserId,
        dataPublicationId: input.dataPublicationId ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    const [snapshotRow] = await tx
      .insert(taktRequestSnapshotsTable)
      .values({
        id: snapshotId,
        taktRequestId: requestId,
        schemaVersion: "1.0",
        snapshotPayload,
      })
      .returning();

    return {
      request: {
        id: requestRow.id,
        taktId: requestRow.taktId,
        taktVersion: requestRow.taktVersion,
        guOrgId: requestRow.guOrgId,
        nuOrgId: requestRow.nuOrgId,
        requestNumber: requestRow.requestNumber,
        status: requestRow.status,
        responseRequiredBy: requestRow.responseRequiredBy ?? null,
        createdAt: requestRow.createdAt,
      },
      snapshot: {
        id: snapshotRow.id,
        taktRequestId: snapshotRow.taktRequestId,
        schemaVersion: snapshotRow.schemaVersion,
        snapshotPayload: snapshotRow.snapshotPayload as unknown as TaktRequestSnapshotPayload,
        createdAt: snapshotRow.createdAt,
      },
    };
  });
}
