import { pgEnum, pgTable, text, integer, timestamp, index, unique } from "drizzle-orm/pg-core";
import { projectsTable } from "./projects";
import { leistungenTable } from "./leistungen";
import { leistungsanfragenTable } from "./leistungsanfragen";

export const serviceDependencyTypeEnum = pgEnum("service_dependency_type", ["FINISH_TO_START"]);

export const serviceDependenciesTable = pgTable("service_dependencies", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  projectId: text("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
  predecessorServiceRequestId: text("predecessor_service_request_id").notNull().references(() => leistungsanfragenTable.id, { onDelete: "cascade" }),
  successorServiceRequestId: text("successor_service_request_id").notNull().references(() => leistungsanfragenTable.id, { onDelete: "cascade" }),
  dependencyType: serviceDependencyTypeEnum("dependency_type").notNull().default("FINISH_TO_START"),
  lagDays: integer("lag_days").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique("service_dependencies_pair_unique").on(t.predecessorServiceRequestId, t.successorServiceRequestId),
  index("service_dependencies_project_idx").on(t.projectId),
]);

export type ServiceDependency = typeof serviceDependenciesTable.$inferSelect;