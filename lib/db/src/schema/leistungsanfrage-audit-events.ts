/**
 * Leistungsanfrage audit event log.
 *
 * Canonical rename of takt_request_audit_events (Task #196).
 *
 * Records every significant data-exchange event in the coordination lifecycle
 * of a Leistungsanfrage. Each event is append-only — no updates, no deletes.
 */
import {
  pgTable,
  pgEnum,
  text,
  timestamp,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { leistungsanfragenTable } from "./leistungsanfragen";
import { organizationsTable } from "./organizations";
import { usersTable } from "./users";

export const leistungsanfrageAuditEventTypeEnum = pgEnum("takt_audit_event_type", [
  "NOTIFICATION_SENT",
  "NOTIFICATION_DELIVERED",
  "DETAILS_RETRIEVED",
  "AVAILABILITY_CHECK_DONE",
  "RESPONSE_SUBMITTED",
  "RESPONSE_DELIVERED",
  "GU_DECISION_MADE",
  "REVISION_CREATED",
  "REQUEST_EXPIRED",
  "REQUEST_CANCELLED",
  // Added in Task #105 — PoC spec required event types
  "REQUEST_CREATED",
  "SNAPSHOT_CREATED",
  "REMINDER_SENT",
  // Added in Task #112 — Dataspace publication audit events
  "DATA_PUBLICATION_CREATED",
  "DATA_PUBLICATION_PUBLISHED",
  "DATA_OFFER_SENT",
  "DATA_POLICY_ACCEPTED",
  "DATA_POLICY_REJECTED",
  "DATA_CONTENT_ACCESSED",
  "DATA_PUBLICATION_SUSPENDED",
  "DATA_PUBLICATION_WITHDRAWN",
  "DATA_PUBLICATION_EXPIRED",
]);

export const leistungsanfrageAuditActorRoleEnum = pgEnum("takt_audit_actor_role", [
  "GU",
  "NU",
  "HUB",
  "SYSTEM",
]);

/**
 * Append-only log of all coordination data-exchange events for a Leistungsanfrage.
 *
 * - One row per event. Never updated.
 * - `actorOrgId` / `actorUserId` are nullable for system-generated events.
 */
export const leistungsanfrageAuditEventsTable = pgTable(
  "leistungsanfrage_audit_events",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),

    /** The Leistungsanfrage this event belongs to */
    requestId: text("request_id")
      .notNull()
      .references(() => leistungsanfragenTable.id, { onDelete: "cascade" }),

    /** What happened */
    eventType: leistungsanfrageAuditEventTypeEnum("event_type").notNull(),

    /** Organisation that triggered the event; null for SYSTEM events */
    actorOrgId: text("actor_org_id").references(() => organizationsTable.id),

    /** User that triggered the event; null for automated/system events */
    actorUserId: text("actor_user_id").references(() => usersTable.id),

    /** Caller's role at the time of the event */
    actorRole: leistungsanfrageAuditActorRoleEnum("actor_role"),

    /**
     * Event-specific context.
     */
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),

    /** When the event occurred (server clock) */
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("leistungsanfrage_audit_request_id_idx").on(t.requestId),
    index("leistungsanfrage_audit_event_type_idx").on(t.eventType),
    index("leistungsanfrage_audit_occurred_at_idx").on(t.occurredAt),
    index("leistungsanfrage_audit_actor_org_id_idx").on(t.actorOrgId),
    // Primary query pattern: all events for one request in time order
    index("leistungsanfrage_audit_request_occurred_at_idx").on(t.requestId, t.occurredAt),
  ],
);

export type LeistungsanfrageAuditEventType =
  typeof leistungsanfrageAuditEventTypeEnum.enumValues[number];
export type LeistungsanfrageAuditActorRole =
  typeof leistungsanfrageAuditActorRoleEnum.enumValues[number];
export type LeistungsanfrageAuditEvent =
  typeof leistungsanfrageAuditEventsTable.$inferSelect;
export type InsertLeistungsanfrageAuditEvent =
  typeof leistungsanfrageAuditEventsTable.$inferInsert;

// ── Enum aliases only — table/type aliases live in legacy-takt-adapters.ts ───
/** @deprecated Use leistungsanfrageAuditEventTypeEnum */
export const taktAuditEventTypeEnum = leistungsanfrageAuditEventTypeEnum;
/** @deprecated Use leistungsanfrageAuditActorRoleEnum */
export const taktAuditActorRoleEnum = leistungsanfrageAuditActorRoleEnum;
