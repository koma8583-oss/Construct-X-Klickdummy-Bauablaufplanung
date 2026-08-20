import { pgTable, text, timestamp, date, pgEnum, integer, numeric } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { projectsTable } from "./projects";

/** Vergabe-Priorität — GU-internal, never released to NU */
export const leistungProcurementPriorityEnum = pgEnum("leistung_procurement_priority", [
  "HIGH",
  "MEDIUM",
  "LOW",
]);

/** Risikoklasse — GU-internal, never released to NU */
export const leistungRiskClassificationEnum = pgEnum("leistung_risk_classification", [
  "A",
  "B",
  "C",
]);

/** Dedicated lifecycle status for the Leistung itself — separate from LeistungStatus */
export const leistungLifecycleStatusEnum = pgEnum("leistung_lifecycle_status", [
  "DRAFT",
  "PLANNED",
  "IN_COORDINATION",
  "CONFIRMED",
  "CANCELLED",
]);

export const leistungStatusEnum = pgEnum("leistung_status", [
  "GEPLANT",
  "VERGEBEN",
  "ALTERNATIV",
  "BESTAETIGT",
  "ABGELEHNT",
  "STORNIERT",
]);

export const leistungenTable = pgTable("leistungen", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  projectId: text("project_id")
    .notNull()
    .references(() => projectsTable.id, { onDelete: "cascade" }),
  leistungsBezeichnung: text("leistungs_bezeichnung").notNull(),
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
  status: leistungStatusEnum("status").notNull().default("GEPLANT"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
  /**
   * Monotonically incrementing version number.
   * Starts at 1 for all existing Leistungen.
   * Incremented when Leistung data changes in a way that invalidates active Leistungsanfragen.
   */
  version: integer("version").notNull().default(1),
  /**
   * Dedicated lifecycle status for the Leistung itself.
   * Parallel to `status` — not a replacement.
   */
  lifecycleStatus: leistungLifecycleStatusEnum("lifecycle_status")
    .notNull()
    .default("PLANNED"),

  // ── GU-internal fields — NEVER released to NU via LeistungsanfrageSnapshot ─
  // These fields are excluded from buildLeistungsanfrageSnapshot() by design.

  /** Internal notes for the GU team — not shared with NU */
  internalNote: text("internal_note"),
  /** Internal cost estimate / budget note — not shared with NU */
  costEstimate: text("cost_estimate"),
  /** Procurement priority (HIGH/MEDIUM/LOW) — not shared with NU */
  procurementPriority: leistungProcurementPriorityEnum("procurement_priority"),
  /** Risk classification (A/B/C) — not shared with NU */
  riskClassification: leistungRiskClassificationEnum("risk_classification"),

  /**
   * Duration in working days (0.5 steps).
   * When set, plannedEnd is computed from plannedStart + durationDays using
   * the project calendar. Null = manual end date (legacy behaviour).
   */
  durationDays: numeric("duration_days", { precision: 4, scale: 1 }),
});

export const insertLeistungSchema = createInsertSchema(leistungenTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertLeistung = z.infer<typeof insertLeistungSchema>;
export type Leistung = typeof leistungenTable.$inferSelect;

// ── Enum aliases (enum TS symbols only — tables/types come from legacy-takt-adapters) ─
/** @deprecated Use leistungProcurementPriorityEnum */
export const taktProcurementPriorityEnum = leistungProcurementPriorityEnum;
/** @deprecated Use leistungRiskClassificationEnum */
export const taktRiskClassificationEnum = leistungRiskClassificationEnum;
/** @deprecated Use leistungLifecycleStatusEnum */
export const taktLifecycleStatusEnum = leistungLifecycleStatusEnum;
/** @deprecated Use leistungStatusEnum */
export const taktStatusEnum = leistungStatusEnum;
/** @deprecated Use insertLeistungSchema */
export const insertTaktSchema = insertLeistungSchema;
