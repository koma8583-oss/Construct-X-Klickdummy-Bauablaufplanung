/**
 * Reminder tracking tables for deadline monitoring (Task 7.2).
 *
 * Architecture decisions:
 *   - Reminders are write-once per business event: sent reminders are preserved
 *     historically. Stale pending reminders are CANCELLED, never deleted.
 *   - deduplicationKey prevents double reminders across worker restarts.
 *     Format: "<requestNumber>:<reminderType>:<YYYY-MM-DD>"
 *   - messageId is set once on dispatch and reused for retries — no new message
 *     is created for a retry, only the status/attemptCount are updated.
 *   - No FK from reminders to message_outbox — loose coupling matches the
 *     existing outbox/inbox architecture.
 */
import {
  pgTable,
  pgEnum,
  text,
  integer,
  timestamp,
  index,
  unique,
} from "drizzle-orm/pg-core";
import { taktRequestsTable } from "./takt-requests";
import { organizationsTable } from "./organizations";
import { usersTable } from "./users";

// ── Enums ─────────────────────────────────────────────────────────────────────

/**
 * The business type of a reminder.
 * Each type corresponds to a distinct point in the deadline lifecycle.
 */
export const reminderTypeEnum = pgEnum("reminder_type", [
  /** First reminder, sent firstReminderHoursBeforeDue before responseRequiredBy */
  "RESPONSE_DUE_SOON",
  /** Second reminder, sent secondReminderHoursBeforeDue before responseRequiredBy */
  "RESPONSE_DUE_TODAY",
  /** Reminder sent overdueReminderHoursAfterDue after responseRequiredBy (still in grace) */
  "RESPONSE_OVERDUE",
  /** Reminder to GU that their decision is due soon */
  "GU_DECISION_DUE_SOON",
  /** Reminder to GU that their decision deadline has passed */
  "GU_DECISION_OVERDUE",
  /** Technical delivery failure notification to GU */
  "DELIVERY_FAILED",
]);

/**
 * Delivery lifecycle of a single reminder record.
 *
 * Valid progressions:
 *   PENDING → SENT → DELIVERED
 *   PENDING → FAILED  (retry possible: FAILED → SENT → DELIVERED)
 *   PENDING → CANCELLED  (no longer needed, e.g. request answered)
 *   SENT    → FAILED
 */
export const reminderStatusEnum = pgEnum("reminder_status", [
  "PENDING",
  "SENT",
  "DELIVERED",
  "FAILED",
  "CANCELLED",
]);

// ── takt_request_reminders ────────────────────────────────────────────────────

/**
 * Persistent history of every business reminder associated with a TaktRequest.
 *
 * One row per (request, reminderType, deduplicationKey) — enforced by UNIQUE.
 * Sent reminders are never overwritten; their status field tracks delivery.
 */
export const taktRequestRemindersTable = pgTable(
  "takt_request_reminders",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),

    /** The request this reminder belongs to */
    taktRequestId: text("takt_request_id")
      .notNull()
      .references(() => taktRequestsTable.id, { onDelete: "cascade" }),

    /** What kind of business reminder this is */
    reminderType: reminderTypeEnum("reminder_type").notNull(),

    /**
     * Organisation that should receive this reminder.
     * NU-type reminders go to nuOrgId; GU-type reminders go to guOrgId.
     */
    recipientOrgId: text("recipient_org_id")
      .notNull()
      .references(() => organizationsTable.id),

    /**
     * Optional specific user. Null = whole organisation.
     * Used when the system has enough context to address a named dispatcher.
     */
    recipientUserId: text("recipient_user_id").references(() => usersTable.id),

    /**
     * The point in time for which this reminder was calculated.
     * Used to window idempotency: one reminder per type per due-date.
     */
    scheduledFor: timestamp("scheduled_for", { withTimezone: true }).notNull(),

    status: reminderStatusEnum("status").notNull().default("PENDING"),

    /**
     * Business deduplication key — prevents double reminders across restarts.
     * Format: "<requestNumber>:<reminderType>:<YYYY-MM-DD UTC>"
     * Example: "TKR-2026-0042:RESPONSE_DUE_SOON:2026-08-07"
     */
    deduplicationKey: text("deduplication_key").notNull(),

    /**
     * messageId of the outbox row written when the reminder was dispatched.
     * Null until first dispatch attempt. Reused for retries (no new message).
     * Unique constraint ensures each reminder maps to at most one outbox entry.
     */
    messageId: text("message_id").unique(),

    /** Number of dispatch attempts (including retries). */
    attemptCount: integer("attempt_count").notNull().default(0),

    /** Timestamp of the last successful dispatch attempt */
    sentAt: timestamp("sent_at", { withTimezone: true }),

    /** Timestamp when the recipient's inbox row was created */
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),

    /** Human-readable reason from the last failed attempt */
    failureReason: text("failure_reason"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    // ── Uniqueness: one reminder per (request, type, deduplication window) ──
    unique("uq_reminder_dedup").on(t.taktRequestId, t.reminderType, t.deduplicationKey),

    // ── Single-column indexes ─────────────────────────────────────────────────
    index("reminders_takt_request_id_idx").on(t.taktRequestId),
    index("reminders_recipient_org_id_idx").on(t.recipientOrgId),
    index("reminders_reminder_type_idx").on(t.reminderType),
    index("reminders_status_idx").on(t.status),
    index("reminders_scheduled_for_idx").on(t.scheduledFor),
    index("reminders_created_at_idx").on(t.createdAt),

    // ── Combined indexes for scheduler queries ────────────────────────────────
    index("reminders_status_scheduled_for_idx").on(t.status, t.scheduledFor),
    index("reminders_recipient_status_idx").on(t.recipientOrgId, t.status),
    index("reminders_request_status_idx").on(t.taktRequestId, t.status),
  ],
);

// ── Types ─────────────────────────────────────────────────────────────────────

export type ReminderType   = typeof reminderTypeEnum.enumValues[number];
export type ReminderStatus = typeof reminderStatusEnum.enumValues[number];
export type TaktRequestReminder       = typeof taktRequestRemindersTable.$inferSelect;
export type InsertTaktRequestReminder = typeof taktRequestRemindersTable.$inferInsert;
