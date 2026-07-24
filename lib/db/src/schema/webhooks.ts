import {
  pgTable,
  text,
  timestamp,
  boolean,
  integer,
  pgEnum,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organizationsTable } from "./organizations";

export const webhookStatusEnum = pgEnum("webhook_event_status", [
  "PENDING",
  "DELIVERED",
  "FAILED",
]);

export const webhookSubscriptionsTable = pgTable("webhook_subscriptions", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  orgId: text("org_id")
    .notNull()
    .references(() => organizationsTable.id, { onDelete: "cascade" }),
  url: text("url").notNull(),
  events: text("events").array().notNull(),
  active: boolean("active").notNull().default(true),
  secret: text("secret"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const webhookEventsTable = pgTable("webhook_events", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  subscriptionId: text("subscription_id")
    .notNull()
    .references(() => webhookSubscriptionsTable.id, { onDelete: "cascade" }),
  event: text("event").notNull(),
  payload: text("payload").notNull(),
  status: webhookStatusEnum("status").notNull().default("PENDING"),
  attempts: integer("attempts").notNull().default(0),
  lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const insertWebhookSubscriptionSchema = createInsertSchema(
  webhookSubscriptionsTable,
).omit({ id: true, createdAt: true });

export type InsertWebhookSubscription = z.infer<
  typeof insertWebhookSubscriptionSchema
>;
export type WebhookSubscription =
  typeof webhookSubscriptionsTable.$inferSelect;
export type WebhookEvent = typeof webhookEventsTable.$inferSelect;
