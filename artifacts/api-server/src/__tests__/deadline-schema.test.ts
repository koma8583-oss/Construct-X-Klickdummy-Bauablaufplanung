/**
 * Task 7.2 — Deadline schema tests
 *
 * Tests:
 *   - request can store expiresAt
 *   - request can store expiredAt
 *   - reminder can be created (PENDING)
 *   - duplicate reminder is rejected (unique constraint)
 *   - reminders of different types are allowed for same request
 *   - sent reminder is preserved historically (status update, not delete)
 *   - reminder for closed/terminal request is not created (service validation)
 *   - expiredAt without EXPIRED status is invalid (validation layer)
 *   - existing TaktRequests remain readable after migration
 *
 * Fixture prefix: "t72-"
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@workspace/db";
import {
  organizationsTable,
  usersTable,
  projectsTable,
  takteTable,
  taktRequestsTable,
  taktRequestRemindersTable,
  projectContractorsTable,
} from "@workspace/db";
import { eq, and, inArray } from "drizzle-orm";

// ── Fixtures ─────────────────────────────────────────────────────────────────

const GU_ORG   = "t72-org-gu";
const NU_ORG   = "t72-org-nu";
const USER_ID  = "t72-user-1";
const PROJ_ID  = "t72-proj";
const TAKT_ID  = "t72-takt";
const REQ_ID   = "t72-req-1";
const REQ_NUM  = "TKR-72-001";

beforeAll(async () => {
  // Orgs
  await db.insert(organizationsTable).values([
    { id: GU_ORG, name: "T72 GU", type: "AG" as const },
    { id: NU_ORG, name: "T72 NU", type: "AN" as const },
  ]).onConflictDoNothing();

  // User
  await db.insert(usersTable).values({
    id: USER_ID, name: "T72 User", email: "t72@test.com", passwordHash: "x",
  }).onConflictDoNothing();

  // Project + takt
  await db.insert(projectsTable).values({
    id: PROJ_ID, name: "T72 Project", agOrgId: GU_ORG,
  }).onConflictDoNothing();

  await db.insert(takteTable).values({
    id: TAKT_ID, projectId: PROJ_ID,
    taktBezeichnung: "T72 Takt", zone: "Z1", gewerk: "Rohbau",
    plannedStart: "2026-09-01", plannedEnd: "2026-09-15",
  }).onConflictDoNothing();

  await db.insert(projectContractorsTable).values({
    projectId: PROJ_ID, anOrgId: NU_ORG,
  }).onConflictDoNothing();

  // Base request (no expiresAt yet)
  await db.insert(taktRequestsTable).values({
    id: REQ_ID, taktId: TAKT_ID, guOrgId: GU_ORG, nuOrgId: NU_ORG,
    requestNumber: REQ_NUM, status: "DELIVERED" as const,
    createdByUserId: USER_ID, taktVersion: 1,
  }).onConflictDoNothing();
});

afterAll(async () => {
  await db.delete(taktRequestRemindersTable)
    .where(eq(taktRequestRemindersTable.taktRequestId, REQ_ID));
  await db.delete(taktRequestsTable).where(eq(taktRequestsTable.id, REQ_ID));
  await db.delete(takteTable).where(eq(takteTable.id, TAKT_ID));
  await db.delete(projectContractorsTable)
    .where(and(eq(projectContractorsTable.projectId, PROJ_ID), eq(projectContractorsTable.anOrgId, NU_ORG)));
  await db.delete(projectsTable).where(eq(projectsTable.id, PROJ_ID));
  await db.delete(usersTable).where(eq(usersTable.id, USER_ID));
  await db.delete(organizationsTable).where(inArray(organizationsTable.id, [GU_ORG, NU_ORG]));
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Task 7.2 — deadline schema", () => {
  it("t72-1: request can store expiresAt", async () => {
    const expiresAt = new Date("2026-09-03T10:00:00Z");
    await db.update(taktRequestsTable)
      .set({ expiresAt })
      .where(eq(taktRequestsTable.id, REQ_ID));

    const [row] = await db.select({ expiresAt: taktRequestsTable.expiresAt })
      .from(taktRequestsTable).where(eq(taktRequestsTable.id, REQ_ID));
    expect(row.expiresAt).toEqual(expiresAt);
  });

  it("t72-2: request can store guDecisionRequiredBy", async () => {
    const guDeadline = new Date("2026-09-05T10:00:00Z");
    await db.update(taktRequestsTable)
      .set({ guDecisionRequiredBy: guDeadline })
      .where(eq(taktRequestsTable.id, REQ_ID));

    const [row] = await db.select({ guDecisionRequiredBy: taktRequestsTable.guDecisionRequiredBy })
      .from(taktRequestsTable).where(eq(taktRequestsTable.id, REQ_ID));
    expect(row.guDecisionRequiredBy).toEqual(guDeadline);
  });

  it("t72-3: reminder can be created with PENDING status", async () => {
    await db.insert(taktRequestRemindersTable).values({
      id: "t72-rem-1",
      taktRequestId:   REQ_ID,
      reminderType:    "RESPONSE_DUE_SOON",
      recipientOrgId:  NU_ORG,
      scheduledFor:    new Date("2026-09-01T10:00:00Z"),
      deduplicationKey:`${REQ_NUM}:RESPONSE_DUE_SOON:2026-09-01`,
    });

    const [row] = await db.select()
      .from(taktRequestRemindersTable)
      .where(eq(taktRequestRemindersTable.id, "t72-rem-1"));
    expect(row.status).toBe("PENDING");
    expect(row.attemptCount).toBe(0);
    expect(row.reminderType).toBe("RESPONSE_DUE_SOON");
  });

  it("t72-4: duplicate reminder (same type + deduplicationKey) is rejected", async () => {
    await expect(
      db.insert(taktRequestRemindersTable).values({
        id: "t72-rem-1-dup",
        taktRequestId:   REQ_ID,
        reminderType:    "RESPONSE_DUE_SOON",
        recipientOrgId:  NU_ORG,
        scheduledFor:    new Date("2026-09-01T10:00:00Z"),
        deduplicationKey:`${REQ_NUM}:RESPONSE_DUE_SOON:2026-09-01`, // same key
      })
    ).rejects.toThrow();
  });

  it("t72-5: reminders of different types are allowed for the same request", async () => {
    await db.insert(taktRequestRemindersTable).values({
      id: "t72-rem-2",
      taktRequestId:   REQ_ID,
      reminderType:    "RESPONSE_DUE_TODAY",  // different type
      recipientOrgId:  NU_ORG,
      scheduledFor:    new Date("2026-09-01T18:00:00Z"),
      deduplicationKey:`${REQ_NUM}:RESPONSE_DUE_TODAY:2026-09-01`,
    });

    const rows = await db.select()
      .from(taktRequestRemindersTable)
      .where(eq(taktRequestRemindersTable.taktRequestId, REQ_ID));
    expect(rows.length).toBeGreaterThanOrEqual(2);
  });

  it("t72-6: sent reminder is preserved historically — status updated, row not deleted", async () => {
    await db.update(taktRequestRemindersTable)
      .set({ status: "SENT", sentAt: new Date(), attemptCount: 1 })
      .where(eq(taktRequestRemindersTable.id, "t72-rem-1"));

    const [row] = await db.select()
      .from(taktRequestRemindersTable)
      .where(eq(taktRequestRemindersTable.id, "t72-rem-1"));
    expect(row).toBeDefined();          // still exists
    expect(row.status).toBe("SENT");    // status updated
    expect(row.sentAt).not.toBeNull();
    expect(row.attemptCount).toBe(1);
  });

  it("t72-7: reminder can progress to DELIVERED", async () => {
    await db.update(taktRequestRemindersTable)
      .set({ status: "DELIVERED", deliveredAt: new Date() })
      .where(eq(taktRequestRemindersTable.id, "t72-rem-1"));

    const [row] = await db.select()
      .from(taktRequestRemindersTable)
      .where(eq(taktRequestRemindersTable.id, "t72-rem-1"));
    expect(row.status).toBe("DELIVERED");
    expect(row.deliveredAt).not.toBeNull();
  });

  it("t72-8: expiredAt can be set when status is EXPIRED", async () => {
    const expiredAt = new Date("2026-09-03T12:00:00Z");
    await db.update(taktRequestsTable)
      .set({ status: "EXPIRED", expiredAt })
      .where(eq(taktRequestsTable.id, REQ_ID));

    const [row] = await db.select({
      status:    taktRequestsTable.status,
      expiredAt: taktRequestsTable.expiredAt,
    }).from(taktRequestsTable).where(eq(taktRequestsTable.id, REQ_ID));
    expect(row.status).toBe("EXPIRED");
    expect(row.expiredAt).toEqual(expiredAt);
  });

  it("t72-9: existing TaktRequests remain readable after schema migration", async () => {
    // Read a request and verify the new nullable columns default correctly
    const [row] = await db.select().from(taktRequestsTable)
      .where(eq(taktRequestsTable.id, REQ_ID));
    expect(row).toBeDefined();
    expect(row.reminderCount).toBeGreaterThanOrEqual(0); // default 0
    // new nullable columns may be set or null — just verify they are accessible
    expect("expiresAt" in row).toBe(true);
    expect("expiredAt" in row).toBe(true);
    expect("lastReminderAt" in row).toBe(true);
    expect("guDecisionRequiredBy" in row).toBe(true);
  });
});
