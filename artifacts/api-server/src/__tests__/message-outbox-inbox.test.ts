/**
 * Task 3.2 — DB integration tests for message_outbox and message_inbox tables.
 *
 * Fixture prefix: "t32-" — ensures no collision with other test files.
 * Each test uses direct SQL inserts to stay independent of any service layer.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { hubDb as db } from "@workspace/db";
import {
  messageOutboxTable,
  messageInboxTable,
  type InsertMessageOutbox,
  type InsertMessageInbox,
} from "@workspace/db";
import { organizationsTable } from "@workspace/db";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const GU_ORG_ID = "t32-org-gu";
const NU_ORG_ID = "t32-org-nu";
const NU2_ORG_ID = "t32-org-nu2";

const BASE_PAYLOAD: Record<string, unknown> = {
  schemaVersion: "1.0",
  taktRequestId: "t32-req-001",
  detailsUrl: "https://example.com/api/takt-requests/t32-req-001/snapshot",
  responseRequiredBy: "2026-10-01T00:00:00Z",
};

async function insertOrg(id: string, name: string, type: "AG" | "AN") {
  await db
    .insert(organizationsTable)
    .values({ id, name, type })
    .onConflictDoNothing();
}

// ── Setup / teardown ──────────────────────────────────────────────────────────

beforeAll(async () => {
  await insertOrg(GU_ORG_ID, "T32 GU Org", "AG");
  await insertOrg(NU_ORG_ID, "T32 NU Org", "AN");
  await insertOrg(NU2_ORG_ID, "T32 NU2 Org", "AN");
});

afterAll(async () => {
  // Delete in FK-safe order: inbox → outbox → orgs
  const { sql } = await import("drizzle-orm");
  await db
    .execute(sql`DELETE FROM message_inbox  WHERE sender_org_id    IN (${GU_ORG_ID}, ${NU_ORG_ID}, ${NU2_ORG_ID})`)
    .catch(() => {});
  await db
    .execute(sql`DELETE FROM message_inbox  WHERE recipient_org_id IN (${GU_ORG_ID}, ${NU_ORG_ID}, ${NU2_ORG_ID})`)
    .catch(() => {});
  await db
    .execute(sql`DELETE FROM message_outbox WHERE sender_org_id    IN (${GU_ORG_ID}, ${NU_ORG_ID}, ${NU2_ORG_ID})`)
    .catch(() => {});
  await db
    .execute(sql`DELETE FROM organizations  WHERE id               IN (${GU_ORG_ID}, ${NU_ORG_ID}, ${NU2_ORG_ID})`)
    .catch(() => {});
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeOutboxRow(overrides: Partial<InsertMessageOutbox> = {}): InsertMessageOutbox {
  return {
    messageId: `t32-msg-${crypto.randomUUID()}`,
    messageType: "TAKT_REQUEST_NOTIFICATION",
    senderOrgId: GU_ORG_ID,
    recipientOrgId: NU_ORG_ID,
    correlationId: "t32-corr-001",
    payload: BASE_PAYLOAD,
    ...overrides,
  };
}

function makeInboxRow(overrides: Partial<InsertMessageInbox> = {}): InsertMessageInbox {
  return {
    messageId: `t32-inbox-${crypto.randomUUID()}`,
    messageType: "TAKT_REQUEST_NOTIFICATION",
    senderOrgId: GU_ORG_ID,
    recipientOrgId: NU_ORG_ID,
    correlationId: "t32-corr-001",
    payload: BASE_PAYLOAD,
    ...overrides,
  };
}

// ── message_outbox ────────────────────────────────────────────────────────────

describe("message_outbox", () => {
  it("inserts a valid outbox row with correct defaults", async () => {
    const row = makeOutboxRow();
    const [inserted] = await db
      .insert(messageOutboxTable)
      .values(row)
      .returning();

    expect(inserted.messageId).toBe(row.messageId);
    expect(inserted.messageType).toBe("TAKT_REQUEST_NOTIFICATION");
    expect(inserted.status).toBe("PENDING");
    expect(inserted.attemptCount).toBe(0);
    expect(inserted.lastAttemptAt).toBeNull();
    expect(inserted.nextAttemptAt).toBeNull();
    expect(inserted.failureReason).toBeNull();
    expect(inserted.sentAt).toBeNull();
    expect(inserted.deliveredAt).toBeNull();
    expect(inserted.schemaVersion).toBe("1.0");
    expect(inserted.createdAt).toBeInstanceOf(Date);
  });

  it("rejects a duplicate messageId", async () => {
    const sharedMsgId = `t32-dup-${crypto.randomUUID()}`;
    await db.insert(messageOutboxTable).values(makeOutboxRow({ messageId: sharedMsgId }));

    await expect(
      db.insert(messageOutboxTable).values(makeOutboxRow({ messageId: sharedMsgId })),
    ).rejects.toThrow();
  });

  it("stores and retrieves a complex JSONB payload accurately", async () => {
    const complexPayload = {
      schemaVersion: "1.0",
      taktRequestId: "t32-req-complex",
      detailsUrl: "https://example.com/snapshot",
      responseRequiredBy: "2026-11-01T00:00:00Z",
      nested: { a: 1, b: [true, null, "x"] },
    };
    const [inserted] = await db
      .insert(messageOutboxTable)
      .values(makeOutboxRow({ payload: complexPayload }))
      .returning();

    expect(inserted.payload).toEqual(complexPayload);
    expect((inserted.payload as typeof complexPayload).nested.b).toEqual([true, null, "x"]);
  });

  it("accepts all DataspaceMessageType values", async () => {
    const types = [
      "TAKT_REQUEST_REVISED",
      "TAKT_REQUEST_CANCELLED",
      "TAKT_DETAILS_RETRIEVED",
      "TAKT_RESPONSE_SUBMITTED",
      "TAKT_RESPONSE_ACCEPTED",
      "TAKT_RESPONSE_REVISION_REQUESTED",
    ] as const;

    for (const messageType of types) {
      const [row] = await db
        .insert(messageOutboxTable)
        .values(makeOutboxRow({ messageType }))
        .returning();
      expect(row.messageType).toBe(messageType);
    }
  });

  it("accepts a nullable causationId (first message in thread)", async () => {
    const [row] = await db
      .insert(messageOutboxTable)
      .values(makeOutboxRow({ causationId: undefined }))
      .returning();
    expect(row.causationId).toBeNull();
  });

  it("stores causationId when set (follow-up message in thread)", async () => {
    const [row] = await db
      .insert(messageOutboxTable)
      .values(makeOutboxRow({ causationId: "t32-cause-msg-001" }))
      .returning();
    expect(row.causationId).toBe("t32-cause-msg-001");
  });
});

// ── message_inbox ─────────────────────────────────────────────────────────────

describe("message_inbox", () => {
  it("inserts a valid inbox row with correct defaults", async () => {
    const row = makeInboxRow();
    const [inserted] = await db
      .insert(messageInboxTable)
      .values(row)
      .returning();

    expect(inserted.messageId).toBe(row.messageId);
    expect(inserted.messageType).toBe("TAKT_REQUEST_NOTIFICATION");
    expect(inserted.status).toBe("DELIVERED");
    expect(inserted.readAt).toBeNull();
    expect(inserted.receivedAt).toBeInstanceOf(Date);
    expect(inserted.createdAt).toBeInstanceOf(Date);
  });

  it("rejects the same messageId for the same recipientOrgId (duplicate delivery)", async () => {
    const sharedMsgId = `t32-inbox-dup-${crypto.randomUUID()}`;
    await db.insert(messageInboxTable).values(
      makeInboxRow({ messageId: sharedMsgId, recipientOrgId: NU_ORG_ID }),
    );

    await expect(
      db.insert(messageInboxTable).values(
        makeInboxRow({ messageId: sharedMsgId, recipientOrgId: NU_ORG_ID }),
      ),
    ).rejects.toThrow();
  });

  it("allows the same messageId for different recipients (broadcast)", async () => {
    const sharedMsgId = `t32-inbox-bc-${crypto.randomUUID()}`;

    const [row1] = await db
      .insert(messageInboxTable)
      .values(makeInboxRow({ messageId: sharedMsgId, recipientOrgId: NU_ORG_ID }))
      .returning();

    const [row2] = await db
      .insert(messageInboxTable)
      .values(makeInboxRow({ messageId: sharedMsgId, recipientOrgId: NU2_ORG_ID }))
      .returning();

    expect(row1.messageId).toBe(sharedMsgId);
    expect(row2.messageId).toBe(sharedMsgId);
    expect(row1.recipientOrgId).not.toBe(row2.recipientOrgId);
  });

  it("stores and retrieves a JSONB payload accurately", async () => {
    const payload = { ...BASE_PAYLOAD, flag: true, count: 42 };
    const [row] = await db
      .insert(messageInboxTable)
      .values(makeInboxRow({ payload }))
      .returning();

    expect(row.payload).toEqual(payload);
    expect((row.payload as typeof payload).count).toBe(42);
  });

  it("default status is DELIVERED", async () => {
    const [row] = await db
      .insert(messageInboxTable)
      .values(makeInboxRow())
      .returning();
    expect(row.status).toBe("DELIVERED");
  });

  it("records readAt when set", async () => {
    const readAt = new Date("2026-09-15T10:00:00Z");
    const [row] = await db
      .insert(messageInboxTable)
      .values(makeInboxRow({ readAt }))
      .returning();
    expect(row.readAt).toEqual(readAt);
  });

  it("keeps messages from different recipients separate", async () => {
    const correlationId = `t32-sep-${crypto.randomUUID()}`;
    const msg1 = `t32-sep-msg1-${crypto.randomUUID()}`;
    const msg2 = `t32-sep-msg2-${crypto.randomUUID()}`;

    await db.insert(messageInboxTable).values(
      makeInboxRow({ messageId: msg1, recipientOrgId: NU_ORG_ID, correlationId }),
    );
    await db.insert(messageInboxTable).values(
      makeInboxRow({ messageId: msg2, recipientOrgId: NU2_ORG_ID, correlationId }),
    );

    const { eq, and } = await import("drizzle-orm");
    const nu1Rows = await db
      .select()
      .from(messageInboxTable)
      .where(
        and(
          eq(messageInboxTable.recipientOrgId, NU_ORG_ID),
          eq(messageInboxTable.correlationId, correlationId),
        ),
      );
    const nu2Rows = await db
      .select()
      .from(messageInboxTable)
      .where(
        and(
          eq(messageInboxTable.recipientOrgId, NU2_ORG_ID),
          eq(messageInboxTable.correlationId, correlationId),
        ),
      );

    expect(nu1Rows).toHaveLength(1);
    expect(nu1Rows[0].messageId).toBe(msg1);
    expect(nu2Rows).toHaveLength(1);
    expect(nu2Rows[0].messageId).toBe(msg2);
  });
});
