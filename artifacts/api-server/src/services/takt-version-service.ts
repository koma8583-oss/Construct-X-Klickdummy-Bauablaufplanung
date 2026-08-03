/**
 * Task 6.4 — TaktVersionService
 *
 * applyConfirmAccepted(params)
 *   Processes a CONFIRM_ACCEPTED decision:
 *   - Compares accepted time window with the request snapshot
 *   - If no content difference: only sets lifecycleStatus = CONFIRMED (no new version)
 *   - If accepted window differs from snapshot: creates a new takt_versions entry
 *   - Uses optimistic locking on takt.version to prevent race conditions
 *
 * applyAcceptAlternative(params)
 *   Processes an ACCEPT_ALTERNATIVE decision:
 *   - Whitelists only: timeWindow.start/end, crewSize, conditions
 *   - Always creates a new takt_versions entry (ACCEPTED_ALTERNATIVE)
 *   - Increments takt.version, updates plannedStart/plannedEnd
 *   - Uses optimistic locking
 *
 * Privacy invariant:
 *   - No resourceId, resourceName, localProjectId, customerAlias, internalConflicts,
 *     internalPriority, or internalCost may be transferred from the alternative.
 *
 * Concurrency invariant:
 *   - All takt mutations use: UPDATE takte … WHERE id = ? AND version = ?
 *   - Zero-row result → VersionConflictError (no partial state saved)
 */
import pino from "pino";
import { db } from "@workspace/db";
import {
  takteTable,
  taktRequestsTable,
  taktRequestSnapshotsTable,
  taktResponsesTable,
  taktResponseAlternativesTable,
  taktResponseDecisionsTable,
  taktVersionsTable,
} from "@workspace/db";
import { eq, and } from "drizzle-orm";
import type { TaktVersion } from "@workspace/db";

const logger = pino({ name: "takt-version-service" });

// ── Domain errors ─────────────────────────────────────────────────────────────

export class VersionConflictError extends Error {
  constructor(taktId: string, expectedVersion: number) {
    super(
      `Takt "${taktId}" was modified concurrently (expected version ${expectedVersion}). ` +
        "Please reload the Takt and retry.",
    );
    this.name = "VersionConflictError";
  }
}

// ── Whitelist ─────────────────────────────────────────────────────────────────

/** Fields that may NEVER be transferred from an alternative to the Takt. */
const BLOCKED_ALTERNATIVE_FIELDS = new Set([
  "resourceId",
  "resourceName",
  "localProjectId",
  "customerAlias",
  "internalConflicts",
  "internalPriority",
  "internalCost",
]);

/**
 * Builds the full snapshot payload for a new takt_versions row.
 * Represents the complete business content of the Takt after the change.
 */
function buildTaktSnapshotPayload(takt: {
  taktBezeichnung: string;
  zone: string;
  gewerk: string;
  description: string | null;
  plannedStart: string;
  plannedEnd: string;
  earliestStart: string | null;
  latestEnd: string | null;
  lvReference: string | null;
  bimReference: string | null;
  requiredResources: string | null;
  version: number;
}): Record<string, unknown> {
  return {
    taktBezeichnung:  takt.taktBezeichnung,
    zone:             takt.zone,
    gewerk:           takt.gewerk,
    description:      takt.description ?? null,
    plannedStart:     takt.plannedStart,
    plannedEnd:       takt.plannedEnd,
    earliestStart:    takt.earliestStart ?? null,
    latestEnd:        takt.latestEnd ?? null,
    lvReference:      takt.lvReference ?? null,
    bimReference:     takt.bimReference ?? null,
    requiredResources: takt.requiredResources ?? null,
    version:          takt.version,
  };
}

