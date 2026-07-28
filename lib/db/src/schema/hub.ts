import {
  pgTable,
  text,
  timestamp,
  pgEnum,
  json,
} from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const hubMessageTypeEnum = pgEnum("hub_message_type", [
  "DELEGATION_CREATED",
  "DELEGATION_CONFIRMED",
  "DELEGATION_REJECTED",
  "DELEGATION_ALTERNATIVE",
  "DELEGATION_CANCELLED",
  "AG_ACCEPTED_ALTERNATIVE",
  "AG_REJECTED_ALTERNATIVE",
]);

/** Central message log — every delegation event is written here by the broker middleware */
export const hubMessagesTable = pgTable("hub_messages", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  type: hubMessageTypeEnum("type").notNull(),
  /** Organisation that triggered the event */
  senderOrgId: text("sender_org_id").notNull(),
  /** Organisation that receives the notification */
  recipientOrgId: text("recipient_org_id").notNull(),
  /** Which delegation this message belongs to (plain text, no FK to avoid circular deps) */
  delegationId: text("delegation_id"),
  /** Full event payload for display in the hub */
  payload: json("payload").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/** Marks a user as a Hub admin (can see all messages across all orgs) */
export const hubAdminsTable = pgTable("hub_admins", {
  userId: text("user_id")
    .primaryKey()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type HubMessage = typeof hubMessagesTable.$inferSelect;
export type HubAdmin = typeof hubAdminsTable.$inferSelect;
