/**
 * LocalDeadlineWorker — Task 7.3
 *
 * Periodically calls DeadlineEvaluationService.evaluateTaktRequestDeadlines()
 * from within the API server process.
 *
 * Design principles:
 *   - Only one worker interval per server instance (guarded by module-level flag)
 *   - PostgreSQL Advisory Lock prevents two server instances from running
 *     the evaluation concurrently (safe for horizontal scaling)
 *   - Failures in one run do not crash the server; they are logged and the
 *     next interval fires normally
 *   - The worker can be stopped cleanly (clearInterval)
 *   - An explicit runNow() method is exposed for tests and the internal endpoint
 */

import { agPool, runWithDatabaseRole } from "@workspace/db";
import pino from "pino";
import { evaluateTaktRequestDeadlines, type DeadlineEvaluationResult } from "../services/deadline-evaluation-service";
import type { DeadlineConfig } from "../services/deadline-config";

const logger = pino({ name: "local-deadline-worker" });

// Advisory lock key — must be a stable int64. We pick an app-specific constant.
const ADVISORY_LOCK_KEY = 7272727272n; // "deadline-worker"

// ── Module-level singleton guard ──────────────────────────────────────────────

let workerTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Promise for the currently-in-progress evaluation, if any.
 * Set at the start of each interval tick; cleared when the run finishes.
 * stopDeadlineWorker() awaits this so SIGTERM does not interrupt mid-run.
 *
 * The in-flight guard (isTickRunning) ensures at most one tick is active at a
 * time, which means currentRunPromise is never overwritten by a concurrent tick.
 * Without the guard a slow first run could still be in flight when a second tick
 * fires; the second tick's `finally` would then null the promise while the first
 * is still running, causing stopDeadlineWorker() to see null and exit early.
 */
let currentRunPromise: Promise<WorkerRunResult> | null = null;

/**
 * True while an evaluation tick is in progress.
 * Prevents overlapping interval callbacks: if the previous tick hasn't finished
 * by the time the next interval fires, the next tick is skipped entirely.
 */
let isTickRunning = false;

// ── Public API ────────────────────────────────────────────────────────────────

export interface WorkerRunResult {
  ran:    boolean;
  locked: boolean;
  result: DeadlineEvaluationResult | null;
  error:  string | null;
}

/**
 * Run the evaluation once, protected by a PostgreSQL advisory lock.
 *
 * @param now    Injected clock. Pass a fixed date for tests; omit for production.
 * @param config Deadline configuration.
 */
export async function runDeadlineEvaluationOnce(
  config: DeadlineConfig,
  now?: Date,
): Promise<WorkerRunResult> {
  const effectiveNow = now ?? new Date();

  // Acquire advisory lock (non-blocking — returns false if another instance holds it)
  const client = await agPool.connect();
  let lockAcquired = false;

  try {
    const lockResult = await client.query(
      "SELECT pg_try_advisory_lock($1) AS locked",
      [Number(ADVISORY_LOCK_KEY)],
    );
    lockAcquired = lockResult.rows[0]?.locked === true;
  } catch (err) {
    client.release();
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err }, "Advisory lock acquisition failed");
    return { ran: false, locked: false, result: null, error: msg };
  }

  if (!lockAcquired) {
    client.release();
    logger.debug("Advisory lock held by another instance — skipping this run");
    return { ran: false, locked: false, result: null, error: null };
  }

  try {
    logger.info({ now: effectiveNow.toISOString() }, "Deadline worker run starting");
    const result = await runWithDatabaseRole("ag", () =>
      evaluateTaktRequestDeadlines(effectiveNow, config),
    );
    logger.info(
      {
        checkedRequests:   result.checkedRequests,
        expiredRequests:   result.expiredRequests,
        createdReminders:  result.createdReminders,
        sentReminders:     result.sentReminders,
        cancelledReminders: result.cancelledReminders,
        failedRequests:    result.failedRequests,
      },
      "Deadline worker run complete",
    );
    return { ran: true, locked: true, result, error: null };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err }, "Deadline worker run failed");
    return { ran: true, locked: true, result: null, error: msg };
  } finally {
    // Always release the lock
    try {
      await client.query("SELECT pg_advisory_unlock($1)", [Number(ADVISORY_LOCK_KEY)]);
    } catch (unlockErr) {
      logger.warn({ unlockErr }, "Advisory lock release failed");
    }
    client.release();
  }
}

