/**
 * Legacy Takt adapter tables (Task #196).
 *
 * These are separate Drizzle table declarations that point to the same physical
 * tables/columns as the canonical Leistung tables, but use the OLD TypeScript
 * property names (taktBezeichnung, taktId, taktVersion, taktRequestId, etc.).
 *
 * WHY SEPARATE TABLES INSTEAD OF ALIASES:
 *   Drizzle's insert type requires ALL notNull columns to be present in the
 *   values object. If two TS properties share the same physical column on the
 *   same pgTable, both become required for inserts — breaking all existing
 *   call sites that only supply the old name. Separate pgTable declarations
 *   avoid this: each declaration only requires its own set of property names.
 *
 * SAFE TO USE:
 *   - All table declarations here reference the same physical PostgreSQL tables.
 *   - SELECT, INSERT, UPDATE, DELETE against these tables are identical to the
 *     canonical tables at the SQL level — the physical column names are identical.
 *   - Only the TypeScript property names differ.
 *
 * MIGRATION PATH:
 *   When all call sites in the codebase are updated to canonical names, these
 *   declarations and their exports can be deleted in one pass.
 *
 * DO NOT USE for new code — use the canonical leistungen.ts equivalents.
 */

import {
  pgTable,
  text,
  timestamp,
  date,
  pgEnum,
  integer,
  numeric,
  index,
  unique,
  jsonb,
} from "drizzle-orm/pg-core";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { projectsTable } from "./projects";
import { organizationsTable } from "./organizations";
import { usersTable } from "./users";
import { dataPublicationsTable } from "./data-publications";
import { resourceTypesTable } from "./resources";
import { coordinationPoliciesTable } from "./coordination-policies";

// ── Re-use the same enum pg-type names (enum values defined once in canonical files)
// We import the enum objects from canonical so there's exactly one pgEnum() call
// per pg type name — Drizzle would error on duplicate pgEnum() registrations.
import {
  leistungStatusEnum,
  leistungLifecycleStatusEnum,
  leistungProcurementPriorityEnum,
  leistungRiskClassificationEnum,
} from "./leistungen";
import { leistungsanfrageStatusEnum } from "./leistungsanfragen";
import {
  leistungsantwortDecisionEnum,
  leistungsantwortOriginEnum,
  leistungsantwortReasonCodeEnum,
} from "./leistungsantworten";
import { leistungsantwortEntscheidungTypeEnum } from "./leistungsantwort-entscheidungen";
import { leistungsVersionSourceTypeEnum } from "./leistungs-versionen";
import { reminderTypeEnum, reminderStatusEnum } from "./leistungsanfrage-reminders";

// ─────────────────────────────────────────────────────────────────────────────
// 1. takteTable  (physical: leistungen, column takt_bezeichnung → leistungs_bezeichnung)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @deprecated Use leistungenTable. Legacy adapter for code that references old
 * property names (taktBezeichnung) against the canonical "leistungen" table.
 */
