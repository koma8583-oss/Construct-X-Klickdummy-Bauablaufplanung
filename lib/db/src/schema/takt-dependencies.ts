import { pgTable, text, integer, pgEnum, unique } from "drizzle-orm/pg-core";
import { takteTable } from "./takte";
import { projectsTable } from "./projects";

export const taktDependencyTypeEnum = pgEnum("takt_dependency_type", [
  "EA", // Ende-Anfang  (Finish-Start):  successor.start ≥ predecessor.end + lag
  "AA", // Anfang-Anfang (Start-Start):   successor.start ≥ predecessor.start + lag
  "EE", // Ende-Ende    (Finish-Finish):  successor.end   ≥ predecessor.end + lag
]);

export const taktDependenciesTable = pgTable(
  "takt_dependencies",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    projectId: text("project_id")
      .notNull()
      .references(() => projectsTable.id, { onDelete: "cascade" }),
    predecessorId: text("predecessor_id")
      .notNull()
      .references(() => takteTable.id, { onDelete: "cascade" }),
    successorId: text("successor_id")
      .notNull()
      .references(() => takteTable.id, { onDelete: "cascade" }),
    type: taktDependencyTypeEnum("type").notNull().default("EA"),
    lagDays: integer("lag_days").notNull().default(0),
  },
  (t) => ({
    uniqPair: unique().on(t.predecessorId, t.successorId),
  }),
);

export type TaktDependency = typeof taktDependenciesTable.$inferSelect;
