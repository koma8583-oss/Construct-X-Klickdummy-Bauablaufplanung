/**
 * Takt Request Resource Requirements — Task #118.
 *
 * Stores the AN's resource requirements for a TaktRequest.
 * Each row represents one resource type needed for the execution of the Takt.
 * These are used by the availability check to evaluate feasibility per type.
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
import { taktRequestsTable } from "./takt-requests";
import { organizationsTable } from "./organizations";
import { resourceTypesTable } from "./resources";

export const taktRequestResourceRequirementsTable = pgTable(
  "takt_request_resource_requirements",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),

    /** The TaktRequest this requirement belongs to */
    taktRequestId: text("takt_request_id")
      .notNull()
      .references(() => taktRequestsTable.id, { onDelete: "cascade" }),

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

    /** Free-text qualification requirement (e.g. "Kranführerschein") */
    requiredQualification: text("required_qualification"),

    /** Planned start of this resource's deployment (defaults to snapshot time window) */
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
    index("takt_req_resource_reqs_request_id_idx").on(t.taktRequestId),
    index("takt_req_resource_reqs_an_org_id_idx").on(t.anOrgId),
  ],
);

export type TaktRequestResourceRequirement =
  typeof taktRequestResourceRequirementsTable.$inferSelect;
export type InsertTaktRequestResourceRequirement =
  typeof taktRequestResourceRequirementsTable.$inferInsert;
