/**
 * TaktVersions — immutable content-version history for Takte (Task 6.2).
 *
 * Architecture decisions:
 *   - One row per version of a Takt. Versions are never updated or deleted.
 *   - UNIQUE on (taktId, version) prevents duplicate version numbers.
 *   - RESTRICT on taktId: a Takt with version history cannot be deleted.
 *   - sourceType describes the origin of the version (INITIAL, MANUAL_EDIT,
 *     ACCEPTED_ALTERNATIVE, REVISION).
 *   - sourceRequestId / sourceResponseId / sourceDecisionId are all nullable;
 *     set only where the version was produced by a coordination action.
 *   - snapshotPayload contains the full business content of the Takt at this
 *     version. It never changes after creation.
 *   - contentHash is optional but recommended for deduplication of identical
 *     content versions (non-cryptographic, deterministic SHA-256 over canonical
 *     JSON).
 *
 * Initialisation (Task 6.2):
 *   Existing Takte receive one INITIAL row via a one-time migration script.
 *   Their current content is captured as version = takt.version (or 1).
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
import { takteTable } from "./takte";
import { taktRequestsTable } from "./takt-requests";
import { taktResponsesTable } from "./takt-responses";
import { taktResponseDecisionsTable } from "./takt-response-decisions";
import { usersTable } from "./users";

export const taktVersionSourceTypeEnum = pgEnum("takt_version_source_type", [
  "INITIAL",
  "MANUAL_EDIT",
  "ACCEPTED_ALTERNATIVE",
  "REVISION",
]);

export const taktVersionsTable = pgTable(
  "takt_versions",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),

    /**
     * FK to takte. RESTRICT: a Takt with version history cannot be deleted.
     * All versions survive as long as the Takt exists.
     */
    taktId: text("takt_id")
      .notNull()
      .references(() => takteTable.id, { onDelete: "restrict" }),

    /**
     * Monotonically incrementing version number for this Takt.
     * Starts at 1. Unique per takt — see unique constraint below.
     * Versions are never updated or reused.
     */
    version: integer("version").notNull(),

    /** Origin of this version */
    sourceType: taktVersionSourceTypeEnum("source_type").notNull(),

    /**
     * The TaktRequest that triggered this version, if applicable.
     * Null for INITIAL and MANUAL_EDIT.
     * SET NULL on delete (requests can be deleted in dev without losing version history).
     */
    sourceRequestId: text("source_request_id").references(
      () => taktRequestsTable.id,
      { onDelete: "set null" },
    ),

    /**
     * The TaktResponse that provided the alternative, if applicable.
     * Set for ACCEPTED_ALTERNATIVE.
     * RESTRICT: the response cannot be deleted once a version references it.
     */
    sourceResponseId: text("source_response_id").references(
      () => taktResponsesTable.id,
      { onDelete: "restrict" },
    ),

    /**
     * The GU decision that created this version, if applicable.
     * Set for ACCEPTED_ALTERNATIVE and REVISION.
     * RESTRICT: the decision cannot be deleted once referenced.
     */
    sourceDecisionId: text("source_decision_id").references(
      () => taktResponseDecisionsTable.id,
      { onDelete: "restrict" },
    ),

    /**
     * Full business content of the Takt at this version.
     * Stored as JSONB. Never mutated after creation.
     * Contains: taktBezeichnung, zone, gewerk, description, plannedStart,
     *   plannedEnd, earliestStart, latestEnd, lvReference, bimReference,
     *   requiredResources — all fields that constitute Takt content.
     */
    snapshotPayload: jsonb("snapshot_payload")
      .$type<Record<string, unknown>>()
      .notNull(),

    /**
     * Optional deterministic SHA-256 hash of the canonically serialised
     * snapshotPayload. Enables fast deduplication of identical content versions.
     * Not used for security — purely for content equality detection.
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
    /** Core invariant: no two rows with the same version for the same Takt */
    unique("uq_takt_version").on(t.taktId, t.version),
    index("takt_versions_takt_id_idx").on(t.taktId),
    index("takt_versions_source_type_idx").on(t.sourceType),
    index("takt_versions_content_hash_idx").on(t.contentHash),
  ],
);

export type TaktVersionSourceType =
  typeof taktVersionSourceTypeEnum.enumValues[number];
export type TaktVersion = typeof taktVersionsTable.$inferSelect;
export type InsertTaktVersion = typeof taktVersionsTable.$inferInsert;
