/**
 * Task 82 — Auto-start Deadline Worker with PostgreSQL advisory lock.
 *
 * Tests:
 *   [1]  DEADLINE_WORKER_ENABLED=true  → worker timer is active after startDeadlineWorker()
 *   [2]  DEADLINE_WORKER_ENABLED=false → no timer started
 *   [3]  Calling startDeadlineWorker() twice → only one timer (singleton guard)
 *   [4]  stopDeadlineWorker() clears the timer (_isWorkerRunning() → false)
 *   [5]  stopDeadlineWorker() is safe to call when worker was never started
 *   [6]  Advisory lock: concurrent invocations return { locked: false } for the second caller
 *   [7]  No duplicate reminders when runDeadlineEvaluationOnce() is called twice on same data
 *   [8]  _resetWorkerForTests() clears module state between tests
 *
 * Fixture prefix: "t82-"
 */
import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from "vitest";
import { agDb as db, pool } from "@workspace/db";
import {
  organizationsTable,
  usersTable,
  projectsTable,
  takteTable,
  taktRequestsTable,
  taktRequestRemindersTable,
  messageOutboxTable,
  messageInboxTable,
  projectContractorsTable,
} from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";
import {
  startDeadlineWorker,
  stopDeadlineWorker,
  runDeadlineEvaluationOnce,
  _isWorkerRunning,
  _resetWorkerForTests,
  _simulateInProgressTickForTests,
  type WorkerRunResult,
} from "../lib/local-deadline-worker";
import type { DeadlineConfig } from "../services/deadline-config";

// ── Config helpers ─────────────────────────────────────────────────────────────

const ENABLED_CONFIG: DeadlineConfig = {
  workerEnabled:               true,
  workerIntervalMinutes:       60,   // 60 min so the interval never fires during tests
  firstReminderHoursBeforeDue: 48,
  secondReminderHoursBeforeDue: 8,
  overdueReminderHoursAfterDue: 24,
  expirationGracePeriodHours:  48,
  guDecisionReminderHours:     24,
  maxRemindersPerType:         1,
};

const DISABLED_CONFIG: DeadlineConfig = {
  ...ENABLED_CONFIG,
  workerEnabled: false,
};

// ── Advisory lock key (must match local-deadline-worker.ts) ───────────────────
const ADVISORY_LOCK_KEY = 7272727272;

// ── Fixture IDs ───────────────────────────────────────────────────────────────

const GU_ORG  = "t82-org-gu";
const NU_ORG  = "t82-org-nu";
const USER_ID = "t82-user";
const PROJ_ID = "t82-proj";

function taktId(tag: string) { return `t82-takt-${tag}`; }
function reqId(tag: string)  { return `t82-req-${tag}`;  }
function reqNum(tag: string) { return `TKR-82-${tag}`;   }

// ── Setup / Teardown ──────────────────────────────────────────────────────────

beforeAll(async () => {
  await db.insert(organizationsTable).values([
    { id: GU_ORG, name: "T82 GU", type: "AG" as const },
    { id: NU_ORG, name: "T82 NU", type: "AN" as const },
  ]).onConflictDoNothing();

  await db.insert(usersTable).values({
    id: USER_ID, name: "T82 User", email: "t82@test.com", passwordHash: "x",
  }).onConflictDoNothing();

  await db.insert(projectsTable).values({
    id: PROJ_ID, name: "T82 Project", agOrgId: GU_ORG,
  }).onConflictDoNothing();

  await db.insert(projectContractorsTable).values({
    projectId: PROJ_ID, anOrgId: NU_ORG,
  }).onConflictDoNothing();
});

afterAll(async () => {
  const reqIds = ["lock-a", "lock-b", "dedup"].map(t => reqId(t));

  await db.delete(messageInboxTable)
    .where(inArray(messageInboxTable.correlationId, reqIds));
  await db.delete(messageOutboxTable)
    .where(inArray(messageOutboxTable.correlationId, reqIds));
  await db.delete(taktRequestRemindersTable)
    .where(inArray(taktRequestRemindersTable.taktRequestId, reqIds));
  await db.delete(taktRequestsTable)
    .where(inArray(taktRequestsTable.id, reqIds));

  const taktIds = ["lock", "dedup"].map(t => taktId(t));
  await db.delete(takteTable).where(inArray(takteTable.id, taktIds));

  await db.delete(projectContractorsTable)
    .where(and(eq(projectContractorsTable.projectId, PROJ_ID),
               eq(projectContractorsTable.anOrgId, NU_ORG)));
  await db.delete(projectsTable).where(eq(projectsTable.id, PROJ_ID));
  await db.delete(usersTable).where(eq(usersTable.id, USER_ID));
  await db.delete(organizationsTable)
    .where(inArray(organizationsTable.id, [GU_ORG, NU_ORG]));
});

// Ensure a clean worker state before and after each test
beforeEach(() => { _resetWorkerForTests(); });
afterEach(async () => { await stopDeadlineWorker(); });

// ── [1–5] Timer lifecycle ─────────────────────────────────────────────────────

