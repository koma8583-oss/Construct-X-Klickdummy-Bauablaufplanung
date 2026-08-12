import { pgTable, text, numeric } from "drizzle-orm/pg-core";
import { projectsTable } from "./projects";

/**
 * Working-hours calendar per project.
 * Each column holds the number of productive hours on that weekday.
 * 0 = non-working day. Default is Mon–Fri 8h, Sat–Sun 0h.
 */
export const projectCalendarsTable = pgTable("project_calendars", {
  projectId: text("project_id")
    .primaryKey()
    .references(() => projectsTable.id, { onDelete: "cascade" }),
  monHours: numeric("mon_hours", { precision: 4, scale: 2 }).notNull().default("8"),
  tueHours: numeric("tue_hours", { precision: 4, scale: 2 }).notNull().default("8"),
  wedHours: numeric("wed_hours", { precision: 4, scale: 2 }).notNull().default("8"),
  thuHours: numeric("thu_hours", { precision: 4, scale: 2 }).notNull().default("8"),
  friHours: numeric("fri_hours", { precision: 4, scale: 2 }).notNull().default("8"),
  satHours: numeric("sat_hours", { precision: 4, scale: 2 }).notNull().default("0"),
  sunHours: numeric("sun_hours", { precision: 4, scale: 2 }).notNull().default("0"),
});

export type ProjectCalendar = typeof projectCalendarsTable.$inferSelect;

/** Weekday name → column key (getDay() order: 0=Sun … 6=Sat) */
export const WEEKDAY_KEYS = [
  "sunHours",
  "monHours",
  "tueHours",
  "wedHours",
  "thuHours",
  "friHours",
  "satHours",
] as const satisfies (keyof ProjectCalendar)[];

export const WEEKDAY_LABELS: Record<typeof WEEKDAY_KEYS[number], string> = {
  monHours: "Montag",
  tueHours: "Dienstag",
  wedHours: "Mittwoch",
  thuHours: "Donnerstag",
  friHours: "Freitag",
  satHours: "Samstag",
  sunHours: "Sonntag",
};
