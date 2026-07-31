/**
 * Task 3.3 — Unit tests for the MessageTransport interface.
 *
 * Uses an in-memory mock implementation of MessageTransport so tests have
 * no DB dependency and run at unit-test speed. The mock enforces the same
 * behavioural contracts that every real implementation must satisfy.
 */
import { describe, it, expect, beforeEach } from "vitest";
import type {
  MessageTransport,
  MessageEnvelope,
  TransportResult,
  InboxMessage,
  InboxQueryOptions,
} from "../lib/transport/message-transport";
import {
  RecipientForbiddenError,
  NotRetryableError,
  MessageNotFoundError,
} from "../lib/transport/transport-errors";

// ── In-memory mock transport ──────────────────────────────────────────────────

/**
 * InMemoryTransport — a minimal MessageTransport implementation used only
 * in tests. It satisfies every contract in the interface without touching the DB.
 *
 * This demonstrates the correct shape for LocalHubTransport and EdcTransport.
 */
class InMemoryTransport implements MessageTransport {
  private outbox = new Map<string, { envelope: MessageEnvelope; result: TransportResult }>();
  private inbox = new Map<string, InboxMessage[]>(); // keyed by recipientOrgId

  async send(envelope: MessageEnvelope): Promise<TransportResult> {
    const now = new Date();
    const result: TransportResult = {
      messageId: envelope.messageId,
      status: "DELIVERED",
      sentAt: now,
      deliveredAt: now,
      attemptCount: 1,
    };
    this.outbox.set(envelope.messageId, { envelope, result });

    // Deliver to recipient inbox — idempotent on messageId per recipient
    const recipientInbox = this.inbox.get(envelope.recipientOrgId) ?? [];
    const alreadyDelivered = recipientInbox.some(
      (m) => m.messageId === envelope.messageId,
    );
    if (!alreadyDelivered) {
      recipientInbox.push({
        id: crypto.randomUUID(),
        messageId: envelope.messageId,
        senderOrgId: envelope.senderOrgId,
        recipientOrgId: envelope.recipientOrgId,
        messageType: envelope.messageType,
        correlationId: envelope.correlationId,
        payload: envelope.payload as Record<string, unknown>,
        status: "DELIVERED",
        receivedAt: now,
        readAt: null,
      });
      this.inbox.set(envelope.recipientOrgId, recipientInbox);
    }
    return result;
  }

  async getInbox(
    recipientOrgId: string,
    options?: InboxQueryOptions,
  ): Promise<InboxMessage[]> {
    let messages = this.inbox.get(recipientOrgId) ?? [];
    if (options?.status) {
      messages = messages.filter((m) => m.status === options.status);
    }
    if (options?.messageType) {
      messages = messages.filter((m) => m.messageType === options.messageType);
    }
    if (options?.correlationId) {
      messages = messages.filter(
        (m) => m.correlationId === options.correlationId,
      );
    }
    const offset = options?.offset ?? 0;
    const limit = options?.limit ?? messages.length;
    return messages.slice(offset, offset + limit);
  }

  async markAsRead(messageId: string, recipientOrgId: string): Promise<void> {
    const entry = this.outbox.get(messageId);
    if (!entry) throw new MessageNotFoundError(messageId);
    if (entry.envelope.recipientOrgId !== recipientOrgId) {
      throw new RecipientForbiddenError(messageId, recipientOrgId);
    }
    const recipientInbox = this.inbox.get(recipientOrgId) ?? [];
    const msg = recipientInbox.find((m) => m.messageId === messageId);
    if (msg) {
      msg.status = "READ";
      msg.readAt = new Date();
    }
  }

  async retry(messageId: string): Promise<TransportResult> {
    const entry = this.outbox.get(messageId);
    if (!entry) throw new MessageNotFoundError(messageId);
    if (entry.result.status !== "FAILED") {
      throw new NotRetryableError(messageId, entry.result.status);
    }
    // Retry reuses the same messageId
    const now = new Date();
    const retried: TransportResult = {
      messageId,
      status: "DELIVERED",
      sentAt: now,
      deliveredAt: now,
      attemptCount: entry.result.attemptCount + 1,
    };
    entry.result = retried;
    return retried;
  }

