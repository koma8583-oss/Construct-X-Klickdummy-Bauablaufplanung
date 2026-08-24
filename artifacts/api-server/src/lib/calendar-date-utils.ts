/** Date-only helpers for inclusive planning windows. */
export function compareCalendarDates(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function differenceInCalendarDays(start: string, end: string): number {
  const a = Date.UTC(Number(start.slice(0, 4)), Number(start.slice(5, 7)) - 1, Number(start.slice(8, 10)));
  const b = Date.UTC(Number(end.slice(0, 4)), Number(end.slice(5, 7)) - 1, Number(end.slice(8, 10)));
  return Math.round((b - a) / 86_400_000);
}

export function shiftCalendarDate(value: string, days: number): string {
  const date = new Date(`${value.slice(0, 10)}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Convert a Date to its UTC calendar date without retaining a time-of-day. */
export function toCalendarDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

/** Add calendar days to a date-only value, independent of timezone/DST. */
export function addCalendarDays(value: string, days: number): string {
  return shiftCalendarDate(value, days);
}

/** Inclusive date-only range validation used at domain boundaries. */
export function isValidCalendarRange(start: string, end: string): boolean {
  return compareCalendarDates(start, end) <= 0;
}

/** Inclusive list of date-only values between start and end. */
export function iterateCalendarDays(start: string, end: string): string[] {
  const days: string[] = [];
  for (let current = start; compareCalendarDates(current, end) <= 0; current = shiftCalendarDate(current, 1)) {
    days.push(current);
  }
  return days;
}