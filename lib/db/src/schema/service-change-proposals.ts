import {
  pgEnum,
  pgTable,
  text,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { leistungsanfragenTable } from "./leistungsanfragen";
import { organizationsTable } from "./organizations";
import { usersTable } from "./users";

export const serviceChangeProposalStatusEnum = pgEnum("service_change_proposal_status", [
  "OPEN",
  "ACCEPTED",
  "REJECTED",
  "SUPERSEDED",
]);

export const serviceChangeProposalActionEnum = pgEnum("service_change_proposal_action", [
  "PROPOSE",
  "COUNTER",
]);

export const serviceChangeProposalsTable = pgTable(
  "service_change_proposals",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    leistungsanfrageId: text("leistungsanfrage_id")
      .notNull()
      .references(() => leistungsanfragenTable.id, { onDelete: "cascade" }),
    proposerOrgId: text("proposer_org_id")
      .notNull()
      .references(() => organizationsTable.id),
    proposerUserId: text("proposer_user_id")
      .notNull()
      .references(() => usersTable.id),
    start: timestamp("proposed_start", { withTimezone: true }).notNull(),
    end: timestamp("proposed_end", { withTimezone: true }).notNull(),
    reasonCode: text("reason_code"),
    comment: text("comment"),
    action: serviceChangeProposalActionEnum("action").notNull().default("PROPOSE"),
    status: serviceChangeProposalStatusEnum("status").notNull().default("OPEN"),
    supersedesProposalId: text("supersedes_proposal_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolvedByUserId: text("resolved_by_user_id").references(() => usersTable.id),
  },
  (t) => [
    index("service_change_proposals_request_idx").on(t.leistungsanfrageId),
    index("service_change_proposals_open_idx").on(t.leistungsanfrageId, t.status),
    index("service_change_proposals_proposer_idx").on(t.proposerOrgId),
  ],
);

export type ServiceChangeProposal = typeof serviceChangeProposalsTable.$inferSelect;
export type InsertServiceChangeProposal = typeof serviceChangeProposalsTable.$inferInsert;