import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Fine-grained role values a user can hold.
 *
 * AG side:
 *   AG_ADMIN        — full admin: create/send TaktRequests, manage contractors
 *   GENERAL_PLANNER — read + create/send TaktRequests; cannot manage contractors
 *
 * AN side:
 *   AN_ADMIN        — full admin: respond to TaktRequests, run availability checks, manage org
 *   AN_DISPATCHER   — can respond + run availability checks; cannot manage org
 *
 * Hub:
 *   HUB_ADMIN       — Hub administration panel and reporting
 */
export const USER_ROLES = [
  "AG_ADMIN",
  "GENERAL_PLANNER",
  "AN_ADMIN",
  "AN_DISPATCHER",
  "HUB_ADMIN",
] as const;

export type UserRole = (typeof USER_ROLES)[number];

export const usersTable = pgTable("users", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  preferredLanguage: text("preferred_language").notNull().default("de"),
  /**
   * Role assignments for this user.  Stored as a plain text array so that
   * new roles can be added without a schema migration.  Empty array means
   * legacy / unassigned user (soft-enforcement: most guards let them through).
   */
  roles: text("roles").array().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const insertUserSchema = createInsertSchema(usersTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;
