/**
 * TaktRequest audit event log.
 *
 * Records every significant data-exchange event in the coordination lifecycle
 * of a TaktRequest. Each event is append-only — no updates, no deletes.
 *
 * Design intent:
 *   - Provides a queryable, structured audit trail beyond the timestamps stored
 *     directly on takt_requests (sentAt, deliveredAt, detailsRetrievedAt, …).
 *   - Will be queried by the reporting API (Task #86) and surfaced in the Hub
 *     coordination timeline.
 *   - EDC-readiness: when the transport layer is replaced with an Eclipse
 *     Dataspace Connector, each data-push operation will still write an audit
 *     event here so the coordination history remains transport-agnostic.
 *
 * Event types:
 *   NOTIFICATION_SENT        — GU sent the TaktRequest notification to the NU.
 *   NOTIFICATION_DELIVERED   — Transport confirmed delivery to the NU's inbox.
 *   DETAILS_RETRIEVED        — NU pulled the released Takt snapshot.
 *   AVAILABILITY_CHECK_DONE  — NU completed a local availability check.
 *   RESPONSE_SUBMITTED       — NU submitted a business response (ACCEPTED / …).
 *   RESPONSE_DELIVERED       — Transport confirmed delivery of the response to GU.
 *   GU_DECISION_MADE         — GU accepted or requested revision after NU response.
 *   REVISION_CREATED         — GU issued a revised TaktRequest superseding this one.
 *   REQUEST_EXPIRED          — Request transitioned to EXPIRED (no response in time).
 *   REQUEST_CANCELLED        — GU cancelled the request before a response.
 */
import {
  pgTable,
  pgEnum,
  text,
  timestamp,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { taktRequestsTable } from "./takt-requests";
import { organizationsTable } from "./organizations";
import { usersTable } from "./users";

export const taktAuditEventTypeEnum = pgEnum("takt_audit_event_type", [
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
]);

export const taktAuditActorRoleEnum = pgEnum("takt_audit_actor_role", [
  "GU",
  "NU",
  "HUB",
  "SYSTEM",
]);

/**
 * Append-only log of all coordination data-exchange events for a TaktRequest.
 *
 * - One row per event. Never updated.
 * - `actorOrgId` / `actorUserId` are nullable for system-generated events
 *   (e.g. REQUEST_EXPIRED emitted by the deadline worker).
 * - `metadata` holds event-specific context (e.g. decision type, schema version,
 *   transport messageId) without repeating full payloads.
 */
export const taktRequestAuditEventsTable = pgTable(
  "takt_request_audit_events",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),

    /** The TaktRequest this event belongs to */
    requestId: text("request_id")
      .notNull()
      .references(() => taktRequestsTable.id, { onDelete: "cascade" }),

    /** What happened */
    eventType: taktAuditEventTypeEnum("event_type").notNull(),

    /** Organisation that triggered the event; null for SYSTEM events */
    actorOrgId: text("actor_org_id").references(() => organizationsTable.id),

    /** User that triggered the event; null for automated/system events */
    actorUserId: text("actor_user_id").references(() => usersTable.id),

    /** Caller's role at the time of the event */
    actorRole: taktAuditActorRoleEnum("actor_role"),

    /**
     * Event-specific context. Examples:
     *   DETAILS_RETRIEVED:   { firstAccess: true, requestStatus: "DELIVERED" }
     *   RESPONSE_SUBMITTED:  { decision: "ACCEPTED", reasonCode: null }
     *   GU_DECISION_MADE:    { decisionType: "ACCEPT", acceptedAlternativeId: null }
     *   NOTIFICATION_SENT:   { transportMessageId: "taktrequest-notification-..." }
     */
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),

    /** When the event occurred (server clock) */
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("takt_audit_request_id_idx").on(t.requestId),
    index("takt_audit_event_type_idx").on(t.eventType),
    index("takt_audit_occurred_at_idx").on(t.occurredAt),
    index("takt_audit_actor_org_id_idx").on(t.actorOrgId),
    // Primary query pattern: all events for one request in time order
    index("takt_audit_request_occurred_at_idx").on(t.requestId, t.occurredAt),
  ],
);

export type TaktAuditEventType =
  typeof taktAuditEventTypeEnum.enumValues[number];
export type TaktAuditActorRole =
  typeof taktAuditActorRoleEnum.enumValues[number];
export type TaktRequestAuditEvent =
  typeof taktRequestAuditEventsTable.$inferSelect;
export type InsertTaktRequestAuditEvent =
  typeof taktRequestAuditEventsTable.$inferInsert;
