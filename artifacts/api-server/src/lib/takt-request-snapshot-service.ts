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
import { agDb as db } from "@workspace/db";
import {
  takteTable,
  projectsTable,
  projectContractorsTable,
  taktDependenciesTable,
  taktRequestsTable,
  taktRequestSnapshotsTable,
  coordinationPoliciesTable,
  projectMembershipsTable,
} from "@workspace/db";
import { createPolicySnapshot } from "../services/policy-snapshot-service";
import {
  createConstructXPolicy,
  resolvePolicyDelta,
} from "../services/construct-x-policy-service";
import { eq, and } from "drizzle-orm";
import type { Takt } from "@workspace/db";
import type { TaktDependency } from "@workspace/db";
import type { TaktRequestSnapshotPayload } from "@workspace/api-zod";
import { withCanonicalTakt } from "./legacy-takt-mappers";
import { assertActiveProjectMembership } from "../services/project-membership-service";

/** Business purposes for a Leistung request.  These are deliberately not
 * policy-template ids: an AG chooses a business purpose, while the server
 * derives the child policy from the accepted project agreement. */
export const LEISTUNGSFREIGABE_FIELD_WHITELISTS = {
  RAHMENTERMINE: [
    "taktReference", "taktVersion", "trade", "workPackage", "kurzbezeichnung",
    "location", "plannedTimeWindow", "bufferTimeWindow", "predecessors", "successors",
  ],
  LEISTUNGSKOORDINATION: [
    "taktReference", "taktVersion", "trade", "workPackage", "kurzbezeichnung",
    "location", "plannedTimeWindow", "bufferTimeWindow", "requiredOutput",
    "resourceRequirements", "constraints", "predecessors", "successors", "documentReferences",
  ],
  AUSFUEHRUNGSINFORMATIONEN: [
    "taktReference", "taktVersion", "trade", "workPackage", "kurzbezeichnung",
    "location", "plannedTimeWindow", "bufferTimeWindow", "requiredOutput",
    "constraints", "predecessors", "successors", "documentReferences",
  ],
  INDIVIDUELLE_FREIGABE: [
    "taktReference", "taktVersion", "trade", "workPackage", "kurzbezeichnung",
    "location", "plannedTimeWindow", "bufferTimeWindow", "requiredOutput",
    "resourceRequirements", "constraints", "predecessors", "successors", "documentReferences",
  ],
} as const;

export type LeistungsfreigabePurpose = keyof typeof LEISTUNGSFREIGABE_FIELD_WHITELISTS;
const PARENT_COVERED_FIELDS = new Set(["projectLocation", "projectDescription"]);

export class InvalidLeistungsfreigabeFieldsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidLeistungsfreigabeFieldsError";
  }
}

export function selectLeistungsfreigabeFields(
  payload: TaktRequestSnapshotPayload,
  purpose: LeistungsfreigabePurpose,
  selectedFields?: readonly string[],
): Record<string, unknown> {
  const permitted = LEISTUNGSFREIGABE_FIELD_WHITELISTS[purpose];
  const fields = selectedFields ? [...new Set(selectedFields)] : [...permitted];
  const illegal = fields.filter((field) => !permitted.includes(field as never) || PARENT_COVERED_FIELDS.has(field));
  if (illegal.length) {
    throw new InvalidLeistungsfreigabeFieldsError(
      `Fields are not permitted for ${purpose}: ${illegal.join(", ")}.`,
    );
  }
  // Project reference remains a technical identifier, never a child-owned
  // project-information field. Parent-covered fields are omitted completely.
  const source = payload as unknown as Record<string, unknown>;
  return Object.fromEntries([
    ["schemaVersion", payload.schemaVersion],
    ["projectReference", payload.projectReference],
    ...fields.map((field) => [field, source[field]]),
  ]);
}

// ── Snapshot payload type ─────────────────────────────────────────────────────

// Re-export the shared public contract for existing service consumers.
export type { TaktRequestSnapshotPayload } from "@workspace/api-zod";

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
    kurzbezeichnung: takt.kurzbezeichnung,

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
  purpose?: LeistungsfreigabePurpose;
  /** Explicit child-owned fields. Omitted only for backwards-compatible callers. */
  selectedFields?: string[];
  /** Compatibility input for old routes. It is intentionally ignored: normal
   * Leistungsanfragen never create or link a DataPublication. */
  dataPublicationId?: string;
  /** Shared selection group for parallel requests; omitted means a singleton group. */
  selectionGroupId?: string;
  /** Internal transaction connection used by atomic batch creation. */
  tx?: any;
}

