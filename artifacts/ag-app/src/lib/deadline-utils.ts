/**
 * Shared deadline utility functions for TaktRequest deadline display.
 * Used by both the list page and the detail page.
 */

import { differenceInHours, differenceInDays, isPast, isAfter, addHours, format } from 'date-fns';

// ── Types ────────────────────────────────────────────────────────────────────

export type DeadlineKind =
  | 'expired'          // request expired, no response possible
  | 'overdue'          // past responseRequiredBy but still in grace period
  | 'due-today'        // within 8h of responseRequiredBy
  | 'due-soon'         // within 48h of responseRequiredBy
  | 'ok'               // responseRequiredBy exists, no urgency
  | 'none'             // no deadline set
  | 'gu-decision-overdue'   // guDecisionRequiredBy passed
  | 'gu-decision-due-soon'; // guDecisionRequiredBy within 24h

export interface DeadlineInfo {
  kind: DeadlineKind;
  label: string;       // e.g. "Fällig in 2 Tagen"
  ariaLabel: string;   // accessible longer form
  dateLabel: string;   // formatted absolute date+time
}

// ── Core classifier ──────────────────────────────────────────────────────────

/**
 * Classify a TaktRequest's deadline state given the current time.
 *
 * @param responseRequiredBy  ISO string or null
 * @param expiresAt           ISO string or null
 * @param expiredAt           ISO string or null (set means already EXPIRED)
 * @param guDecisionRequiredBy ISO string or null
 * @param now                 Current time (injected for testability)
 */
export function classifyDeadline(opts: {
  responseRequiredBy?: string | Date | null;
  expiresAt?: string | Date | null;
  expiredAt?: string | Date | null;
  guDecisionRequiredBy?: string | Date | null;
  now?: Date;
}): DeadlineInfo {
  const now = opts.now ?? new Date();

  const toDate = (v: string | Date | null | undefined): Date | null => {
    if (!v) return null;
    return v instanceof Date ? v : new Date(v);
  };

  const expiredAt   = toDate(opts.expiredAt);
  const expiresAt   = toDate(opts.expiresAt);
  const due         = toDate(opts.responseRequiredBy);
  const guDue       = toDate(opts.guDecisionRequiredBy);

  // ── Expired ────────────────────────────────────────────────────────────────
  if (expiredAt || (expiresAt && now >= expiresAt)) {
    const at = expiredAt ?? expiresAt!;
    return {
      kind: 'expired',
      label: 'Abgelaufen',
      ariaLabel: `Abgelaufen am ${formatDateTime(at)}`,
      dateLabel: formatDateTime(at),
    };
  }

  // ── GU decision overdue ───────────────────────────────────────────────────
  if (guDue && now > guDue) {
    const hoursLate = Math.abs(differenceInHours(now, guDue));
    const label = hoursLate < 24
      ? `GU-Entscheidung seit ${hoursLate}h überfällig`
      : `GU-Entscheidung seit ${differenceInDays(now, guDue)}T überfällig`;
    return {
      kind: 'gu-decision-overdue',
      label,
      ariaLabel: `GU-Entscheidungsfrist überschritten – fällig war ${formatDateTime(guDue)}`,
      dateLabel: formatDateTime(guDue),
    };
  }

  // ── GU decision due soon ──────────────────────────────────────────────────
  if (guDue && isAfter(guDue, now) && differenceInHours(guDue, now) <= 24) {
    return {
      kind: 'gu-decision-due-soon',
      label: 'GU-Entscheidung bald fällig',
      ariaLabel: `GU-Entscheidung fällig am ${formatDateTime(guDue)}`,
      dateLabel: formatDateTime(guDue),
    };
  }

  if (!due) {
    return { kind: 'none', label: '–', ariaLabel: 'Keine Antwortfrist gesetzt', dateLabel: '–' };
  }

  // ── Overdue ────────────────────────────────────────────────────────────────
  if (now > due) {
    const hoursLate = Math.abs(differenceInHours(now, due));
    const label = hoursLate < 24
      ? `Seit ${hoursLate}h überfällig`
      : `Seit ${differenceInDays(now, due)} Tag${differenceInDays(now, due) === 1 ? '' : 'en'} überfällig`;
    return {
      kind: 'overdue',
      label,
      ariaLabel: `Antwortfrist überschritten – fällig war ${formatDateTime(due)}`,
      dateLabel: formatDateTime(due),
    };
  }

  const hoursLeft = differenceInHours(due, now);

  // ── Due today (within 8h) ─────────────────────────────────────────────────
  if (hoursLeft <= 8) {
    return {
      kind: 'due-today',
      label: hoursLeft <= 1 ? 'Fällig in < 1 Stunde' : `Fällig in ${hoursLeft}h`,
      ariaLabel: `Antwortfrist heute – fällig am ${formatDateTime(due)}`,
      dateLabel: formatDateTime(due),
    };
  }

  // ── Due soon (within 48h) ─────────────────────────────────────────────────
  if (hoursLeft <= 48) {
    const daysLeft = differenceInDays(due, now);
    const label = daysLeft === 0
      ? `Fällig heute`
      : daysLeft === 1
        ? `Fällig morgen`
        : `Fällig in ${daysLeft} Tagen`;
    return {
      kind: 'due-soon',
      label,
      ariaLabel: `Antwortfrist in Kürze – fällig am ${formatDateTime(due)}`,
      dateLabel: formatDateTime(due),
    };
  }

  // ── OK ────────────────────────────────────────────────────────────────────
  const daysLeft = differenceInDays(due, now);
  return {
    kind: 'ok',
    label: `Fällig in ${daysLeft} Tagen`,
    ariaLabel: `Antwortfrist am ${formatDateTime(due)}`,
    dateLabel: formatDateTime(due),
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

export function formatDateTime(d: Date): string {
  return format(d, 'dd.MM.yyyy HH:mm');
}

/** Returns the CSS colour class for a DeadlineKind. */
export function deadlineColor(kind: DeadlineKind): string {
  switch (kind) {
    case 'expired':              return 'text-muted-foreground';
    case 'overdue':              return 'text-red-600';
    case 'due-today':            return 'text-red-600';
    case 'due-soon':             return 'text-amber-600';
    case 'gu-decision-overdue':  return 'text-orange-600';
    case 'gu-decision-due-soon': return 'text-orange-600';
    default:                     return 'text-foreground';
  }
}