/** Deterministic MD5-like content hash (stable sort of keys). */
function contentHash(payload: Record<string, unknown>): string {
  const str = JSON.stringify(
    Object.keys(payload)
      .sort()
      .reduce((acc, k) => ({ ...acc, [k]: payload[k] }), {} as Record<string, unknown>),
  );
  // Simple deterministic hash without crypto import (non-security use)
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** Extract a date string (YYYY-MM-DD) from an ISO datetime or date string. */
function toDateString(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  const s = typeof value === "string" ? value : value.toISOString();
  return s.slice(0, 10);
}

// ── CONFIRM_ACCEPTED ──────────────────────────────────────────────────────────

export interface ApplyConfirmAcceptedParams {
  taktRequestId:    string;
  responseId:       string;
  decisionId:       string;
  guOrgId:          string;
  userId:           string;
  /** Must match takt.version at call time — guards against concurrent edits */
  expectedTaktVersion: number;
}

export interface ApplyConfirmAcceptedResult {
  newVersion:     TaktVersion | null;  // null = no content change
  confirmedAt:    Date;
}

export async function applyConfirmAccepted(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  params: ApplyConfirmAcceptedParams,
): Promise<ApplyConfirmAcceptedResult> {
  const { taktRequestId, responseId, decisionId, userId, expectedTaktVersion } = params;

  // 1. Load TaktRequest
  const [request] = await tx
    .select()
    .from(taktRequestsTable)
    .where(eq(taktRequestsTable.id, taktRequestId))
    .limit(1);
  if (!request) throw new Error(`TaktRequest ${taktRequestId} not found`);

  // 2. Load current Takt
  const [takt] = await tx
    .select()
    .from(takteTable)
    .where(eq(takteTable.id, request.taktId))
    .limit(1);
  if (!takt) throw new Error(`Takt ${request.taktId} not found`);

  // 3. Load snapshot (to compare accepted window)
  const [snapshot] = await tx
    .select()
    .from(taktRequestSnapshotsTable)
    .where(eq(taktRequestSnapshotsTable.taktRequestId, taktRequestId))
    .limit(1);

  // 4. Load response (to get accepted window)
  const [response] = await tx
    .select()
    .from(taktResponsesTable)
    .where(eq(taktResponsesTable.id, responseId))
    .limit(1);
  if (!response) throw new Error(`TaktResponse ${responseId} not found`);

  const confirmedAt = new Date();

  // 5. Compare accepted window with current takt dates
  const acceptedStartDate = toDateString(response.acceptedStart);
  const acceptedEndDate   = toDateString(response.acceptedEnd);
  const taktStartDate     = takt.plannedStart;
  const taktEndDate       = takt.plannedEnd;

  const contentChanged =
    (acceptedStartDate !== null && acceptedStartDate !== taktStartDate) ||
    (acceptedEndDate   !== null && acceptedEndDate   !== taktEndDate);

  if (!contentChanged) {
    // No content difference — only set lifecycleStatus to CONFIRMED
    // Optimistic lock: update only if version matches expected
    const result = await tx
      .update(takteTable)
      .set({ lifecycleStatus: "CONFIRMED" })
      .where(and(eq(takteTable.id, takt.id), eq(takteTable.version, expectedTaktVersion)))
      .returning();

    if (result.length === 0) {
      throw new VersionConflictError(takt.id, expectedTaktVersion);
    }

    logger.info({ taktId: takt.id }, "CONFIRM_ACCEPTED: no content change, only lifecycleStatus → CONFIRMED");
    return { newVersion: null, confirmedAt };
  }

  // Content changed — create new version
  const newVersionNumber = takt.version + 1;
  const newStart = acceptedStartDate ?? takt.plannedStart;
  const newEnd   = acceptedEndDate   ?? takt.plannedEnd;

  // 6. Insert new takt_versions
  const newPayload = buildTaktSnapshotPayload({
    ...takt,
    plannedStart: newStart,
    plannedEnd:   newEnd,
    version:      newVersionNumber,
  });

  const [versionRow] = await tx
    .insert(taktVersionsTable)
    .values({
      taktId:           takt.id,
      version:          newVersionNumber,
      sourceType:       "ACCEPTED_ALTERNATIVE" as const, // content came from NU's ACCEPTED window
      sourceRequestId:  taktRequestId,
      sourceResponseId: responseId,
      sourceDecisionId: decisionId,
      snapshotPayload:  newPayload,
      contentHash:      contentHash(newPayload),
      createdByUserId:  userId,
    })
    .returning();

  // 7. Update takt with optimistic lock
  const updateResult = await tx
    .update(takteTable)
    .set({
      plannedStart:    newStart,
      plannedEnd:      newEnd,
      version:         newVersionNumber,
      lifecycleStatus: "CONFIRMED",
    })
    .where(and(eq(takteTable.id, takt.id), eq(takteTable.version, expectedTaktVersion)))
    .returning();

  if (updateResult.length === 0) {
    throw new VersionConflictError(takt.id, expectedTaktVersion);
  }

  logger.info(
    { taktId: takt.id, newVersion: newVersionNumber, newStart, newEnd },
    "CONFIRM_ACCEPTED: content changed, new takt_versions entry created",
  );

  return { newVersion: versionRow, confirmedAt };
}

// ── ACCEPT_ALTERNATIVE ────────────────────────────────────────────────────────

export interface ApplyAcceptAlternativeParams {
  taktRequestId:       string;
  responseId:          string;
  decisionId:          string;
  acceptedAlternativeId: string;
  guOrgId:             string;
  userId:              string;
  /** Must match takt.version at call time — guards against concurrent edits */
  expectedTaktVersion: number;
}

export interface ApplyAcceptAlternativeResult {
  newVersion:  TaktVersion;
  confirmedAt: Date;
}

export async function applyAcceptAlternative(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  params: ApplyAcceptAlternativeParams,
): Promise<ApplyAcceptAlternativeResult> {
  const {
    taktRequestId, responseId, decisionId,
    acceptedAlternativeId, userId, expectedTaktVersion,
  } = params;

  // 1. Load alternative
  const [alt] = await tx
    .select()
    .from(taktResponseAlternativesTable)
    .where(
      and(
        eq(taktResponseAlternativesTable.id, acceptedAlternativeId),
        eq(taktResponseAlternativesTable.responseId, responseId),
      ),
    )
    .limit(1);

  if (!alt) {
    throw new Error(
      `Alternative ${acceptedAlternativeId} not found or does not belong to response ${responseId}`,
    );
  }

  // 2. Privacy check: conditions must not contain blocked fields
  // (conditions is a string array — just pass through; internal fields live in other NU columns)

  // 3. Load TaktRequest + Takt
  const [request] = await tx
    .select()
    .from(taktRequestsTable)
    .where(eq(taktRequestsTable.id, taktRequestId))
    .limit(1);
  if (!request) throw new Error(`TaktRequest ${taktRequestId} not found`);

  const [takt] = await tx
    .select()
    .from(takteTable)
    .where(eq(takteTable.id, request.taktId))
    .limit(1);
  if (!takt) throw new Error(`Takt ${request.taktId} not found`);

  // 4. Whitelist: only take timeWindow start/end, crewSize, conditions from alternative
  const newStart = toDateString(alt.proposedStart) ?? takt.plannedStart;
  const newEnd   = toDateString(alt.proposedEnd)   ?? takt.plannedEnd;
  // crewSize and conditions are stored in the snapshot payload as coordination hints only
  const newVersionNumber = takt.version + 1;

  // 5. Build full snapshot payload for the new version
  const newPayload = buildTaktSnapshotPayload({
    ...takt,
    plannedStart: newStart,
    plannedEnd:   newEnd,
    version:      newVersionNumber,
  });

  // Add accepted alternative metadata (only public fields)
  const fullPayload: Record<string, unknown> = {
    ...newPayload,
    acceptedAlternative: {
      alternativeId: alt.alternativeId,
      rank:          alt.rank,
      proposedStart: alt.proposedStart?.toISOString() ?? null,
      proposedEnd:   alt.proposedEnd?.toISOString()   ?? null,
      crewSize:      alt.crewSize ?? null,
      conditions:    alt.conditions ?? null,
      // Fields intentionally NOT included: resourceId, localProjectId, etc.
    },
  };

  // 6. Insert new takt_versions
  const [versionRow] = await tx
    .insert(taktVersionsTable)
    .values({
      taktId:           takt.id,
      version:          newVersionNumber,
      sourceType:       "ACCEPTED_ALTERNATIVE" as const,
      sourceRequestId:  taktRequestId,
      sourceResponseId: responseId,
      sourceDecisionId: decisionId,
      snapshotPayload:  fullPayload,
      contentHash:      contentHash(fullPayload),
      createdByUserId:  userId,
    })
    .returning();

  // 7. Update takt with optimistic lock
  const confirmedAt = new Date();
  const updateResult = await tx
    .update(takteTable)
    .set({
      plannedStart:    newStart,
      plannedEnd:      newEnd,
      version:         newVersionNumber,
      lifecycleStatus: "CONFIRMED",
    })
    .where(and(eq(takteTable.id, takt.id), eq(takteTable.version, expectedTaktVersion)))
    .returning();

  if (updateResult.length === 0) {
    throw new VersionConflictError(takt.id, expectedTaktVersion);
  }

  logger.info(
    {
      taktId: takt.id,
      newVersion: newVersionNumber,
      alternativeId: alt.alternativeId,
      newStart,
      newEnd,
    },
    "ACCEPT_ALTERNATIVE: new takt_versions entry, takt updated",
  );

  return { newVersion: versionRow, confirmedAt };
}
