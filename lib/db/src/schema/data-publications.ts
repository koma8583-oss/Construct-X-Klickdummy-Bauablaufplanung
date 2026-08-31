/**
 * Simulated Dataspace Publication tables (Task #112).
 *
 * Implements the AG-controlled publication flow:
 *   1. AG selects a data product type and fields (whitelist).
 *   2. AG selects AN recipients from ACTIVE project_contractors.
 *   3. AG selects a policy template and validity period.
 *   4. On publish: content snapshot is captured immutably, notifications sent.
 *   5. AN receives offer, must accept policy before accessing content.
 *
 * Design principles (Dataspace simulation, no real EDC):
 *   - No automatic publication on project/Takt creation.
 *   - Content snapshot is whitelist-only — never raw DB serialisation.
 *   - Notifications carry only metadata (no content).
 *   - AN pulls content after explicit policy acceptance.
 *   - Published versions are immutable; changes create new versions.
 *   - Full audit trail at every state transition.
 */
import {
  pgTable,
  pgEnum,
  text,
  boolean,
  integer,
  timestamp,
  jsonb,
  index,
  unique,
} from "drizzle-orm/pg-core";
import { organizationsTable } from "./organizations";
import { projectsTable } from "./projects";
import { usersTable } from "./users";
import { projectMembershipsTable } from "./project-memberships";

// ── Enums ─────────────────────────────────────────────────────────────────────

/**
 * Data product categories supported by the publication wizard.
 * Each type has its own field whitelist.
 */
export const dataProductTypeEnum = pgEnum("data_product_type", [
  "PROJECT_OVERVIEW",
  "PROJECT_COORDINATION_PACKAGE",
  "PROJECT_MEMBERSHIP",
  "TAKT_INFORMATION_PACKAGE",
]);

/**
 * Lifecycle status of a data publication.
 *
 *   DRAFT      — created, not yet visible to AN recipients
 *   PUBLISHED  — visible to and accessible by AN recipients (after policy acceptance)
 *   SUSPENDED  — temporarily unavailable; can be re-published
 *   WITHDRAWN  — permanently closed; no further access
 *   EXPIRED    — automatically set after validUntil
 */
export const publicationStatusEnum = pgEnum("publication_status", [
  "DRAFT",
  "PUBLISHED",
  "SUSPENDED",
  "WITHDRAWN",
  "EXPIRED",
]);

/**
 * Recipient-level status within a publication.
 *
 *   OFFERED    — notification sent; AN has not yet accepted the policy
 *   ACCEPTED   — AN accepted the policy; content access is allowed
 *   REJECTED   — AN explicitly rejected the policy
 *   REVOKED    — AG revoked this specific recipient's access
 *   EXPIRED    — access expired (publication expired or validUntil passed)
 */
export const publicationRecipientStatusEnum = pgEnum(
  "publication_recipient_status",
  ["OFFERED", "ACCEPTED", "REJECTED", "REVOKED", "EXPIRED"],
);

// ── policy_templates ──────────────────────────────────────────────────────────

/**
 * Seed-only policy templates. Not editable by end users in the PoC.
 *
 * The active publication catalog ships the schedule-coordination template.
 * PROJECT_MEMBERSHIP is seeded as a separate invitation-only policy.
 */
export const policyTemplatesTable = pgTable("policy_templates", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),

  /** Short machine-readable code (e.g. PROJECT_COORDINATION_READ_ONLY) */
  code: text("code").notNull().unique(),

  /** Human-readable display name */
  name: text("name").notNull(),

  description: text("description"),

  /** Short purpose statement shown to AN before accepting */
  purpose: text("purpose").notNull(),

  /**
   * Permitted operations (JSONB list of strings).
   * E.g. ["READ", "DOWNLOAD", "USE_FOR_PROJECT_COORDINATION"]
   */
  permissions: jsonb("permissions")
    .$type<string[]>()
    .notNull(),

  /**
   * Prohibited operations (JSONB list of strings).
   * E.g. ["REDISTRIBUTE", "AI_TRAINING"]
   */
  prohibitions: jsonb("prohibitions")
    .$type<string[]>()
    .notNull(),

  /** Natural-language description of when the policy expires */
  validityRule: text("validity_rule").notNull(),

  /** Natural-language description of data retention after expiry */
  retentionRule: text("retention_rule"),

  /** Whether this template is available in the wizard */
  active: boolean("active").notNull().default(true),

  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

// ── data_publications ─────────────────────────────────────────────────────────

/**
 * One row per publication version.
 *
 * A publication starts as DRAFT. On publish():
 *   - selectedFields + selectedTaktIds are frozen into contentSnapshot (JSONB).
 *   - SHA-256 hash stored as contentHash for integrity verification.
 *   - version incremented from the previous PUBLISHED/WITHDRAWN/EXPIRED row
 *     for the same (agOrgId, projectId, dataProductType) combination.
 *
 * A published version is immutable. To revise: create a new DRAFT.
 */
