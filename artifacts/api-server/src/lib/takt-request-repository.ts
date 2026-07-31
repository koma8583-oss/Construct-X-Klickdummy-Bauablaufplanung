/**
 * Repository layer for TaktRequest and TaktRequestSnapshot (Task 2.6).
 *
 * Rules:
 *   - All queries filter by guOrgId or nuOrgId — no unfiltered "get all" functions.
 *   - updateTaktRequestStatus uses assertValidTaktRequestTransition before writing.
 *   - createTaktRequestSnapshot is write-once; a second call for the same
 *     taktRequestId will throw (DB UNIQUE constraint).
 *   - No transport logic here (no Hub messages, webhooks, or EDC).
 */
import { db } from "@workspace/db";
import {
  taktRequestsTable,
  taktRequestSnapshotsTable,
  type TaktRequest,
  type InsertTaktRequest,
  type TaktRequestSnapshot,
  type InsertTaktRequestSnapshot,
  type TaktRequestStatus,
} from "@workspace/db";
import { eq, and } from "drizzle-orm";
import {
  assertValidTaktRequestTransition,
} from "./takt-request-transitions";

// Re-export the status type so routes don't need to import it separately
export type { TaktRequestStatus };

/** Domain error thrown for invalid status transitions */
export class TaktRequestTransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TaktRequestTransitionError";
  }
}

/** Domain error thrown when trying to create a second snapshot */
export class DuplicateSnapshotError extends Error {
  constructor(taktRequestId: string) {
    super(`A snapshot already exists for TaktRequest ${taktRequestId}`);
    this.name = "DuplicateSnapshotError";
  }
}

// ── TaktRequest functions ─────────────────────────────────────────────────────

/**
 * Creates a new TaktRequest in DRAFT status.
 * Does not send any message or update any Takt status.
 */
export async function createTaktRequestDraft(data: {
  taktId: string;
  taktVersion: number;
  guOrgId: string;
  nuOrgId: string;
  requestNumber: string;
  responseRequiredBy?: Date;
  createdByUserId: string;
}): Promise<TaktRequest> {
  const [row] = await db
    .insert(taktRequestsTable)
    .values({
      id: crypto.randomUUID(),
      taktId: data.taktId,
      taktVersion: data.taktVersion,
      guOrgId: data.guOrgId,
      nuOrgId: data.nuOrgId,
      requestNumber: data.requestNumber,
      status: "DRAFT",
      responseRequiredBy: data.responseRequiredBy ?? null,
      createdByUserId: data.createdByUserId,
    })
    .returning();
  if (!row) throw new Error("Failed to insert TaktRequest");
  return row;
}

/**
 * Retrieves a TaktRequest by ID.
 * Returns null if not found.
 */
export async function getTaktRequestById(
  id: string,
): Promise<TaktRequest | null> {
  const [row] = await db
    .select()
    .from(taktRequestsTable)
    .where(eq(taktRequestsTable.id, id))
    .limit(1);
  return row ?? null;
}

/**
 * Retrieves a TaktRequest along with its Snapshot.
 * Returns null if the request is not found.
 * Snapshot may be null if not yet created.
 */
export async function getTaktRequestWithSnapshot(id: string): Promise<{
  request: TaktRequest;
  snapshot: TaktRequestSnapshot | null;
} | null> {
  const [row] = await db
    .select()
    .from(taktRequestsTable)
    .where(eq(taktRequestsTable.id, id))
    .limit(1);
  if (!row) return null;

  const [snapshot] = await db
    .select()
    .from(taktRequestSnapshotsTable)
    .where(eq(taktRequestSnapshotsTable.taktRequestId, id))
    .limit(1);

  return { request: row, snapshot: snapshot ?? null };
}

/**
 * Lists TaktRequests for a GU organisation.
 * Always filtered by guOrgId — never returns requests from other GU orgs.
 */
export async function listTaktRequestsForGu(
  guOrgId: string,
  filters?: { status?: TaktRequestStatus; taktId?: string },
): Promise<TaktRequest[]> {
  const conditions = [eq(taktRequestsTable.guOrgId, guOrgId)];
  if (filters?.status) {
    conditions.push(eq(taktRequestsTable.status, filters.status));
  }
  if (filters?.taktId) {
    conditions.push(eq(taktRequestsTable.taktId, filters.taktId));
  }
  return db
    .select()
    .from(taktRequestsTable)
    .where(and(...conditions));
}

