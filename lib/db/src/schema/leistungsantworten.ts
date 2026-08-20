/**
 * Leistungsantwort and LeistungsantwortAlternative tables.
 *
 * Canonical renames of takt_responses / takt_response_alternatives (Task #196).
 *
 * These tables record the NU's business response to a Leistungsanfrage.
 *
 * Architecture decisions:
 *   - One response per request (UNIQUE on leistungsanfrageId).
 *   - messageId is nullable (transport not yet implemented) but UNIQUE when set.
 *   - Alternatives are stored in a child table to support up to 3 ranked proposals.
 *   - CASCADE on responseId: alternatives are deleted with their response.
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
import { leistungsanfragenTable } from "./leistungsanfragen";
import { usersTable } from "./users";

export const leistungsantwortDecisionEnum = pgEnum("takt_decision", [
  "ACCEPTED",
  "ALTERNATIVES_PROPOSED",
  "REJECTED",
]);

export const leistungsantwortReasonCodeEnum = pgEnum(
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

/** Leistungsantworten — business responses from a NU to a Leistungsanfrage */
export const leistungsantwortenTable = pgTable(
  "leistungsantworten",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),

    /**
     * FK to leistungsanfragen. UNIQUE = at most one response per request in the PoC.
     * CASCADE: if a request is removed (dev only), its response goes too.
     */
    leistungsanfrageId: text("leistungsanfrage_id")
      .notNull()
      .unique()
      .references(() => leistungsanfragenTable.id, { onDelete: "cascade" }),

    /**
     * Transport message ID for correlation with Hub messages.
     * Nullable while transport is not yet implemented.
     * UNIQUE when set — enforces deduplication of inbound messages.
     */
    messageId: text("message_id").unique(),

    /** The NU's business decision */
    decision: leistungsantwortDecisionEnum("decision").notNull(),

    /**
     * Generic reason code — only generic codes may be transmitted.
     */
    reasonCode: leistungsantwortReasonCodeEnum("reason_code"),

    /**
     * Optional free-text comment from the NU.
     * Max 2000 chars enforced in the service layer, not the DB.
     */
    comment: text("comment"),

    /** Accepted time window start — required when decision = ACCEPTED */
    acceptedStart: timestamp("accepted_start", { withTimezone: true }),

    /** Accepted time window end — required when decision = ACCEPTED */
    acceptedEnd: timestamp("accepted_end", { withTimezone: true }),

    /**
     * Earliest date the NU could be available.
     */
    nextAvailableDate: date("next_available_date", { mode: "string" }),

    /**
     * SHA-256 hash of the canonical public response payload.
     */
    responsePayloadHash: text("response_payload_hash").unique(),

    /** NU user who submitted this response */
    createdByUserId: text("created_by_user_id")
      .notNull()
      .references(() => usersTable.id),

    /** Write-once — no updatedAt. */
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
);

/** LeistungsantwortAlternativen — ranked alternative time windows proposed by the NU */
export const leistungsantwortAlternativenTable = pgTable(
  "leistungsantwort_alternativen",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),

    /**
     * FK to leistungsantworten. CASCADE: alternatives deleted with their response.
     */
    responseId: text("response_id")
      .notNull()
      .references(() => leistungsantwortenTable.id, { onDelete: "cascade" }),

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
     */
    conditions: jsonb("conditions").$type<string[]>(),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("uq_response_alternative_id").on(t.responseId, t.alternativeId),
    unique("uq_response_rank").on(t.responseId, t.rank),
    index("leistungsantwort_alternativen_response_id_idx").on(t.responseId),
  ],
);

export type LeistungsantwortDecision = typeof leistungsantwortDecisionEnum.enumValues[number];
export type LeistungsantwortReasonCode =
  typeof leistungsantwortReasonCodeEnum.enumValues[number];
export type Leistungsantwort = typeof leistungsantwortenTable.$inferSelect;
export type InsertLeistungsantwort = typeof leistungsantwortenTable.$inferInsert;
export type LeistungsantwortAlternativeRow =
  typeof leistungsantwortAlternativenTable.$inferSelect;
export type InsertLeistungsantwortAlternative =
  typeof leistungsantwortAlternativenTable.$inferInsert;

// ── Enum aliases only — table/type aliases live in legacy-takt-adapters.ts ───
/** @deprecated Use leistungsantwortDecisionEnum */
export const taktDecisionEnum = leistungsantwortDecisionEnum;
/** @deprecated Use leistungsantwortReasonCodeEnum */
export const taktResponseReasonCodeEnum = leistungsantwortReasonCodeEnum;
