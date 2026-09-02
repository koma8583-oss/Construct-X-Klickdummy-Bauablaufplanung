import { pgEnum, pgTable, text, timestamp, integer, index, unique } from "drizzle-orm/pg-core";
import { organizationsTable } from "./organizations";

export const dataspaceExchangeDirectionEnum = pgEnum("dataspace_exchange_direction", ["OUTBOUND", "INBOUND"]);
export const dataspaceExchangeMessageTypeEnum = pgEnum("dataspace_exchange_message_type", [
  "SERVICE_REQUEST",
  "SERVICE_RESPONSE",
  "PROJECT_INVITATION",
  "PROJECT_INVITATION_RESPONSE",
  "DATA_OFFER_PUBLISHED",
  "DATA_OFFER_RESPONSE",
  "TAKT_RESPONSE_ACCEPTED",
  "TAKT_RESPONSE_REVISION_REQUESTED",
  "TAKT_REQUEST_CANCELLED",
]);
export const dataspaceExchangeStatusEnum = pgEnum("dataspace_exchange_status", ["CREATED", "PUBLISHED", "RECEIVED", "PROCESSED", "FAILED"]);

export const dataspaceExchangesTable = pgTable("dataspace_exchanges", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  direction: dataspaceExchangeDirectionEnum("direction").notNull(),
  messageType: dataspaceExchangeMessageTypeEnum("message_type").notNull(),
  messageId: text("message_id").notNull(),
  correlationId: text("correlation_id").notNull(),
  senderOrgId: text("sender_org_id").notNull().references(() => organizationsTable.id),
  receiverOrgId: text("receiver_org_id").notNull().references(() => organizationsTable.id),
  businessObjectId: text("business_object_id").notNull(),
  businessObjectVersion: integer("business_object_version").notNull(),
  payloadHash: text("payload_hash"),
  status: dataspaceExchangeStatusEnum("status").notNull().default("CREATED"),
  externalReference: text("external_reference"),
  errorCode: text("error_code"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => ({
  correlationIdx: index("dataspace_exchanges_correlation_idx").on(table.correlationId),
  directionMessageIdUnique: unique("dataspace_exchanges_direction_message_id_key").on(table.direction, table.messageId),
}));

export type DataspaceExchangeRow = typeof dataspaceExchangesTable.$inferSelect;