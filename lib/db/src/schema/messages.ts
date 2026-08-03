/**
 * Message Outbox and Inbox tables (Task 3.2).
 *
 * These tables implement the transactional outbox pattern for the simulated
 * TaktKoord Dataspace transport layer.
 *
 * Architecture decisions:
 *   - Payloads use JSONB (not JSON) so individual fields are indexable.
 *   - correlationId ties a message thread together (e.g. all messages for one
 *     TaktRequest share the same correlationId = taktRequestId).
 *   - causationId records which earlier message caused this one (nullable for
 *     the first message in a thread).
 *   - No direct FK from outbox/inbox to takt_requests — loose coupling via
 *     correlationId keeps the transport layer independent of domain tables.
 *   - message_inbox has a composite UNIQUE on (messageId, recipientOrgId) so
 *     the same message can be delivered to multiple recipients exactly once each.
 *   - Default outbox status is PENDING; default inbox status is DELIVERED
 *     (recorded after successful delivery).
 */
import {
  pgTable,
  pgEnum,
  text,
  integer,
  timestamp,
  index,
  unique,
  jsonb,
} from "drizzle-orm/pg-core";
import { organizationsTable } from "./organizations";

// ── Enums ─────────────────────────────────────────────────────────────────────

/**
 * Message types for the federated Takt coordination dataspace.
 * Values mirror DataspaceMessageType in the OpenAPI spec.
 */
export const dataspaceMessageTypeEnum = pgEnum("dataspace_message_type", [
  "TAKT_REQUEST_NOTIFICATION",
  "TAKT_REQUEST_REVISED",
  "TAKT_REQUEST_CANCELLED",
  "TAKT_DETAILS_RETRIEVED",
  "TAKT_RESPONSE_SUBMITTED",
  "TAKT_RESPONSE_ACCEPTED",
  "TAKT_RESPONSE_REVISION_REQUESTED",
  /** Sent to both GU and NU when an open TaktRequest passes its expiresAt (Task 7.4) */
  "TAKT_REQUEST_EXPIRED",
  /** Generic reminder envelope — reminderType in payload distinguishes sub-types (Task 7.5) */
  "TAKT_REQUEST_REMINDER",
]);

/**
 * Technical delivery status of a message envelope.
 * DELIVERED means the message arrived — it is NOT a business confirmation.
 * Business outcomes are expressed in TaktDecision, not here.
 * Values mirror DataspaceMessageStatus in the OpenAPI spec.
 */
export const dataspaceMessageStatusEnum = pgEnum("dataspace_message_status", [
  "PENDING",
  "SENT",
  "DELIVERED",
  "READ",
  "FAILED",
]);

// ── message_outbox ────────────────────────────────────────────────────────────

/**
 * Transactional outbox for outgoing coordination messages.
 *
 * A row is written inside the same DB transaction as the domain change that
 * triggers it. The delivery service reads PENDING rows and dispatches them via
 * the active MessageTransport implementation (LocalHubTransport in PoC).
 *
 * Payload must be minimal — no full Takt plans, resource plans, or NU-internal
 * data. Only references, deadlines, and a detailsUrl.
 */
export const messageOutboxTable = pgTable(
  "message_outbox",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),

    /**
     * Globally unique message ID (e.g. a UUID generated per send attempt).
     * Used for idempotency: the transport layer checks this before inserting
     * an inbox row to avoid duplicate delivery.
     */
    messageId: text("message_id").notNull().unique(),

    /** Schema version of the payload contract (e.g. "1.0") */
    schemaVersion: text("schema_version").notNull().default("1.0"),

    /** Business event type — maps to DataspaceMessageType in OpenAPI */
    messageType: dataspaceMessageTypeEnum("message_type").notNull(),

    /** Organisation that is sending the message */
    senderOrgId: text("sender_org_id")
      .notNull()
      .references(() => organizationsTable.id),

    /** Organisation that should receive the message */
    recipientOrgId: text("recipient_org_id")
      .notNull()
      .references(() => organizationsTable.id),

    /**
     * Groups all messages belonging to the same coordination thread.
     * Typically set to the TaktRequest ID — correlates without a hard FK.
     */
    correlationId: text("correlation_id").notNull(),

    /**
     * ID of the message that caused this message to be created.
     * Null for the first message in a thread (the original notification).
     */
    causationId: text("causation_id"),

    /**
     * JSONB payload. Must be a small notification envelope — no full Takt
     * snapshots, no project plans, no internal cost data.
     */
    payload: jsonb("payload")
      .$type<Record<string, unknown>>()
      .notNull(),

    /** Current delivery status */
    status: dataspaceMessageStatusEnum("status").notNull().default("PENDING"),

    /** Number of delivery attempts made so far */
    attemptCount: integer("attempt_count").notNull().default(0),

    /** Timestamp of the most recent delivery attempt */
    lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),

    /**
     * Earliest time the delivery service should try again.
     * Null means "try immediately on next sweep".
     */
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),

    /** Human-readable failure reason from the last attempt */
    failureReason: text("failure_reason"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),

    /** Set when the transport layer confirms it has dispatched the message */
    sentAt: timestamp("sent_at", { withTimezone: true }),

    /** Set when the recipient confirms receipt (inbox row created) */
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  },
  (t) => [
    // Single-column indexes
    index("msg_outbox_message_id_idx").on(t.messageId),
    index("msg_outbox_correlation_id_idx").on(t.correlationId),
    index("msg_outbox_sender_org_id_idx").on(t.senderOrgId),
    index("msg_outbox_recipient_org_id_idx").on(t.recipientOrgId),
    index("msg_outbox_message_type_idx").on(t.messageType),
    index("msg_outbox_status_idx").on(t.status),
    index("msg_outbox_created_at_idx").on(t.createdAt),
    index("msg_outbox_next_attempt_at_idx").on(t.nextAttemptAt),
    // Combined indexes for the most common query patterns
    index("msg_outbox_recipient_status_idx").on(t.recipientOrgId, t.status),
    index("msg_outbox_sender_status_idx").on(t.senderOrgId, t.status),
    index("msg_outbox_status_next_attempt_idx").on(t.status, t.nextAttemptAt),
    index("msg_outbox_correlation_created_idx").on(t.correlationId, t.createdAt),
  ],
);