/**
 * Start the periodic deadline worker.
 * Safe to call multiple times — only one interval is ever active.
 *
 * @param config Deadline configuration (reads workerEnabled + workerIntervalMinutes)
 */
export function startDeadlineWorker(config: DeadlineConfig): void {
  if (!config.workerEnabled) {
    logger.info("Deadline worker disabled (DEADLINE_WORKER_ENABLED != true) — not starting");
    return;
  }
  if (workerTimer !== null) {
    logger.debug("Deadline worker already running — ignoring duplicate start");
    return;
  }

  const intervalMs = config.workerIntervalMinutes * 60 * 1000;
  logger.info({ intervalMs, intervalMinutes: config.workerIntervalMinutes }, "Starting periodic deadline worker");

  workerTimer = setInterval(async () => {
    // Skip this tick if the previous one hasn't finished yet.
    // Without this guard a slow DB call could cause a second tick to fire,
    // overwrite currentRunPromise in its `finally`, and allow stopDeadlineWorker()
    // to see null and exit while the original (slow) run is still in flight.
    if (isTickRunning) {
      logger.warn("Previous deadline worker tick still running — skipping this interval");
      return;
    }

    isTickRunning = true;
    const runPromise = runDeadlineEvaluationOnce(config);
    currentRunPromise = runPromise;
    try {
      await runPromise;
    } catch (err) {
      // Belt-and-suspenders: runDeadlineEvaluationOnce should not throw,
      // but we guard here so the interval continues even if it does.
      logger.error({ err }, "Unhandled error in deadline worker interval");
    } finally {
      isTickRunning      = false;
      currentRunPromise  = null;
    }
  }, intervalMs);

  // Prevent the timer from keeping the process alive in test environments
  if (workerTimer.unref) {
    workerTimer.unref();
  }
}

/**
 * Stop the periodic deadline worker and wait for any in-progress run to finish.
 * Safe to call even if the worker was never started.
 *
 * Awaiting this ensures SIGTERM / SIGINT do not interrupt a mid-flight
 * deadline evaluation — the process only exits after the current tick completes.
 */
export async function stopDeadlineWorker(): Promise<void> {
  if (workerTimer !== null) {
    clearInterval(workerTimer);
    workerTimer = null;
    logger.info("Deadline worker stopped — waiting for in-progress run to finish");
  }
  // Await the current evaluation if one is running
  if (currentRunPromise) {
    try {
      await currentRunPromise;
    } catch {
      // Errors are already logged inside the run; swallow here
    }
    currentRunPromise = null;
  }
}

/** @internal For tests only */
export function _isWorkerRunning(): boolean {
  return workerTimer !== null;
}

/** @internal Reset module-level state between tests. */
export function _resetWorkerForTests(): void {
  if (workerTimer !== null) {
    clearInterval(workerTimer);
    workerTimer = null;
  }
  currentRunPromise = null;
  isTickRunning     = false;
}

/**
 * @internal
 * Simulate an in-progress tick for tests that verify stopDeadlineWorker() waits.
 * Sets both currentRunPromise and isTickRunning so the state exactly mirrors what
 * the interval callback sets up when a real tick is running.
 * The caller is responsible for resolving/rejecting the promise.
 */
export function _simulateInProgressTickForTests(p: Promise<WorkerRunResult>): void {
  isTickRunning     = true;
  currentRunPromise = p.finally(() => {
    isTickRunning     = false;
    currentRunPromise = null;
  });
}
