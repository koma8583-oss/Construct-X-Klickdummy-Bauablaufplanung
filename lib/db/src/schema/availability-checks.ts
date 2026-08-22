/**
 * Availability checks — Task 4.5.
 *
 * Stores the full result of a NU's feasibility check for a TaktRequest.
 *
 * Data sovereignty rules (binding):
 *   - internalResultPayload contains conflicts, resource IDs, local project IDs,
 *     qualification gaps etc. — MUST NEVER be transmitted to GU or Hub.
 *   - publicResultPayload contains only: recommendedDecision, reasonCode, alternatives[].
 *     Alternatives expose only: alternativeId, rank, timeWindow, crewSize, conditions.
 *   - These rows are only accessible to the owning NU organisation.
 *
 * History strategy:
 *   - Each runAvailabilityCheck() call creates a NEW row.
 *   - runNumber increments per (taktRequestId, nuOrgId) — the highest
 *     runNumber is the most recent check.
 *   - supersedesCheckId links to the previous check row for full audit history.
 *   - "Latest successful check" = MAX(runNumber) WHERE status = 'COMPLETED'.
 */
import {
  pgTable,
  pgEnum,
  text,
  integer,
  timestamp,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { organizationsTable } from "./organizations";
import { leistungsanfragenTable as taktRequestsTable } from "./leistungsanfragen";
import { usersTable } from "./users";

// ── Enums ─────────────────────────────────────────────────────────────────────

export const availabilityCheckStatusEnum = pgEnum("availability_check_status", [
  "PENDING",
  "RUNNING",
  "COMPLETED",
  "FAILED",
]);

export const availabilityResultEnum = pgEnum("availability_result", [
  "FEASIBLE",
  "FEASIBLE_WITH_ALTERNATIVES",
  "NOT_FEASIBLE",
]);

// ── Internal payload types (for application layer only — never serialised to GU) ──

/** Shape stored in internalResultPayload. NEVER sent externally. */
export interface InternalResultPayload {
  conflicts: Array<{
    resourceId: string;
    resourceName: string;
    conflictType: "OVERLAP" | "CAPACITY_EXCEEDED" | "MISSING_QUALIFICATION" | "MISSING_EQUIPMENT";
    /** tentativeness flag — TENTATIVE bookings cause warnings, not hard blocks */
    isTentative?: boolean;
    /** Local project involved in the conflict — internal only */
    localProjectId?: string;
    overlapStart?: string; // ISO 8601
    overlapEnd?: string;   // ISO 8601
    overlapUtilizationSum?: number;
    missingQualification?: string;
  }>;
  availableResources: Array<{
    resourceId: string | null;
    resourceType: string;
    resourceTypeId?: string;
    quantity?: number;
    utilizationPercent?: number;
    periodStart?: string | null;
    periodEnd?: string | null;
  }>;
  missingQualifications: string[];
  unavailableEquipment: string[];
  /** TENTATIVE bookings treated as warnings per task spec */
  tentativeWarnings: Array<{
    resourceId: string;
    bookingId: string;
    overlapStart: string;
    overlapEnd: string;
  }>;
  dailyAvailability?: Array<{
    date: string;
    totalCapacity: number;
    confirmedUsed: number;
    tentativeUsed: number;
    requiredCapacity: number;
    availableCapacity: number;
  }>;
  /** Technical error message when status = FAILED */
  errorMessage?: string;
}

/** Shape stored in publicResultPayload. Safe to include in GU-facing responses. */
export interface PublicResultPayload {
  recommendedDecision: "ACCEPTED" | "ALTERNATIVES_PROPOSED" | "REJECTED";
  reasonCode:
    | "FEASIBLE"
    | "RESOURCE_CONFLICT"
    | "MISSING_QUALIFICATION"
    | "MISSING_EQUIPMENT"
    | "CAPACITY_EXCEEDED"
    | "WINDOW_INFEASIBLE"
    | "CHECK_FAILED";
  /** At most 3 alternatives. No resourceIds, localProjectIds, or internal fields. */
  alternatives: Array<{
    alternativeId: string;
    rank: number;
    timeWindow: { start: string; end: string };
    crewSize: number | null;
    conditions: string | null;
  }>;
  nextAvailableDate?: string | null;
}

// ── Table ─────────────────────────────────────────────────────────────────────

export const availabilityChecksTable = pgTable(
  "availability_checks",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),

    /** NU organisation performing the check */
    nuOrgId: text("nu_org_id")
      .notNull()
      .references(() => organizationsTable.id),

    /** TaktRequest being evaluated */
    taktRequestId: text("takt_request_id")
      .notNull()
      .references(() => taktRequestsTable.id),

    /** Lifecycle status of this check run */
    status: availabilityCheckStatusEnum("status").notNull().default("PENDING"),

    /**
     * Feasibility result — null while PENDING or RUNNING; set on COMPLETED.
     * FAILED checks have no result (null).
     */
    result: availabilityResultEnum("result"),

    /**
     * Monotonically increasing per (taktRequestId, nuOrgId).
     * Highest runNumber = most recent check.
     */
    runNumber: integer("run_number").notNull().default(1),

    /**
     * Links to the previous check for this request (audit trail).
     * Null for the first check.
     */
    supersedesCheckId: text("supersedes_check_id").references(
      (): AnyPgColumn => availabilityChecksTable.id,
    ),

    /**
     * Full conflict detail, resource IDs, local project IDs, etc.
     * MUST NEVER be transmitted to GU or Hub.
     */
    internalResultPayload: jsonb("internal_result_payload").$type<InternalResultPayload>(),

    /**
     * Sanitised result safe for GU consumption.
     * Contains only: recommendedDecision, reasonCode, alternatives (no internal IDs).
     */
    publicResultPayload: jsonb("public_result_payload").$type<PublicResultPayload>(),

    /** Timestamp when the check completed (or failed) */
    checkedAt: timestamp("checked_at", { withTimezone: true }),

    /** User who triggered this check */
    createdByUserId: text("created_by_user_id").references(() => usersTable.id),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index("availability_checks_nu_org_id_idx").on(t.nuOrgId),
    index("availability_checks_takt_request_id_idx").on(t.taktRequestId),
    index("availability_checks_status_idx").on(t.status),
    index("availability_checks_result_idx").on(t.result),
    // Most common query: latest check for a given request + org
    index("availability_checks_request_nu_run_idx").on(t.taktRequestId, t.nuOrgId, t.runNumber),
    index("availability_checks_nu_org_request_idx").on(t.nuOrgId, t.taktRequestId),
  ],
);

export type AvailabilityCheck = typeof availabilityChecksTable.$inferSelect;
export type InsertAvailabilityCheck = typeof availabilityChecksTable.$inferInsert;
