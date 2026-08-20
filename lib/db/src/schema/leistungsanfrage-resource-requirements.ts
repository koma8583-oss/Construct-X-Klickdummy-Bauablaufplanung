/**
 * Leistungsanfrage Resource Requirements — Task #118.
 *
 * Canonical rename of takt_request_resource_requirements (Task #196).
 *
 * Stores the AN's resource requirements for a Leistungsanfrage.
 */
import {
  pgTable,
  text,
  integer,
  numeric,
  timestamp,
  date,
  index,
} from "drizzle-orm/pg-core";
import { leistungsanfragenTable } from "./leistungsanfragen";
import { organizationsTable } from "./organizations";
import { resourceTypesTable } from "./resources";

export const leistungsanfrageResourceRequirementsTable = pgTable(
  "leistungsanfrage_resource_requirements",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),

    /** The Leistungsanfrage this requirement belongs to */
    leistungsanfrageId: text("leistungsanfrage_id")
      .notNull()
      .references(() => leistungsanfragenTable.id, { onDelete: "cascade" }),

    /** The AN organisation that recorded this requirement */
    anOrgId: text("an_org_id")
      .notNull()
      .references(() => organizationsTable.id),

    /** Optional: link to a specific ResourceType in the AN's catalogue */
    resourceTypeId: text("resource_type_id").references(
      () => resourceTypesTable.id,
      { onDelete: "set null" },
    ),

    /** Required capacity (e.g. number of persons, units, hours/day) */
    requiredCapacity: numeric("required_capacity", { precision: 10, scale: 2 }),

    /** Expected utilization percentage (0–100) */
    utilizationPercent: integer("utilization_percent").notNull().default(100),

    /** Free-text qualification requirement */
    requiredQualification: text("required_qualification"),

    /** Planned start of this resource's deployment */
    periodStart: date("period_start"),

    /** Planned end of this resource's deployment */
    periodEnd: date("period_end"),

    /** Internal notes — never transmitted externally */
    notes: text("notes"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index("leistungsanfrage_resource_reqs_anfrage_id_idx").on(t.leistungsanfrageId),
    index("leistungsanfrage_resource_reqs_an_org_id_idx").on(t.anOrgId),
  ],
);

export type LeistungsanfrageResourceRequirement =
  typeof leistungsanfrageResourceRequirementsTable.$inferSelect;
export type InsertLeistungsanfrageResourceRequirement =
  typeof leistungsanfrageResourceRequirementsTable.$inferInsert;

// ── No deprecated table/type aliases here — they live in legacy-takt-adapters.ts