export interface CreateTaktRequestWithSnapshotResult {
  request: {
    id: string;
    taktId: string;
    taktVersion: number;
    guOrgId: string;
    nuOrgId: string;
    requestNumber: string;
    selectionGroupId: string;
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
  const connection = input.tx ?? db;
  // ── Step 1: Load Takt ─────────────────────────────────────────────────────
  const [takt] = await connection
    .select()
    .from(takteTable)
    .where(eq(takteTable.id, input.taktId))
    .limit(1);

  if (!takt) throw new TaktNotFoundError(input.taktId);

  // ── Step 2: Load Project ──────────────────────────────────────────────────
  const [project] = await connection
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
  const membership = await assertActiveProjectMembership(takt.projectId, input.nuOrgId);
  let [agreement] = membership.projectAgreementPolicyId
    ? await connection.select().from(coordinationPoliciesTable).where(
      eq(coordinationPoliciesTable.id, membership.projectAgreementPolicyId),
    ).limit(1)
    : [];
  if (!agreement) {
    // Backfill the explicit agreement for memberships created before policy
    // versioning. This keeps an existing ACTIVE membership equivalent to the
    // new model without introducing a second consent step.
    const legacyAgreementSnapshot = createPolicySnapshot({
      templateId: "PROJECT_MEMBERSHIP",
      providerContext: { organizationId: input.guOrgId, organizationType: "AG" },
      overrides: {
        recipientOrganizationId: input.nuOrgId,
        purpose: "PROJECT_MEMBERSHIP",
        projectReference: project.id,
      },
    });
    const legacyAgreement = createConstructXPolicy({
      baseSnapshot: legacyAgreementSnapshot,
      policyType: "PROJECT_AGREEMENT",
      policyVersion: legacyAgreementSnapshot.templateVersion,
      lifecycleStatus: "ACCEPTED",
      effectivePolicy: {
        ...legacyAgreementSnapshot,
        childPolicyTypes: ["PERFORMANCE_REQUEST", "SCHEDULE_CHANGE", "DATA_OFFER"],
        childPermissions: [
          "READ",
          "DOWNLOAD",
          "USE_FOR_PERFORMANCE_COORDINATION",
          "USE_FOR_SCHEDULE_COORDINATION",
          "USE_FOR_RESOURCE_COORDINATION",
          "USE_FOR_EXECUTION_COORDINATION",
        ],
      },
    });
    const legacyPolicyKey = `${project.id}:agreement:${input.nuOrgId}:legacy-${membership.id}`;
    const insertedLegacyAgreement = await connection.insert(coordinationPoliciesTable).values({
      id: legacyAgreement.policyId,
      policyKey: legacyPolicyKey,
      version: legacyAgreement.policyVersion,
      kind: legacyAgreement.policyType,
      projectId: project.id,
      providerOrgId: input.guOrgId,
      recipientOrgId: input.nuOrgId,
      parentPolicyId: null,
      lifecycleStatus: legacyAgreement.lifecycleStatus,
      deltaClass: null,
      policySnapshot: legacyAgreement as unknown as Record<string, unknown>,
      diff: null,
      effectivePolicy: legacyAgreement.effectivePolicy,
      createdByUserId: input.createdByUserId,
    }).onConflictDoNothing().returning({ id: coordinationPoliciesTable.id });
    // A retry can race (or follow a previous failed transaction cleanup) on the
    // deterministic policy key. Never attach the membership to this attempt's
    // random UUID unless that row was actually inserted.
    const persistedAgreementId = insertedLegacyAgreement[0]?.id ?? (
      await connection.select({ id: coordinationPoliciesTable.id })
        .from(coordinationPoliciesTable)
        .where(eq(coordinationPoliciesTable.policyKey, legacyPolicyKey))
        .limit(1)
    )[0]?.id;
    if (!persistedAgreementId) {
      throw new Error("Accepted project agreement could not be resolved after insert.");
    }
    await connection.update(projectMembershipsTable)
      .set({ projectAgreementPolicyId: persistedAgreementId })
      .where(eq(projectMembershipsTable.id, membership.id));
    [agreement] = await connection.select().from(coordinationPoliciesTable)
      .where(eq(coordinationPoliciesTable.id, persistedAgreementId))
      .limit(1);
  }

  // ── Step 4: Load dependencies ─────────────────────────────────────────────
  const predecessors = await connection
    .select()
    .from(taktDependenciesTable)
    .where(eq(taktDependenciesTable.successorId, input.taktId));

  const successors = await connection
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
  const purpose = input.purpose ?? "LEISTUNGSKOORDINATION";
  const releasedPayload = selectLeistungsfreigabeFields(basePayload, purpose, input.selectedFields);

  // Merge optional coordination context into the snapshot.
  // subject/message are GU-to-NU communication metadata; they are stored
  // here so the send endpoint can include them in the notification without
  // needing a separate DB lookup or a schema change to takt_requests.
  const policyTemplateId = purpose === "RAHMENTERMINE"
    ? "SCHEDULE_COORDINATION"
    : "PERFORMANCE_COORDINATION";
  const basePolicySnapshot = createPolicySnapshot({
    templateId: policyTemplateId,
    providerContext: { organizationId: input.guOrgId, userId: input.createdByUserId, organizationType: "AG" },
    overrides: {
      recipientOrganizationId: input.nuOrgId,
      purpose,
      projectReference: project.id,
      workPackageReference: input.taktId,
    },
  });
  const candidateSnapshot = {
    ...basePolicySnapshot,
    selectedFields: input.selectedFields ?? LEISTUNGSFREIGABE_FIELD_WHITELISTS[purpose],
  };
  const resolution = resolvePolicyDelta(
    agreement?.effectivePolicy as Record<string, unknown> | undefined,
    candidateSnapshot,
  );
  const performancePolicy = createConstructXPolicy({
    baseSnapshot: basePolicySnapshot,
    policyType: "PERFORMANCE_REQUEST",
    policyVersion: takt.version,
    parentPolicyId: agreement?.id ?? null,
    lifecycleStatus: resolution.deltaClass === "REQUIRES_CONSENT"
      ? "CONSENT_REQUIRED"
      : resolution.deltaClass === "NOT_PERMITTED" ? "DRAFT" : "PUBLISHED",
    deltaClass: resolution.deltaClass,
    diff: resolution.diff,
    effectivePolicy: resolution.effectivePolicy,
  });

  const snapshotPayload: Record<string, unknown> = {
    ...releasedPayload,
    policySnapshot: performancePolicy,
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
  const persist = async (tx: any): Promise<CreateTaktRequestWithSnapshotResult> => {
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
        selectionGroupId: input.selectionGroupId ?? requestId,
        status: "DRAFT",
        responseRequiredBy: input.responseRequiredBy ?? null,
        createdByUserId: input.createdByUserId,
        // Data offers are a separate BIM/logistics/document workflow. A normal
        // Leistungsanfrage is governed solely by its child performance policy.
        dataPublicationId: null,
        performancePolicyId: performancePolicy.policyId,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    await tx.insert(coordinationPoliciesTable).values({
      id: performancePolicy.policyId,
      policyKey: `${input.requestNumber}:performance`,
      version: performancePolicy.policyVersion,
      kind: performancePolicy.policyType,
      projectId: project.id,
      providerOrgId: input.guOrgId,
      recipientOrgId: input.nuOrgId,
      parentPolicyId: performancePolicy.parentPolicyId,
      lifecycleStatus: performancePolicy.lifecycleStatus,
      deltaClass: performancePolicy.deltaClass,
      policySnapshot: performancePolicy as unknown as Record<string, unknown>,
      diff: performancePolicy.diff as unknown as Record<string, unknown> | null,
      effectivePolicy: performancePolicy.effectivePolicy,
      createdByUserId: input.createdByUserId,
    });

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
        selectionGroupId: requestRow.selectionGroupId,
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
  };

  return input.tx ? persist(input.tx) : db.transaction(persist);
}

export interface CreateTaktRequestBatchInput {
  taktId: string;
  guOrgId: string;
  nuOrgIds: string[];
  responseRequiredBy?: Date;
  createdByUserId: string;
  subject?: string;
  message?: string;
  purpose?: LeistungsfreigabePurpose;
  selectedFields?: string[];
}

export interface CreateTaktRequestBatchResult {
  selectionGroupId: string;
  requests: CreateTaktRequestWithSnapshotResult[];
}

/**
 * Atomically create one immutable snapshot request for each selected AN.
 * All rows share one selectionGroupId; a failure for any recipient rolls back
 * the complete batch. Deliveries intentionally remain a subsequent operation.
 */
export async function createTaktRequestBatchWithSnapshot(
  input: CreateTaktRequestBatchInput,
): Promise<CreateTaktRequestBatchResult> {
  const nuOrgIds = [...new Set(input.nuOrgIds)];
  if (nuOrgIds.length === 0) {
    throw new Error("At least one NU organisation is required.");
  }

  // Reuse the established validation and snapshot builder for every recipient.
  // Passing the outer transaction through keeps every insert on one connection,
  // so validation or persistence failure rolls the whole batch back.
  const selectionGroupId = crypto.randomUUID();
  const requestNumberStem = `TKR-${Date.now().toString(36).toUpperCase()}-${selectionGroupId.slice(0, 6).toUpperCase()}`;

  return db.transaction(async (tx) => {
    const requests: CreateTaktRequestWithSnapshotResult[] = [];
    for (const [index, nuOrgId] of nuOrgIds.entries()) {
      const request = await createTaktRequestWithSnapshot({
        taktId: input.taktId,
        guOrgId: input.guOrgId,
        nuOrgId,
        requestNumber: `${requestNumberStem}-${String(index + 1).padStart(2, "0")}`,
        responseRequiredBy: input.responseRequiredBy,
        createdByUserId: input.createdByUserId,
        subject: input.subject,
        message: input.message,
        purpose: input.purpose,
        selectedFields: input.selectedFields,
        selectionGroupId,
        tx,
      });
      requests.push(request);
    }
    return { selectionGroupId, requests };
  });
}
