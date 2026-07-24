import {
  pgTable,
  text,
  timestamp,
  date,
  boolean,
  pgEnum,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organizationsTable } from "./organizations";
import { projectsTable } from "./projects";
import { takteTable } from "./takte";

export const delegationStatusEnum = pgEnum("delegation_status_enum", [
  "PENDING",
  "CONFIRMED",
  "ALTERNATIVE_PROPOSED",
  "REJECTED",
  "CANCELLED",
]);

export const responseTypeEnum = pgEnum("response_type", [
  "CONFIRMED",
  "ALTERNATIVE",
  "REJECTED",
]);

export const agDecisionEnum = pgEnum("ag_decision", [
  "PENDING",
  "ACCEPTED",
  "REJECTED",
]);

export const delegationsTable = pgTable("delegations", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  taktId: text("takt_id")
    .notNull()
    .references(() => takteTable.id, { onDelete: "cascade" }),
  projectId: text("project_id")
    .notNull()
    .references(() => projectsTable.id, { onDelete: "cascade" }),
  agOrgId: text("ag_org_id")
    .notNull()
    .references(() => organizationsTable.id),
  anOrgId: text("an_org_id")
    .notNull()
    .references(() => organizationsTable.id),
  requestedStart: date("requested_start", { mode: "string" }).notNull(),
  requestedEnd: date("requested_end", { mode: "string" }).notNull(),
  earliestStart: date("earliest_start", { mode: "string" }),
  latestEnd: date("latest_end", { mode: "string" }),
  status: delegationStatusEnum("status").notNull().default("PENDING"),
  message: text("message"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const delegationResponsesTable = pgTable("delegation_responses", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  delegationId: text("delegation_id")
    .notNull()
    .references(() => delegationsTable.id, { onDelete: "cascade" }),
  type: responseTypeEnum("type").notNull(),
  proposedStart: date("proposed_start", { mode: "string" }),
  proposedEnd: date("proposed_end", { mode: "string" }),
  comment: text("comment"),
  isWithinBuffer: boolean("is_within_buffer").notNull().default(false),
  agDecision: agDecisionEnum("ag_decision").notNull().default("PENDING"),
  agComment: text("ag_comment"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const insertDelegationSchema = createInsertSchema(
  delegationsTable,
).omit({ id: true, createdAt: true, updatedAt: true });

export const insertDelegationResponseSchema = createInsertSchema(
  delegationResponsesTable,
).omit({ id: true, createdAt: true });

export type InsertDelegation = z.infer<typeof insertDelegationSchema>;
export type Delegation = typeof delegationsTable.$inferSelect;
export type InsertDelegationResponse = z.infer<
  typeof insertDelegationResponseSchema
>;
export type DelegationResponse = typeof delegationResponsesTable.$inferSelect;
