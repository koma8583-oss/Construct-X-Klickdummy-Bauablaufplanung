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
  takteTable,
  projectsTable,
  organizationsTable,
  messageOutboxTable,
  messageInboxTable,
  taktResponsesTable,
  taktResponseAlternativesTable,
  taktResponseDecisionsTable,
  type TaktRequest,
  type InsertTaktRequest,
  type TaktRequestSnapshot,
  type InsertTaktRequestSnapshot,
  type TaktRequestStatus,
} from "@workspace/db";
import { eq, and, sql, desc } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

// ── Detail view types (Task 5.4) ──────────────────────────────────────────────

export interface TaktRequestDetailTransport {
  /** Transport status from the outbox; null if not yet queued */
  status: "PENDING" | "SENT" | "DELIVERED" | "READ" | "FAILED" | null;
  /** Notification payload actually sent to the NU; null before sending */
  notificationPayload: Record<string, unknown> | null;
  attemptCount: number | null;
  lastAttemptAt: Date | null;
  failureReason: string | null;
  /** When the NU's inbox row was marked as read; null if not tracked or not read */
  inboxReadAt: Date | null;
}

export interface TaktRequestDetailResponseAlt {
  /** Row UUID — used as `acceptedAlternativeId` when submitting a GU decision */
  id: string;
  /** NU-assigned business identifier, e.g. "ALT-001" — display only */
  alternativeId: string;
  rank: number;
  proposedStart: Date;
  proposedEnd: Date;
  crewSize: number | null;
  conditions: string[] | null;
}

export interface TaktRequestDetailResponse {
  id: string;
  decision: "ACCEPTED" | "ALTERNATIVES_PROPOSED" | "REJECTED";
  reasonCode: string | null;
  comment: string | null;
  acceptedStart: Date | null;
  acceptedEnd: Date | null;
  nextAvailableDate: string | null;
  createdAt: Date;
  alternatives: TaktRequestDetailResponseAlt[];
}

/** All timeline timestamps in one flat object — null = event not yet occurred / not tracked */
export interface TaktRequestDetailTimeline {
  requestCreatedAt: Date;
  snapshotCreatedAt: Date | null;
  sentAt: Date | null;
  deliveredAt: Date | null;
  /** When the NU's inbox row was marked read — derived from message_inbox.readAt */
  inboxReadAt: Date | null;
  detailsRetrievedAt: Date | null;
  /**
   * "Prüfung gestartet" — not stored on takt_requests; only tracked via
   * NU-internal availability checks. Always null from the GU perspective.
   */
  checkedAt: null;
  responseCreatedAt: Date | null;
}

export interface TaktRequestDetail {
  id: string;
  requestNumber: string;
  taktId: string;
  taktBezeichnung: string;
  taktVersion: number;
  projectId: string;
  projectName: string;
  guOrgId: string;
  nuOrgId: string;
  nuOrgName: string;
  status: TaktRequestStatus;
  responseRequiredBy: Date | null;
  sentAt: Date | null;
  deliveredAt: Date | null;
  detailsRetrievedAt: Date | null;
  supersedesRequestId: string | null;
  createdAt: Date;
  updatedAt: Date;
  transport: TaktRequestDetailTransport;
  snapshot: {
    id: string;
    schemaVersion: string;
    snapshotPayload: Record<string, unknown>;
    createdAt: Date;
  } | null;
  response: TaktRequestDetailResponse | null;
  timeline: TaktRequestDetailTimeline;
  taktLifecycleStatus: string | null;
  guDecision: {
    decisionId: string;
    taktRequestId: string;
    responseId: string;
    decisionType: string;
    acceptedAlternativeId: string | null;
    comment: string | null;
    decidedAt: Date;
    createdAt: Date;
    updatedRequestStatus: string;
    idempotent: boolean;
  } | null;
}

/**
 * Full detail view for a single TaktRequest, GU-scoped.
 * Joins: takte, projects, organizations (NU), snapshot, outbox, inbox, response + alternatives.
 * Returns null if not found OR if guOrgId does not match.
 */
