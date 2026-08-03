/**
 * Central deadline configuration for the TaktKoord deadline worker (Task 7.3).
 *
 * All values can be overridden via environment variables.
 * Durations are always in whole hours.
 */

export interface DeadlineConfig {
  /** Whether the periodic deadline worker is enabled */
  workerEnabled: boolean;
  /** How often the worker polls for due jobs, in minutes */
  workerIntervalMinutes: number;
  /** Hours before responseRequiredBy to send the first reminder (RESPONSE_DUE_SOON) */
  firstReminderHoursBeforeDue: number;
  /** Hours before responseRequiredBy to send the second reminder (RESPONSE_DUE_TODAY) */
  secondReminderHoursBeforeDue: number;
  /** Hours after responseRequiredBy to send the overdue reminder (RESPONSE_OVERDUE) */
  overdueReminderHoursAfterDue: number;
  /**
   * Grace period in hours added to responseRequiredBy to compute expiresAt.
   * A request only becomes EXPIRED after responseRequiredBy + gracePeriod.
   */
  expirationGracePeriodHours: number;
  /** Hours before guDecisionRequiredBy to send GU_DECISION_DUE_SOON */
  guDecisionReminderHours: number;
  /** Maximum reminders of a given type per request (idempotency ceiling) */
  maxRemindersPerType: number;
}

function envInt(key: string, fallback: number): number {
  const v = process.env[key];
  if (!v) return fallback;
  const n = parseInt(v, 10);
  return isNaN(n) ? fallback : n;
}

/**
 * Reads deadline config from environment variables with documented defaults.
 *
 * Environment variables:
 *   DEADLINE_WORKER_ENABLED                  (default: false)
 *   DEADLINE_WORKER_INTERVAL_MINUTES         (default: 5)
 *   FIRST_REMINDER_HOURS_BEFORE_DUE          (default: 48)
 *   SECOND_REMINDER_HOURS_BEFORE_DUE         (default: 8)
 *   OVERDUE_REMINDER_HOURS_AFTER_DUE         (default: 24)
 *   EXPIRATION_GRACE_PERIOD_HOURS            (default: 48)
 *   GU_DECISION_REMINDER_HOURS               (default: 24)
 *   MAX_REMINDERS_PER_TYPE                   (default: 1)
 */
export function loadDeadlineConfig(): DeadlineConfig {
  return {
    workerEnabled:               process.env.DEADLINE_WORKER_ENABLED === "true",
    workerIntervalMinutes:       envInt("DEADLINE_WORKER_INTERVAL_MINUTES", 5),
    firstReminderHoursBeforeDue: envInt("FIRST_REMINDER_HOURS_BEFORE_DUE", 48),
    secondReminderHoursBeforeDue:envInt("SECOND_REMINDER_HOURS_BEFORE_DUE", 8),
    overdueReminderHoursAfterDue:envInt("OVERDUE_REMINDER_HOURS_AFTER_DUE", 24),
    expirationGracePeriodHours:  envInt("EXPIRATION_GRACE_PERIOD_HOURS", 48),
    guDecisionReminderHours:     envInt("GU_DECISION_REMINDER_HOURS", 24),
    maxRemindersPerType:         envInt("MAX_REMINDERS_PER_TYPE", 1),
  };
}

export const defaultDeadlineConfig: DeadlineConfig = loadDeadlineConfig();
