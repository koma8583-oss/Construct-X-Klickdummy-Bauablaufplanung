import {
  pgTable,
  text,
  timestamp,
  pgEnum,
  date,
  unique,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organizationsTable } from "./organizations";
import { usersTable } from "./users";

export const projectStatusEnum = pgEnum("project_status", [
  "ACTIVE",
  "COMPLETED",
  "ARCHIVED",
]);

export const projectContractorStatusEnum = pgEnum("project_contractor_status", [
  "PLANNED",
  "ACTIVE",
  "INACTIVE",
  "COMPLETED",
  "CANCELLED",
]);

export const projectsTable = pgTable("projects", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  agOrgId: text("ag_org_id")
    .notNull()
    .references(() => organizationsTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  location: text("location"),
  status: projectStatusEnum("status").notNull().default("ACTIVE"),
  startDate: date("start_date", { mode: "string" }),
  endDate: date("end_date", { mode: "string" }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

/**
 * project_contractors — assigns AN (Nachunternehmer) organisations to projects.
 *
 * Extended in Task 9.2 to support:
 *   - per-trade/work-package assignments (same AN, multiple rows per project)
 *   - lifecycle status (PLANNED → ACTIVE → INACTIVE/COMPLETED/CANCELLED)
 *   - validity period (validFrom / validTo)
 *   - audit trail (createdByUserId)
 *
 * Unique constraint (enforced via psql index, not Drizzle):
 *   (project_id, an_org_id, COALESCE(trade, ''), COALESCE(work_package_reference, ''))
 *   with NULLS NOT DISTINCT so null trade is treated as one distinct value per AN.
 *
 * Only ACTIVE assignments may be used for new TaktRequests.
 * Physical deletion of historically used assignments is prohibited — use
 * PATCH assignmentStatus = INACTIVE/CANCELLED instead.
 */
export const projectContractorsTable = pgTable(
  "project_contractors",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    projectId: text("project_id")
      .notNull()
      .references(() => projectsTable.id, { onDelete: "cascade" }),
    anOrgId: text("an_org_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "cascade" }),
    /** Optional trade/Gewerk for this assignment. Null means "all trades". */
    trade: text("trade"),
    /** Optional fachliche Referenz des Arbeitspaketes */
    workPackageReference: text("work_package_reference"),
    /** Lifecycle status of the assignment */
    assignmentStatus: projectContractorStatusEnum("assignment_status")
      .notNull()
      .default("ACTIVE"),
    /** Date from which this assignment is valid (inclusive, date only) */
    validFrom: date("valid_from", { mode: "string" }),
    /** Date until which this assignment is valid (inclusive, date only) */
    validTo: date("valid_to", { mode: "string" }),
    createdByUserId: text("created_by_user_id")
      .references(() => usersTable.id, { onDelete: "set null" }),
    addedAt: timestamp("added_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index("project_contractors_project_idx").on(t.projectId),
    index("project_contractors_an_idx").on(t.anOrgId),
  ],
);

export const insertProjectSchema = createInsertSchema(projectsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertProject = z.infer<typeof insertProjectSchema>;
export type Project = typeof projectsTable.$inferSelect;
export type ProjectContractor = typeof projectContractorsTable.$inferSelect;
