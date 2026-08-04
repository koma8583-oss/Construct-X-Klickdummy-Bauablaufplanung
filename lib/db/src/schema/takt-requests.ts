/**
 * TaktRequest and TaktRequestSnapshot tables (Task 2.4).
 *
 * These tables are introduced PARALLEL to the existing `delegations` and
 * `delegation_responses` tables. No existing tables are changed or removed.
 *
 * Architecture decision:
 *   - `taktId` uses ON DELETE RESTRICT so a Takt with active requests cannot
 *     be deleted; historical requests are preserved.
 *   - `supersedesRequestId` is a self-referential FK (nullable) that links a
 *     revised request back to the one it replaces.
 *   - Snapshot rows are write-once (no updatedAt, no update functions).
 */
import {
  pgTable,
  text,
  timestamp,
  integer,
  pgEnum,
  index,
  unique,
  jsonb,
} from "drizzle-orm/pg-core";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { takteTable } from "./takte";
import { organizationsTable } from "./organizations";
import { usersTable } from "./users";
import { dataPublicationsTable } from "./data-publications";

export const taktRequestStatusEnum = pgEnum("takt_request_status", [
  "DRAFT",
  "SENT",
  "DELIVERED",
  "DETAILS_RETRIEVED",
  "UNDER_REVIEW",
  "ACCEPTED",
  "ALTERNATIVES_PROPOSED",
  "REJECTED",
  "REVISION_REQUIRED",
  "CANCELLED",
  "EXPIRED",
  "SUPERSEDED",
]);

/** TaktRequests — coordination requests from GU to NU */
export const taktRequestsTable = pgTable(
  "takt_requests",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),

    /** The Takt being coordinated. RESTRICT prevents deleting a Takt with requests. */
    taktId: text("takt_id")
      .notNull()
      .references(() => takteTable.id, { onDelete: "restrict" }),

    /**
     * Version of the Takt at the time this request was created.
     * Immutable after creation — records which snapshot of the Takt was used.
     */
    taktVersion: integer("takt_version").notNull().default(1),

    /** GU organisation that created this request */
    guOrgId: text("gu_org_id")
      .notNull()
      .references(() => organizationsTable.id),

    /** NU organisation addressed by this request */
    nuOrgId: text("nu_org_id")
      .notNull()
      .references(() => organizationsTable.id),

    /**
     * Human-readable unique reference (e.g. "TKR-2026-0042").
     * Unique constraint enforced at DB level.
     */
    requestNumber: text("request_number").notNull().unique(),

    status: taktRequestStatusEnum("status").notNull().default("DRAFT"),

    /** Deadline by which the NU must respond. Nullable for DRAFT requests. */
    responseRequiredBy: timestamp("response_required_by", {
      withTimezone: true,
    }),

    /** Set when the GU sends the notification to the NU */
    sentAt: timestamp("sent_at", { withTimezone: true }),

    /** Set when the notification is confirmed as technically delivered */
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),

    /** Set when the NU pulls the released Takt details */
    detailsRetrievedAt: timestamp("details_retrieved_at", {
      withTimezone: true,
    }),

    /**
     * Self-referential FK to the request this one supersedes.
     * Null for the initial request. Set when a revised request is created.
     */
    supersedesRequestId: text("supersedes_request_id").references(
      (): AnyPgColumn => taktRequestsTable.id,
    ),

    /** User who created this request */
    createdByUserId: text("created_by_user_id")
      .notNull()
      .references(() => usersTable.id),

    /**
     * Optional FK to the data_publications entry whose TAKT_INFORMATION_PACKAGE
     * was shared with the NU before sending this request.
     * Null for legacy requests created before the dataspace feature.
     * After sending, the NU must accept the linked publication's policy before
     * the snapshot details can be retrieved.
     */
    dataPublicationId: text("data_publication_id").references(
      () => dataPublicationsTable.id,
    ),

    /**
     * Absolute expiry timestamp.
     * Computed as responseRequiredBy + expirationGracePeriodHours.
     * After this point a still-open request transitions to EXPIRED.
     * Null for DRAFT requests that have no responseRequiredBy yet.
     */
    expiresAt: timestamp("expires_at", { withTimezone: true }),

    /**
     * Set exactly once when the request transitions to EXPIRED.
     * Must only be set when status = 'EXPIRED'.
     */
    expiredAt: timestamp("expired_at", { withTimezone: true }),

    /**
     * Timestamp of the last business reminder sent for this request.
     * Only counts fachliche Erinnerungen, not technical outbox retries.
     */
    lastReminderAt: timestamp("last_reminder_at", { withTimezone: true }),

    /**
     * Counter of business reminders sent.
     * Starts at 0, incremented each time a reminder row is SENT.
     * Does not count technical outbox retries.
     */
    reminderCount: integer("reminder_count").notNull().default(0),

    /**
     * Deadline by which the GU must decide after a NU response arrives.
     * Optional — only relevant when a NU response is present and not yet decided.
     */
    guDecisionRequiredBy: timestamp("gu_decision_required_by", {
      withTimezone: true,
    }),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index("takt_requests_takt_id_idx").on(t.taktId),
    index("takt_requests_gu_org_id_idx").on(t.guOrgId),
    index("takt_requests_nu_org_id_idx").on(t.nuOrgId),
    index("takt_requests_status_idx").on(t.status),
    index("takt_requests_response_required_by_idx").on(t.responseRequiredBy),
    index("takt_requests_expires_at_idx").on(t.expiresAt),
    index("takt_requests_created_at_idx").on(t.createdAt),
    // Combined indexes for the most common query patterns
    index("takt_requests_nu_org_status_idx").on(t.nuOrgId, t.status),
    index("takt_requests_gu_org_status_idx").on(t.guOrgId, t.status),
    index("takt_requests_takt_version_idx").on(t.taktId, t.taktVersion),
    index("takt_requests_status_expires_at_idx").on(t.status, t.expiresAt),
  ],
);

/**
 * TaktRequestSnapshots — immutable point-in-time copy of released Takt data.
 *
 * Written once when a request is sent. Never updated.
 * The NU pulls this snapshot to see the Takt details released for them.
 * Contains only the data the GU explicitly released — no full project data.
 */
export const taktRequestSnapshotsTable = pgTable(
  "takt_request_snapshots",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),

    /**
     * FK to takt_requests. Unique constraint = exactly one snapshot per request.
     * CASCADE: if a request is deleted (only possible in dev), snapshot goes too.
     */
    taktRequestId: text("takt_request_id")
      .notNull()
      .unique()
      .references(() => taktRequestsTable.id, { onDelete: "cascade" }),

    /** Schema version of the snapshot payload (e.g. "1.0") for future evolution */
    schemaVersion: text("schema_version").notNull().default("1.0"),

    /**
     * JSONB payload with the released Takt data.
     * Must NOT contain: full project plan, other NU data, internal GU comments.
     * See docs/json-contracts.md for the canonical shape.
     */
    snapshotPayload: jsonb("snapshot_payload")
      .$type<Record<string, unknown>>()
      .notNull(),

    /** Write-once — no updatedAt on this table */
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
);

export type TaktRequestStatus =
  typeof taktRequestStatusEnum.enumValues[number];
export type TaktRequest = typeof taktRequestsTable.$inferSelect;
export type InsertTaktRequest = typeof taktRequestsTable.$inferInsert;
export type TaktRequestSnapshot =
  typeof taktRequestSnapshotsTable.$inferSelect;
export type InsertTaktRequestSnapshot =
  typeof taktRequestSnapshotsTable.$inferInsert;
