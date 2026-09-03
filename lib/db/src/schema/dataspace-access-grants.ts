import {
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  index,
} from "drizzle-orm/pg-core";

/**
 * Connector access state shared by the notification/data-plane adapter.
 *
 * The row is deliberately transport metadata only. It is not a domain
 * agreement and contains no business payload. A new negotiation is required
 * when the stored agreement or EDR is no longer usable.
 */
export const dataspaceAccessGrantStatusEnum = pgEnum("dataspace_access_grant_status", [
  "ACTIVE",
  "EXPIRED",
  "INVALID",
  "REVOKED",
]);

export const dataspaceAccessGrantsTable = pgTable(
  "dataspace_access_grants",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    senderBpn: text("sender_bpn").notNull(),
    receiverBpn: text("receiver_bpn").notNull(),
    assetId: text("asset_id").notNull(),
    contractAgreementId: text("contract_agreement_id").notNull(),
    edrId: text("edr_id"),
    dataPlaneUrl: text("data_plane_url"),
    status: dataspaceAccessGrantStatusEnum("status").notNull().default("ACTIVE"),
    agreementExpiresAt: timestamp("agreement_expires_at", { withTimezone: true }),
    edrExpiresAt: timestamp("edr_expires_at", { withTimezone: true }),
    lastValidatedAt: timestamp("last_validated_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("dataspace_access_grants_participants_asset_key").on(
      table.senderBpn,
      table.receiverBpn,
      table.assetId,
    ),
    index("dataspace_access_grants_status_idx").on(table.status),
    index("dataspace_access_grants_expiry_idx").on(
      table.agreementExpiresAt,
      table.edrExpiresAt,
    ),
  ],
);

export type DataspaceAccessGrant = typeof dataspaceAccessGrantsTable.$inferSelect;
export type InsertDataspaceAccessGrant = typeof dataspaceAccessGrantsTable.$inferInsert;