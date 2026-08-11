import {
  pgTable,
  text,
  timestamp,
  date,
  doublePrecision,
  pgEnum,
  jsonb,
  boolean,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organizationsTable } from "./organizations";
import { delegationsTable } from "./delegations";

// ── Enums ─────────────────────────────────────────────────────────────────────

/**
 * Resource types — CREW added in Task 4.3.
 * Existing values (EMPLOYEE, EQUIPMENT, MACHINE, OTHER) are retained for
 * backward compatibility with existing resource_assignments and AN-app views.
 */
export const resourceTypeEnum = pgEnum("resource_type", [
  "EMPLOYEE",
  "CREW",
  "EQUIPMENT",
  "MACHINE",
  "OTHER",
]);

/**
 * Unit of capacity for a resource.
 * PERSONS: crew headcount; UNITS: equipment count; HOURS_PER_DAY: time-based;
 * PERCENT: percentage of a larger pool.
 */
export const capacityUnitEnum = pgEnum("capacity_unit", [
  "PERSONS",
  "UNITS",
  "HOURS_PER_DAY",
  "PERCENT",
]);

/**
 * Category for named resource types (resource_types table).
 * PERSONNEL: individual workers; CREW: pre-formed teams.
 */
export const resourceTypeCategoryEnum = pgEnum("resource_type_category", [
  "PERSONNEL",
  "CREW",
  "EQUIPMENT",
  "MACHINE",
  "OTHER",
]);

// ── Named resource types (per AN-organisation) ────────────────────────────────

/**
 * Named, organisation-scoped resource types (e.g. "Facharbeiter Trockenbau").
 * Acts as a fachliche Klammer over concrete resources.
 * Soft-deleted via `active = false`; no physical deletes.
 */
export const resourceTypesTable = pgTable("resource_types", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  anOrgId: text("an_org_id")
    .notNull()
    .references(() => organizationsTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  category: resourceTypeCategoryEnum("category").notNull(),

  // ── DTC alignment (Task DTC-1) ─────────────────────────────────────────────
  /** Short internal code, e.g. "LAB-DRYWALL" */
  code: text("code"),
  /**
   * Full DTC-v2 class URI that this resource type maps to.
   * One of:
   *   https://dtc-ontology.cms.ed.tum.de/ontology/v2#AsPlannedWorker
   *   https://dtc-ontology.cms.ed.tum.de/ontology/v2#AsPlannedWorkerCrew
   *   https://dtc-ontology.cms.ed.tum.de/ontology/v2#AsPlannedEquipment
   *   https://dtc-ontology.cms.ed.tum.de/ontology/v2#AsPlannedTemporaryEquipment
   */
  dtcClass: text("dtc_class"),
  /** Optional external classification system label (e.g. "INTERNAL", "STLB-Bau") */
  classificationSystem: text("classification_system"),
  /** Optional classification code within that system */
  classificationCode: text("classification_code"),

  // ── Legacy fields (retained for backward compatibility) ────────────────────
  /** Optional freetext qualification description for this type */
  qualification: text("qualification"),
  /** Unit of capacity (reuses the shared enum) */
  capacityUnit: capacityUnitEnum("capacity_unit"),
  /** Default daily capacity — interpretation depends on capacityUnit */
  defaultDailyCapacity: doublePrecision("default_daily_capacity"),

  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type ResourceTypeRow = typeof resourceTypesTable.$inferSelect;
export type InsertResourceTypeRow = typeof resourceTypesTable.$inferInsert;

// ── Concrete resources ────────────────────────────────────────────────────────

export const resourcesTable = pgTable("resources", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  anOrgId: text("an_org_id")
    .notNull()
    .references(() => organizationsTable.id, { onDelete: "cascade" }),
  type: resourceTypeEnum("type").notNull(),
  name: text("name").notNull(),

  // ── Legacy fields (retained for backward compatibility) ───────────────────
  /** Free-text qualification string — retained; superseded by qualifications[] */
  qualification: text("qualification"),
  /** Daily capacity in hours — retained; superseded by capacity + capacityUnit */
  dailyCapacityHours: doublePrecision("daily_capacity_hours"),
  /** UI display colour */
  color: text("color"),

  // ── New fields added in Task 4.3 ─────────────────────────────────────────
  /**
   * Trade / Gewerk — standardised string (e.g. DRYWALL, MEP, CONCRETE).
   * Nullable — not required for all resource types.
   */
  trade: text("trade"),

  /**
   * List of skills (deduplicated, no empty strings).
   * Stored as JSONB string array; default empty list.
   */
  skills: jsonb("skills").$type<string[]>().notNull().default([]),

  /**
   * List of qualifications or certificates (deduplicated, no empty strings).
   * Long-term replacement for the free-text `qualification` column.
   */
  qualifications: jsonb("qualifications").$type<string[]>().notNull().default([]),

  /**
   * Quantitative capacity of this resource.
   * Interpretation depends on capacityUnit.
   * Must be > 0 when set (enforced in application layer).
   */
  capacity: doublePrecision("capacity"),

  /**
   * Unit for the capacity field.
   * Convention: CREW → PERSONS, EQUIPMENT/MACHINE → UNITS.
   */
  capacityUnit: capacityUnitEnum("capacity_unit"),

  /**
   * Optional calendar ID for future shift-pattern integration.
   * No calendar engine is implemented — placeholder for future use.
   */
  calendarId: text("calendar_id"),

  /**
   * Whether this resource is active and available for new bookings.
   * Inactive resources are excluded from automatic availability suggestions.
   */
  active: boolean("active").notNull().default(true),

  /**
   * Optional link to a named resource type (resource_types).
   * Nullable — existing resources without a type remain valid.
   */
  resourceTypeId: text("resource_type_id").references(
    () => resourceTypesTable.id,
    { onDelete: "set null" },
  ),

  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),

  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
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
  /**
   * Soft-delete flag. Set to false instead of physically deleting so that
   * historical assignment data remains readable for audit purposes.
   */
  active: boolean("active").notNull().default(true),
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
