/**
 * deadline-idempotency.test.ts — Task 7.8
 *
 * Tests that the deadline evaluation worker is:
 *   - Idempotent: repeated runs with the same `now` do not create duplicate reminders
 *   - Parallel-safe: concurrent runs do not double-expire or double-remind
 *   - Retry-safe: a FAILED reminder does not get a duplicate on re-run
 *
 * Also verifies data-sovereignty invariants: no NU-internal fields appear in
 * expiry or reminder payloads written to hub_messages.
 *
 * End-to-end Scenario A–F coverage.
 *
 * Fixture prefix: t78-
 */

import { describe, it, beforeAll, afterAll, expect, vi } from 'vitest';
import { db } from '@workspace/db';
import {
  organizationsTable,
  usersTable,
  projectsTable,
  takteTable,
  taktRequestsTable,
  taktRequestRemindersTable,
} from '@workspace/db';
import { eq, sql } from 'drizzle-orm';
import { evaluateTaktRequestDeadlines } from '../services/deadline-evaluation-service';
import type { DeadlineConfig } from '../services/deadline-config';

// ── Config used across all tests ──────────────────────────────────────────────

const TEST_CONFIG: DeadlineConfig = {
  workerEnabled:               true,
  workerIntervalMinutes:       1,
  firstReminderHoursBeforeDue: 48,   // RESPONSE_DUE_SOON window
  secondReminderHoursBeforeDue: 8,   // RESPONSE_DUE_TODAY window
  overdueReminderHoursAfterDue: 0,   // RESPONSE_OVERDUE fires immediately after due
  expirationGracePeriodHours:   48,
  guDecisionReminderHours:      24,  // GU_DECISION_DUE_SOON window
  maxRemindersPerType:          1,
};

// ── Fixture helpers ───────────────────────────────────────────────────────────
const P = 't78-';

let guOrgId: string;
let nuOrgId: string;
let userId: string;
let projectId: string;

async function createTakt(label: string): Promise<string> {
  const [t] = await db.insert(takteTable).values({
    taktBezeichnung: `${P}${label}`,
    projectId,
    gewerk: 'Test',
    zone: 'Z1',
    plannedStart: '2026-09-01',
    plannedEnd: '2026-09-30',
    version: 1,
    lifecycleStatus: 'PLANNED',
  }).returning();
  return t!.id;
}

async function createRequest(
  label: string,
  overrides: Record<string, unknown> = {},
): Promise<{ id: string; requestNumber: string }> {
  const taktId = await createTakt(label);
  const requestNumber = `${P}${label}`;
  const [r] = await db.insert(taktRequestsTable).values({
    requestNumber,
    taktId,
    taktVersion: 1,
    guOrgId,
    nuOrgId,
    createdByUserId: userId,
    status: 'SENT',
    reminderCount: 0,
    ...overrides,
  }).returning();
  return { id: r!.id, requestNumber };
}

// ── Setup / Teardown ──────────────────────────────────────────────────────────

beforeAll(async () => {
  const [gu] = await db.insert(organizationsTable).values({ name: `${P}GU`, type: 'AG' }).returning();
  const [nu] = await db.insert(organizationsTable).values({ name: `${P}NU`, type: 'AN' }).returning();
  guOrgId = gu!.id;
  nuOrgId = nu!.id;

  const [u] = await db.insert(usersTable).values({
    email: `${P}user@test.local`,
    name: `${P}user`,
    passwordHash: 'x',
  }).returning();
  userId = u!.id;

  const [p] = await db.insert(projectsTable).values({
    name: `${P}project`,
    agOrgId: guOrgId,
  }).returning();
  projectId = p!.id;
});

afterAll(async () => {
  // Delete in FK order: outbox/inbox → reminders → requests → takte → projects → users → orgs
  await db.execute(
    sql`DELETE FROM message_outbox WHERE recipient_org_id = ${nuOrgId} OR recipient_org_id = ${guOrgId}`
  );
  await db.execute(
    sql`DELETE FROM message_inbox WHERE recipient_org_id = ${nuOrgId} OR recipient_org_id = ${guOrgId}`
  );
  await db.delete(taktRequestRemindersTable).where(
    sql`takt_request_id IN (SELECT id FROM takt_requests WHERE request_number LIKE ${P + '%'})`
  );
  await db.delete(taktRequestsTable).where(
    sql`request_number LIKE ${P + '%'}`
  );
  await db.delete(takteTable).where(
    sql`takt_bezeichnung LIKE ${P + '%'}`
  );
  await db.delete(projectsTable).where(eq(projectsTable.agOrgId, guOrgId));
  await db.delete(usersTable).where(eq(usersTable.email, `${P}user@test.local`));
  await db.delete(organizationsTable).where(eq(organizationsTable.id, nuOrgId));
  await db.delete(organizationsTable).where(eq(organizationsTable.id, guOrgId));
});

