/**
 * NU-private resource planning tables (Tasks 4.2, 4.3).
 *
 * Data sovereignty rules:
 *   - All rows are scoped to nuOrgId. GU/Hub users must NEVER see these tables.
 *   - nuLocalProjects.customerAlias is anonymised — never transmitted externally.
 *   - resourceBookings.sourceReferenceId is a plain-text polymorphic reference
 *     (no FK) so it can point to TaktRequests, manual blocks, etc.
 *   - These tables must not appear in Takt snapshots or Hub messages.
 */
import {
  pgTable,
  pgEnum,
  text,
  timestamp,
  date,
  integer,
  index,
  unique,
} from "drizzle-orm/pg-core";
import { organizationsTable } from "./organizations";
import { resourcesTable } from "./resources";

// ── Enums ─────────────────────────────────────────────────────────────────────

export const localProjectStatusEnum = pgEnum("local_project_status", [
  "PLANNED",
  "ACTIVE",
  "COMPLETED",
  "CANCELLED",
]);

export const resourceBookingSourceTypeEnum = pgEnum(
  "resource_booking_source_type",
  [
    "LOCAL_PROJECT",
    "TAKT_REQUEST",
    "MANUAL_BLOCK",
    "ABSENCE",
    "MAINTENANCE",
  ],
);

export const resourceBookingStatusEnum = pgEnum("resource_booking_status", [
  "TENTATIVE",
  "CONFIRMED",
  "CANCELLED",
]);

// ── nu_local_projects ──────────────────────────────────────────────────────────

/**
 * An NU's internal project record.
 *
 * Represents work the NU is planning across one or more GU relationships.
 * customerAlias anonymises the GU identity (e.g. "Kunde A") — this field
 * must NEVER appear in external messages or TaktRequest responses.
 *
 * localProjectCode is unique per NU organisation (composite UNIQUE constraint).
 * startDate/endDate are date-only strings matching the existing conventions
 * in this codebase (date column, mode:"string").
 */
export const nuLocalProjectsTable = pgTable(
  "nu_local_projects",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),

    /** NU organisation that owns this project — all access is scoped to this */
    nuOrgId: text("nu_org_id")
      .notNull()
      .references(() => organizationsTable.id),

    /**
     * NU-internal project code (e.g. "2026-P-042").
     * Unique within this NU organisation (not globally unique).
     */
    localProjectCode: text("local_project_code").notNull(),

    /** Human-readable display name for the project within the NU system */
    displayName: text("display_name").notNull(),

    /**
     * Anonymised alias for the GU / customer (e.g. "Kunde A", "GU Nord").
     * MUST NOT be transmitted in external messages or TaktRequest responses.
     */
    customerAlias: text("customer_alias"),

    /** Date-only start boundary (inclusive) */
    startDate: date("start_date", { mode: "string" }),

    /** Date-only end boundary (inclusive); must be ≥ startDate when both set */
    endDate: date("end_date", { mode: "string" }),

    status: localProjectStatusEnum("status").notNull().default("PLANNED"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),

    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    // Core uniqueness: same localProjectCode cannot appear twice for one NU
    unique("uq_nu_local_project_code").on(t.nuOrgId, t.localProjectCode),
    // Single-column indexes
    index("nu_local_projects_nu_org_id_idx").on(t.nuOrgId),
    index("nu_local_projects_status_idx").on(t.status),
    index("nu_local_projects_start_date_idx").on(t.startDate),
    index("nu_local_projects_end_date_idx").on(t.endDate),
    // Combined
    index("nu_local_projects_nu_org_status_idx").on(t.nuOrgId, t.status),
  ],
);

// ── resource_bookings ──────────────────────────────────────────────────────────

/**
 * General-purpose resource booking.
 *
 * Supersedes resource_assignments for all new coordination flows.
 * resource_assignments is retained for backward compatibility with delegation views.
 *
 * Key design decisions:
 *   - nuOrgId is denormalised on the booking row so org-scoped queries need
 *     no join to the resources table.
 *   - sourceReferenceId is a nullable plain-text field (no FK) to support
 *     polymorphic sources: TaktRequest IDs, local project IDs, manual strings.
 *   - utilizationPercent defaults to 100 and is constrained to 1–100.
 *     CHECK constraints are enforced in the application layer (see tests).
 *   - endAt > startAt is enforced in the application layer.
 */
export const resourceBookingsTable = pgTable(
  "resource_bookings",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),

    /** NU organisation — denormalised for efficient org-scoped queries */
    nuOrgId: text("nu_org_id")
      .notNull()
      .references(() => organizationsTable.id),

    /** The resource being booked — must belong to the same nuOrgId */
    resourceId: text("resource_id")
      .notNull()
      .references(() => resourcesTable.id, { onDelete: "cascade" }),

    /**
     * Optional link to a local project.
     * Required by business rules when sourceType = LOCAL_PROJECT.
     * NULL for ABSENCE, MAINTENANCE, MANUAL_BLOCK without a project context.
     */
    localProjectId: text("local_project_id").references(
      () => nuLocalProjectsTable.id,
      { onDelete: "set null" },
    ),

    /** What created this booking */
    sourceType: resourceBookingSourceTypeEnum("source_type").notNull(),

    /**
     * Polymorphic reference to the originating record.
     * Examples: taktRequestId, "manual-block-2026-Q4".
     * No FK — enables multiple source types without multiple nullable FK columns.
     */
    sourceReferenceId: text("source_reference_id"),

    /** Booking start — inclusive, timezone-aware */
    startAt: timestamp("start_at", { withTimezone: true }).notNull(),

    /** Booking end — exclusive, must be after startAt */
    endAt: timestamp("end_at", { withTimezone: true }).notNull(),

    /**
     * Percentage of resource capacity consumed by this booking.
     * Application must validate: 1 ≤ utilizationPercent ≤ 100.
     */
    utilizationPercent: integer("utilization_percent").notNull().default(100),

    status: resourceBookingStatusEnum("status").notNull().default("TENTATIVE"),

    note: text("note"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),

    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    // Single-column indexes
    index("resource_bookings_nu_org_id_idx").on(t.nuOrgId),
    index("resource_bookings_resource_id_idx").on(t.resourceId),
    index("resource_bookings_local_project_id_idx").on(t.localProjectId),
    index("resource_bookings_source_type_idx").on(t.sourceType),
    index("resource_bookings_status_idx").on(t.status),
    index("resource_bookings_start_at_idx").on(t.startAt),
    index("resource_bookings_end_at_idx").on(t.endAt),
    // Combined indexes for the most common query patterns
    index("resource_bookings_resource_time_idx").on(t.resourceId, t.startAt, t.endAt),
    index("resource_bookings_nu_org_time_idx").on(t.nuOrgId, t.startAt, t.endAt),
    index("resource_bookings_nu_org_status_idx").on(t.nuOrgId, t.status),
    index("resource_bookings_local_project_status_idx").on(t.localProjectId, t.status),
  ],
);

// ── Types ─────────────────────────────────────────────────────────────────────

export type NuLocalProject = typeof nuLocalProjectsTable.$inferSelect;
export type InsertNuLocalProject = typeof nuLocalProjectsTable.$inferInsert;
export type ResourceBooking = typeof resourceBookingsTable.$inferSelect;
export type InsertResourceBooking = typeof resourceBookingsTable.$inferInsert;
