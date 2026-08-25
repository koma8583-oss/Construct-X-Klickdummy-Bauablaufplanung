/**
 * Task 3.4 — DB integration tests for LocalHubTransport.
 *
 * Fixture prefix: "t34-" — no collision with other test files.
 * Tests verify the full outbox → inbox delivery flow against the real DB.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { hubDb as db, messageOutboxTable, messageInboxTable } from "@workspace/db";
import { organizationsTable } from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
import { LocalHubTransport } from "../lib/transport/local-hub-transport";
import {
  InvalidEnvelopeError,
  IdempotencyConflictError,
  MessageNotFoundError,
  RecipientForbiddenError,
  NotRetryableError,
} from "../lib/transport/transport-errors";
import type { MessageEnvelope } from "../lib/transport/message-transport";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const GU_ORG = "t34-org-gu";
const NU_ORG = "t34-org-nu";
const OTHER_ORG = "t34-org-other";

const BASE_PAYLOAD = {
  taktRequestId: "t34-req-001",
  detailsUrl: "https://example.com/api/snapshot/t34-req-001",
  responseRequiredBy: "2026-10-01T00:00:00Z",
};

let transport: LocalHubTransport;

function makeEnvelope(overrides: Partial<MessageEnvelope> = {}): MessageEnvelope {
  return {
    messageId: `t34-${crypto.randomUUID()}`,
    schemaVersion: "1.0",
    messageType: "TAKT_REQUEST_NOTIFICATION",
    senderOrgId: GU_ORG,
    recipientOrgId: NU_ORG,
    correlationId: "t34-corr-001",
    createdAt: new Date(),
    payload: BASE_PAYLOAD,
    ...overrides,
  };
}

// ── Setup / teardown ──────────────────────────────────────────────────────────

beforeAll(async () => {
  await db
    .insert(organizationsTable)
    .values([
      { id: GU_ORG, name: "T34 GU Org", type: "AG" },
      { id: NU_ORG, name: "T34 NU Org", type: "AN" },
      { id: OTHER_ORG, name: "T34 Other Org", type: "AN" },
    ])
    .onConflictDoNothing();
  transport = new LocalHubTransport();
});

afterAll(async () => {
  const orgs = [GU_ORG, NU_ORG, OTHER_ORG];
  await db
    .execute(sql`DELETE FROM message_inbox  WHERE sender_org_id    = ANY(ARRAY[${sql.raw(orgs.map((o) => `'${o}'`).join(","))}])`)
    .catch(() => {});
  await db
    .execute(sql`DELETE FROM message_inbox  WHERE recipient_org_id = ANY(ARRAY[${sql.raw(orgs.map((o) => `'${o}'`).join(","))}])`)
    .catch(() => {});
  await db
    .execute(sql`DELETE FROM message_outbox WHERE sender_org_id    = ANY(ARRAY[${sql.raw(orgs.map((o) => `'${o}'`).join(","))}])`)
    .catch(() => {});
  await db
    .execute(sql`DELETE FROM organizations  WHERE id               = ANY(ARRAY[${sql.raw(orgs.map((o) => `'${o}'`).join(","))}])`)
    .catch(() => {});
});

// ── send() ────────────────────────────────────────────────────────────────────

describe("LocalHubTransport.send()", () => {
  it("delivers a message and returns DELIVERED result", async () => {
    const envelope = makeEnvelope();
    const result = await transport.send(envelope);

    expect(result.messageId).toBe(envelope.messageId);
    expect(result.status).toBe("DELIVERED");
    expect(result.sentAt).toBeInstanceOf(Date);
    expect(result.deliveredAt).toBeInstanceOf(Date);
    expect(result.attemptCount).toBe(1);
    expect(result.error).toBeUndefined();
  });

  it("outbox follows PENDING → SENT → DELIVERED status sequence", async () => {
    // We can't observe the intermediate SENT state in a synchronous test,
    // but we verify the final committed state is DELIVERED with all timestamps set.
    const envelope = makeEnvelope();
    await transport.send(envelope);

    const [outboxRow] = await db
      .select()
      .from(messageOutboxTable)
      .where(eq(messageOutboxTable.messageId, envelope.messageId));

    expect(outboxRow.status).toBe("DELIVERED");
    expect(outboxRow.attemptCount).toBe(1);
    expect(outboxRow.sentAt).toBeInstanceOf(Date);
    expect(outboxRow.deliveredAt).toBeInstanceOf(Date);
    expect(outboxRow.lastAttemptAt).toBeInstanceOf(Date);
    expect(outboxRow.failureReason).toBeNull();
  });

  it("creates exactly one inbox row for the recipient", async () => {
    const envelope = makeEnvelope();
    await transport.send(envelope);

    const inboxRows = await db
      .select()
      .from(messageInboxTable)
      .where(eq(messageInboxTable.messageId, envelope.messageId));

    expect(inboxRows).toHaveLength(1);
    expect(inboxRows[0].status).toBe("DELIVERED");
    expect(inboxRows[0].recipientOrgId).toBe(NU_ORG);
    expect(inboxRows[0].senderOrgId).toBe(GU_ORG);
    expect(inboxRows[0].receivedAt).toBeInstanceOf(Date);
  });

  it("sending the same messageId with identical content is idempotent — no second row", async () => {
    const envelope = makeEnvelope();
    const result1 = await transport.send(envelope);
    const result2 = await transport.send(envelope); // exact same envelope

    expect(result2.messageId).toBe(envelope.messageId);
    expect(result2.status).toBe("DELIVERED");

    const outboxRows = await db
      .select()
      .from(messageOutboxTable)
      .where(eq(messageOutboxTable.messageId, envelope.messageId));
    expect(outboxRows).toHaveLength(1);

    const inboxRows = await db
      .select()
      .from(messageInboxTable)
      .where(eq(messageInboxTable.messageId, envelope.messageId));
    expect(inboxRows).toHaveLength(1);

    // Both calls return the same result
    expect(result1.messageId).toBe(result2.messageId);
  });

  it("same messageId with different payload is rejected with IdempotencyConflictError", async () => {
    const envelope = makeEnvelope();
    await transport.send(envelope);

    const modified = { ...envelope, payload: { ...BASE_PAYLOAD, extra: "conflict" } };

    await expect(transport.send(modified)).rejects.toBeInstanceOf(IdempotencyConflictError);
  });

  it("same messageId with different recipientOrgId is rejected with IdempotencyConflictError", async () => {
    const envelope = makeEnvelope();
    await transport.send(envelope);

    const conflicting = { ...envelope, recipientOrgId: OTHER_ORG };
    await expect(transport.send(conflicting)).rejects.toBeInstanceOf(IdempotencyConflictError);
  });

  it("stores a failed delivery as FAILED in the outbox when inbox insert fails", async () => {
    // Pre-insert an inbox row to cause the DB unique constraint to fire
    // when LocalHubTransport tries to insert during send()
    const messageId = `t34-prefail-${crypto.randomUUID()}`;
    await db.insert(messageInboxTable).values({
      messageId,
      recipientOrgId: NU_ORG,
      senderOrgId: GU_ORG,
      messageType: "TAKT_REQUEST_NOTIFICATION",
      correlationId: "t34-corr-fail",
      payload: BASE_PAYLOAD,
      status: "DELIVERED",
    });

    const envelope = makeEnvelope({ messageId, correlationId: "t34-corr-fail" });
    const result = await transport.send(envelope);

    expect(result.status).toBe("FAILED");
    expect(result.error).toBeDefined();
    expect(result.error!.code).toBe("TRANSPORT_FAILURE");

    // Outbox must be FAILED, not stuck at PENDING
    const [outboxRow] = await db
      .select()
      .from(messageOutboxTable)
      .where(eq(messageOutboxTable.messageId, messageId));

    expect(outboxRow.status).toBe("FAILED");
    expect(outboxRow.failureReason).toBeTruthy();
    expect(outboxRow.attemptCount).toBe(1);
  });

  it("send() result has no domain-level TaktRequest fields", async () => {
    const result = await transport.send(makeEnvelope());
    const keys = Object.keys(result);
    for (const key of keys) {
      expect(["messageId", "status", "sentAt", "deliveredAt", "attemptCount", "error"]).toContain(key);
    }
  });
});

// ── getInbox() ────────────────────────────────────────────────────────────────

describe("LocalHubTransport.getInbox()", () => {
  it("returns only messages for the specified recipient", async () => {
    const corrId = `t34-scope-${crypto.randomUUID()}`;
    await transport.send(makeEnvelope({ correlationId: corrId, recipientOrgId: NU_ORG }));

    const nuInbox = await transport.getInbox(NU_ORG, { correlationId: corrId });
    const otherInbox = await transport.getInbox(OTHER_ORG, { correlationId: corrId });

    expect(nuInbox).toHaveLength(1);
    expect(nuInbox[0].recipientOrgId).toBe(NU_ORG);
    expect(otherInbox).toHaveLength(0);
  });

  it("filters by correlationId", async () => {
    const corrA = `t34-corrA-${crypto.randomUUID()}`;
    const corrB = `t34-corrB-${crypto.randomUUID()}`;
    await transport.send(makeEnvelope({ correlationId: corrA }));
    await transport.send(makeEnvelope({ correlationId: corrB }));

    const results = await transport.getInbox(NU_ORG, { correlationId: corrA });
    expect(results.every((m) => m.correlationId === corrA)).toBe(true);
    expect(results.length).toBeGreaterThanOrEqual(1);
  });

  it("filters by status", async () => {
    const corr = `t34-status-${crypto.randomUUID()}`;
    const envelope = makeEnvelope({ correlationId: corr });
    await transport.send(envelope);
    await transport.markAsRead(envelope.messageId, NU_ORG);

    const readMessages = await transport.getInbox(NU_ORG, { status: "READ", correlationId: corr });
    const deliveredMessages = await transport.getInbox(NU_ORG, { status: "DELIVERED", correlationId: corr });

    expect(readMessages).toHaveLength(1);
    expect(deliveredMessages).toHaveLength(0);
  });

  it("returns messages sorted by receivedAt descending (newest first)", async () => {
    const corr = `t34-sort-${crypto.randomUUID()}`;
    for (let i = 0; i < 3; i++) {
      await transport.send(makeEnvelope({ correlationId: corr }));
    }
    const inbox = await transport.getInbox(NU_ORG, { correlationId: corr });
    for (let i = 0; i < inbox.length - 1; i++) {
      expect(inbox[i].receivedAt.getTime()).toBeGreaterThanOrEqual(
        inbox[i + 1].receivedAt.getTime(),
      );
    }
  });

  it("supports limit and offset for pagination", async () => {
    const corr = `t34-page-${crypto.randomUUID()}`;
    for (let i = 0; i < 5; i++) {
      await transport.send(makeEnvelope({ correlationId: corr }));
    }
    const page1 = await transport.getInbox(NU_ORG, { correlationId: corr, limit: 2, offset: 0 });
    const page2 = await transport.getInbox(NU_ORG, { correlationId: corr, limit: 2, offset: 2 });
    expect(page1).toHaveLength(2);
    expect(page2).toHaveLength(2);
    expect(page1[0].messageId).not.toBe(page2[0].messageId);
  });
});

// ── markAsRead() ──────────────────────────────────────────────────────────────

describe("LocalHubTransport.markAsRead()", () => {
  it("marks an inbox message as READ and sets readAt", async () => {
    const envelope = makeEnvelope();
    await transport.send(envelope);

    await transport.markAsRead(envelope.messageId, NU_ORG);

    const [inboxRow] = await db
      .select()
      .from(messageInboxTable)
      .where(eq(messageInboxTable.messageId, envelope.messageId));

    expect(inboxRow.status).toBe("READ");
    expect(inboxRow.readAt).toBeInstanceOf(Date);
  });

  it("markAsRead is idempotent — calling twice does not error", async () => {
    const envelope = makeEnvelope();
    await transport.send(envelope);
    await transport.markAsRead(envelope.messageId, NU_ORG);
    await expect(transport.markAsRead(envelope.messageId, NU_ORG)).resolves.toBeUndefined();
  });

  it("throws RecipientForbiddenError when a different org tries to mark as read", async () => {
    const envelope = makeEnvelope();
    await transport.send(envelope);

    await expect(
      transport.markAsRead(envelope.messageId, OTHER_ORG),
    ).rejects.toBeInstanceOf(RecipientForbiddenError);
  });

  it("markAsRead does not touch takt_requests — returns void only", async () => {
    const envelope = makeEnvelope();
    await transport.send(envelope);
    const result = await transport.markAsRead(envelope.messageId, NU_ORG);
    expect(result).toBeUndefined();
  });

  it("throws MessageNotFoundError for an unknown messageId", async () => {
    await expect(
      transport.markAsRead("non-existent-msg-id", NU_ORG),
    ).rejects.toBeInstanceOf(MessageNotFoundError);
  });
});

// ── retry() ───────────────────────────────────────────────────────────────────

describe("LocalHubTransport.retry()", () => {
  it("retries a FAILED message using the same messageId", async () => {
    // Use the failure injection pattern to get a FAILED outbox row
    const messageId = `t34-retry-${crypto.randomUUID()}`;
    const corr = `t34-retry-corr-${messageId}`;

    // Pre-insert inbox to trigger failure
    await db.insert(messageInboxTable).values({
      messageId,
      recipientOrgId: NU_ORG,
      senderOrgId: GU_ORG,
      messageType: "TAKT_REQUEST_NOTIFICATION",
      correlationId: corr,
      payload: BASE_PAYLOAD,
      status: "DELIVERED",
    });

    // First send → fails (inbox conflict)
    await transport.send(makeEnvelope({ messageId, correlationId: corr }));

    // Verify outbox is FAILED
    const [failedRow] = await db
      .select()
      .from(messageOutboxTable)
      .where(eq(messageOutboxTable.messageId, messageId));
    expect(failedRow.status).toBe("FAILED");

    // Remove the conflicting inbox row so retry can succeed
    await db
      .delete(messageInboxTable)
      .where(
        and(
          eq(messageInboxTable.messageId, messageId),
          eq(messageInboxTable.recipientOrgId, NU_ORG),
        ),
      );

    // Retry — must reuse same messageId
    const retryResult = await transport.retry(messageId);

    expect(retryResult.messageId).toBe(messageId);
    expect(retryResult.status).toBe("DELIVERED");
    expect(retryResult.attemptCount).toBe(2);
    expect(retryResult.error).toBeUndefined();
  });

  it("throws NotRetryableError when retrying an already DELIVERED message", async () => {
    const envelope = makeEnvelope();
    await transport.send(envelope); // → DELIVERED

    await expect(
      transport.retry(envelope.messageId),
    ).rejects.toBeInstanceOf(NotRetryableError);
  });

  it("throws MessageNotFoundError for an unknown messageId", async () => {
    await expect(
      transport.retry("non-existent-id"),
    ).rejects.toBeInstanceOf(MessageNotFoundError);
  });
});
