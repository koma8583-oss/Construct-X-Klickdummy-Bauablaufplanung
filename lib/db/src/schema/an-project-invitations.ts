import {
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";

export const anProjectInvitationStatusEnum = pgEnum("an_project_invitation_status", [
  "PENDING",
  "ACCEPTED",
  "REJECTED",
]);

/**
 * AN-local projection of an incoming project invitation.
 *
 * It deliberately stores the display data received through DataspaceExchange
 * rather than referencing AG-owned project or membership rows. This keeps the
 * AN decision path viable when AG and AN are physically separated later.
 */
export const anProjectInvitationsTable = pgTable(
  "an_project_invitations",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    invitationId: text("invitation_id").notNull().unique(),
    correlationId: text("correlation_id").notNull().unique(),
    senderAgOrgId: text("sender_ag_org_id").notNull(),
    senderAgOrgName: text("sender_ag_org_name"),
    receiverAnOrgId: text("receiver_an_org_id").notNull(),
    projectReference: text("project_reference").notNull(),
    projectName: text("project_name").notNull(),
    projectDescription: text("project_description"),
    projectLocation: text("project_location"),
    invitationMessage: text("invitation_message"),
    invitationExpiresAt: timestamp("invitation_expires_at", { withTimezone: true }),
    dataPublicationId: text("data_publication_id"),
    dataPublicationTitle: text("data_publication_title"),
    selectedFields: jsonb("selected_fields").$type<string[]>(),
    /** Immutable Dataspace data-offer payload, including its own policy snapshot. */
    dataOfferSnapshot: jsonb("data_offer_snapshot").$type<Record<string, unknown> | null>(),
    policySnapshot: jsonb("policy_snapshot").$type<Record<string, unknown>>().notNull(),
    status: anProjectInvitationStatusEnum("status").notNull().default("PENDING"),
    policyAcceptedAt: timestamp("policy_accepted_at", { withTimezone: true }),
    respondedAt: timestamp("responded_at", { withTimezone: true }),
    rejectedAt: timestamp("rejected_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    unique("uq_an_project_invitation_invitation").on(table.invitationId),
    index("an_project_invitation_receiver_status_idx").on(table.receiverAnOrgId, table.status),
    index("an_project_invitation_correlation_idx").on(table.correlationId),
  ],
);

export type AnProjectInvitation = typeof anProjectInvitationsTable.$inferSelect;