  /** Test helper — force a message into FAILED state */
  _forceFail(messageId: string) {
    const entry = this.outbox.get(messageId);
    if (entry) entry.result.status = "FAILED";
  }
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeEnvelope(overrides: Partial<MessageEnvelope> = {}): MessageEnvelope {
  return {
    messageId: crypto.randomUUID(),
    schemaVersion: "1.0",
    messageType: "TAKT_REQUEST_NOTIFICATION",
    senderOrgId: "org-gu-test",
    recipientOrgId: "org-nu-test",
    correlationId: "corr-001",
    createdAt: new Date(),
    payload: {
      taktRequestId: "req-001",
      detailsUrl: "https://example.com/snapshot/req-001",
      responseRequiredBy: "2026-10-01T00:00:00Z",
    },
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("MessageTransport (InMemoryTransport)", () => {
  let transport: InMemoryTransport;

  beforeEach(() => {
    transport = new InMemoryTransport();
  });

  // ── send ──────────────────────────────────────────────────────────────────

  it("delivers a valid envelope and returns DELIVERED status", async () => {
    const envelope = makeEnvelope();
    const result = await transport.send(envelope);

    expect(result.messageId).toBe(envelope.messageId);
    expect(result.status).toBe("DELIVERED");
    expect(result.sentAt).toBeInstanceOf(Date);
    expect(result.deliveredAt).toBeInstanceOf(Date);
    expect(result.attemptCount).toBe(1);
    expect(result.error).toBeUndefined();
  });

  it("send() is idempotent — sending the same messageId twice does not create a second inbox row", async () => {
    const envelope = makeEnvelope();
    await transport.send(envelope);
    await transport.send(envelope); // second send — same messageId

    const inbox = await transport.getInbox(envelope.recipientOrgId);
    const matching = inbox.filter((m) => m.messageId === envelope.messageId);
    expect(matching).toHaveLength(1);
  });

  it("does not change any TaktRequest status when delivering (transport is side-effect-free on domain)", async () => {
    // This test verifies the behavioural contract: transport.send() returns a
    // TransportResult — it never writes to takt_requests or changes lifecycleStatus.
    // We verify by checking that the result carries only transport metadata.
    const envelope = makeEnvelope();
    const result = await transport.send(envelope);

    expect(result).not.toHaveProperty("taktRequestStatus");
    expect(result).not.toHaveProperty("lifecycleStatus");
    // Only the 5 transport fields are present
    const allowedKeys: (keyof TransportResult)[] = [
      "messageId", "status", "sentAt", "deliveredAt", "attemptCount", "error",
    ];
    for (const key of Object.keys(result)) {
      expect(allowedKeys).toContain(key);
    }
  });

  // ── getInbox ──────────────────────────────────────────────────────────────

  it("inbox is scoped to the recipient — other organisations see no messages", async () => {
    const guEnvelope = makeEnvelope({ recipientOrgId: "org-nu-a" });
    await transport.send(guEnvelope);

    const nuBInbox = await transport.getInbox("org-nu-b");
    expect(nuBInbox).toHaveLength(0);

    const nuAInbox = await transport.getInbox("org-nu-a");
    expect(nuAInbox).toHaveLength(1);
    expect(nuAInbox[0].messageId).toBe(guEnvelope.messageId);
  });

  it("inbox filters by correlationId", async () => {
    await transport.send(makeEnvelope({ correlationId: "corr-A" }));
    await transport.send(makeEnvelope({ correlationId: "corr-B" }));

    const results = await transport.getInbox("org-nu-test", {
      correlationId: "corr-A",
    });
    expect(results).toHaveLength(1);
    expect(results[0].correlationId).toBe("corr-A");
  });

  it("inbox supports limit and offset for pagination", async () => {
    for (let i = 0; i < 5; i++) {
      await transport.send(makeEnvelope());
    }
    const page1 = await transport.getInbox("org-nu-test", { limit: 2, offset: 0 });
    const page2 = await transport.getInbox("org-nu-test", { limit: 2, offset: 2 });

    expect(page1).toHaveLength(2);
    expect(page2).toHaveLength(2);
    expect(page1[0].messageId).not.toBe(page2[0].messageId);
  });

  // ── markAsRead ────────────────────────────────────────────────────────────

  it("markAsRead sets status=READ and readAt for the addressed recipient", async () => {
    const envelope = makeEnvelope({ recipientOrgId: "org-nu-test" });
    await transport.send(envelope);

    await transport.markAsRead(envelope.messageId, "org-nu-test");

    const inbox = await transport.getInbox("org-nu-test", { status: "READ" });
    expect(inbox).toHaveLength(1);
    expect(inbox[0].readAt).toBeInstanceOf(Date);
  });

  it("markAsRead throws RecipientForbiddenError when called by a different organisation", async () => {
    const envelope = makeEnvelope({ recipientOrgId: "org-nu-test" });
    await transport.send(envelope);

    await expect(
      transport.markAsRead(envelope.messageId, "org-INTRUDER"),
    ).rejects.toBeInstanceOf(RecipientForbiddenError);
  });

  it("markAsRead does not change TaktRequest status", async () => {
    // Verify the contract: markAsRead returns void — it has no business side effects.
    const envelope = makeEnvelope({ recipientOrgId: "org-nu-test" });
    await transport.send(envelope);
    const result = await transport.markAsRead(envelope.messageId, "org-nu-test");
    expect(result).toBeUndefined();
  });

  // ── retry ─────────────────────────────────────────────────────────────────

  it("retry uses the same messageId as the original failed message", async () => {
    const envelope = makeEnvelope();
    await transport.send(envelope);
    transport._forceFail(envelope.messageId);

    const retryResult = await transport.retry(envelope.messageId);
    expect(retryResult.messageId).toBe(envelope.messageId);
    expect(retryResult.status).toBe("DELIVERED");
    expect(retryResult.attemptCount).toBe(2);
  });

  it("retry throws NotRetryableError when message is DELIVERED (not FAILED)", async () => {
    const envelope = makeEnvelope();
    await transport.send(envelope); // status = DELIVERED

    await expect(
      transport.retry(envelope.messageId),
    ).rejects.toBeInstanceOf(NotRetryableError);
  });

  it("retry throws MessageNotFoundError for an unknown messageId", async () => {
    await expect(
      transport.retry("non-existent-msg-id"),
    ).rejects.toBeInstanceOf(MessageNotFoundError);
  });
});
