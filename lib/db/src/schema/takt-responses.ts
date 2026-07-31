/**
 * TaktResponse and TaktResponseAlternative tables (Task 2.5).
 *
 * These tables record the NU's business response to a TaktRequest.
 *
 * Architecture decisions:
 *   - One response per request (UNIQUE on taktRequestId). A new coordination
 *     round requires a new TaktRequest, not an overwritten response.
 *   - messageId is nullable (transport not yet implemented) but UNIQUE when set.
 *   - Alternatives are stored in a child table to support up to 3 ranked proposals.
 *   - CASCADE on responseId: alternatives are deleted with their response.
 *     Historically relevant responses are NOT deleted in normal operation.
 *   - Decision and reason code are generic — no internal NU data is exposed.
 */
import {
  pgTable,
  text,
  timestamp,
  date,
  integer,
  pgEnum,
  index,
  unique,
  jsonb,
} from "drizzle-orm/pg-core";
import { taktRequestsTable } from "./takt-requests";
import { usersTable } from "./users";

export const taktDecisionEnum = pgEnum("takt_decision", [
  "ACCEPTED",
  "ALTERNATIVES_PROPOSED",
  "REJECTED",
]);

export const taktResponseReasonCodeEnum = pgEnum(
  "takt_response_reason_code",
  [
    "RESOURCE_CONFLICT",
    "NO_CAPACITY",
    "EQUIPMENT_UNAVAILABLE",
    "QUALIFICATION_MISSING",
    "TIME_WINDOW_TOO_SHORT",
    "OUTSIDE_PLANNING_HORIZON",
    "OTHER",
  ],
);

/** TaktResponses — business responses from a NU to a TaktRequest */
export const taktResponsesTable = pgTable(
  "takt_responses",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),

    /**
     * FK to takt_requests. UNIQUE = at most one response per request in the PoC.
     * CASCADE: if a request is removed (dev only), its response goes too.
     */
    taktRequestId: text("takt_request_id")
      .notNull()
      .unique()
      .references(() => taktRequestsTable.id, { onDelete: "cascade" }),

    /**
     * Transport message ID for correlation with Hub messages.
     * Nullable while transport is not yet implemented.
     * UNIQUE when set — enforces deduplication of inbound messages.
     */
    messageId: text("message_id").unique(),

    /** The NU's business decision */
    decision: taktDecisionEnum("decision").notNull(),

    /**
     * Generic reason code — only generic codes may be transmitted.
     * Internal NU conflict details must NOT appear here.
     */
    reasonCode: taktResponseReasonCodeEnum("reason_code"),

    /**
     * Optional free-text comment from the NU.
     * Max 2000 chars enforced in the service layer, not the DB.
     * Must NOT contain internal NU project or resource details.
     */
    comment: text("comment"),

    /** Accepted time window start — required when decision = ACCEPTED */
    acceptedStart: timestamp("accepted_start", { withTimezone: true }),

    /** Accepted time window end — required when decision = ACCEPTED */
    acceptedEnd: timestamp("accepted_end", { withTimezone: true }),

    /**
     * Earliest date the NU could be available.
     * Generic — does not reveal why the earlier dates are unavailable.
     */
    nextAvailableDate: date("next_available_date", { mode: "string" }),

    /** NU user who submitted this response */
    createdByUserId: text("created_by_user_id")
      .notNull()
      .references(() => usersTable.id),

    /** Write-once — no updatedAt. A new coordination round → new TaktRequest */
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
);

/** TaktResponseAlternatives — ranked alternative time windows proposed by the NU */
export const taktResponseAlternativesTable = pgTable(
  "takt_response_alternatives",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),

    /**
     * FK to takt_responses. CASCADE: alternatives deleted with their response.
     * Max 3 alternatives enforced in the service layer.
     */
    responseId: text("response_id")
      .notNull()
      .references(() => taktResponsesTable.id, { onDelete: "cascade" }),

    /** NU-assigned alternative identifier (e.g. "ALT-001") within this response */
    alternativeId: text("alternative_id").notNull(),

    /** Preference rank — 1 is most preferred. Min 1. Unique per response. */
    rank: integer("rank").notNull(),

    /** Alternative time window start */
    proposedStart: timestamp("proposed_start", { withTimezone: true }).notNull(),

    /** Alternative time window end — must be after proposedStart (service-enforced) */
    proposedEnd: timestamp("proposed_end", { withTimezone: true }).notNull(),

    /** Number of workers available in this window. Min 1 if set. */
    crewSize: integer("crew_size"),

    /**
     * Generic conditions or constraints (array of strings).
     * Stored as JSONB. Must not contain internal NU resource identifiers.
     */
    conditions: jsonb("conditions").$type<string[]>(),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("uq_response_alternative_id").on(t.responseId, t.alternativeId),
    unique("uq_response_rank").on(t.responseId, t.rank),
    index("takt_response_alternatives_response_id_idx").on(t.responseId),
  ],
);

export type TaktDecision = typeof taktDecisionEnum.enumValues[number];
export type TaktResponseReasonCode =
  typeof taktResponseReasonCodeEnum.enumValues[number];
export type TaktResponse = typeof taktResponsesTable.$inferSelect;
export type InsertTaktResponse = typeof taktResponsesTable.$inferInsert;
export type TaktResponseAlternativeRow =
  typeof taktResponseAlternativesTable.$inferSelect;
export type InsertTaktResponseAlternative =
  typeof taktResponseAlternativesTable.$inferInsert;