export async function getTaktRequestDetailForGu(
  requestId: string,
  guOrgId: string,
): Promise<TaktRequestDetail | null> {
  const [row] = await db
    .select({
      // ── Request ──────────────────────────────────────────────────────────
      id: taktRequestsTable.id,
      requestNumber: taktRequestsTable.requestNumber,
      taktId: taktRequestsTable.taktId,
      taktBezeichnung: takteTable.taktBezeichnung,
      taktVersion: taktRequestsTable.taktVersion,
      projectId: takteTable.projectId,
      projectName: projectsTable.name,
      guOrgId: taktRequestsTable.guOrgId,
      nuOrgId: taktRequestsTable.nuOrgId,
      nuOrgName: organizationsTable.name,
      status: taktRequestsTable.status,
      responseRequiredBy: taktRequestsTable.responseRequiredBy,
      sentAt: taktRequestsTable.sentAt,
      deliveredAt: taktRequestsTable.deliveredAt,
      detailsRetrievedAt: taktRequestsTable.detailsRetrievedAt,
      supersedesRequestId: taktRequestsTable.supersedesRequestId,
      createdAt: taktRequestsTable.createdAt,
      updatedAt: taktRequestsTable.updatedAt,
      // ── Snapshot ─────────────────────────────────────────────────────────
      snapshotId: taktRequestSnapshotsTable.id,
      snapshotSchemaVersion: taktRequestSnapshotsTable.schemaVersion,
      snapshotPayload: taktRequestSnapshotsTable.snapshotPayload,
      snapshotCreatedAt: taktRequestSnapshotsTable.createdAt,
      // ── Outbox ───────────────────────────────────────────────────────────
      outboxStatus: messageOutboxTable.status,
      outboxPayload: messageOutboxTable.payload,
      outboxAttemptCount: messageOutboxTable.attemptCount,
      outboxLastAttemptAt: messageOutboxTable.lastAttemptAt,
      outboxFailureReason: messageOutboxTable.failureReason,
      // ── Inbox (readAt only) ───────────────────────────────────────────────
      inboxReadAt: messageInboxTable.readAt,
      // ── Response ─────────────────────────────────────────────────────────
      responseId: taktResponsesTable.id,
      responseDecision: taktResponsesTable.decision,
      responseReasonCode: taktResponsesTable.reasonCode,
      responseComment: taktResponsesTable.comment,
      responseAcceptedStart: taktResponsesTable.acceptedStart,
      responseAcceptedEnd: taktResponsesTable.acceptedEnd,
      responseNextAvailableDate: taktResponsesTable.nextAvailableDate,
      responseCreatedAt: taktResponsesTable.createdAt,
      // ── Takt lifecycle ────────────────────────────────────────────────────
      taktLifecycleStatus: takteTable.lifecycleStatus,
      // ── GU Decision ───────────────────────────────────────────────────────
      guDecisionId: taktResponseDecisionsTable.id,
      guDecisionType: taktResponseDecisionsTable.decisionType,
      guDecisionAcceptedAlternativeId: taktResponseDecisionsTable.acceptedAlternativeId,
      guDecisionComment: taktResponseDecisionsTable.comment,
      guDecisionDecidedAt: taktResponseDecisionsTable.decidedAt,
      guDecisionCreatedAt: taktResponseDecisionsTable.createdAt,
      guDecisionResponseId: taktResponseDecisionsTable.responseId,
      guDecisionUpdatedRequestStatus: taktRequestsTable.status,
    })
    .from(taktRequestsTable)
    .innerJoin(takteTable, eq(taktRequestsTable.taktId, takteTable.id))
    .innerJoin(projectsTable, eq(takteTable.projectId, projectsTable.id))
    .innerJoin(organizationsTable, eq(taktRequestsTable.nuOrgId, organizationsTable.id))
    .leftJoin(
      taktRequestSnapshotsTable,
      eq(taktRequestSnapshotsTable.taktRequestId, taktRequestsTable.id),
    )
    .leftJoin(
      messageOutboxTable,
      eq(
        messageOutboxTable.messageId,
        sql`'taktrequest-notification-' || ${taktRequestsTable.id}`,
      ),
    )
    .leftJoin(
      messageInboxTable,
      eq(
        messageInboxTable.messageId,
        sql`'taktrequest-notification-' || ${taktRequestsTable.id}`,
      ),
    )
    .leftJoin(
      taktResponsesTable,
      eq(taktResponsesTable.taktRequestId, taktRequestsTable.id),
    )
    .leftJoin(
      taktResponseDecisionsTable,
      eq(taktResponseDecisionsTable.responseId, taktResponsesTable.id),
    )
    .where(
      and(
        eq(taktRequestsTable.id, requestId),
        eq(taktRequestsTable.guOrgId, guOrgId),
      ),
    )
    .limit(1);

  if (!row) return null;

  // ── Alternatives (1:many — separate query) ──────────────────────────────
  let alternatives: TaktRequestDetailResponseAlt[] = [];
  if (row.responseId) {
    const altRows = await db
      .select()
      .from(taktResponseAlternativesTable)
      .where(eq(taktResponseAlternativesTable.responseId, row.responseId))
      .orderBy(taktResponseAlternativesTable.rank);
    alternatives = altRows.map((a) => ({
      id: a.id,
      alternativeId: a.alternativeId,
      rank: a.rank,
      proposedStart: a.proposedStart,
      proposedEnd: a.proposedEnd,
      crewSize: a.crewSize ?? null,
      conditions: (a.conditions ?? null) as string[] | null,
    }));
  }

  return {
    id: row.id,
    requestNumber: row.requestNumber,
    taktId: row.taktId,
    taktBezeichnung: row.taktBezeichnung,
    taktVersion: row.taktVersion,
    projectId: row.projectId ?? "",
    projectName: row.projectName,
    guOrgId: row.guOrgId,
    nuOrgId: row.nuOrgId,
    nuOrgName: row.nuOrgName,
    status: row.status as TaktRequestStatus,
    responseRequiredBy: row.responseRequiredBy ?? null,
    sentAt: row.sentAt ?? null,
    deliveredAt: row.deliveredAt ?? null,
    detailsRetrievedAt: row.detailsRetrievedAt ?? null,
    supersedesRequestId: row.supersedesRequestId ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    transport: {
      status: (row.outboxStatus ?? null) as TaktRequestDetailTransport["status"],
      notificationPayload: (row.outboxPayload ?? null) as Record<string, unknown> | null,
      attemptCount: row.outboxAttemptCount ?? null,
      lastAttemptAt: row.outboxLastAttemptAt ?? null,
      failureReason: row.outboxFailureReason ?? null,
      inboxReadAt: row.inboxReadAt ?? null,
    },
    snapshot: row.snapshotId
      ? {
          id: row.snapshotId,
          schemaVersion: row.snapshotSchemaVersion!,
          snapshotPayload: (row.snapshotPayload ?? {}) as Record<string, unknown>,
          createdAt: row.snapshotCreatedAt!,
        }
      : null,
    response: row.responseId
      ? {
          id: row.responseId,
          decision: row.responseDecision as TaktRequestDetailResponse["decision"],
          reasonCode: row.responseReasonCode ?? null,
          comment: row.responseComment ?? null,
          acceptedStart: row.responseAcceptedStart ?? null,
          acceptedEnd: row.responseAcceptedEnd ?? null,
          nextAvailableDate: row.responseNextAvailableDate ?? null,
          createdAt: row.responseCreatedAt!,
          alternatives,
        }
      : null,
    taktLifecycleStatus: (row.taktLifecycleStatus ?? null) as string | null,
    guDecision: row.guDecisionId
      ? {
          decisionId: row.guDecisionId,
          taktRequestId: row.id,
          responseId: row.guDecisionResponseId!,
          decisionType: row.guDecisionType as string,
          acceptedAlternativeId: row.guDecisionAcceptedAlternativeId ?? null,
          comment: row.guDecisionComment ?? null,
          decidedAt: row.guDecisionDecidedAt!,
          createdAt: row.guDecisionCreatedAt!,
          updatedRequestStatus: row.guDecisionUpdatedRequestStatus as string,
          idempotent: false,
        }
      : null,
    timeline: {
      requestCreatedAt: row.createdAt,
      snapshotCreatedAt: row.snapshotCreatedAt ?? null,
      sentAt: row.sentAt ?? null,
      deliveredAt: row.deliveredAt ?? null,
      inboxReadAt: row.inboxReadAt ?? null,
      detailsRetrievedAt: row.detailsRetrievedAt ?? null,
      checkedAt: null,
      responseCreatedAt: row.responseCreatedAt ?? null,
    },
  };
}

