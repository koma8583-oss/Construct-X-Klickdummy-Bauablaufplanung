/**
 * TaktRequest Audit Service
 *
 * Writes and queries the `takt_request_audit_events` table.
 *
 * Design rules:
 *   1. Writing an audit event must NEVER throw or cause the parent operation to
 *      fail. Wrap all writes in try/catch and log on failure.
 *   2. Each event is append-only — no update, no delete.
 *   3. The audit trail is transport-agnostic: when the current LocalHubTransport
 *      is replaced by an EDC connector, the same service writes events here so
 *      the coordination history remains consistent.
 *   4. GU callers receive the full event list; NU callers receive only events
 *      relevant to them (NOTIFICATION_DELIVERED, DETAILS_RETRIEVED,
 *      AVAILABILITY_CHECK_DONE, RESPONSE_SUBMITTED).
 *   5. Hub admins receive the full event list (read-only).
 */
import { agDb, db } from "@workspace/db";
import { taktRequestAuditEventsTable } from "@workspace/db";
import { eq, asc } from "drizzle-orm";
import type {
  TaktAuditEventType,
  TaktAuditActorRole,
  TaktRequestAuditEvent,
} from "@workspace/db";

// ── Event subsets visible to each caller role ─────────────────────────────────

/** Event types the NU (addressed AN) may see in the public audit trail. */
const NU_VISIBLE_EVENT_TYPES = new Set<TaktAuditEventType>([
  "NOTIFICATION_DELIVERED",
  "DETAILS_RETRIEVED",
  "AVAILABILITY_CHECK_DONE",
  "RESPONSE_SUBMITTED",
  "RESPONSE_DELIVERED",
  // GU decisions are shown to NU so they can see revision requests and outcomes.
  "GU_DECISION_MADE",
  // Audit events on revision successor requests
  "NOTIFICATION_SENT",
  "REVISION_CREATED",
]);

// ── Write helpers ─────────────────────────────────────────────────────────────

export interface WriteAuditEventParams {
  requestId: string;
  eventType: TaktAuditEventType;
  actorOrgId?: string | null;
  actorUserId?: string | null;
  actorRole?: TaktAuditActorRole | null;
  metadata?: Record<string, unknown>;
}

/**
 * Write a single audit event for a TaktRequest.
 *
 * Safe to `await` — catches and logs all errors so the caller is never
 * interrupted by an audit write failure.
 */
export async function writeAuditEvent(
  params: WriteAuditEventParams,
): Promise<void> {
  try {
    await agDb.insert(taktRequestAuditEventsTable).values({
      requestId: params.requestId,
      eventType: params.eventType,
      actorOrgId: params.actorOrgId ?? null,
      actorUserId: params.actorUserId ?? null,
      actorRole: params.actorRole ?? null,
      metadata: params.metadata ?? null,
    });
  } catch (err) {
    // Audit writes must not break business operations.
    console.error(
      `[takt-audit] Failed to write ${params.eventType} event for request ${params.requestId}:`,
      err,
    );
    // In test environments, rethrow so failures are visible in test output.
    if (process.env.NODE_ENV === "test") throw err;
  }
}

// ── Query helpers ─────────────────────────────────────────────────────────────

export interface AuditTrailEntry {
  id: string;
  requestId: string;
  eventType: TaktAuditEventType;
  actorOrgId: string | null;
  actorUserId: string | null;
  actorRole: TaktAuditActorRole | null;
  metadata: Record<string, unknown> | null;
  occurredAt: Date;
}

export type AuditTrailCallerRole = "GU" | "NU" | "HUB_ADMIN";

/**
 * Return the audit trail for a TaktRequest, filtered to what the caller may see.
 *
 * - GU (owning AG org) and HUB_ADMIN: full event list, chronological.
 * - NU (addressed AN org): only NU-visible event types (no internal GU decisions).
 */
export async function getAuditTrail(
  requestId: string,
  callerRole: AuditTrailCallerRole,
): Promise<AuditTrailEntry[]> {
  const rows = await db
    .select()
    .from(taktRequestAuditEventsTable)
    .where(eq(taktRequestAuditEventsTable.requestId, requestId))
    .orderBy(asc(taktRequestAuditEventsTable.occurredAt));

  if (callerRole === "NU") {
    return rows.filter((r) =>
      NU_VISIBLE_EVENT_TYPES.has(r.eventType as TaktAuditEventType),
    );
  }

  return rows;
}

/**
 * Convert a DB row to the public API shape.
 * Strips internal DB id from the top-level for the API response (kept in row).
 */
export function formatAuditEvent(row: TaktRequestAuditEvent): AuditTrailEntry {
  return {
    id: row.id,
    requestId: row.requestId,
    eventType: row.eventType as TaktAuditEventType,
    actorOrgId: row.actorOrgId ?? null,
    actorUserId: row.actorUserId ?? null,
    actorRole: row.actorRole as TaktAuditActorRole | null,
    metadata: (row.metadata as Record<string, unknown> | null) ?? null,
    occurredAt: row.occurredAt,
  };
}
