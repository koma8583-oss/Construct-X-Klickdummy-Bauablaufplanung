/**
 * Leistungsabhaengigkeiten — dependency links between Leistungen.
 *
 * Canonical rename of takt_dependencies (Task #196).
 */
import { pgTable, text, integer, pgEnum, unique } from "drizzle-orm/pg-core";
import { leistungenTable } from "./leistungen";
import { projectsTable } from "./projects";

export const leistungsabhaengigkeitTypeEnum = pgEnum("takt_dependency_type", [
  "EA", // Ende-Anfang  (Finish-Start):  successor.start ≥ predecessor.end + lag
  "AA", // Anfang-Anfang (Start-Start):   successor.start ≥ predecessor.start + lag
  "EE", // Ende-Ende    (Finish-Finish):  successor.end   ≥ predecessor.end + lag
]);

export const leistungsabhaengigkeitenTable = pgTable(
  "leistungsabhaengigkeiten",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    projectId: text("project_id")
      .notNull()
      .references(() => projectsTable.id, { onDelete: "cascade" }),
    predecessorId: text("predecessor_id")
      .notNull()
      .references(() => leistungenTable.id, { onDelete: "cascade" }),
    successorId: text("successor_id")
      .notNull()
      .references(() => leistungenTable.id, { onDelete: "cascade" }),
    type: leistungsabhaengigkeitTypeEnum("type").notNull().default("EA"),
    lagDays: integer("lag_days").notNull().default(0),
  },
  (t) => ({
    uniqPair: unique().on(t.predecessorId, t.successorId),
  }),
);

export type Leistungsabhaengigkeit = typeof leistungsabhaengigkeitenTable.$inferSelect;

// ── Enum alias only — table/type alias lives in legacy-takt-adapters.ts ───────
/** @deprecated Use leistungsabhaengigkeitTypeEnum */
export const taktDependencyTypeEnum = leistungsabhaengigkeitTypeEnum;