/**
 * Lists TaktRequests for a NU organisation.
 * Always filtered by nuOrgId — never returns requests addressed to other NUs.
 */
export async function listTaktRequestsForNu(
  nuOrgId: string,
  filters?: { status?: TaktRequestStatus },
): Promise<TaktRequest[]> {
  const conditions = [eq(taktRequestsTable.nuOrgId, nuOrgId)];
  if (filters?.status) {
    conditions.push(eq(taktRequestsTable.status, filters.status));
  }
  return db
    .select()
    .from(taktRequestsTable)
    .where(and(...conditions));
}

/**
 * Updates the status of a TaktRequest.
 * Uses assertValidTaktRequestTransition — throws TaktRequestTransitionError on invalid moves.
 * Optionally sets a timestamp field associated with the transition.
 */
export async function updateTaktRequestStatus(
  id: string,
  nextStatus: TaktRequestStatus,
  timestampUpdates?: {
    sentAt?: Date;
    deliveredAt?: Date;
    detailsRetrievedAt?: Date;
  },
): Promise<TaktRequest> {
  const existing = await getTaktRequestById(id);
  if (!existing) {
    throw new Error(`TaktRequest ${id} not found`);
  }

  try {
    assertValidTaktRequestTransition(existing.status as TaktRequestStatus, nextStatus);
  } catch (err) {
    throw new TaktRequestTransitionError((err as Error).message);
  }

  const [updated] = await db
    .update(taktRequestsTable)
    .set({
      status: nextStatus,
      ...(timestampUpdates?.sentAt ? { sentAt: timestampUpdates.sentAt } : {}),
      ...(timestampUpdates?.deliveredAt
        ? { deliveredAt: timestampUpdates.deliveredAt }
        : {}),
      ...(timestampUpdates?.detailsRetrievedAt
        ? { detailsRetrievedAt: timestampUpdates.detailsRetrievedAt }
        : {}),
    })
    .where(eq(taktRequestsTable.id, id))
    .returning();
  if (!updated) throw new Error(`TaktRequest ${id} not found after update`);
  return updated;
}

/**
 * Marks a TaktRequest as SUPERSEDED.
 * Called when a revised request is created that replaces this one.
 * Uses the standard transition validation — SUPERSEDED is only reachable
 * from ALTERNATIVES_PROPOSED, REJECTED, or REVISION_REQUIRED.
 */
export async function markTaktRequestSuperseded(
  id: string,
): Promise<TaktRequest> {
  return updateTaktRequestStatus(id, "SUPERSEDED");
}

// ── Snapshot functions ─────────────────────────────────────────────────────────

/**
 * Creates the immutable snapshot for a TaktRequest.
 * Throws DuplicateSnapshotError if a snapshot already exists.
 * The payload must not contain full project data or other NU information.
 */
export async function createTaktRequestSnapshot(data: {
  taktRequestId: string;
  schemaVersion?: string;
  snapshotPayload: Record<string, unknown>;
}): Promise<TaktRequestSnapshot> {
  // Check for existing snapshot before attempting insert (clearer error message)
  const existing = await getTaktRequestSnapshot(data.taktRequestId);
  if (existing) {
    throw new DuplicateSnapshotError(data.taktRequestId);
  }

  const [row] = await db
    .insert(taktRequestSnapshotsTable)
    .values({
      id: crypto.randomUUID(),
      taktRequestId: data.taktRequestId,
      schemaVersion: data.schemaVersion ?? "1.0",
      snapshotPayload: data.snapshotPayload,
    })
    .returning();
  if (!row) throw new Error("Failed to insert TaktRequestSnapshot");
  return row;
}

/**
 * Retrieves the snapshot for a TaktRequest.
 * Returns null if no snapshot exists yet.
 */
export async function getTaktRequestSnapshot(
  taktRequestId: string,
): Promise<TaktRequestSnapshot | null> {
  const [row] = await db
    .select()
    .from(taktRequestSnapshotsTable)
    .where(eq(taktRequestSnapshotsTable.taktRequestId, taktRequestId))
    .limit(1);
  return row ?? null;
}
