import { pgTable, text, timestamp, date, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { projectsTable } from "./projects";

export const taktStatusEnum = pgEnum("takt_status", [
  "GEPLANT",
  "VERGEBEN",
  "ALTERNATIV",
  "BESTAETIGT",
  "ABGELEHNT",
  "STORNIERT",
]);

export const takteTable = pgTable("takte", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  projectId: text("project_id")
    .notNull()
    .references(() => projectsTable.id, { onDelete: "cascade" }),
  taktBezeichnung: text("takt_bezeichnung").notNull(),
  zone: text("zone").notNull(),
  gewerk: text("gewerk").notNull(),
  description: text("description"),
  plannedStart: date("planned_start", { mode: "string" }).notNull(),
  plannedEnd: date("planned_end", { mode: "string" }).notNull(),
  earliestStart: date("earliest_start", { mode: "string" }),
  latestEnd: date("latest_end", { mode: "string" }),
  lvReference: text("lv_reference"),
  bimReference: text("bim_reference"),
  requiredResources: text("required_resources"),
  status: taktStatusEnum("status").notNull().default("GEPLANT"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const insertTaktSchema = createInsertSchema(takteTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertTakt = z.infer<typeof insertTaktSchema>;
export type Takt = typeof takteTable.$inferSelect;
