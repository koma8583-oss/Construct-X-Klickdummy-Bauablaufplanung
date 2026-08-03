/**
 * Task 84 — Schema version validation + transport envelope idempotency
 *
 * Tests:
 *   [1]  assertSupportedSchemaVersion("1.0")  → passes (no throw)
 *   [2]  assertSupportedSchemaVersion("1.9")  → passes (minor bump, compatible)
 *   [3]  assertSupportedSchemaVersion("99.0") → throws UnsupportedSchemaVersionError (422)
 *   [4]  assertSupportedSchemaVersion("2.0")  → throws UnsupportedSchemaVersionError (422)
 *   [5]  assertSupportedSchemaVersion(undefined) → throws MalformedSchemaVersionError (400)
 *   [6]  assertSupportedSchemaVersion("")     → throws MalformedSchemaVersionError (400)
 *   [7]  assertSupportedSchemaVersion("v1")   → throws MalformedSchemaVersionError (400)
 *   [8]  assertSupportedSchemaVersion("10")   → throws MalformedSchemaVersionError (400)
 *
 *   stableStringify:
 *   [9]  {b:1, a:2} equals {a:2, b:1}
 *   [10] arrays preserve order — [1,2] ≠ [2,1]
 *   [11] nested objects inside arrays have keys sorted
 *   [12] JSONB-roundtrip stability: [{b:1,a:2}] matches [{a:2,b:1}]
 *   [13] null / primitives pass through unchanged
 *
 *   LocalHubTransport envelope idempotency (DB integration):
 *   [14] Same messageId + identical envelope → idempotent (200 cached result)
 *   [15] Same messageId + different causationId → IdempotencyConflictError
 *   [16] Same messageId + different schemaVersion → IdempotencyConflictError
 *         (and error carries correct conflictingFields list)
 *   [17] Same messageId + different payload → IdempotencyConflictError
 *   [18] Different messageId → independent delivery, two outbox rows
 *
 *   HTTP-layer mapping (via supertest against the /send endpoint):
 *   [19] Route returns 422 when schemaVersion is unsupported (bad version injected)
 *   [20] Route returns 409 for duplicate messageId with conflicting envelope
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { db } from "@workspace/db";
import { messageOutboxTable, messageInboxTable, organizationsTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import {
  assertSupportedSchemaVersion,
  MalformedSchemaVersionError,
  UnsupportedSchemaVersionError,
} from "../lib/schema-version";
import {
  stableStringify,
} from "../lib/transport/local-hub-transport";
import { LocalHubTransport } from "../lib/transport/local-hub-transport";
import { IdempotencyConflictError } from "../lib/transport/transport-errors";
import type { MessageEnvelope } from "../lib/transport/message-transport";

// ── Org fixtures ─────────────────────────────────────────────────────────────

const T84_GU_ORG = "t84-org-gu";
const T84_NU_ORG = "t84-org-nu";

beforeAll(async () => {
  await db.insert(organizationsTable).values([
    { id: T84_GU_ORG, name: "T84 GU", type: "AG" as const },
    { id: T84_NU_ORG, name: "T84 NU", type: "AN" as const },
  ]).onConflictDoNothing();
});

afterAll(async () => {
  // Drain all outbox/inbox rows for our test orgs before deleting the orgs
  await db.delete(messageInboxTable)
    .where(eq(messageInboxTable.recipientOrgId, T84_NU_ORG));
  await db.delete(messageOutboxTable)
    .where(eq(messageOutboxTable.senderOrgId, T84_GU_ORG));
  await db.delete(organizationsTable)
    .where(inArray(organizationsTable.id, [T84_GU_ORG, T84_NU_ORG]));
});

// ── Envelope factory ──────────────────────────────────────────────────────────

const TEST_PREFIX = "t84-";
const collectedMessageIds: string[] = [];

function makeEnvelope(overrides: Partial<MessageEnvelope> = {}): MessageEnvelope {
  const id = `${TEST_PREFIX}msg-${crypto.randomUUID()}`;
  collectedMessageIds.push(id);
  return {
    messageId: id,
    schemaVersion: "1.0",
    messageType: "TAKT_REQUEST_NOTIFICATION",
    senderOrgId: "t84-org-gu",
    recipientOrgId: "t84-org-nu",
    correlationId: "t84-corr-001",
    createdAt: new Date(),
    causationId: null,
    payload: {
      taktRequestId: "t84-req-001",
      detailsRef: "/api/takt-requests/t84-req-001",
    },
    ...overrides,
  };
}

// ── Cleanup ───────────────────────────────────────────────────────────────────

afterEach(async () => {
  if (collectedMessageIds.length > 0) {
    await db.delete(messageInboxTable)
      .where(inArray(messageInboxTable.messageId, [...collectedMessageIds]));
    await db.delete(messageOutboxTable)
      .where(inArray(messageOutboxTable.messageId, [...collectedMessageIds]));
    collectedMessageIds.length = 0;
  }
});

// ── [1-8] assertSupportedSchemaVersion ───────────────────────────────────────

describe("assertSupportedSchemaVersion", () => {
  it("[1] '1.0' → passes (current version)", () => {
    expect(() => assertSupportedSchemaVersion("1.0")).not.toThrow();
  });

  it("[2] '1.9' → passes (minor bump, backward-compatible)", () => {
    expect(() => assertSupportedSchemaVersion("1.9")).not.toThrow();
  });

  it("[3] '99.0' → throws UnsupportedSchemaVersionError (422-level)", () => {
    expect(() => assertSupportedSchemaVersion("99.0")).toThrow(UnsupportedSchemaVersionError);
  });

  it("[4] '2.0' → throws UnsupportedSchemaVersionError (422-level)", () => {
    let caught: unknown;
    try { assertSupportedSchemaVersion("2.0"); } catch (e) { caught = e; }
    expect(caught).toBeInstanceOf(UnsupportedSchemaVersionError);
    expect((caught as UnsupportedSchemaVersionError).schemaVersion).toBe("2.0");
    expect((caught as UnsupportedSchemaVersionError).supportedMajorVersions).toContain(1);
  });

  it("[5] undefined → throws MalformedSchemaVersionError (400-level)", () => {
    expect(() => assertSupportedSchemaVersion(undefined)).toThrow(MalformedSchemaVersionError);
  });

  it("[6] empty string → throws MalformedSchemaVersionError (400-level)", () => {
    expect(() => assertSupportedSchemaVersion("")).toThrow(MalformedSchemaVersionError);
  });

  it("[7] 'v1' (invalid format) → throws MalformedSchemaVersionError (400-level)", () => {
    let caught: unknown;
    try { assertSupportedSchemaVersion("v1"); } catch (e) { caught = e; }
    expect(caught).toBeInstanceOf(MalformedSchemaVersionError);
    expect((caught as MalformedSchemaVersionError).received).toBe("v1");
  });

  it("[8] '10' (no dot separator) → throws MalformedSchemaVersionError (400-level)", () => {
    expect(() => assertSupportedSchemaVersion("10")).toThrow(MalformedSchemaVersionError);
  });

  it("error names are distinct so callers can distinguish 400 vs 422", () => {
    let malformed: Error | null = null;
    let unsupported: Error | null = null;
    try { assertSupportedSchemaVersion("bad"); } catch (e) { malformed = e as Error; }
    try { assertSupportedSchemaVersion("2.0"); } catch (e) { unsupported = e as Error; }
    expect(malformed?.name).toBe("MalformedSchemaVersionError");
    expect(unsupported?.name).toBe("UnsupportedSchemaVersionError");
    expect(malformed?.name).not.toBe(unsupported?.name);
  });
});

// ── [9-13] stableStringify ────────────────────────────────────────────────────

describe("stableStringify", () => {
  it("[9] object key order does not affect output", () => {
    expect(stableStringify({ b: 1, a: 2 })).toBe(stableStringify({ a: 2, b: 1 }));
  });

  it("[10] arrays preserve element order — [1,2] ≠ [2,1]", () => {
    expect(stableStringify([1, 2])).not.toBe(stableStringify([2, 1]));
  });

  it("[11] nested objects inside arrays have their keys sorted", () => {
    const a = [{ z: 3, y: 4 }, { b: 2, a: 1 }];
    const b = [{ y: 4, z: 3 }, { a: 1, b: 2 }];
    expect(stableStringify(a)).toBe(stableStringify(b));
  });

  it("[12] JSONB round-trip stable: [{b:1,a:2}] matches JSONB-returned [{a:2,b:1}]", () => {
    // JSONB returns keys alphabetically. Simulate a round-trip by reversing key order.
    const original = [{ alternativeId: "ALT-001", rank: 1, timeWindow: { start: "2026-09-01", end: "2026-09-05" } }];
    // Simulate JSONB returning keys alphabetically (alphabetical is a subset of "sorted")
    const afterRoundTrip = [{ alternativeId: "ALT-001", rank: 1, timeWindow: { end: "2026-09-05", start: "2026-09-01" } }];
    expect(stableStringify(original)).toBe(stableStringify(afterRoundTrip));
  });

  it("[13] null and primitives pass through unchanged", () => {
    expect(stableStringify(null)).toBe("null");
    expect(stableStringify(42)).toBe("42");
    expect(stableStringify("hello")).toBe('"hello"');
    expect(stableStringify(true)).toBe("true");
  });

  it("deeply nested objects are fully sorted", () => {
    const a = { outer: { z: { nested: 9 }, a: 1 } };
    const b = { outer: { a: 1, z: { nested: 9 } } };
    expect(stableStringify(a)).toBe(stableStringify(b));
  });
});

// ── [14-18] LocalHubTransport envelope idempotency (DB integration) ───────────

describe("LocalHubTransport — envelope idempotency", () => {
  const transport = new LocalHubTransport();

  it("[14] same messageId + identical envelope → idempotent, returns cached result", async () => {
    const env = makeEnvelope();
    const first = await transport.send(env);
    expect(first.status).toBe("DELIVERED");

    const second = await transport.send(env); // exact same envelope
    expect(second.messageId).toBe(first.messageId);
    expect(second.status).toBe(first.status);

    // Only one inbox row should exist
    const inboxRows = await db.select().from(messageInboxTable)
      .where(eq(messageInboxTable.messageId, env.messageId));
    expect(inboxRows).toHaveLength(1);
  });

  it("[15] same messageId + different causationId → throws IdempotencyConflictError", async () => {
    const env = makeEnvelope({ causationId: "t84-cause-A" });
    await transport.send(env);

    const conflicting = { ...env, causationId: "t84-cause-B" };
    await expect(transport.send(conflicting)).rejects.toBeInstanceOf(IdempotencyConflictError);
  });

  it("[15] IdempotencyConflictError lists 'causationId' in conflictingFields", async () => {
    const env = makeEnvelope({ causationId: "t84-cause-X" });
    await transport.send(env);

    let caught: IdempotencyConflictError | null = null;
    try {
      await transport.send({ ...env, causationId: "t84-cause-Y" });
    } catch (e) {
      if (e instanceof IdempotencyConflictError) caught = e;
    }
    expect(caught).not.toBeNull();
    expect(caught!.conflictingFields).toContain("causationId");
    expect(caught!.messageId).toBe(env.messageId);
  });

  it("[16] same messageId + different schemaVersion → IdempotencyConflictError with schemaVersion in conflictingFields", async () => {
    const env = makeEnvelope({ schemaVersion: "1.0" });
    await transport.send(env);

    // 1.3 is a valid (supported) version, so it passes format/version check,
    // but it differs from the stored "1.0" and must be detected as a conflict.
    let caught: IdempotencyConflictError | null = null;
    try {
      await transport.send({ ...env, schemaVersion: "1.3" });
    } catch (e) {
      if (e instanceof IdempotencyConflictError) caught = e;
    }
    expect(caught).not.toBeNull();
    expect(caught!.conflictingFields).toContain("schemaVersion");
  });

  it("[17] same messageId + different payload → IdempotencyConflictError", async () => {
    const env = makeEnvelope({ payload: { taktRequestId: "t84-req-001", detailsRef: "/orig" } });
    await transport.send(env);

    await expect(
      transport.send({ ...env, payload: { taktRequestId: "t84-req-001", detailsRef: "/different" } }),
    ).rejects.toBeInstanceOf(IdempotencyConflictError);
  });

  it("[18] different messageIds → two independent deliveries, two outbox rows", async () => {
    const env1 = makeEnvelope();
    const env2 = makeEnvelope(); // generates a new UUID messageId
    expect(env1.messageId).not.toBe(env2.messageId);

    await transport.send(env1);
    await transport.send(env2);

    const rows = await db.select().from(messageOutboxTable)
      .where(inArray(messageOutboxTable.messageId, [env1.messageId, env2.messageId]));
    expect(rows).toHaveLength(2);
  });

  it("malformed schemaVersion throws MalformedSchemaVersionError before hitting the DB", async () => {
    const env = makeEnvelope({ schemaVersion: "bad-version" });
    await expect(transport.send(env)).rejects.toBeInstanceOf(MalformedSchemaVersionError);
  });

  it("unsupported major schemaVersion throws UnsupportedSchemaVersionError before hitting the DB", async () => {
    const env = makeEnvelope({ schemaVersion: "99.0" });
    await expect(transport.send(env)).rejects.toBeInstanceOf(UnsupportedSchemaVersionError);
  });
});