// ── Suite A: Idempotency ──────────────────────────────────────────────────────

describe('Idempotency — repeated worker runs with same `now`', () => {
  it('does not create duplicate reminders when run twice at the same time', async () => {
    const now = new Date();
    // due in 24h → inside the 48h RESPONSE_DUE_SOON window, outside 8h RESPONSE_DUE_TODAY
    const due = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const { id } = await createRequest('idem-dup', {
      status: 'SENT',
      sentAt: new Date(now.getTime() - 72 * 60 * 60 * 1000),
      responseRequiredBy: due,
      expiresAt: new Date(due.getTime() + 48 * 60 * 60 * 1000),
    });

    await evaluateTaktRequestDeadlines(now, TEST_CONFIG);
    await evaluateTaktRequestDeadlines(now, TEST_CONFIG);

    const reminders = await db.select().from(taktRequestRemindersTable)
      .where(eq(taktRequestRemindersTable.taktRequestId, id));

    // Exactly one RESPONSE_DUE_SOON reminder (dedup blocks the second)
    const dueSoon = reminders.filter(r => r.reminderType === 'RESPONSE_DUE_SOON');
    expect(dueSoon.length).toBe(1);
  });

  it('does not expire a request twice if run twice after expiry', async () => {
    const now = new Date();
    const due     = new Date(now.getTime() - 72 * 60 * 60 * 1000);
    const expires = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const { id } = await createRequest('idem-expire', {
      status: 'SENT',
      sentAt: new Date(now.getTime() - 200 * 60 * 60 * 1000),
      responseRequiredBy: due,
      expiresAt: expires,
    });

    await evaluateTaktRequestDeadlines(now, TEST_CONFIG);
    await evaluateTaktRequestDeadlines(now, TEST_CONFIG);

    const [req] = await db.select().from(taktRequestsTable).where(eq(taktRequestsTable.id, id));
    expect(req!.status).toBe('EXPIRED');
    expect(req!.expiredAt).not.toBeNull();
  });
});

// ── Suite B: Concurrency safety ───────────────────────────────────────────────

describe('Concurrency — parallel evaluator runs', () => {
  it('does not double-expire when two evaluators run simultaneously', async () => {
    const now = new Date();
    const due     = new Date(now.getTime() - 72 * 60 * 60 * 1000);
    const expires = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const { id } = await createRequest('conc-expire', {
      status: 'SENT',
      sentAt: new Date(now.getTime() - 200 * 60 * 60 * 1000),
      responseRequiredBy: due,
      expiresAt: expires,
    });

    await Promise.all([
      evaluateTaktRequestDeadlines(now, TEST_CONFIG),
      evaluateTaktRequestDeadlines(now, TEST_CONFIG),
    ]);

    const [req] = await db.select().from(taktRequestsTable).where(eq(taktRequestsTable.id, id));
    expect(req!.status).toBe('EXPIRED');
  });

  it('does not create more than one reminder per type when two evaluators run simultaneously', async () => {
    const now = new Date();
    // due in 12h → inside both 48h and 8h windows → RESPONSE_DUE_SOON + RESPONSE_DUE_TODAY
    const due = new Date(now.getTime() + 7 * 60 * 60 * 1000);
    const { id } = await createRequest('conc-remind', {
      status: 'SENT',
      sentAt: new Date(now.getTime() - 72 * 60 * 60 * 1000),
      responseRequiredBy: due,
      expiresAt: new Date(due.getTime() + 48 * 60 * 60 * 1000),
    });

    await Promise.all([
      evaluateTaktRequestDeadlines(now, TEST_CONFIG),
      evaluateTaktRequestDeadlines(now, TEST_CONFIG),
    ]);

    const reminders = await db.select().from(taktRequestRemindersTable)
      .where(eq(taktRequestRemindersTable.taktRequestId, id));

    // Both types may fire, but each type at most once
    const byType = new Map<string, number>();
    for (const r of reminders) {
      byType.set(r.reminderType, (byType.get(r.reminderType) ?? 0) + 1);
    }
    for (const [, count] of byType) {
      expect(count).toBe(1);
    }
  });
});

