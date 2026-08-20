/**
 * Reminder tracking tables for deadline monitoring.
 *
 * Canonical rename of takt_request_reminders (Task #196).
 *
 * Architecture decisions:
 *   - Reminders are write-once per business event.
 *   - deduplicationKey prevents double reminders across worker restarts.
 *   - messageId is set once on dispatch and reused for retries.
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
import { leistungsanfragenTable } from "./leistungsanfragen";
import { organizationsTable } from "./organizations";
import { usersTable } from "./users";

// ── Enums ─────────────────────────────────────────────────────────────────────

/**
 * The business type of a reminder.
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
 */
export const reminderStatusEnum = pgEnum("reminder_status", [
  "PENDING",
  "SENT",
  "DELIVERED",
  "FAILED",
  "CANCELLED",
]);

// ── leistungsanfrage_reminders ────────────────────────────────────────────────

/**
 * Persistent history of every business reminder associated with a Leistungsanfrage.
 */
export const leistungsanfrageRemindersTable = pgTable(
  "leistungsanfrage_reminders",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),

    /** The request this reminder belongs to */
    leistungsanfrageId: text("leistungsanfrage_id")
      .notNull()
      .references(() => leistungsanfragenTable.id, { onDelete: "cascade" }),

    /** What kind of business reminder this is */
    reminderType: reminderTypeEnum("reminder_type").notNull(),

    /**
     * Organisation that should receive this reminder.
     */
    recipientOrgId: text("recipient_org_id")
      .notNull()
      .references(() => organizationsTable.id),

    /**
     * Optional specific user. Null = whole organisation.
     */
    recipientUserId: text("recipient_user_id").references(() => usersTable.id),

    /**
     * The point in time for which this reminder was calculated.
     */
    scheduledFor: timestamp("scheduled_for", { withTimezone: true }).notNull(),

    status: reminderStatusEnum("status").notNull().default("PENDING"),

    /**
     * Business deduplication key — prevents double reminders across restarts.
     */
    deduplicationKey: text("deduplication_key").notNull(),

    /**
     * messageId of the outbox row written when the reminder was dispatched.
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
    unique("uq_leistungsanfrage_reminder_dedup").on(t.leistungsanfrageId, t.reminderType, t.deduplicationKey),

    // ── Single-column indexes ─────────────────────────────────────────────────
    index("leistungsanfrage_reminders_anfrage_id_idx").on(t.leistungsanfrageId),
    index("reminders_recipient_org_id_idx").on(t.recipientOrgId),
    index("reminders_reminder_type_idx").on(t.reminderType),
    index("reminders_status_idx").on(t.status),
    index("reminders_scheduled_for_idx").on(t.scheduledFor),
    index("reminders_created_at_idx").on(t.createdAt),

    // ── Combined indexes for scheduler queries ────────────────────────────────
    index("reminders_status_scheduled_for_idx").on(t.status, t.scheduledFor),
    index("reminders_recipient_status_idx").on(t.recipientOrgId, t.status),
    index("reminders_request_status_idx").on(t.leistungsanfrageId, t.status),
  ],
);

// ── Types ─────────────────────────────────────────────────────────────────────

export type ReminderType   = typeof reminderTypeEnum.enumValues[number];
export type ReminderStatus = typeof reminderStatusEnum.enumValues[number];
export type LeistungsanfrageReminder       = typeof leistungsanfrageRemindersTable.$inferSelect;
export type InsertLeistungsanfrageReminder = typeof leistungsanfrageRemindersTable.$inferInsert;

// ── No deprecated table/type aliases here — they live in legacy-takt-adapters.ts
