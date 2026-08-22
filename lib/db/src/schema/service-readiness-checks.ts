import { pgTable, text, boolean, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { leistungsanfragenTable } from "./leistungsanfragen";
import { organizationsTable } from "./organizations";

export const serviceReadinessChecksTable = pgTable("service_readiness_checks", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  serviceRequestId: text("service_request_id").notNull().references(() => leistungsanfragenTable.id, { onDelete: "cascade" }),
  scheduleConfirmed: boolean("schedule_confirmed").notNull().default(false),
  siteReady: boolean("site_ready").notNull().default(false),
  informationComplete: boolean("information_complete").notNull().default(false),
  agReady: boolean("ag_ready").notNull().default(false),
  anReady: boolean("an_ready").notNull().default(false),
  updatedByOrgId: text("updated_by_org_id").notNull().references(() => organizationsTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("service_readiness_request_unique").on(t.serviceRequestId),
]);

export type ServiceReadinessCheck = typeof serviceReadinessChecksTable.$inferSelect;