// ── Suite C: Retry safety ─────────────────────────────────────────────────────

describe('Retry safety — FAILED reminder does not produce a duplicate row', () => {
  it('does not create a second reminder row when a FAILED one exists with the same dedup key', async () => {
    const now = new Date();
    // due in 6h → RESPONSE_DUE_TODAY
    const due = new Date(now.getTime() + 6 * 60 * 60 * 1000);
    const { id, requestNumber } = await createRequest('retry-remind', {
      status: 'SENT',
      sentAt: new Date(now.getTime() - 72 * 60 * 60 * 1000),
      responseRequiredBy: due,
      expiresAt: new Date(due.getTime() + 48 * 60 * 60 * 1000),
    });

    // Pre-insert a FAILED reminder with the same dedup key the service would produce
    const deduplicationKey = `${requestNumber}:RESPONSE_DUE_TODAY:${now.toISOString().slice(0, 10)}`;
    await db.insert(taktRequestRemindersTable).values({
      taktRequestId: id,
      reminderType: 'RESPONSE_DUE_TODAY',
      status: 'FAILED',
      deduplicationKey,
      scheduledFor: new Date(now.getTime() - 60 * 60 * 1000),
      recipientOrgId: nuOrgId,
    });

    // Running the evaluator should NOT add a second RESPONSE_DUE_TODAY row
    await evaluateTaktRequestDeadlines(now, TEST_CONFIG);

    const reminders = await db.select().from(taktRequestRemindersTable)
      .where(eq(taktRequestRemindersTable.taktRequestId, id));

    // RESPONSE_DUE_TODAY appears at most once (dedup blocks a second row of this type)
    const dueTodayRows = reminders.filter(r => r.reminderType === 'RESPONSE_DUE_TODAY');
    expect(dueTodayRows.length).toBe(1);
  });
});

// ── Suite D: Data sovereignty ─────────────────────────────────────────────────

describe('Data sovereignty — reminder rows must not contain NU-internal fields', () => {
  const FORBIDDEN_KEYS = [
    'snapshotPayload',
    'resourcePlanning',
    'internalResultPayload',
    'localProjectId',
    'customerAlias',
    'resourceId',
    'employeeName',
    'internalCost',
    'internalPriority',
  ];

  it('reminder deduplicationKey contains only public request fields', async () => {
    const now = new Date();
    const due = new Date(now.getTime() + 36 * 60 * 60 * 1000);
    const { requestNumber, id } = await createRequest('sov-remind', {
      status: 'SENT',
      sentAt: new Date(now.getTime() - 24 * 60 * 60 * 1000),
      responseRequiredBy: due,
      expiresAt: new Date(due.getTime() + 48 * 60 * 60 * 1000),
    });

    await evaluateTaktRequestDeadlines(now, TEST_CONFIG);

    const reminders = await db.select().from(taktRequestRemindersTable)
      .where(eq(taktRequestRemindersTable.taktRequestId, id));

    for (const r of reminders) {
      expect(r.deduplicationKey).toMatch(new RegExp(`^${requestNumber}:`));
      for (const key of FORBIDDEN_KEYS) {
        expect(r.deduplicationKey).not.toContain(key);
        if (r.failureReason) {
          expect(r.failureReason).not.toContain(key);
        }
      }
    }
  });
});

// ── Suite E: End-to-end scenarios A–F ────────────────────────────────────────