// ── Enriched list types ───────────────────────────────────────────────────────

export interface TaktRequestListItem {
  id: string;
  requestNumber: string;
  taktId: string;
  taktBezeichnung: string;
  taktVersion: number;
  projectId: string;
  projectName: string;
  guOrgId: string;
  nuOrgId: string;
  nuOrgName: string;
  status: TaktRequestStatus;
  /** Transport delivery status of the notification message. Null if not yet sent. */
  outboxStatus: "PENDING" | "SENT" | "DELIVERED" | "READ" | "FAILED" | null;
  responseRequiredBy: Date | null;
  sentAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
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
 * Enriched list for the GU overview page.
 * Joins takte, projects, organizations (NU), and message_outbox for transport status.
 * Always filtered by guOrgId — never returns foreign GU requests.
 */
export async function listTaktRequestsForGuEnriched(
  guOrgId: string,
  filters?: { status?: TaktRequestStatus; taktId?: string; nuOrgId?: string },
): Promise<TaktRequestListItem[]> {
  // Alias for nu organization to avoid ambiguity
  const nuOrg = organizationsTable;

  const conditions = [eq(taktRequestsTable.guOrgId, guOrgId)];
  if (filters?.status) {
    conditions.push(eq(taktRequestsTable.status, filters.status));
  }
  if (filters?.taktId) {
    conditions.push(eq(taktRequestsTable.taktId, filters.taktId));
  }
  if (filters?.nuOrgId) {
    conditions.push(eq(taktRequestsTable.nuOrgId, filters.nuOrgId));
  }

  const rows = await db
    .select({
      id: taktRequestsTable.id,
      requestNumber: taktRequestsTable.requestNumber,
      taktId: taktRequestsTable.taktId,
      taktBezeichnung: takteTable.taktBezeichnung,
      taktVersion: taktRequestsTable.taktVersion,
      projectId: takteTable.projectId,
      projectName: projectsTable.name,
      guOrgId: taktRequestsTable.guOrgId,
      nuOrgId: taktRequestsTable.nuOrgId,
      nuOrgName: nuOrg.name,
      status: taktRequestsTable.status,
      outboxStatus: messageOutboxTable.status,
      responseRequiredBy: taktRequestsTable.responseRequiredBy,
      expiresAt: taktRequestsTable.expiresAt,
      expiredAt: taktRequestsTable.expiredAt,
      guDecisionRequiredBy: taktRequestsTable.guDecisionRequiredBy,
      lastReminderAt: taktRequestsTable.lastReminderAt,
      reminderCount: taktRequestsTable.reminderCount,
      sentAt: taktRequestsTable.sentAt,
      createdAt: taktRequestsTable.createdAt,
      updatedAt: taktRequestsTable.updatedAt,
    })
    .from(taktRequestsTable)
    .innerJoin(takteTable, eq(taktRequestsTable.taktId, takteTable.id))
    .innerJoin(projectsTable, eq(takteTable.projectId, projectsTable.id))
    .innerJoin(nuOrg, eq(taktRequestsTable.nuOrgId, nuOrg.id))
    .leftJoin(
      messageOutboxTable,
      eq(
        messageOutboxTable.messageId,
        sql`'taktrequest-notification-' || ${taktRequestsTable.id}`,
      ),
    )
    .where(and(...conditions));

  return rows.map((r) => ({
    ...r,
    status: r.status as TaktRequestStatus,
    outboxStatus: (r.outboxStatus ?? null) as TaktRequestListItem["outboxStatus"],
    projectId: r.projectId ?? "",
  }));
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
 * Enriched list for NU — joins the AG organisation name and the immutable
 * Takt snapshot so the inbox can show Auftraggeber, Taktbezeichnung, Zone
 * and Gewerk without exposing data-sovereign internal fields.
 */
export async function listTaktRequestsForNuEnriched(
  nuOrgId: string,
  filters?: { status?: TaktRequestStatus },
) {
  const guOrg = alias(organizationsTable, "gu_org");
  const conditions = [eq(taktRequestsTable.nuOrgId, nuOrgId)];
  if (filters?.status) {
    conditions.push(eq(taktRequestsTable.status, filters.status));
  }

  const rows = await db
    .select({
      id:                 taktRequestsTable.id,
      taktId:             taktRequestsTable.taktId,
      guOrgId:            taktRequestsTable.guOrgId,
      nuOrgId:            taktRequestsTable.nuOrgId,
      requestNumber:      taktRequestsTable.requestNumber,
      status:             taktRequestsTable.status,
      taktVersion:        taktRequestsTable.taktVersion,
      responseRequiredBy: taktRequestsTable.responseRequiredBy,
      expiresAt:          taktRequestsTable.expiresAt,
      expiredAt:          taktRequestsTable.expiredAt,
      sentAt:             taktRequestsTable.sentAt,
      deliveredAt:        taktRequestsTable.deliveredAt,
      detailsRetrievedAt: taktRequestsTable.detailsRetrievedAt,
      reminderCount:      taktRequestsTable.reminderCount,
      lastReminderAt:     taktRequestsTable.lastReminderAt,
      createdAt:          taktRequestsTable.createdAt,
      updatedAt:          taktRequestsTable.updatedAt,
      agOrgName:          guOrg.name,
      projectId:          takteTable.projectId,
      projectName:        projectsTable.name,
      snapshotPayload:    taktRequestSnapshotsTable.snapshotPayload,
    })
    .from(taktRequestsTable)
    .leftJoin(guOrg, eq(taktRequestsTable.guOrgId, guOrg.id))
    .leftJoin(takteTable, eq(taktRequestsTable.taktId, takteTable.id))
    .leftJoin(projectsTable, eq(takteTable.projectId, projectsTable.id))
    .leftJoin(
      taktRequestSnapshotsTable,
      eq(taktRequestSnapshotsTable.taktRequestId, taktRequestsTable.id),
    )
    .where(and(...conditions))
    .orderBy(desc(taktRequestsTable.createdAt));

  return rows.map((r) => {
    // The snapshot payload uses the TaktRequestSnapshotPayload schema (v1.0):
    //   workPackage   → taktBezeichnung
    //   trade         → gewerk
    //   location.zone → zone
    //   plannedTimeWindow.start/end → plannedStart/plannedEnd
    const payload = (r.snapshotPayload ?? {}) as Record<string, unknown>;
    const location = (payload.location ?? {}) as Record<string, unknown>;
    const tw       = (payload.plannedTimeWindow ?? {}) as Record<string, unknown>;

    return {
      id:                 r.id,
      taktId:             r.taktId,
      guOrgId:            r.guOrgId,
      nuOrgId:            r.nuOrgId,
      requestNumber:      r.requestNumber,
      status:             r.status,
      taktVersion:        r.taktVersion,
      responseRequiredBy: r.responseRequiredBy,
      expiresAt:          r.expiresAt,
      expiredAt:          r.expiredAt,
      sentAt:             r.sentAt,
      deliveredAt:        r.deliveredAt,
      detailsRetrievedAt: r.detailsRetrievedAt,
      reminderCount:      r.reminderCount,
      lastReminderAt:     r.lastReminderAt,
      createdAt:          r.createdAt,
      updatedAt:          r.updatedAt,
      agOrgName:          r.agOrgName   ?? null,
      projectId:          r.projectId   ?? null,
      projectName:        r.projectName ?? null,
      // Snapshot-derived display fields (correct keys per TaktRequestSnapshotPayload v1.0)
      taktBezeichnung:    (payload.workPackage as string | undefined) ?? null,
      zone:               (location.zone       as string | undefined) ?? null,
      gewerk:             (payload.trade        as string | undefined) ?? null,
      plannedStart:       (tw.start             as string | undefined) ?? null,
      plannedEnd:         (tw.end               as string | undefined) ?? null,
    };
  });
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
 * Atomically transitions a TaktRequest from DELIVERED to DETAILS_RETRIEVED.
 *
 * Uses a single conditional UPDATE:
 *   UPDATE takt_requests
 *      SET status='DETAILS_RETRIEVED', details_retrieved_at=NOW()
 *    WHERE id=? AND status='DELIVERED'
 *   RETURNING *
 *
 * Returns the updated row when THIS call won the race, or null when
 * another concurrent caller already performed the transition.
 *
 * This is the ONLY correct way to gate a DETAILS_RETRIEVED audit event —
 * non-atomic read-validate-update sequences allow two concurrent callers
 * to both write the audit event. Callers must write DETAILS_RETRIEVED audit
 * events only when this function returns a non-null row.
 */
export async function transitionToDetailsRetrievedAtomic(
  id: string,
  detailsRetrievedAt: Date,
): Promise<TaktRequest | null> {
  const [updated] = await db
    .update(taktRequestsTable)
    .set({
      status: "DETAILS_RETRIEVED" as TaktRequestStatus,
      detailsRetrievedAt,
    })
    .where(
      and(
        eq(taktRequestsTable.id, id),
        eq(taktRequestsTable.status, "DELIVERED" as TaktRequestStatus),
      ),
    )
    .returning();

  // `updated` is undefined when no row matched (already past DELIVERED)
  return updated ?? null;
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
