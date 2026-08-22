import { pgEnum, pgTable, text, timestamp, index } from "drizzle-orm/pg-core";
import { leistungsanfragenTable } from "./leistungsanfragen";
import { organizationsTable } from "./organizations";

export const serviceConstraintRoleEnum = pgEnum("service_constraint_role", ["AG", "AN"]);
export const serviceConstraintTypeEnum = pgEnum("service_constraint_type", [
  "UPSTREAM_NOT_READY", "SITE_NOT_READY", "RESOURCE_CONFLICT", "MATERIAL_NOT_AVAILABLE",
  "INFORMATION_MISSING", "APPROVAL_MISSING", "ACCESS_RESTRICTED", "SAFETY_CLEARANCE_MISSING", "OTHER",
]);
export const serviceConstraintStatusEnum = pgEnum("service_constraint_status", ["OPEN", "RESOLVED", "CANCELLED"]);

export const serviceConstraintsTable = pgTable("service_constraints", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  serviceRequestId: text("service_request_id").notNull().references(() => leistungsanfragenTable.id, { onDelete: "cascade" }),
  reportedByOrgId: text("reported_by_org_id").notNull().references(() => organizationsTable.id),
  reportedByRole: serviceConstraintRoleEnum("reported_by_role").notNull(),
  constraintType: serviceConstraintTypeEnum("constraint_type").notNull(),
  description: text("description").notNull(),
  status: serviceConstraintStatusEnum("status").notNull().default("OPEN"),
  responsibleOrgId: text("responsible_org_id").notNull().references(() => organizationsTable.id),
  reportedAt: timestamp("reported_at", { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("service_constraints_request_idx").on(t.serviceRequestId),
  index("service_constraints_status_idx").on(t.status),
]);

export type ServiceConstraint = typeof serviceConstraintsTable.$inferSelect;