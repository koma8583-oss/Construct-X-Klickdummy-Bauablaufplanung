/**
 * TaktResponseDecisions — immutable GU decisions on a TaktResponse (Task 6.2).
 *
 * Architecture decisions:
 *   - UNIQUE on responseId: exactly one GU decision per response.
 *   - Decisions are write-once. No update path provided.
 *   - Corrections require a new coordination round (new TaktRequest), not an
 *     overwrite of the existing decision.
 *   - acceptedAlternativeId is only valid for ACCEPT_ALTERNATIVE decisions.
 *     The service layer enforces this constraint; the DB stores the FK.
 *   - idempotencyKey enables safe retries: same key + same payload → return
 *     existing decision. Same key + different payload → rejected.
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
import { taktRequestsTable } from "./takt-requests";
import { taktResponsesTable } from "./takt-responses";
import { taktResponseAlternativesTable } from "./takt-responses";
import { organizationsTable } from "./organizations";
import { usersTable } from "./users";

export const taktCoordinationDecisionTypeEnum = pgEnum(
  "takt_coordination_decision_type",
  [
    "CONFIRM_ACCEPTED",
    "ACCEPT_ALTERNATIVE",
    "REQUEST_REVISION",
    "CLOSE_WITHOUT_AGREEMENT",
  ],
);

export const taktResponseDecisionsTable = pgTable(
  "takt_response_decisions",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),

    /**
     * FK to takt_requests — which coordination round this decision belongs to.
     * RESTRICT: the request cannot be deleted while a decision exists.
     */
    taktRequestId: text("takt_request_id")
      .notNull()
      .references(() => taktRequestsTable.id, { onDelete: "restrict" }),

    /**
     * FK to takt_responses — the NU response being decided on.
     * UNIQUE: only one GU decision per response.
     * RESTRICT: the response cannot be deleted once a decision exists.
     */
    responseId: text("response_id")
      .notNull()
      .unique()
      .references(() => taktResponsesTable.id, { onDelete: "restrict" }),

    /**
     * The GU organisation making this decision.
     * Must match the guOrgId of the TaktRequest.
     */
    guOrgId: text("gu_org_id")
      .notNull()
      .references(() => organizationsTable.id),

    /** The GU's business decision type */
    decisionType: taktCoordinationDecisionTypeEnum("decision_type").notNull(),

    /**
     * Only set when decisionType = ACCEPT_ALTERNATIVE.
     * Must reference an alternative that belongs to the referenced response.
     * RESTRICT: the selected alternative cannot be deleted once referenced.
     */
    acceptedAlternativeId: text("accepted_alternative_id").references(
      () => taktResponseAlternativesTable.id,
      { onDelete: "restrict" },
    ),

    /** Optional free-text comment from the GU */
    comment: text("comment"),

    /**
     * Optional idempotency key supplied by the client.
     * Unique within the GU organisation — prevents duplicate decisions from
     * transport retries.
     * If set: same key + same payload → returns existing record.
     * If set: same key + different payload → rejected with 409.
     */
    idempotencyKey: text("idempotency_key"),

    /** GU user who made this decision */
    decidedByUserId: text("decided_by_user_id")
      .notNull()
      .references(() => usersTable.id),

    /**
     * Business timestamp of the decision (may differ from createdAt for
     * replayed or retried submissions).
     * Defaults to createdAt if not explicitly set.
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
    index("takt_response_decisions_request_id_idx").on(t.taktRequestId),
    index("takt_response_decisions_gu_org_idx").on(t.guOrgId),
    index("takt_response_decisions_decision_type_idx").on(t.decisionType),
    /**
     * Idempotency key must be unique within a GU organisation.
     * NULL values are excluded from this constraint (SQL NULL != NULL).
     */
    unique("uq_takt_response_decision_idempotency").on(
      t.guOrgId,
      t.idempotencyKey,
    ),
  ],
);

export type TaktCoordinationDecisionType =
  typeof taktCoordinationDecisionTypeEnum.enumValues[number];
export type TaktResponseDecision =
  typeof taktResponseDecisionsTable.$inferSelect;
export type InsertTaktResponseDecision =
  typeof taktResponseDecisionsTable.$inferInsert;
