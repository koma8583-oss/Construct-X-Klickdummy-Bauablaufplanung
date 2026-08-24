import {
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  index,
} from "drizzle-orm/pg-core";
import { organizationsTable } from "./organizations";
import { projectsTable } from "./projects";
import { dataPublicationsTable } from "./data-publications";

export const projectMembershipStatusEnum = pgEnum("project_membership_status", [
  "INVITED",
  "ACTIVE",
  "REJECTED",
  "REVOKED",
]);

/**
 * Bilateral project relationship. This table answers only whether an AN may
 * participate in a project; trade and work-package assignment remain in the
 * existing project_contractors table.
 */
export const projectMembershipsTable = pgTable(
  "project_memberships",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    projectId: text("project_id")
      .notNull()
      .references(() => projectsTable.id, { onDelete: "cascade" }),
    agOrgId: text("ag_org_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "cascade" }),
    anOrgId: text("an_org_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "cascade" }),
    anParticipantId: text("an_participant_id"),
    /** Publication prepared together with this invitation, if any. */
    dataPublicationId: text("data_publication_id")
      .references(() => dataPublicationsTable.id, { onDelete: "set null" }),
    status: projectMembershipStatusEnum("status").notNull().default("INVITED"),
    invitationMessage: text("invitation_message"),
    invitationId: text("invitation_id").notNull().unique(),
    correlationId: text("correlation_id").notNull().unique(),
    invitationExpiresAt: timestamp("invitation_expires_at", { withTimezone: true }),
    invitedAt: timestamp("invited_at", { withTimezone: true }).notNull().defaultNow(),
    respondedAt: timestamp("responded_at", { withTimezone: true }),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    rejectedAt: timestamp("rejected_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (table) => [
    unique("uq_project_membership_project_an").on(table.projectId, table.anOrgId),
    index("project_memberships_project_idx").on(table.projectId),
    index("project_memberships_an_idx").on(table.anOrgId),
    index("project_memberships_status_idx").on(table.status),
  ],
);

export type ProjectMembership = typeof projectMembershipsTable.$inferSelect;
export type InsertProjectMembership = typeof projectMembershipsTable.$inferInsert;