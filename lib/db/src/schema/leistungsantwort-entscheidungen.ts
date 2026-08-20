/**
 * LeistungsantwortEntscheidungen — immutable GU decisions on a Leistungsantwort.
 *
 * Canonical rename of takt_response_decisions (Task #196).
 *
 * Architecture decisions:
 *   - UNIQUE on responseId: exactly one GU decision per response.
 *   - Decisions are write-once. No update path provided.
 *   - Corrections require a new coordination round (new Leistungsanfrage).
 *   - acceptedAlternativeId is only valid for ACCEPT_ALTERNATIVE decisions.
 *   - idempotencyKey enables safe retries.
 *   - Unique constraint on (guOrgId, idempotencyKey) prevents cross-org collisions.
 *   - No CASCADE DELETE from responses: decisions must survive response lifetime.
 */
import {
  pgTable,
  text,
  timestamp,
  pgEnum,
  index,
  unique,
} from "drizzle-orm/pg-core";
import { leistungsanfragenTable } from "./leistungsanfragen";
import { leistungsantwortenTable, leistungsantwortAlternativenTable } from "./leistungsantworten";
import { organizationsTable } from "./organizations";
import { usersTable } from "./users";

export const leistungsantwortEntscheidungTypeEnum = pgEnum(
  "takt_coordination_decision_type",
  [
    "CONFIRM_ACCEPTED",
    "ACCEPT_ALTERNATIVE",
    "REQUEST_REVISION",
    "CLOSE_WITHOUT_AGREEMENT",
  ],
);

export const leistungsantwortEntscheidungenTable = pgTable(
  "leistungsantwort_entscheidungen",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),

    /**
     * FK to leistungsanfragen — which coordination round this decision belongs to.
     * RESTRICT: the request cannot be deleted while a decision exists.
     */
    leistungsanfrageId: text("leistungsanfrage_id")
      .notNull()
      .references(() => leistungsanfragenTable.id, { onDelete: "restrict" }),

    /**
     * FK to leistungsantworten — the NU response being decided on.
     * UNIQUE: only one GU decision per response.
     * RESTRICT: the response cannot be deleted once a decision exists.
     */
    responseId: text("response_id")
      .notNull()
      .unique()
      .references(() => leistungsantwortenTable.id, { onDelete: "restrict" }),

    /**
     * The GU organisation making this decision.
     */
    guOrgId: text("gu_org_id")
      .notNull()
      .references(() => organizationsTable.id),

    /** The GU's business decision type */
    decisionType: leistungsantwortEntscheidungTypeEnum("decision_type").notNull(),

    /**
     * Only set when decisionType = ACCEPT_ALTERNATIVE.
     */
    acceptedAlternativeId: text("accepted_alternative_id").references(
      () => leistungsantwortAlternativenTable.id,
      { onDelete: "restrict" },
    ),

    /** Optional free-text comment from the GU */
    comment: text("comment"),

    /**
     * Optional idempotency key supplied by the client.
     */
    idempotencyKey: text("idempotency_key"),

    /** GU user who made this decision */
    decidedByUserId: text("decided_by_user_id")
      .notNull()
      .references(() => usersTable.id),

    /**
     * Business timestamp of the decision.
     */
    decidedAt: timestamp("decided_at", { withTimezone: true })
      .notNull()
      .defaultNow(),

    /** Write-once — no updatedAt */
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("leistungsantwort_entscheidungen_anfrage_id_idx").on(t.leistungsanfrageId),
    index("leistungsantwort_entscheidungen_gu_org_idx").on(t.guOrgId),
    index("leistungsantwort_entscheidungen_decision_type_idx").on(t.decisionType),
    /**
     * Idempotency key must be unique within a GU organisation.
     */
    unique("uq_leistungsantwort_entscheidung_idempotency").on(
      t.guOrgId,
      t.idempotencyKey,
    ),
  ],
);

export type LeistungsantwortEntscheidungType =
  typeof leistungsantwortEntscheidungTypeEnum.enumValues[number];
export type LeistungsantwortEntscheidung =
  typeof leistungsantwortEntscheidungenTable.$inferSelect;
export type InsertLeistungsantwortEntscheidung =
  typeof leistungsantwortEntscheidungenTable.$inferInsert;

// ── Enum alias only — table/type aliases live in legacy-takt-adapters.ts ──────
/** @deprecated Use leistungsantwortEntscheidungTypeEnum */
export const taktCoordinationDecisionTypeEnum = leistungsantwortEntscheidungTypeEnum;
