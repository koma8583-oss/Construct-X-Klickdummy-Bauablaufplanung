import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

/** Stores long-lived refresh tokens for the centralized JWT auth service */
export const refreshTokensTable = pgTable("refresh_tokens", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  /** The opaque refresh token value (UUID) sent as an httpOnly cookie */
  token: text("token").notNull().unique(),
  userId: text("user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type RefreshToken = typeof refreshTokensTable.$inferSelect;
