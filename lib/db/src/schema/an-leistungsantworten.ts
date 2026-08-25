import {
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import { anLeistungsanfragenTable } from "./an-leistungsanfragen";

export const anLeistungsantwortDecisionEnum = pgEnum("an_leistungsantwort_decision", [
  "ACCEPTED",
  "ALTERNATIVES_PROPOSED",
  "REJECTED",
]);

export const anLeistungsantwortenTable = pgTable(
  "an_leistungsantworten",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    anLeistungsanfrageId: text("an_leistungsanfrage_id")
      .notNull()
      .references(() => anLeistungsanfragenTable.id, { onDelete: "cascade" }),
    sourceRequestId: text("source_request_id").notNull(),
    requestVersion: integer("request_version").notNull(),
    decision: anLeistungsantwortDecisionEnum("decision").notNull(),
    reasonCode: text("reason_code"),
    comment: text("comment"),
    acceptedStart: timestamp("accepted_start", { withTimezone: true }),
    acceptedEnd: timestamp("accepted_end", { withTimezone: true }),
    nextAvailableDate: date("next_available_date", { mode: "string" }),
    payloadHash: text("payload_hash").notNull(),
    outboundMessageId: text("outbound_message_id").notNull().unique(),
    createdByUserId: text("created_by_user_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("uq_an_leistungsantwort_request_version").on(
      table.anLeistungsanfrageId,
      table.requestVersion,
    ),
    index("an_leistungsantworten_request_idx").on(table.anLeistungsanfrageId),
    index("an_leistungsantworten_source_request_idx").on(
      table.sourceRequestId,
      table.requestVersion,
    ),
  ],
);

export const anLeistungsantwortAlternativenTable = pgTable(
  "an_leistungsantwort_alternativen",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    responseId: text("response_id")
      .notNull()
      .references(() => anLeistungsantwortenTable.id, { onDelete: "cascade" }),
    alternativeId: text("alternative_id").notNull(),
    rank: integer("rank").notNull(),
    proposedStart: timestamp("proposed_start", { withTimezone: true }).notNull(),
    proposedEnd: timestamp("proposed_end", { withTimezone: true }).notNull(),
    crewSize: integer("crew_size"),
    conditions: jsonb("conditions").$type<string[] | null>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("uq_an_leistungsantwort_alternative_id").on(table.responseId, table.alternativeId),
    unique("uq_an_leistungsantwort_rank").on(table.responseId, table.rank),
    index("an_leistungsantwort_alternativen_response_idx").on(table.responseId),
  ],
);

export type AnLeistungsantwort = typeof anLeistungsantwortenTable.$inferSelect;
export type AnLeistungsantwortAlternative = typeof anLeistungsantwortAlternativenTable.$inferSelect;