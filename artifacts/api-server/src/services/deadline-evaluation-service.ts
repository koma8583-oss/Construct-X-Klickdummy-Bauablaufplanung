/**
 * DeadlineEvaluationService — Tasks 7.3, 7.4, 7.5
 *
 * Evaluates open TaktRequests against their deadlines and:
 *   1. Expires requests past their expiresAt (Task 7.4)
 *   2. Creates and dispatches business reminders (Task 7.5)
 *   3. Cancels stale pending reminders when no longer relevant
 *
 * Design principles:
 *   - All time comparisons use an injected `now: Date` — no scattered new Date()
 *   - Each request is processed independently; one failure does not stop others
 *   - All reminder creation is idempotent via deduplicationKey
 *   - UNDER_REVIEW requests are NOT auto-expired (see docs/deadlines-and-reminders.md §5.4)
 */

import { db } from "@workspace/db";
import {
  taktRequestsTable,
  taktRequestRemindersTable,
  taktResponsesTable,
  takteTable,
  messageOutboxTable,
} from "@workspace/db";
import {
  and, eq, inArray, not, sql,
} from "drizzle-orm";
import type { TaktRequestStatus } from "../lib/takt-request-transitions";
import { assertValidTaktRequestTransition } from "../lib/takt-request-transitions";
import { LocalHubTransport } from "../lib/transport/local-hub-transport";
import type { ReminderType } from "@workspace/db";
import type { DeadlineConfig } from "./deadline-config";
import { writeAuditEvent } from "../lib/takt-request-audit-service";
import pino from "pino";

// Reuse the transaction type established in reschedule.ts
type DbTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const logger = pino({ name: "deadline-evaluation-service" });
const transport = new LocalHubTransport();

// ── Statuses that can auto-expire ─────────────────────────────────────────────

/** Requests in these statuses expire automatically when expiresAt is reached */
const AUTO_EXPIRABLE: readonly TaktRequestStatus[] = [
  "SENT",
  "DELIVERED",
  "DETAILS_RETRIEVED",
];

/**
 * UNDER_REVIEW is intentionally excluded from auto-expiry:
 * the NU has started reviewing, so expiring automatically would discard their
 * in-progress work. Instead we mark it overdue and send a reminder.
 * See docs/deadlines-and-reminders.md §5.4.
 */
const OVERDUE_ONLY: readonly TaktRequestStatus[] = ["UNDER_REVIEW"];

/** Statuses that should receive NU response reminders */
const REMINDER_ELIGIBLE: readonly TaktRequestStatus[] = [
  "SENT", "DELIVERED", "DETAILS_RETRIEVED", "UNDER_REVIEW",
];

/**
 * Statuses where the NU has already responded and the GU must decide.
 * These requests receive GU_DECISION_DUE_SOON / GU_DECISION_OVERDUE reminders.
 */
const GU_DECISION_ELIGIBLE: readonly TaktRequestStatus[] = [
  "ACCEPTED", "ALTERNATIVES_PROPOSED",
];

// ── Result types ──────────────────────────────────────────────────────────────