// ── message_inbox ─────────────────────────────────────────────────────────────

/**
 * Delivery log on the recipient side.
 *
 * One row is created per (messageId, recipientOrgId) pair when the transport
 * layer confirms delivery. The composite UNIQUE prevents double-delivery of
 * the same message to the same organisation.
 *
 * Multiple organisations can receive the same messageId (broadcast scenarios)
 * — each gets its own inbox row.
 */
export const messageInboxTable = pgTable(
  "message_inbox",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),

    /**
     * References the outbox messageId — loose coupling (plain text, no FK)
     * so the inbox can exist independently of the outbox in federated scenarios.
     */
    messageId: text("message_id").notNull(),

    /** Organisation that received the message */
    recipientOrgId: text("recipient_org_id")
      .notNull()
      .references(() => organizationsTable.id),

    /** Organisation that sent the message */
    senderOrgId: text("sender_org_id")
      .notNull()
      .references(() => organizationsTable.id),

    /** Business event type — mirrors the outbox messageType */
    messageType: dataspaceMessageTypeEnum("message_type").notNull(),

    /** Ties this message to the broader coordination thread */
    correlationId: text("correlation_id").notNull(),

    /**
     * JSONB payload as delivered. May differ slightly from the outbox payload
     * if the transport layer enriches or strips fields on delivery.
     */
    payload: jsonb("payload")
      .$type<Record<string, unknown>>()
      .notNull(),

    /**
     * Delivery status from the recipient's perspective.
     * Default DELIVERED — set when the inbox row is created.
     */
    status: dataspaceMessageStatusEnum("status").notNull().default("DELIVERED"),

    /** When the message was recorded as delivered to this recipient */
    receivedAt: timestamp("received_at", { withTimezone: true })
      .notNull()
      .defaultNow(),

    /** When the recipient's application code read the message */
    readAt: timestamp("read_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // Composite UNIQUE: same message must not be delivered twice to same org
    unique("uq_inbox_message_recipient").on(t.messageId, t.recipientOrgId),
    // Single-column indexes
    index("msg_inbox_message_id_idx").on(t.messageId),
    index("msg_inbox_correlation_id_idx").on(t.correlationId),
    index("msg_inbox_sender_org_id_idx").on(t.senderOrgId),
    index("msg_inbox_recipient_org_id_idx").on(t.recipientOrgId),
    index("msg_inbox_message_type_idx").on(t.messageType),
    index("msg_inbox_status_idx").on(t.status),
    index("msg_inbox_received_at_idx").on(t.receivedAt),
    // Combined indexes
    index("msg_inbox_recipient_status_idx").on(t.recipientOrgId, t.status),
    index("msg_inbox_sender_status_idx").on(t.senderOrgId, t.status),
    index("msg_inbox_correlation_received_idx").on(t.correlationId, t.receivedAt),
  ],
);

// ── Types ─────────────────────────────────────────────────────────────────────

export type DataspaceMessageType =
  typeof dataspaceMessageTypeEnum.enumValues[number];
export type DataspaceMessageStatus =
  typeof dataspaceMessageStatusEnum.enumValues[number];

export type MessageOutbox = typeof messageOutboxTable.$inferSelect;
export type InsertMessageOutbox = typeof messageOutboxTable.$inferInsert;
export type MessageInbox = typeof messageInboxTable.$inferSelect;
export type InsertMessageInbox = typeof messageInboxTable.$inferInsert;
