/**
 * Leistungsanfrage and LeistungsanfrageSnapshot tables.
 *
 * Canonical renames of takt_requests / takt_request_snapshots (Task #196).
 *
 * These tables are introduced PARALLEL to the existing `delegations` and
 * `delegation_responses` tables. No existing tables are changed or removed.
 *
 * Architecture decision:
 *   - `leistungId` uses ON DELETE RESTRICT so a Leistung with active requests
 *     cannot be deleted; historical requests are preserved.
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
import { leistungenTable } from "./leistungen";
import { organizationsTable } from "./organizations";
import { usersTable } from "./users";
import { dataPublicationsTable } from "./data-publications";

export const leistungsanfrageStatusEnum = pgEnum("takt_request_status", [
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

/** Leistungsanfragen — coordination requests from GU to NU */
export const leistungsanfragenTable = pgTable(
  "leistungsanfragen",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),

    /** The Leistung being coordinated. RESTRICT prevents deleting a Leistung with requests. */
    leistungId: text("leistung_id")
      .notNull()
      .references(() => leistungenTable.id, { onDelete: "restrict" }),

    /**
     * Version of the Leistung at the time this request was created.
     * Immutable after creation — records which snapshot of the Leistung was used.
     */
    leistungVersion: integer("leistung_version").notNull().default(1),

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

    status: leistungsanfrageStatusEnum("status").notNull().default("DRAFT"),

    /** Deadline by which the NU must respond. Nullable for DRAFT requests. */
    responseRequiredBy: timestamp("response_required_by", {
      withTimezone: true,
    }),

    /** Set when the GU sends the notification to the NU */
    sentAt: timestamp("sent_at", { withTimezone: true }),

    /** Set when the notification is confirmed as technically delivered */
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),

    /** Set when the NU pulls the released Leistung details */
    detailsRetrievedAt: timestamp("details_retrieved_at", {
      withTimezone: true,
    }),

    /**
     * Self-referential FK to the request this one supersedes.
     * Null for the initial request. Set when a revised request is created.
     */
    supersedesRequestId: text("supersedes_request_id").references(
      (): AnyPgColumn => leistungsanfragenTable.id,
    ),

    /** User who created this request */
    createdByUserId: text("created_by_user_id")
      .notNull()
      .references(() => usersTable.id),

    /**
     * Optional FK to the data_publications entry whose TAKT_INFORMATION_PACKAGE
     * was shared with the NU before sending this request.
     */
    dataPublicationId: text("data_publication_id").references(
      () => dataPublicationsTable.id,
    ),

    /**
     * Absolute expiry timestamp.
     * Computed as responseRequiredBy + expirationGracePeriodHours.
     */
    expiresAt: timestamp("expires_at", { withTimezone: true }),

    /**
     * Set exactly once when the request transitions to EXPIRED.
     */
    expiredAt: timestamp("expired_at", { withTimezone: true }),

    /**
     * Timestamp of the last business reminder sent for this request.
     */
    lastReminderAt: timestamp("last_reminder_at", { withTimezone: true }),

    /**
     * Counter of business reminders sent.
     */
    reminderCount: integer("reminder_count").notNull().default(0),

    /**
     * Deadline by which the GU must decide after a NU response arrives.
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
    index("leistungsanfragen_leistung_id_idx").on(t.leistungId),
    index("leistungsanfragen_gu_org_id_idx").on(t.guOrgId),
    index("leistungsanfragen_nu_org_id_idx").on(t.nuOrgId),
    index("leistungsanfragen_status_idx").on(t.status),
    index("leistungsanfragen_response_required_by_idx").on(t.responseRequiredBy),
    index("leistungsanfragen_expires_at_idx").on(t.expiresAt),
    index("leistungsanfragen_created_at_idx").on(t.createdAt),
    // Combined indexes for the most common query patterns
    index("leistungsanfragen_nu_org_status_idx").on(t.nuOrgId, t.status),
    index("leistungsanfragen_gu_org_status_idx").on(t.guOrgId, t.status),
    index("leistungsanfragen_leistung_version_idx").on(t.leistungId, t.leistungVersion),
    index("leistungsanfragen_status_expires_at_idx").on(t.status, t.expiresAt),
  ],
);

/**
 * LeistungsanfrageSnapshots — immutable point-in-time copy of released Leistung data.
 *
 * Written once when a request is sent. Never updated.
 */
export const leistungsanfrageSnapshotsTable = pgTable(
  "leistungsanfrage_snapshots",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),

    /**
     * FK to leistungsanfragen. Unique constraint = exactly one snapshot per request.
     * CASCADE: if a request is deleted (only possible in dev), snapshot goes too.
     */
    leistungsanfrageId: text("leistungsanfrage_id")
      .notNull()
      .unique()
      .references(() => leistungsanfragenTable.id, { onDelete: "cascade" }),

    /** Schema version of the snapshot payload (e.g. "1.0") for future evolution */
    schemaVersion: text("schema_version").notNull().default("1.0"),

    /**
     * JSONB payload with the released Leistung data.
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

export type LeistungsanfrageStatus =
  typeof leistungsanfrageStatusEnum.enumValues[number];
export type Leistungsanfrage = typeof leistungsanfragenTable.$inferSelect;
export type InsertLeistungsanfrage = typeof leistungsanfragenTable.$inferInsert;
export type LeistungsanfrageSnapshot =
  typeof leistungsanfrageSnapshotsTable.$inferSelect;
export type InsertLeistungsanfrageSnapshot =
  typeof leistungsanfrageSnapshotsTable.$inferInsert;

// ── Enum alias only — table/type aliases live in legacy-takt-adapters.ts ──────
/** @deprecated Use leistungsanfrageStatusEnum */
export const taktRequestStatusEnum = leistungsanfrageStatusEnum;
