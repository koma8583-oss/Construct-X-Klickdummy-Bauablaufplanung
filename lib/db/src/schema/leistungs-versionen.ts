/**
 * LeistungsVersionen — immutable content-version history for Leistungen.
 *
 * Canonical rename of takt_versions (Task #196).
 *
 * Architecture decisions:
 *   - One row per version of a Leistung. Versions are never updated or deleted.
 *   - UNIQUE on (leistungId, version) prevents duplicate version numbers.
 *   - RESTRICT on leistungId: a Leistung with version history cannot be deleted.
 *   - sourceType describes the origin of the version.
 *   - snapshotPayload contains the full business content of the Leistung at
 *     this version. It never changes after creation.
 */
import {
  pgTable,
  text,
  integer,
  timestamp,
  jsonb,
  pgEnum,
  index,
  unique,
} from "drizzle-orm/pg-core";
import { leistungenTable } from "./leistungen";
import { leistungsanfragenTable } from "./leistungsanfragen";
import { leistungsantwortenTable } from "./leistungsantworten";
import { leistungsantwortEntscheidungenTable } from "./leistungsantwort-entscheidungen";
import { usersTable } from "./users";

export const leistungsVersionSourceTypeEnum = pgEnum("leistungs_version_source_type", [
  "INITIAL",
  "MANUAL_EDIT",
  "ACCEPTED_ALTERNATIVE",
  "REVISION",
]);

export const leistungsVersionenTable = pgTable(
  "leistungs_versionen",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),

    /**
     * FK to leistungen. RESTRICT: a Leistung with version history cannot be deleted.
     */
    leistungId: text("leistung_id")
      .notNull()
      .references(() => leistungenTable.id, { onDelete: "restrict" }),

    /**
     * Monotonically incrementing version number for this Leistung.
     * Starts at 1. Unique per leistung — see unique constraint below.
     */
    version: integer("version").notNull(),

    /** Origin of this version */
    sourceType: leistungsVersionSourceTypeEnum("source_type").notNull(),

    /**
     * The Leistungsanfrage that triggered this version, if applicable.
     */
    sourceRequestId: text("source_request_id").references(
      () => leistungsanfragenTable.id,
      { onDelete: "set null" },
    ),

    /**
     * The Leistungsantwort that provided the alternative, if applicable.
     */
    sourceResponseId: text("source_response_id").references(
      () => leistungsantwortenTable.id,
      { onDelete: "restrict" },
    ),

    /**
     * The GU decision that created this version, if applicable.
     */
    sourceDecisionId: text("source_decision_id").references(
      () => leistungsantwortEntscheidungenTable.id,
      { onDelete: "restrict" },
    ),

    /**
     * Full business content of the Leistung at this version.
     * Stored as JSONB. Never mutated after creation.
     */
    snapshotPayload: jsonb("snapshot_payload")
      .$type<Record<string, unknown>>()
      .notNull(),

    /**
     * Optional deterministic SHA-256 hash of the canonically serialised
     * snapshotPayload.
     */
    contentHash: text("content_hash"),

    /** User who created this version (GU planner or system for INITIAL) */
    createdByUserId: text("created_by_user_id").references(
      () => usersTable.id,
      { onDelete: "set null" },
    ),

    /** Write-once — no updatedAt */
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    /** Core invariant: no two rows with the same version for the same Leistung */
    unique("uq_leistung_version").on(t.leistungId, t.version),
    index("leistungs_versionen_leistung_id_idx").on(t.leistungId),
    index("leistungs_versionen_source_type_idx").on(t.sourceType),
    index("leistungs_versionen_content_hash_idx").on(t.contentHash),
  ],
);

export type LeistungsVersionSourceType =
  typeof leistungsVersionSourceTypeEnum.enumValues[number];
export type LeistungsVersion = typeof leistungsVersionenTable.$inferSelect;
export type InsertLeistungsVersion = typeof leistungsVersionenTable.$inferInsert;

// ── Enum alias only — table/type aliases live in legacy-takt-adapters.ts ──────
/** @deprecated Use leistungsVersionSourceTypeEnum */
export const taktVersionSourceTypeEnum = leistungsVersionSourceTypeEnum;