export const dataPublicationsTable = pgTable(
  "data_publications",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),

    /** AG organisation that owns this publication */
    agOrgId: text("ag_org_id")
      .notNull()
      .references(() => organizationsTable.id),

    /** Project whose data is being shared */
    projectId: text("project_id")
      .notNull()
      .references(() => projectsTable.id, { onDelete: "cascade" }),

    /**
     * Set for a publication created by the combined project invitation flow.
     * Null keeps existing, separately created publications compatible.
     */
    projectInvitationId: text("project_invitation_id"),

    /** Type of data product */
    dataProductType: dataProductTypeEnum("data_product_type").notNull(),

    /** Human-readable title shown to AN */
    title: text("title").notNull(),

    description: text("description"),

    /**
     * Publication version (1-based). New drafts start at 1.
     * Incrementing happens only when re-publishing after a previous
     * publication for the same product exists.
     */
    version: integer("version").notNull().default(1),

    /** Payload schema version for forward compatibility */
    schemaVersion: text("schema_version").notNull().default("1.0"),

    status: publicationStatusEnum("status").notNull().default("DRAFT"),

    /** Policy template governing AN usage rights */
    policyTemplateId: text("policy_template_id")
      .notNull()
      .references(() => policyTemplatesTable.id),

    /**
     * AG-selected fields from the whitelist (stored at creation time,
     * frozen into contentSnapshot on publish).
     * E.g. ["projectName", "startDate", "endDate"]
     */
    selectedFields: jsonb("selected_fields")
      .$type<string[]>()
      .notNull(),

    /**
     * Takt IDs to include (only for TAKT_INFORMATION_PACKAGE).
     * Null for project-level products.
     */
    selectedTaktIds: jsonb("selected_takt_ids").$type<string[]>(),

    /**
     * Immutable content snapshot (set on publish, never changed).
     * Built from selectedFields via a strict whitelist — no raw DB rows.
     */
    contentSnapshot: jsonb("content_snapshot").$type<Record<string, unknown>>(),

    /**
     * SHA-256 hex digest of the canonically serialised contentSnapshot.
     * Allows integrity verification without re-fetching the snapshot.
     */
    contentHash: text("content_hash"),

    /** When the offer becomes valid (defaults to publishedAt) */
    validFrom: timestamp("valid_from", { withTimezone: true }),

    /** When the offer expires (null = no fixed expiry) */
    validUntil: timestamp("valid_until", { withTimezone: true }),

    /** Who triggered the publish action */
    publishedByUserId: text("published_by_user_id").references(
      () => usersTable.id,
    ),

    publishedAt: timestamp("published_at", { withTimezone: true }),
    withdrawnAt: timestamp("withdrawn_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    unique("uq_data_publication_project_invitation").on(t.projectInvitationId),
    index("data_pub_ag_org_id_idx").on(t.agOrgId),
    index("data_pub_project_id_idx").on(t.projectId),
    index("data_pub_status_idx").on(t.status),
    index("data_pub_product_type_idx").on(t.dataProductType),
    index("data_pub_project_status_idx").on(t.projectId, t.status),
  ],
);

// ── data_publication_recipients ───────────────────────────────────────────────

/**
 * One row per (publication, AN organisation) pair.
 *
 * The AG selects specific AN recipients from ACTIVE project_contractors.
 * Each recipient independently accepts or rejects the policy.
 * Access to contentSnapshot is gated on status === ACCEPTED AND
 * parent publication status === PUBLISHED AND validUntil not passed.
 *
 * Unique constraint: (publicationId, anOrgId) — one record per AN per version.
 */
export const dataPublicationRecipientsTable = pgTable(
  "data_publication_recipients",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),

    publicationId: text("publication_id")
      .notNull()
      .references(() => dataPublicationsTable.id, { onDelete: "cascade" }),

    anOrgId: text("an_org_id")
      .notNull()
      .references(() => organizationsTable.id),

    /**
     * Present only for an invitation-coupled offer. It allows the AG inbound
     * processor to activate exactly the recipient that belongs to the accepted
     * invitation; ordinary standalone data publications keep this null.
     */
    projectMembershipId: text("project_membership_id")
      .references(() => projectMembershipsTable.id, { onDelete: "cascade" }),

    status: publicationRecipientStatusEnum("status")
      .notNull()
      .default("OFFERED"),

    /** When DATA_OFFER_PUBLISHED notification was sent to this AN */
    notifiedAt: timestamp("notified_at", { withTimezone: true }),

    policyAcceptedAt: timestamp("policy_accepted_at", { withTimezone: true }),
    policyRejectedAt: timestamp("policy_rejected_at", { withTimezone: true }),

    /** First time this AN pulled the content (after policy acceptance) */
    firstAccessedAt: timestamp("first_accessed_at", { withTimezone: true }),

    /** Most recent time this AN pulled the content */
    lastAccessedAt: timestamp("last_accessed_at", { withTimezone: true }),

    /** Set when AG revokes access for this specific recipient */
    revokedAt: timestamp("revoked_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    // Enforce unique (publicationId + anOrgId) — one row per AN per publication version
    unique("uq_pub_recipient").on(t.publicationId, t.anOrgId),
    index("data_pub_recipient_pub_id_idx").on(t.publicationId),
    index("data_pub_recipient_an_org_id_idx").on(t.anOrgId),
    index("data_pub_recipient_status_idx").on(t.status),
    index("data_pub_recipient_membership_idx").on(t.projectMembershipId),
  ],
);

// ── Types ─────────────────────────────────────────────────────────────────────

export type DataProductType = typeof dataProductTypeEnum.enumValues[number];
export type PublicationStatus = typeof publicationStatusEnum.enumValues[number];
export type PublicationRecipientStatus =
  typeof publicationRecipientStatusEnum.enumValues[number];

export type PolicyTemplate = typeof policyTemplatesTable.$inferSelect;
export type DataPublication = typeof dataPublicationsTable.$inferSelect;
export type DataPublicationRecipient =
  typeof dataPublicationRecipientsTable.$inferSelect;
export type InsertDataPublication =
  typeof dataPublicationsTable.$inferInsert;
