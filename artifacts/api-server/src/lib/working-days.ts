/**
 * Working-day arithmetic using a project calendar config.
 *
 * A ProjectCalendar maps each weekday to productive hours (0 = non-working).
 * "Working day" = any day where hours > 0.
 *
 * Duration convention used throughout TaktKoord:
 *   durationDays = 1  →  start and end are the same date (one working day)
 *   durationDays = 2  →  end is the next working day after start
 *   durationDays = 0.5 → same day as start (half day — end = start)
 */

export interface CalendarConfig {
  monHours: number;
  tueHours: number;
  wedHours: number;
  thuHours: number;
  friHours: number;
  satHours: number;
  sunHours: number;
}

export const DEFAULT_CALENDAR: CalendarConfig = {
  monHours: 8,
  tueHours: 8,
  wedHours: 8,
  thuHours: 8,
  friHours: 8,
  satHours: 0,
  sunHours: 0,
};

const HOURS_BY_DOW = (cal: CalendarConfig): number[] => [
  cal.sunHours, // 0
  cal.monHours, // 1
  cal.tueHours, // 2
  cal.wedHours, // 3
  cal.thuHours, // 4
  cal.friHours, // 5
  cal.satHours, // 6
];

function isWorkingDay(date: Date, cal: CalendarConfig): boolean {
  return HOURS_BY_DOW(cal)[date.getDay()] > 0;
}

/** Parse ISO date string into local midnight Date */
function parseDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** Format Date to ISO date string */
function fmtDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Advance `date` by `n` working days (n may be 0).
 * Works by stepping forward calendar day-by-day, counting only working days.
 */
function addWorkingDaysInt(date: Date, n: number, cal: CalendarConfig): Date {
  const cur = new Date(date);
  let remaining = n;
  while (remaining > 0) {
    cur.setDate(cur.getDate() + 1);
    if (isWorkingDay(cur, cal)) remaining--;
  }
  return cur;
}

/**
 * Compute plannedEnd from plannedStart + durationDays.
 *
 * durationDays = 1.0 → end = start
 * durationDays = 2.0 → end = next working day after start
 * durationDays = 0.5 → end = start (half-day: same day)
 * durationDays = 1.5 → end = start (starts on start, finishes next morning)
 *
 * Rule: end = start + (ceil(duration) - 1) working days,
 *        but if start is not a working day advance to the next working day first.
 */
export function computePlannedEnd(
  plannedStart: string,
  durationDays: number,
  cal: CalendarConfig,
): string {
  let start = parseDate(plannedStart);

  // Ensure start is a working day
  while (!isWorkingDay(start, cal)) {
    start.setDate(start.getDate() + 1);
  }

  const fullDays = Math.max(0, Math.ceil(durationDays) - 1);
  const end = addWorkingDaysInt(start, fullDays, cal);
  return fmtDate(end);
}

/**
 * Count working days between start (inclusive) and end (inclusive).
 * Returns a whole number; half-days are not back-computed from dates alone.
 */
export function countWorkingDays(
  plannedStart: string,
  plannedEnd: string,
  cal: CalendarConfig,
): number {
  const start = parseDate(plannedStart);
  const end = parseDate(plannedEnd);
  let count = 0;
  const cur = new Date(start);
  while (cur <= end) {
    if (isWorkingDay(cur, cal)) count++;
    cur.setDate(cur.getDate() + 1);
  }
  return count;
}

/** Coerce a raw DB ProjectCalendar row (numeric strings) to CalendarConfig numbers */
export function toCalendarConfig(row: {
  monHours: string | number;
  tueHours: string | number;
  wedHours: string | number;
  thuHours: string | number;
  friHours: string | number;
  satHours: string | number;
  sunHours: string | number;
}): CalendarConfig {
  return {
    monHours: Number(row.monHours),
    tueHours: Number(row.tueHours),
    wedHours: Number(row.wedHours),
    thuHours: Number(row.thuHours),
    friHours: Number(row.friHours),
    satHours: Number(row.satHours),
    sunHours: Number(row.sunHours),
  };
}