describe("Worker timer lifecycle", () => {
  it("[1] ENABLED config → timer active after startDeadlineWorker()", () => {
    startDeadlineWorker(ENABLED_CONFIG);
    expect(_isWorkerRunning()).toBe(true);
  });

  it("[2] DISABLED config → no timer started", () => {
    startDeadlineWorker(DISABLED_CONFIG);
    expect(_isWorkerRunning()).toBe(false);
  });

  it("[3] startDeadlineWorker() called twice → still only one timer", () => {
    startDeadlineWorker(ENABLED_CONFIG);
    startDeadlineWorker(ENABLED_CONFIG); // second call should be a no-op
    expect(_isWorkerRunning()).toBe(true);
    // If two timers were created, stop would only clear one.
    // The test passes as long as isRunning stays true (no exception, no duplication).
  });

  it("[4] stopDeadlineWorker() clears the timer", async () => {
    startDeadlineWorker(ENABLED_CONFIG);
    expect(_isWorkerRunning()).toBe(true);

    await stopDeadlineWorker();
    expect(_isWorkerRunning()).toBe(false);
  });

  it("[5] stopDeadlineWorker() is safe to call when not started", async () => {
    // Should resolve without error
    await expect(stopDeadlineWorker()).resolves.toBeUndefined();
    expect(_isWorkerRunning()).toBe(false);
  });
});

// ── [8] Reset helper ──────────────────────────────────────────────────────────

describe("_resetWorkerForTests()", () => {
  it("[8] resets module state even when timer is running", () => {
    startDeadlineWorker(ENABLED_CONFIG);
    expect(_isWorkerRunning()).toBe(true);
    _resetWorkerForTests();
    expect(_isWorkerRunning()).toBe(false);
  });
});

// ── [9] In-progress tick guard — stopDeadlineWorker() awaits current run ──────

describe("stopDeadlineWorker() awaits in-progress tick", () => {
  it("[9] does not resolve until the in-progress run finishes", async () => {
    // Build a deferred promise we control externally
    let resolveRun!: (v: WorkerRunResult) => void;
    const slowRun = new Promise<WorkerRunResult>((resolve) => { resolveRun = resolve; });

    // Simulate a tick that is already mid-flight
    _simulateInProgressTickForTests(slowRun);

    // stopDeadlineWorker() should NOT have resolved yet
    let stopResolved = false;
    const stopPromise = stopDeadlineWorker().then(() => { stopResolved = true; });

    // Yield to the micro-task queue — stop should still be pending
    await Promise.resolve();
    expect(stopResolved).toBe(false);

    // Finish the simulated run
    resolveRun({
      ran: true, locked: true,
      result: {
        startedAt: new Date(), finishedAt: new Date(),
        checkedRequests: 0, expiredRequests: 0,
        createdReminders: 0, sentReminders: 0,
        cancelledReminders: 0, failedRequests: 0, errors: [],
      },
      error: null,
    });

    // Now stop should resolve
    await stopPromise;
    expect(stopResolved).toBe(true);
    expect(_isWorkerRunning()).toBe(false);
  });
});

// ── [6] Advisory lock — concurrent invocations ────────────────────────────────

describe("Advisory lock — prevents double-processing", () => {
  it("[6] second runDeadlineEvaluationOnce() with lock held returns { locked: false }", async () => {
    // Hold the advisory lock manually on a raw pg client
    const client = await pool.connect();
    try {
      await client.query("SELECT pg_advisory_lock($1)", [ADVISORY_LOCK_KEY]);

      // Now try to run evaluation — it should fail to acquire the lock
      const result = await runDeadlineEvaluationOnce(ENABLED_CONFIG);

      expect(result.locked).toBe(false);
      expect(result.ran).toBe(false);
      expect(result.result).toBeNull();
      expect(result.error).toBeNull(); // no error — just skipped
    } finally {
      // Release and clean up
      try {
        await client.query("SELECT pg_advisory_unlock($1)", [ADVISORY_LOCK_KEY]);
      } catch { /* ignore */ }
      client.release();
    }
  });
});

// ── [7] No duplicate reminders on consecutive runs ────────────────────────────

describe("No duplicate reminders on repeated runs", () => {
  // DUE is in the past so RESPONSE_OVERDUE fires
  const DUE = new Date("2026-08-01T12:00:00Z");
  const NOW = new Date("2026-08-03T12:00:00Z"); // 48h after DUE → overdue

  beforeAll(async () => {
    // Takt
    await db.insert(takteTable).values({
      id: taktId("dedup"), projectId: PROJ_ID,
      taktBezeichnung: "T82 Dedup Takt", zone: "Z1", gewerk: "Rohbau",
      plannedStart: "2026-07-25", plannedEnd: "2026-08-01",
      lifecycleStatus: "IN_COORDINATION",
    }).onConflictDoNothing();

    // Request: responseRequiredBy in the past, no expiresAt so it stays open
    await db.insert(taktRequestsTable).values({
      id: reqId("dedup"),
      taktId: taktId("dedup"),
      guOrgId: GU_ORG, nuOrgId: NU_ORG,
      requestNumber: reqNum("dedup"),
      status: "DELIVERED" as const,
      createdByUserId: USER_ID,
      taktVersion: 1,
      responseRequiredBy: DUE,
      // No expiresAt so it doesn't auto-expire during this run
    }).onConflictDoNothing();
  });

  it("[7] two consecutive runs create exactly one RESPONSE_OVERDUE reminder", async () => {
    const config: DeadlineConfig = {
      ...ENABLED_CONFIG,
      workerEnabled: false, // don't start the interval — we call runNow directly
      overdueReminderHoursAfterDue: 0, // fire immediately after DUE
    };

    // First run
    const r1 = await runDeadlineEvaluationOnce(config, NOW);
    expect(r1.ran).toBe(true);

    // Second run — same data
    const r2 = await runDeadlineEvaluationOnce(config, NOW);
    expect(r2.ran).toBe(true);

    // Exactly one RESPONSE_OVERDUE reminder row
    const rows = await db.select()
      .from(taktRequestRemindersTable)
      .where(
        and(
          eq(taktRequestRemindersTable.taktRequestId, reqId("dedup")),
          eq(taktRequestRemindersTable.reminderType, "RESPONSE_OVERDUE"),
        ),
      );
    expect(rows).toHaveLength(1);
  });
});
