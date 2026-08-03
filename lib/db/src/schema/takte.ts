import { pgTable, text, timestamp, date, pgEnum, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { projectsTable } from "./projects";

/** Vergabe-Priorität — GU-internal, never released to NU */
export const taktProcurementPriorityEnum = pgEnum("takt_procurement_priority", [
  "HIGH",
  "MEDIUM",
  "LOW",
]);

/** Risikoklasse — GU-internal, never released to NU */
export const taktRiskClassificationEnum = pgEnum("takt_risk_classification", [
  "A",
  "B",
  "C",
]);

/** Dedicated lifecycle status for the Takt itself — separate from TaktStatus (Task 2.2/2.3) */
export const taktLifecycleStatusEnum = pgEnum("takt_lifecycle_status", [
  "DRAFT",
  "PLANNED",
  "IN_COORDINATION",
  "CONFIRMED",
  "CANCELLED",
]);

export const taktStatusEnum = pgEnum("takt_status", [
  "GEPLANT",
  "VERGEBEN",
  "ALTERNATIV",
  "BESTAETIGT",
  "ABGELEHNT",
  "STORNIERT",
]);

export const takteTable = pgTable("takte", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  projectId: text("project_id")
    .notNull()
    .references(() => projectsTable.id, { onDelete: "cascade" }),
  taktBezeichnung: text("takt_bezeichnung").notNull(),
  zone: text("zone").notNull(),
  gewerk: text("gewerk").notNull(),
  description: text("description"),
  plannedStart: date("planned_start", { mode: "string" }).notNull(),
  plannedEnd: date("planned_end", { mode: "string" }).notNull(),
  earliestStart: date("earliest_start", { mode: "string" }),
  latestEnd: date("latest_end", { mode: "string" }),
  lvReference: text("lv_reference"),
  bimReference: text("bim_reference"),
  requiredResources: text("required_resources"),
  status: taktStatusEnum("status").notNull().default("GEPLANT"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
  /**
   * Monotonically incrementing version number (Task 2.3).
   * Starts at 1 for all existing Takte.
   * Incremented when Takt data changes in a way that invalidates active TaktRequests.
   */
  version: integer("version").notNull().default(1),
  /**
   * Dedicated lifecycle status for the Takt itself (Task 2.3).
   * Parallel to `status` — not a replacement.
   * Existing Takte default to PLANNED; see docs/database-model.md for full mapping.
   */
  lifecycleStatus: taktLifecycleStatusEnum("lifecycle_status")
    .notNull()
    .default("PLANNED"),

  // ── GU-internal fields — NEVER released to NU via TaktRequestSnapshot ────
  // These fields are excluded from buildTaktRequestSnapshot() by design.
  // See docs/data-ownership.md § Takt field classification for the policy.

  /** Internal notes for the GU team — not shared with NU */
  internalNote: text("internal_note"),
  /** Internal cost estimate / budget note — not shared with NU */
  costEstimate: text("cost_estimate"),
  /** Procurement priority (HIGH/MEDIUM/LOW) — not shared with NU */
  procurementPriority: taktProcurementPriorityEnum("procurement_priority"),
  /** Risk classification (A/B/C) — not shared with NU */
  riskClassification: taktRiskClassificationEnum("risk_classification"),
});

export const insertTaktSchema = createInsertSchema(takteTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertTakt = z.infer<typeof insertTaktSchema>;
export type Takt = typeof takteTable.$inferSelect;