export const takteTable = pgTable("leistungen", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  projectId: text("project_id")
    .notNull()
    .references(() => projectsTable.id, { onDelete: "cascade" }),
  /** @deprecated physical col renamed to leistungs_bezeichnung */
  taktBezeichnung: text("leistungs_bezeichnung").notNull(),
  kurzbezeichnung: text("kurzbezeichnung").notNull().default(""),
  zone: text("zone"),
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
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
  version: integer("version").notNull().default(1),
  lifecycleStatus: leistungLifecycleStatusEnum("lifecycle_status")
    .notNull()
    .default("PLANNED"),
  internalNote: text("internal_note"),
  costEstimate: text("cost_estimate"),
  procurementPriority: leistungProcurementPriorityEnum("procurement_priority"),
  riskClassification: leistungRiskClassificationEnum("risk_classification"),
  durationDays: numeric("duration_days", { precision: 4, scale: 1 }),
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. taktRequestsTable  (physical: leistungsanfragen, cols takt_id, takt_version)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @deprecated Use leistungsanfragenTable. Legacy adapter with old property names
 * taktId / taktVersion against the canonical "leistungsanfragen" table.
 */
export const taktRequestsTable = pgTable(
  "leistungsanfragen",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    /** @deprecated physical col renamed to leistung_id */
    taktId: text("leistung_id")
      .notNull()
      .references(() => takteTable.id, { onDelete: "restrict" }),
    /** @deprecated physical col renamed to leistung_version */
    taktVersion: integer("leistung_version").notNull().default(1),
    guOrgId: text("gu_org_id")
      .notNull()
      .references(() => organizationsTable.id),
    nuOrgId: text("nu_org_id")
      .notNull()
      .references(() => organizationsTable.id),
    requestNumber: text("request_number").notNull().unique(),
    /** Shared selection group for parallel AN requests. */
    selectionGroupId: text("selection_group_id")
      .notNull()
      .$defaultFn(() => crypto.randomUUID()),
    status: leistungsanfrageStatusEnum("status").notNull().default("DRAFT"),
    responseRequiredBy: timestamp("response_required_by", { withTimezone: true }),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    detailsRetrievedAt: timestamp("details_retrieved_at", { withTimezone: true }),
    supersedesRequestId: text("supersedes_request_id").references(
      (): AnyPgColumn => taktRequestsTable.id,
    ),
    createdByUserId: text("created_by_user_id")
      .notNull()
      .references(() => usersTable.id),
    dataPublicationId: text("data_publication_id").references(
      () => dataPublicationsTable.id,
    ),
    /** Construct-X child policies are retained on legacy views as well. */
    performancePolicyId: text("performance_policy_id").references(
      () => coordinationPoliciesTable.id,
      { onDelete: "restrict" },
    ),
    scheduleChangePolicyId: text("schedule_change_policy_id").references(
      () => coordinationPoliciesTable.id,
      { onDelete: "restrict" },
    ),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    expiredAt: timestamp("expired_at", { withTimezone: true }),
    lastReminderAt: timestamp("last_reminder_at", { withTimezone: true }),
    reminderCount: integer("reminder_count").notNull().default(0),
    guDecisionRequiredBy: timestamp("gu_decision_required_by", { withTimezone: true }),
    agreedStart: timestamp("agreed_start", { withTimezone: true }),
    agreedEnd: timestamp("agreed_end", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index("takt_requests_takt_id_idx").on(t.taktId),
    index("takt_requests_gu_org_id_idx").on(t.guOrgId),
    index("takt_requests_nu_org_id_idx").on(t.nuOrgId),
    index("takt_requests_status_idx").on(t.status),
    index("takt_requests_selection_group_id_idx").on(t.selectionGroupId),
    index("takt_requests_response_required_by_idx").on(t.responseRequiredBy),
    index("takt_requests_expires_at_idx").on(t.expiresAt),
    index("takt_requests_created_at_idx").on(t.createdAt),
    index("takt_requests_nu_org_status_idx").on(t.nuOrgId, t.status),
    index("takt_requests_gu_org_status_idx").on(t.guOrgId, t.status),
    index("takt_requests_takt_version_idx").on(t.taktId, t.taktVersion),
    index("takt_requests_status_expires_at_idx").on(t.status, t.expiresAt),
  ],
);

// ─────────────────────────────────────────────────────────────────────────────
// 3. taktRequestSnapshotsTable  (physical: leistungsanfrage_snapshots, col takt_request_id)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @deprecated Use leistungsanfrageSnapshotsTable. Legacy adapter with old property
 * name taktRequestId against the canonical "leistungsanfrage_snapshots" table.
 */
export const taktRequestSnapshotsTable = pgTable(
  "leistungsanfrage_snapshots",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    /** @deprecated physical col renamed to leistungsanfrage_id */
    taktRequestId: text("leistungsanfrage_id")
      .notNull()
      .unique()
      .references(() => taktRequestsTable.id, { onDelete: "cascade" }),
    schemaVersion: text("schema_version").notNull().default("1.0"),
    snapshotPayload: jsonb("snapshot_payload")
      .$type<Record<string, unknown>>()
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// 4. taktResponsesTable  (physical: leistungsantworten, col takt_request_id)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @deprecated Use leistungsantwortenTable. Legacy adapter with old property name
 * taktRequestId against the canonical "leistungsantworten" table.
 */
export const taktResponsesTable = pgTable(
  "leistungsantworten",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    /** @deprecated physical col renamed to leistungsanfrage_id */
    taktRequestId: text("leistungsanfrage_id")
      .notNull()
      .unique()
      .references(() => taktRequestsTable.id, { onDelete: "cascade" }),
    messageId: text("message_id").unique(),
    origin: leistungsantwortOriginEnum("origin").notNull().default("LOCAL"),
    sourceOrgId: text("source_org_id").references(() => organizationsTable.id),
    receivedAt: timestamp("received_at", { withTimezone: true }),
    decision: leistungsantwortDecisionEnum("decision").notNull(),
    reasonCode: leistungsantwortReasonCodeEnum("reason_code"),
    comment: text("comment"),
    acceptedStart: timestamp("accepted_start", { withTimezone: true }),
    acceptedEnd: timestamp("accepted_end", { withTimezone: true }),
    nextAvailableDate: date("next_available_date", { mode: "string" }),
    responsePayloadHash: text("response_payload_hash").unique(),
    createdByUserId: text("created_by_user_id")
      .references(() => usersTable.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// 5. taktResponseAlternativesTable  (physical: leistungsantwort_alternativen)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @deprecated Use leistungsantwortAlternativenTable.
 */
export const taktResponseAlternativesTable = pgTable(
  "leistungsantwort_alternativen",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    responseId: text("response_id")
      .notNull()
      .references(() => taktResponsesTable.id, { onDelete: "cascade" }),
    alternativeId: text("alternative_id").notNull(),
    rank: integer("rank").notNull(),
    proposedStart: timestamp("proposed_start", { withTimezone: true }).notNull(),
    proposedEnd: timestamp("proposed_end", { withTimezone: true }).notNull(),
    crewSize: integer("crew_size"),
    conditions: jsonb("conditions").$type<string[]>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("uq_response_alternative_id").on(t.responseId, t.alternativeId),
    unique("uq_response_rank").on(t.responseId, t.rank),
    index("takt_response_alternatives_response_id_idx").on(t.responseId),
  ],
);

// ─────────────────────────────────────────────────────────────────────────────
// 6. taktResponseDecisionsTable  (physical: leistungsantwort_entscheidungen, col takt_request_id)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @deprecated Use leistungsantwortEntscheidungenTable. Legacy adapter with old
 * property name taktRequestId against the canonical table.
 */
export const taktResponseDecisionsTable = pgTable(
  "leistungsantwort_entscheidungen",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    /** @deprecated physical col renamed to leistungsanfrage_id */
    taktRequestId: text("leistungsanfrage_id")
      .notNull()
      .references(() => taktRequestsTable.id, { onDelete: "restrict" }),
    responseId: text("response_id")
      .notNull()
      .unique()
      .references(() => taktResponsesTable.id, { onDelete: "restrict" }),
    guOrgId: text("gu_org_id")
      .notNull()
      .references(() => organizationsTable.id),
    decisionType: leistungsantwortEntscheidungTypeEnum("decision_type").notNull(),
    acceptedAlternativeId: text("accepted_alternative_id").references(
      () => taktResponseAlternativesTable.id,
      { onDelete: "restrict" },
    ),
    comment: text("comment"),
    idempotencyKey: text("idempotency_key"),
    decidedByUserId: text("decided_by_user_id")
      .notNull()
      .references(() => usersTable.id),
    decidedAt: timestamp("decided_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("takt_response_decisions_request_id_idx").on(t.taktRequestId),
    index("takt_response_decisions_gu_org_idx").on(t.guOrgId),
    index("takt_response_decisions_decision_type_idx").on(t.decisionType),
    unique("uq_takt_response_decision_idempotency").on(t.guOrgId, t.idempotencyKey),
  ],
);

// ─────────────────────────────────────────────────────────────────────────────
// 7. taktDependenciesTable  (physical: leistungsabhaengigkeiten)
// ─────────────────────────────────────────────────────────────────────────────

import { leistungsabhaengigkeitTypeEnum } from "./leistungsabhaengigkeiten";

/**
 * @deprecated Use leistungsabhaengigkeitenTable.
 */
export const taktDependenciesTable = pgTable(
  "leistungsabhaengigkeiten",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    projectId: text("project_id")
      .notNull()
      .references(() => projectsTable.id, { onDelete: "cascade" }),
    predecessorId: text("predecessor_id")
      .notNull()
      .references(() => takteTable.id, { onDelete: "cascade" }),
    successorId: text("successor_id")
      .notNull()
      .references(() => takteTable.id, { onDelete: "cascade" }),
    type: leistungsabhaengigkeitTypeEnum("type").notNull().default("EA"),
    lagDays: integer("lag_days").notNull().default(0),
  },
  (t) => ({
    uniqPair: unique().on(t.predecessorId, t.successorId),
  }),
);

// ─────────────────────────────────────────────────────────────────────────────
// 8. taktVersionsTable  (physical: leistungs_versionen, col takt_id)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @deprecated Use leistungsVersionenTable. Legacy adapter with old property name
 * taktId against the canonical "leistungs_versionen" table.
 */
export const taktVersionsTable = pgTable(
  "leistungs_versionen",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    /** @deprecated physical col renamed to leistung_id */
    taktId: text("leistung_id")
      .notNull()
      .references(() => takteTable.id, { onDelete: "restrict" }),
    version: integer("version").notNull(),
    sourceType: leistungsVersionSourceTypeEnum("source_type").notNull(),
    sourceRequestId: text("source_request_id").references(
      () => taktRequestsTable.id,
      { onDelete: "set null" },
    ),
    sourceResponseId: text("source_response_id").references(
      () => taktResponsesTable.id,
      { onDelete: "restrict" },
    ),
    sourceDecisionId: text("source_decision_id").references(
      () => taktResponseDecisionsTable.id,
      { onDelete: "restrict" },
    ),
    snapshotPayload: jsonb("snapshot_payload")
      .$type<Record<string, unknown>>()
      .notNull(),
    contentHash: text("content_hash"),
    createdByUserId: text("created_by_user_id").references(
      () => usersTable.id,
      { onDelete: "set null" },
    ),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("uq_takt_version").on(t.taktId, t.version),
    index("takt_versions_takt_id_idx").on(t.taktId),
    index("takt_versions_source_type_idx").on(t.sourceType),
    index("takt_versions_content_hash_idx").on(t.contentHash),
  ],
);

// ─────────────────────────────────────────────────────────────────────────────
// 9. taktRequestAuditEventsTable  (physical: leistungsanfrage_audit_events)
// ─────────────────────────────────────────────────────────────────────────────

import {
  leistungsanfrageAuditEventTypeEnum,
  leistungsanfrageAuditActorRoleEnum,
} from "./leistungsanfrage-audit-events";

/**
 * @deprecated Use leistungsanfrageAuditEventsTable.
 */
export const taktRequestAuditEventsTable = pgTable(
  "leistungsanfrage_audit_events",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    requestId: text("request_id")
      .notNull()
      .references(() => taktRequestsTable.id, { onDelete: "cascade" }),
    eventType: leistungsanfrageAuditEventTypeEnum("event_type").notNull(),
    actorOrgId: text("actor_org_id").references(() => organizationsTable.id),
    actorUserId: text("actor_user_id").references(() => usersTable.id),
    actorRole: leistungsanfrageAuditActorRoleEnum("actor_role"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("takt_audit_request_id_idx").on(t.requestId),
    index("takt_audit_event_type_idx").on(t.eventType),
    index("takt_audit_occurred_at_idx").on(t.occurredAt),
    index("takt_audit_actor_org_id_idx").on(t.actorOrgId),
    index("takt_audit_request_occurred_at_idx").on(t.requestId, t.occurredAt),
  ],
);

// ─────────────────────────────────────────────────────────────────────────────
// 10. taktRequestRemindersTable  (physical: leistungsanfrage_reminders, col takt_request_id)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @deprecated Use leistungsanfrageRemindersTable. Legacy adapter with old property
 * name taktRequestId against the canonical "leistungsanfrage_reminders" table.
 */
export const taktRequestRemindersTable = pgTable(
  "leistungsanfrage_reminders",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    /** @deprecated physical col renamed to leistungsanfrage_id */
    taktRequestId: text("leistungsanfrage_id")
      .notNull()
      .references(() => taktRequestsTable.id, { onDelete: "cascade" }),
    reminderType: reminderTypeEnum("reminder_type").notNull(),
    recipientOrgId: text("recipient_org_id")
      .notNull()
      .references(() => organizationsTable.id),
    recipientUserId: text("recipient_user_id").references(() => usersTable.id),
    scheduledFor: timestamp("scheduled_for", { withTimezone: true }).notNull(),
    status: reminderStatusEnum("status").notNull().default("PENDING"),
    deduplicationKey: text("deduplication_key").notNull(),
    messageId: text("message_id").unique(),
    attemptCount: integer("attempt_count").notNull().default(0),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    failureReason: text("failure_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// 11. taktRequestResourceRequirementsTable  (physical: leistungsanfrage_resource_requirements, col takt_request_id)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @deprecated Use leistungsanfrageResourceRequirementsTable. Legacy adapter with
 * old property name taktRequestId against the canonical table.
 */
export const taktRequestResourceRequirementsTable = pgTable(
  "leistungsanfrage_resource_requirements",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    /** @deprecated physical col renamed to leistungsanfrage_id */
    taktRequestId: text("leistungsanfrage_id")
      .notNull()
      .references(() => taktRequestsTable.id, { onDelete: "cascade" }),
    anOrgId: text("an_org_id")
      .notNull()
      .references(() => organizationsTable.id),
    resourceTypeId: text("resource_type_id").references(
      () => resourceTypesTable.id,
      { onDelete: "set null" },
    ),
    requiredCapacity: numeric("required_capacity", { precision: 10, scale: 2 }),
    utilizationPercent: integer("utilization_percent").notNull().default(100),
    requiredQualification: text("required_qualification"),
    periodStart: date("period_start"),
    periodEnd: date("period_end"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
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

// ─────────────────────────────────────────────────────────────────────────────
// Legacy type aliases
//
// Select types include BOTH the old property name (e.g. taktId) from the legacy
// adapter table AND a canonical alias (e.g. leistungId) so that new route code
// written against canonical names compiles against legacy-named service return
// values.  Insert types only include the legacy name (canonical name tables are
// used for new inserts).
// ─────────────────────────────────────────────────────────────────────────────

type _TaktInferSelect = typeof takteTable.$inferSelect;
/** @deprecated Use Leistung */
export type Takt = _TaktInferSelect & {
  /** @deprecated Canonical alias for taktBezeichnung */
  leistungsBezeichnung?: string;
};
/** @deprecated Use InsertLeistung */
export type InsertTakt = typeof takteTable.$inferInsert;

/** @deprecated Use LeistungsanfrageStatus */
export type TaktRequestStatus = typeof taktRequestsTable.$inferSelect["status"];

type _TaktRequestInferSelect = typeof taktRequestsTable.$inferSelect;
/**
 * @deprecated Use Leistungsanfrage.
 * Exposes both legacy names (taktId, taktVersion) and canonical aliases
 * (leistungId, leistungVersion) so that routes written against either naming
 * convention compile without changes.
 */
export type TaktRequest = _TaktRequestInferSelect & {
  /** @deprecated Canonical alias for taktId */
  leistungId?: string;
  /** @deprecated Canonical alias for taktVersion */
  leistungVersion?: number;
};
/** @deprecated Use InsertLeistungsanfrage */
export type InsertTaktRequest = typeof taktRequestsTable.$inferInsert;

type _TaktRequestSnapshotInferSelect = typeof taktRequestSnapshotsTable.$inferSelect;
/**
 * @deprecated Use LeistungsanfrageSnapshot.
 * Exposes both taktRequestId (legacy) and leistungsanfrageId (canonical).
 */
export type TaktRequestSnapshot = _TaktRequestSnapshotInferSelect & {
  /** @deprecated Canonical alias for taktRequestId */
  leistungsanfrageId?: string;
};
/** @deprecated Use InsertLeistungsanfrageSnapshot */
export type InsertTaktRequestSnapshot = typeof taktRequestSnapshotsTable.$inferInsert;

/** @deprecated Use LeistungsantwortDecision */
export type TaktDecision = typeof taktResponsesTable.$inferSelect["decision"];
/** @deprecated Use LeistungsantwortReasonCode */
export type TaktResponseReasonCode = typeof taktResponsesTable.$inferSelect["reasonCode"];
/** @deprecated Use Leistungsantwort */
export type TaktResponse = typeof taktResponsesTable.$inferSelect & {
  /** @deprecated Canonical alias for taktRequestId */
  leistungsanfrageId?: string;
};
/** @deprecated Use InsertLeistungsantwort */
export type InsertTaktResponse = typeof taktResponsesTable.$inferInsert;

/** @deprecated Use LeistungsantwortAlternativeRow */
export type TaktResponseAlternativeRow = typeof taktResponseAlternativesTable.$inferSelect;
/** @deprecated Use InsertLeistungsantwortAlternative */
export type InsertTaktResponseAlternative = typeof taktResponseAlternativesTable.$inferInsert;

/** @deprecated Use LeistungsantwortEntscheidungType */
export type TaktCoordinationDecisionType = typeof taktResponseDecisionsTable.$inferSelect["decisionType"];
type _TaktResponseDecisionInferSelect = typeof taktResponseDecisionsTable.$inferSelect;
/**
 * @deprecated Use LeistungsantwortEntscheidung.
 * Exposes both taktRequestId (legacy) and leistungsanfrageId (canonical).
 */
export type TaktResponseDecision = _TaktResponseDecisionInferSelect & {
  /** @deprecated Canonical alias for taktRequestId */
  leistungsanfrageId?: string;
};
/** @deprecated Use InsertLeistungsantwortEntscheidung */
export type InsertTaktResponseDecision = typeof taktResponseDecisionsTable.$inferInsert;

/** @deprecated Use Leistungsabhaengigkeit */
export type TaktDependency = typeof taktDependenciesTable.$inferSelect;

type _TaktVersionInferSelect = typeof taktVersionsTable.$inferSelect;
/**
 * @deprecated Use LeistungsVersion.
 * Exposes both taktId (legacy) and leistungId (canonical).
 */
export type TaktVersion = _TaktVersionInferSelect & {
  /** @deprecated Canonical alias for taktId */
  leistungId?: string;
};
/** @deprecated Use InsertLeistungsVersion */
export type InsertTaktVersion = typeof taktVersionsTable.$inferInsert;
/** @deprecated Use LeistungsVersionSourceType */
export type TaktVersionSourceType = typeof taktVersionsTable.$inferSelect["sourceType"];

/** @deprecated Use LeistungsanfrageAuditEventType */
export type TaktAuditEventType = typeof taktRequestAuditEventsTable.$inferSelect["eventType"];
/** @deprecated Use LeistungsanfrageAuditActorRole */
export type TaktAuditActorRole = typeof taktRequestAuditEventsTable.$inferSelect["actorRole"];
/** @deprecated Use LeistungsanfrageAuditEvent */
export type TaktRequestAuditEvent = typeof taktRequestAuditEventsTable.$inferSelect;
/** @deprecated Use InsertLeistungsanfrageAuditEvent */
export type InsertTaktRequestAuditEvent = typeof taktRequestAuditEventsTable.$inferInsert;

type _TaktRequestReminderInferSelect = typeof taktRequestRemindersTable.$inferSelect;
/**
 * @deprecated Use LeistungsanfrageReminder.
 * Exposes both taktRequestId (legacy) and leistungsanfrageId (canonical).
 */
export type TaktRequestReminder = _TaktRequestReminderInferSelect & {
  /** @deprecated Canonical alias for taktRequestId */
  leistungsanfrageId?: string;
};
/** @deprecated Use InsertLeistungsanfrageReminder */
export type InsertTaktRequestReminder = typeof taktRequestRemindersTable.$inferInsert;

type _TaktRequestResourceRequirementInferSelect = typeof taktRequestResourceRequirementsTable.$inferSelect;
/**
 * @deprecated Use LeistungsanfrageResourceRequirement.
 * Exposes both taktRequestId (legacy) and leistungsanfrageId (canonical).
 */
export type TaktRequestResourceRequirement = _TaktRequestResourceRequirementInferSelect & {
  /** @deprecated Canonical alias for taktRequestId */
  leistungsanfrageId?: string;
};
/** @deprecated Use InsertLeistungsanfrageResourceRequirement */
export type InsertTaktRequestResourceRequirement = typeof taktRequestResourceRequirementsTable.$inferInsert;
