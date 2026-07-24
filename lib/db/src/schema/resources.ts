import {
  pgTable,
  text,
  timestamp,
  date,
  doublePrecision,
  pgEnum,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organizationsTable } from "./organizations";
import { delegationsTable } from "./delegations";

export const resourceTypeEnum = pgEnum("resource_type", [
  "EMPLOYEE",
  "EQUIPMENT",
  "MACHINE",
  "OTHER",
]);

export const resourcesTable = pgTable("resources", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  anOrgId: text("an_org_id")
    .notNull()
    .references(() => organizationsTable.id, { onDelete: "cascade" }),
  type: resourceTypeEnum("type").notNull(),
  name: text("name").notNull(),
  qualification: text("qualification"),
  dailyCapacityHours: doublePrecision("daily_capacity_hours"),
  color: text("color"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const resourceAssignmentsTable = pgTable("resource_assignments", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  resourceId: text("resource_id")
    .notNull()
    .references(() => resourcesTable.id, { onDelete: "cascade" }),
  delegationId: text("delegation_id")
    .notNull()
    .references(() => delegationsTable.id, { onDelete: "cascade" }),
  fromDate: date("from_date", { mode: "string" }).notNull(),
  toDate: date("to_date", { mode: "string" }).notNull(),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const insertResourceSchema = createInsertSchema(resourcesTable).omit({
  id: true,
  createdAt: true,
});

export const insertResourceAssignmentSchema = createInsertSchema(
  resourceAssignmentsTable,
).omit({ id: true, createdAt: true });

export type InsertResource = z.infer<typeof insertResourceSchema>;
export type Resource = typeof resourcesTable.$inferSelect;
export type InsertResourceAssignment = z.infer<
  typeof insertResourceAssignmentSchema
>;
export type ResourceAssignment = typeof resourceAssignmentsTable.$inferSelect;
