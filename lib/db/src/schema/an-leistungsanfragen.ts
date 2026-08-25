import {
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";

export const anLeistungsanfrageStatusEnum = pgEnum("an_leistungsanfrage_status", [
  "RECEIVED",
  "DETAILS_RETRIEVED",
  "UNDER_REVIEW",
  "RESPONDED",
  "REVISION_REQUIRED",
  "CONFIRMED",
  "CANCELLED",
  "SUPERSEDED",
]);

export const anLeistungsanfragenTable = pgTable(
  "an_leistungsanfragen",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    externalLeistungsanfrageId: text("external_leistungsanfrage_id").notNull(),
    externalRequestVersion: integer("external_request_version").notNull(),
    sourceMessageId: text("source_message_id").notNull(),
    payloadHash: text("payload_hash").notNull(),
    correlationId: text("correlation_id").notNull(),
    senderAgOrgId: text("sender_ag_org_id").notNull(),
    receiverAnOrgId: text("receiver_an_org_id").notNull(),
    projectReference: text("project_reference").notNull(),
    leistungReference: text("leistung_reference").notNull(),
    plannedStart: text("planned_start").notNull(),
    plannedEnd: text("planned_end").notNull(),
    policySnapshot: jsonb("policy_snapshot").$type<Record<string, unknown> | null>(),
    payloadSnapshot: jsonb("payload_snapshot").$type<Record<string, unknown>>().notNull(),
    status: anLeistungsanfrageStatusEnum("status").notNull().default("RECEIVED"),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    detailsRetrievedAt: timestamp("details_retrieved_at", { withTimezone: true }),
    respondedAt: timestamp("responded_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (table) => [
    unique("uq_an_leistungsanfrage_source_message").on(table.sourceMessageId),
    unique("uq_an_leistungsanfrage_receiver_external_version").on(
      table.receiverAnOrgId,
      table.externalLeistungsanfrageId,
      table.externalRequestVersion,
    ),
    index("an_leistungsanfragen_receiver_status_idx").on(table.receiverAnOrgId, table.status),
    index("an_leistungsanfragen_external_idx").on(
      table.receiverAnOrgId,
      table.externalLeistungsanfrageId,
    ),
  ],
);

export const anLeistungsanfrageResourceRequirementsTable = pgTable(
  "an_leistungsanfrage_resource_requirements",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    anLeistungsanfrageId: text("an_leistungsanfrage_id")
      .notNull()
      .references(() => anLeistungsanfragenTable.id, { onDelete: "cascade" }),
    externalResourceTypeCode: text("external_resource_type_code").notNull(),
    externalResourceTypeName: text("external_resource_type_name").notNull(),
    localResourceTypeId: text("local_resource_type_id"),
    requiredCapacity: numeric("required_capacity", { precision: 10, scale: 2 }),
    capacityUnit: text("capacity_unit").notNull(),
    utilizationPercent: integer("utilization_percent").notNull(),
    periodStart: text("period_start").notNull(),
    periodEnd: text("period_end").notNull(),
    requiredQualification: text("required_qualification"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (table) => [
    index("an_leistungsanfrage_resource_requirements_request_idx").on(table.anLeistungsanfrageId),
  ],
);

export type AnLeistungsanfrage = typeof anLeistungsanfragenTable.$inferSelect;
export type AnLeistungsanfrageResourceRequirement =
  typeof anLeistungsanfrageResourceRequirementsTable.$inferSelect;