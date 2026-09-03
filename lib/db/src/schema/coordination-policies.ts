import {
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { projectsTable } from "./projects";

/**
 * Construct-X business policies are separate from the technical EDC/DataOffer
 * layer.  A policy row is an immutable versioned envelope; later versions
 * point at the policy they inherit from and carry their resolved decision.
 */
export const coordinationPolicyKindEnum = pgEnum("coordination_policy_kind", [
  "PROJECT_AGREEMENT",
  "PERFORMANCE_REQUEST",
  "SCHEDULE_CHANGE",
  "DATA_OFFER",
]);

export const coordinationPolicyLifecycleEnum = pgEnum("coordination_policy_lifecycle", [
  "DRAFT",
  "PUBLISHED",
  "CONSENT_REQUIRED",
  "ACCEPTED",
  "REJECTED",
  "SUPERSEDED",
  "REVOKED",
]);

export const coordinationPolicyDeltaClassEnum = pgEnum("coordination_policy_delta_class", [
  "WITHIN_BASELINE",
  "REQUIRES_CONSENT",
  "NOT_PERMITTED",
]);

export const coordinationPoliciesTable = pgTable(
  "coordination_policies",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    policyKey: text("policy_key").notNull(),
    version: integer("version").notNull().default(1),
    kind: coordinationPolicyKindEnum("kind").notNull(),
    projectId: text("project_id")
      .notNull()
      .references(() => projectsTable.id, { onDelete: "restrict" }),
    providerOrgId: text("provider_org_id").notNull(),
    recipientOrgId: text("recipient_org_id").notNull(),
    parentPolicyId: text("parent_policy_id").references(
      (): AnyPgColumn => coordinationPoliciesTable.id,
      { onDelete: "restrict" },
    ),
    lifecycleStatus: coordinationPolicyLifecycleEnum("lifecycle_status")
      .notNull()
      .default("DRAFT"),
    deltaClass: coordinationPolicyDeltaClassEnum("delta_class"),
    policySnapshot: jsonb("policy_snapshot").$type<Record<string, unknown>>().notNull(),
    diff: jsonb("diff").$type<Record<string, unknown> | null>(),
    effectivePolicy: jsonb("effective_policy").$type<Record<string, unknown> | null>(),
    consentedAt: timestamp("consented_at", { withTimezone: true }),
    consentedByOrgId: text("consented_by_org_id"),
    createdByUserId: text("created_by_user_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (table) => [
    unique("coordination_policies_key_version_unique").on(table.policyKey, table.version),
    index("coordination_policies_project_idx").on(table.projectId),
    index("coordination_policies_parent_idx").on(table.parentPolicyId),
    index("coordination_policies_recipient_kind_idx").on(table.recipientOrgId, table.kind),
  ],
);

export type CoordinationPolicy = typeof coordinationPoliciesTable.$inferSelect;
export type InsertCoordinationPolicy = typeof coordinationPoliciesTable.$inferInsert;
export type CoordinationPolicyKind = typeof coordinationPolicyKindEnum.enumValues[number];
export type CoordinationPolicyLifecycle = typeof coordinationPolicyLifecycleEnum.enumValues[number];
export type CoordinationPolicyDeltaClass = typeof coordinationPolicyDeltaClassEnum.enumValues[number];