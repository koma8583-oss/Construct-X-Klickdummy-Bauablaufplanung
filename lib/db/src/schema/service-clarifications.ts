import { pgEnum, pgTable, text, timestamp, index } from "drizzle-orm/pg-core";
import { leistungsanfragenTable } from "./leistungsanfragen";
import { organizationsTable } from "./organizations";

export const serviceClarificationRoleEnum = pgEnum("service_clarification_role", ["AG", "AN"]);
export const serviceClarificationCategoryEnum = pgEnum("service_clarification_category", [
  "PLAN", "APPROVAL", "DIMENSION", "ACCESS", "INTERFACE_INFORMATION", "SCOPE", "OTHER",
]);
export const serviceClarificationStatusEnum = pgEnum("service_clarification_status", ["OPEN", "RESOLVED", "CANCELLED"]);

export const serviceClarificationsTable = pgTable("service_clarifications", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  serviceRequestId: text("service_request_id").notNull().references(() => leistungsanfragenTable.id, { onDelete: "cascade" }),
  askedByOrgId: text("asked_by_org_id").notNull().references(() => organizationsTable.id),
  askedByRole: serviceClarificationRoleEnum("asked_by_role").notNull(),
  category: serviceClarificationCategoryEnum("category").notNull(),
  question: text("question").notNull(),
  answer: text("answer"),
  status: serviceClarificationStatusEnum("status").notNull().default("OPEN"),
  answeredByOrgId: text("answered_by_org_id").references(() => organizationsTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  answeredAt: timestamp("answered_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("service_clarifications_request_idx").on(t.serviceRequestId),
  index("service_clarifications_status_idx").on(t.status),
]);

export type ServiceClarification = typeof serviceClarificationsTable.$inferSelect;