export interface DeadlineEvaluationResult {
  startedAt:       Date;
  finishedAt:      Date;
  checkedRequests: number;
  expiredRequests: number;
  createdReminders: number;
  sentReminders:   number;
  cancelledReminders: number;
  failedRequests:  number;
  errors: Array<{ requestId: string; error: string }>;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function addHours(d: Date, hours: number): Date {
  return new Date(d.getTime() + hours * 60 * 60 * 1000);
}

function fmtDate(d: Date): string {
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

function dedupKey(requestNumber: string, type: ReminderType, windowDate: Date): string {
  return `${requestNumber}:${type}:${fmtDate(windowDate)}`;
}

// ── Main service function ─────────────────────────────────────────────────────

/**
 * Evaluates all open TaktRequests against their deadlines.
 * Call this from LocalDeadlineWorker or the internal /run endpoint.
 *
 * @param now    Injected clock — use new Date() in production, fixed value in tests.
 * @param config Deadline configuration (offsets, grace period, etc.)
 */
export async function evaluateTaktRequestDeadlines(
  now: Date,
  config: DeadlineConfig,
): Promise<DeadlineEvaluationResult> {
  const startedAt = new Date(now.getTime());
  const result: Omit<DeadlineEvaluationResult, "startedAt" | "finishedAt"> = {
    checkedRequests:   0,
    expiredRequests:   0,
    createdReminders:  0,
    sentReminders:     0,
    cancelledReminders: 0,
    failedRequests:    0,
    errors:            [],
  };

  // Load all open requests that are potentially due for action.
  // "Open" = not in a terminal or already-answered status.
  const openRequests = await db
    .select({
      id:                  taktRequestsTable.id,
      taktId:              taktRequestsTable.taktId,
      guOrgId:             taktRequestsTable.guOrgId,
      nuOrgId:             taktRequestsTable.nuOrgId,
      requestNumber:       taktRequestsTable.requestNumber,
      status:              taktRequestsTable.status,
      responseRequiredBy:  taktRequestsTable.responseRequiredBy,
      expiresAt:           taktRequestsTable.expiresAt,
      guDecisionRequiredBy:taktRequestsTable.guDecisionRequiredBy,
      reminderCount:       taktRequestsTable.reminderCount,
    })
    .from(taktRequestsTable)
    .where(
      inArray(taktRequestsTable.status, REMINDER_ELIGIBLE as unknown as [TaktRequestStatus, ...TaktRequestStatus[]]),
    );

  result.checkedRequests = openRequests.length;

  for (const req of openRequests) {
    try {
      // ── Check for parallel response ─────────────────────────────────────────
      const [existingResponse] = await db
        .select({ id: taktResponsesTable.id })
        .from(taktResponsesTable)
        .where(eq(taktResponsesTable.taktRequestId, req.id))
        .limit(1);

      if (existingResponse) {
        // Request already answered — cancel any pending reminders and skip
        const cancelled = await cancelPendingReminders(req.id);
        result.cancelledReminders += cancelled;
        continue;
      }

      // ── Expiry check ────────────────────────────────────────────────────────
      const status = req.status as TaktRequestStatus;
      const isAutoExpirable = (AUTO_EXPIRABLE as string[]).includes(status);

      if (
        isAutoExpirable &&
        req.expiresAt &&
        now >= req.expiresAt
      ) {
        const expired = await expireRequest(req, now);
        if (expired) {
          result.expiredRequests++;
          result.cancelledReminders += await cancelPendingReminders(req.id);
          continue; // expired — no further reminder processing
        }
      }

      // ── Reminder evaluation ─────────────────────────────────────────────────
      if (req.responseRequiredBy) {
        const due = req.responseRequiredBy;
        const created = await evaluateNuReminders(req, due, now, config);
        result.createdReminders += created.created;
        result.sentReminders    += created.sent;
      }

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error({ requestId: req.id, error: msg }, "Error evaluating request deadline");
      result.failedRequests++;
      result.errors.push({ requestId: req.id, error: msg });
    }
  }

  // ── Phase 2: GU decision reminders for ACCEPTED / ALTERNATIVES_PROPOSED ────
  // These are requests where the NU has already responded and the GU must decide.
  const guDecisionRequests = await db
    .select({
      id:                  taktRequestsTable.id,
      taktId:              taktRequestsTable.taktId,
      guOrgId:             taktRequestsTable.guOrgId,
      nuOrgId:             taktRequestsTable.nuOrgId,
      requestNumber:       taktRequestsTable.requestNumber,
      status:              taktRequestsTable.status,
      guDecisionRequiredBy:taktRequestsTable.guDecisionRequiredBy,
    })
    .from(taktRequestsTable)
    .where(
      inArray(taktRequestsTable.status, GU_DECISION_ELIGIBLE as unknown as [TaktRequestStatus, ...TaktRequestStatus[]]),
    );

  for (const req of guDecisionRequests) {
    if (!req.guDecisionRequiredBy) continue;
    try {
      const guDue = req.guDecisionRequiredBy;
      const created = await evaluateGuReminders(req, guDue, now, config);
      result.createdReminders += created.created;
      result.sentReminders    += created.sent;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error({ requestId: req.id, error: msg }, "Error evaluating GU decision deadline");
      result.failedRequests++;
      result.errors.push({ requestId: req.id, error: msg });
    }
  }

  return {
    startedAt,
    finishedAt: new Date(),
    ...result,
  };
}

// ── Expiry logic (Task 7.4) ───────────────────────────────────────────────────

async function expireRequest(
  req: {
    id: string;
    taktId: string;
    guOrgId: string;
    nuOrgId: string;
    requestNumber: string;
    status: string;
    expiresAt: Date | null;
  },
  now: Date,
): Promise<boolean> {
  // ── Phase 1: DB updates in a single transaction ───────────────────────────
  // transport.send() is called AFTER the transaction commits so it can read
  // the outbox rows that the transaction wrote (no nested-connection issues).

  let projectReference: string | null = null;
  const msgIdGu = `expired-gu-${req.id}`;
  const msgIdNu = `expired-nu-${req.id}`;

  const committed = await db.transaction(async (tx) => {
    // Re-read current status to guard against concurrent updates
    const [fresh] = await tx
      .select({ status: taktRequestsTable.status })
      .from(taktRequestsTable)
      .where(eq(taktRequestsTable.id, req.id))
      .limit(1);

    if (!fresh) return false;

    const currentStatus = fresh.status as TaktRequestStatus;

    // Status may have changed (e.g. NU responded concurrently)
    if (!(AUTO_EXPIRABLE as string[]).includes(currentStatus)) {
      logger.info({ requestId: req.id, status: currentStatus }, "Request no longer expirable — skipping");
      return false;
    }

    // Check for concurrent NU response
    const [raceResponse] = await tx
      .select({ id: taktResponsesTable.id })
      .from(taktResponsesTable)
      .where(eq(taktResponsesTable.taktRequestId, req.id))
      .limit(1);

    if (raceResponse) {
      logger.info({ requestId: req.id }, "Concurrent NU response found — not expiring");
      return false;
    }

    // Validate transition
    try {
      assertValidTaktRequestTransition(currentStatus, "EXPIRED");
    } catch {
      logger.warn({ requestId: req.id, from: currentStatus }, "Invalid transition to EXPIRED");
      return false;
    }

    // Expire the request
    await tx
      .update(taktRequestsTable)
      .set({ status: "EXPIRED", expiredAt: now, updatedAt: now })
      .where(and(
        eq(taktRequestsTable.id, req.id),
        eq(taktRequestsTable.status, currentStatus), // optimistic guard
      ));

    logger.info({ requestId: req.id }, "TaktRequest set to EXPIRED");

    // Revert takt lifecycle if no other open requests remain
    await revertTaktIfNoOpenRequests(req.taktId, req.id, tx);

    // Load project reference for payload
    const taktRow = await tx
      .select({ projectId: takteTable.projectId })
      .from(takteTable)
      .where(eq(takteTable.id, req.taktId))
      .limit(1);
    projectReference = taktRow[0]?.projectId ?? null;

    const expiredPayload = {
      taktRequestId:    req.id,
      requestNumber:    req.requestNumber,
      expiredAt:        now.toISOString(),
      projectReference,
      taktReference:    req.taktId,
    };

    // Write outbox rows (idempotent via messageId UNIQUE)
    for (const [recipientOrgId, msgId] of [
      [req.guOrgId, msgIdGu],
      [req.nuOrgId, msgIdNu],
    ] as [string, string][]) {
      await tx.insert(messageOutboxTable).values({
        messageId:      msgId,
        schemaVersion:  "1.0",
        messageType:    "TAKT_REQUEST_EXPIRED",
        senderOrgId:    req.guOrgId,
        recipientOrgId,
        correlationId:  req.id,
        payload:        expiredPayload,
      }).onConflictDoNothing();
    }

    return true;
  });

  if (!committed) return false;

  // ── Phase 2: dispatch via transport (after transaction commits) ───────────
  // Best-effort — failures are logged; the outbox rows remain for retry.
  const expiredPayload = {
    taktRequestId:    req.id,
    requestNumber:    req.requestNumber,
    expiredAt:        now.toISOString(),
    projectReference,
    taktReference:    req.taktId,
  };

  for (const [recipientOrgId, msgId] of [
    [req.guOrgId, msgIdGu],
    [req.nuOrgId, msgIdNu],
  ] as [string, string][]) {
    try {
      await transport.send({
        messageId:      msgId,
        schemaVersion:  "1.0",
        messageType:    "TAKT_REQUEST_EXPIRED",
        senderOrgId:    req.guOrgId,
        recipientOrgId,
        correlationId:  req.id,
        createdAt:      now,
        payload:        expiredPayload,
      });
    } catch (err) {
      logger.warn({ requestId: req.id, recipientOrgId, err }, "TAKT_REQUEST_EXPIRED delivery failed (will retry)");
    }
  }

  return true;
}

async function revertTaktIfNoOpenRequests(
  taktId: string,
  expiredRequestId: string,
  tx: DbTx,
): Promise<void> {
  const openStatuses: [TaktRequestStatus, ...TaktRequestStatus[]] = [
    "SENT", "DELIVERED", "DETAILS_RETRIEVED", "UNDER_REVIEW",
    "ALTERNATIVES_PROPOSED", "REJECTED", "REVISION_REQUIRED",
  ];

  const [stillOpen] = await tx
    .select({ id: taktRequestsTable.id })
    .from(taktRequestsTable)
    .where(
      and(
        eq(taktRequestsTable.taktId, taktId),
        inArray(taktRequestsTable.status, openStatuses),
        not(eq(taktRequestsTable.id, expiredRequestId)),
      ),
    )
    .limit(1);

  if (!stillOpen) {
    // Safe to revert to PLANNED — only if currently IN_COORDINATION (not CONFIRMED)
    await tx
      .update(takteTable)
      .set({ lifecycleStatus: "PLANNED" })
      .where(
        and(
          eq(takteTable.id, taktId),
          eq(takteTable.lifecycleStatus, "IN_COORDINATION"),
        ),
      );
    logger.info({ taktId }, "Takt reverted to PLANNED after last open request expired");
  }
}

// ── NU reminder evaluation (Task 7.5) ────────────────────────────────────────

async function evaluateNuReminders(
  req: {
    id: string;
    guOrgId: string;
    nuOrgId: string;
    requestNumber: string;
    status: string;
    taktId: string;
  },
  due: Date,
  now: Date,
  config: DeadlineConfig,
): Promise<{ created: number; sent: number }> {
  let created = 0;
  let sent    = 0;

  const checks: Array<{ type: ReminderType; windowDate: Date; condition: boolean }> = [
    {
      type:       "RESPONSE_DUE_SOON",
      windowDate: due,
      condition:  now >= addHours(due, -config.firstReminderHoursBeforeDue) && now < due,
    },
    {
      type:       "RESPONSE_DUE_TODAY",
      windowDate: due,
      condition:  now >= addHours(due, -config.secondReminderHoursBeforeDue) && now < due,
    },
    {
      type:       "RESPONSE_OVERDUE",
      windowDate: due,
      condition:  now >= addHours(due, config.overdueReminderHoursAfterDue),
    },
  ];

  for (const { type, windowDate, condition } of checks) {
    if (!condition) continue;
    const key = dedupKey(req.requestNumber, type, windowDate);

    const r = await upsertReminder({
      taktRequestId:   req.id,
      reminderType:    type,
      recipientOrgId:  req.nuOrgId,
      scheduledFor:    now,
      deduplicationKey: key,
      taktId:          req.taktId,
      requestNumber:   req.requestNumber,
      dueAt:           due,
      correlationId:   req.id,
      guOrgId:         req.guOrgId,
    });
    if (r === "created") created++;
    if (r === "sent")    sent++;
  }

  return { created, sent };
}

async function evaluateGuReminders(
  req: {
    id: string;
    guOrgId: string;
    nuOrgId: string;
    requestNumber: string;
    taktId: string;
  },
  guDue: Date,
  now: Date,
  config: DeadlineConfig,
): Promise<{ created: number; sent: number }> {
  let created = 0;
  let sent    = 0;

  const checks: Array<{ type: ReminderType; condition: boolean }> = [
    {
      type:      "GU_DECISION_DUE_SOON",
      condition: now >= addHours(guDue, -config.guDecisionReminderHours) && now < guDue,
    },
    {
      type:      "GU_DECISION_OVERDUE",
      condition: now >= guDue,
    },
  ];

  for (const { type, condition } of checks) {
    if (!condition) continue;
    const key = dedupKey(req.requestNumber, type, guDue);

    const r = await upsertReminder({
      taktRequestId:   req.id,
      reminderType:    type,
      recipientOrgId:  req.guOrgId,
      scheduledFor:    now,
      deduplicationKey: key,
      taktId:          req.taktId,
      requestNumber:   req.requestNumber,
      dueAt:           guDue,
      correlationId:   req.id,
      guOrgId:         req.guOrgId,
    });
    if (r === "created") created++;
    if (r === "sent")    sent++;
  }

  return { created, sent };
}

// ── Reminder upsert + dispatch ────────────────────────────────────────────────

type UpsertResult = "exists" | "created" | "sent";

async function upsertReminder(opts: {
  taktRequestId:   string;
  reminderType:    ReminderType;
  recipientOrgId:  string;
  scheduledFor:    Date;
  deduplicationKey: string;
  taktId:          string;
  requestNumber:   string;
  dueAt:           Date;
  correlationId:   string;
  guOrgId:         string;
}): Promise<UpsertResult> {
  const {
    taktRequestId, reminderType, recipientOrgId, scheduledFor,
    deduplicationKey, requestNumber, dueAt, correlationId, guOrgId,
  } = opts;

  // Check idempotency — if reminder already exists (any status), skip
  const [existing] = await db
    .select({ id: taktRequestRemindersTable.id, status: taktRequestRemindersTable.status })
    .from(taktRequestRemindersTable)
    .where(
      and(
        eq(taktRequestRemindersTable.taktRequestId, taktRequestId),
        eq(taktRequestRemindersTable.reminderType, reminderType),
        eq(taktRequestRemindersTable.deduplicationKey, deduplicationKey),
      ),
    )
    .limit(1);

  if (existing) return "exists";

  // Create the reminder row (PENDING)
  const reminderId = crypto.randomUUID();
  const messageId  = `reminder-${reminderId}`;

  await db.insert(taktRequestRemindersTable).values({
    id:               reminderId,
    taktRequestId,
    reminderType,
    recipientOrgId,
    scheduledFor,
    deduplicationKey,
    messageId,
    status:           "PENDING",
  }).onConflictDoNothing();

  logger.info({ taktRequestId, reminderType, deduplicationKey }, "Created reminder");

  // Build reminder payload (no sensitive data)
  const payload = {
    taktRequestId,
    requestNumber,
    reminderType,
    dueAt:           dueAt.toISOString(),
    taktReference:   opts.taktId,
    deepLink:        `/takt-requests/${taktRequestId}`,
  };

  // Dispatch via transport — capture the result to set the correct reminder status.
  // transport.send() may EITHER throw on a hard error OR return { status: "FAILED" }
  // for a soft delivery failure. Both paths must mark the reminder FAILED and must
  // NOT increment reminderCount.
  let transportResult: import("../lib/transport/message-transport").TransportResult;
  try {
    transportResult = await transport.send({
      messageId,
      schemaVersion:  "1.0",
      messageType:    "TAKT_REQUEST_REMINDER",
      senderOrgId:    guOrgId,
      recipientOrgId,
      correlationId,
      createdAt:      scheduledFor,
      payload,
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    await db
      .update(taktRequestRemindersTable)
      .set({ status: "FAILED", failureReason: reason, attemptCount: 1 })
      .where(eq(taktRequestRemindersTable.id, reminderId));
    logger.warn({ taktRequestId, reminderType, reason }, "Reminder dispatch threw — marked FAILED");
    return "created"; // created but not sent
  }

  // transport.send() returned normally — branch on the reported status
  if (transportResult.status === "FAILED") {
    // Soft delivery failure: send() returned FAILED without throwing
    const reason = transportResult.error?.message ?? "Transport returned FAILED status";
    await db
      .update(taktRequestRemindersTable)
      .set({ status: "FAILED", failureReason: reason, attemptCount: 1 })
      .where(eq(taktRequestRemindersTable.id, reminderId));
    logger.warn({ taktRequestId, reminderType, reason }, "Reminder transport returned FAILED — marked FAILED");
    return "created"; // created but not sent; reminderCount unchanged
  }

  // Successful delivery: DELIVERED or SENT
  const reminderStatus =
    transportResult.status === "DELIVERED" ? ("DELIVERED" as const) : ("SENT" as const);

  await db
    .update(taktRequestRemindersTable)
    .set({ status: reminderStatus, sentAt: new Date(), attemptCount: 1 })
    .where(eq(taktRequestRemindersTable.id, reminderId));

  // Increment reminderCount only on successful delivery
  await db
    .update(taktRequestsTable)
    .set({
      lastReminderAt: new Date(),
      reminderCount:  sql`${taktRequestsTable.reminderCount} + 1`,
    })
    .where(eq(taktRequestsTable.id, taktRequestId));

  logger.info({ taktRequestId, reminderType, transportStatus: transportResult.status }, "Reminder sent");

  // Write REMINDER_SENT audit event (best-effort — must not break the reminder flow)
  await writeAuditEvent({
    requestId: taktRequestId,
    eventType: "REMINDER_SENT",
    actorRole: "SYSTEM",
    metadata: { reminderType, transportStatus: transportResult.status, messageId },
  });

  return "sent";
}

// ── Cancel stale pending reminders ───────────────────────────────────────────

async function cancelPendingReminders(taktRequestId: string): Promise<number> {
  const result = await db
    .update(taktRequestRemindersTable)
    .set({ status: "CANCELLED", updatedAt: new Date() })
    .where(
      and(
        eq(taktRequestRemindersTable.taktRequestId, taktRequestId),
        eq(taktRequestRemindersTable.status, "PENDING"),
      ),
    )
    .returning({ id: taktRequestRemindersTable.id });

  return result.length;
}