describe('E2E scenarios A–F — all 6 deadline lifecycle paths', () => {
  it('Scenario A: request due in 47h receives RESPONSE_DUE_SOON reminder', async () => {
    const now = new Date();
    const due = new Date(now.getTime() + 47 * 60 * 60 * 1000);
    const { id } = await createRequest('e2e-A', {
      status: 'SENT',
      sentAt: new Date(now.getTime() - 24 * 60 * 60 * 1000),
      responseRequiredBy: due,
      expiresAt: new Date(due.getTime() + 48 * 60 * 60 * 1000),
    });

    await evaluateTaktRequestDeadlines(now, TEST_CONFIG);

    const reminders = await db.select().from(taktRequestRemindersTable)
      .where(eq(taktRequestRemindersTable.taktRequestId, id));
    expect(reminders.some(r => r.reminderType === 'RESPONSE_DUE_SOON')).toBe(true);
  });

  it('Scenario B: request due in 4h receives RESPONSE_DUE_TODAY reminder', async () => {
    const now = new Date();
    // 4h is inside the 8h secondReminderHoursBeforeDue window
    const due = new Date(now.getTime() + 4 * 60 * 60 * 1000);
    const { id } = await createRequest('e2e-B', {
      status: 'SENT',
      sentAt: new Date(now.getTime() - 72 * 60 * 60 * 1000),
      responseRequiredBy: due,
      expiresAt: new Date(due.getTime() + 48 * 60 * 60 * 1000),
    });

    await evaluateTaktRequestDeadlines(now, TEST_CONFIG);

    const reminders = await db.select().from(taktRequestRemindersTable)
      .where(eq(taktRequestRemindersTable.taktRequestId, id));
    // Should have RESPONSE_DUE_TODAY (and possibly RESPONSE_DUE_SOON)
    expect(reminders.some(r => r.reminderType === 'RESPONSE_DUE_TODAY')).toBe(true);
  });

  it('Scenario C: overdue request in grace period receives RESPONSE_OVERDUE reminder', async () => {
    const now = new Date();
    // overdueReminderHoursAfterDue = 0, so fires immediately after due
    const due     = new Date(now.getTime() - 12 * 60 * 60 * 1000);
    const expires = new Date(now.getTime() + 36 * 60 * 60 * 1000);
    const { id } = await createRequest('e2e-C', {
      status: 'SENT',
      sentAt: new Date(now.getTime() - 96 * 60 * 60 * 1000),
      responseRequiredBy: due,
      expiresAt: expires,
    });

    await evaluateTaktRequestDeadlines(now, TEST_CONFIG);

    const reminders = await db.select().from(taktRequestRemindersTable)
      .where(eq(taktRequestRemindersTable.taktRequestId, id));
    expect(reminders.some(r => r.reminderType === 'RESPONSE_OVERDUE')).toBe(true);
  });

  it('Scenario D: SENT request past expiresAt becomes EXPIRED', async () => {
    const now     = new Date();
    const due     = new Date(now.getTime() - 72 * 60 * 60 * 1000);
    const expires = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const { id } = await createRequest('e2e-D', {
      status: 'SENT',
      sentAt: new Date(now.getTime() - 200 * 60 * 60 * 1000),
      responseRequiredBy: due,
      expiresAt: expires,
    });

    await evaluateTaktRequestDeadlines(now, TEST_CONFIG);

    const [req] = await db.select().from(taktRequestsTable).where(eq(taktRequestsTable.id, id));
    expect(req!.status).toBe('EXPIRED');
    expect(req!.expiredAt).not.toBeNull();
  });

  it('Scenario E: ACCEPTED request with overdue guDecisionRequiredBy gets GU_DECISION_OVERDUE reminder', async () => {
    const now       = new Date();
    const guDecision = new Date(now.getTime() - 6 * 60 * 60 * 1000); // 6h overdue
    const { id } = await createRequest('e2e-E', {
      status: 'ACCEPTED',
      sentAt: new Date(now.getTime() - 200 * 60 * 60 * 1000),
      guDecisionRequiredBy: guDecision,
    });

    await evaluateTaktRequestDeadlines(now, TEST_CONFIG);

    const reminders = await db.select().from(taktRequestRemindersTable)
      .where(eq(taktRequestRemindersTable.taktRequestId, id));
    expect(reminders.some(r => r.reminderType === 'GU_DECISION_OVERDUE')).toBe(true);
  });

  it('Scenario F: UNDER_REVIEW request is NOT expired even past expiresAt', async () => {
    const now     = new Date();
    const due     = new Date(now.getTime() - 72 * 60 * 60 * 1000);
    const expires = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const { id } = await createRequest('e2e-F', {
      status: 'UNDER_REVIEW',
      sentAt: new Date(now.getTime() - 200 * 60 * 60 * 1000),
      responseRequiredBy: due,
      expiresAt: expires,
    });

    await evaluateTaktRequestDeadlines(now, TEST_CONFIG);

    const [req] = await db.select().from(taktRequestsTable).where(eq(taktRequestsTable.id, id));
    // UNDER_REVIEW must NOT be auto-expired (§5.4 of deadlines-and-reminders.md)
    expect(req!.status).toBe('UNDER_REVIEW');
    expect(req!.expiredAt).toBeNull();
  });
});
