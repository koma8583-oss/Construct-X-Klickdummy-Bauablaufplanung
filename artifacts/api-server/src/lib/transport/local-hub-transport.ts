/**
 * LocalHubTransport — PoC implementation of MessageTransport (Task 3.4).
 *
 * Simulates the Dataspace Hub in-process: both sender and recipient share the
 * same database, so outbox → inbox delivery is a local DB write rather than a
 * network call.
 *
 * A future EdcTransport will implement the same MessageTransport interface
 * using the Eclipse Dataspace Connector DSP protocol. No domain service needs
 * to change when that swap happens.
 *
 * Relationship to legacy writeHubMessage():
 *   - writeHubMessage() still exists and is called by delegation routes.
 *   - LocalHubTransport does NOT call writeHubMessage() internally — it writes
 *     to message_outbox / message_inbox directly.
 *   - writeHubMessage() is documented as legacy; it will be retired once
 *     delegation routes migrate to the new transport layer.
 *   - New domain services (TaktRequestNotificationService etc.) must ONLY use
 *     LocalHubTransport (or another MessageTransport), never writeHubMessage().
 *
 * Delivery flow for send():
 *   MessageEnvelope
 *     → message_outbox (PENDING)        — committed immediately
 *     → db.transaction:
 *         outbox → SENT + sentAt
 *         inbox  → DELIVERED + receivedAt
 *         outbox → DELIVERED + deliveredAt
 *     → on transaction failure:
 *         outbox → FAILED + failureReason  (best-effort outside tx)
 */
import { hubDb, messageOutboxTable, messageInboxTable } from "@workspace/db";
import { eq, and, desc, inArray } from "drizzle-orm";
import type { MessageEnvelope, MessageTransport, TransportResult, InboxMessage, InboxQueryOptions } from "./message-transport";
import type { DataspaceMessageType } from "@workspace/api-zod";
import {
  InvalidEnvelopeError,
  IdempotencyConflictError,
  MessageNotFoundError,
  RecipientForbiddenError,
  NotRetryableError,
  TransportFailureError,
} from "./transport-errors";
import {
  assertSupportedSchemaVersion,
  MalformedSchemaVersionError,
  UnsupportedSchemaVersionError,
} from "../schema-version";
import type { MessageOutbox } from "@workspace/db";

// ── Validation ────────────────────────────────────────────────────────────────

function validateEnvelope(envelope: MessageEnvelope): void {
  if (!envelope.messageId || envelope.messageId.trim() === "") {
    throw new InvalidEnvelopeError("messageId is required and must not be empty");
  }
  if (!envelope.messageType) {
    throw new InvalidEnvelopeError("messageType is required");
  }
  if (!envelope.senderOrgId) {
    throw new InvalidEnvelopeError("senderOrgId is required");
  }
  if (!envelope.recipientOrgId) {
    throw new InvalidEnvelopeError("recipientOrgId is required");
  }
  if (!envelope.correlationId) {
    throw new InvalidEnvelopeError("correlationId is required");
  }
  // assertSupportedSchemaVersion throws MalformedSchemaVersionError (400-level)
  // for missing/malformed format, and UnsupportedSchemaVersionError (422-level)
  // for an unknown major version. Both extend Error and are NOT InvalidEnvelopeError —
  // route handlers must catch them separately to return the correct HTTP status.
  assertSupportedSchemaVersion(envelope.schemaVersion);
  if (!envelope.payload || typeof envelope.payload !== "object" || Array.isArray(envelope.payload)) {
    throw new InvalidEnvelopeError("payload must be a non-null object");
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function rowToTransportResult(row: MessageOutbox): TransportResult {
  return {
    messageId: row.messageId,
    status: row.status,
    sentAt: row.sentAt ?? null,
    deliveredAt: row.deliveredAt ?? null,
    attemptCount: row.attemptCount,
    ...(row.status === "FAILED" && row.failureReason
      ? { error: { code: "TRANSPORT_FAILURE" as const, message: row.failureReason } }
      : {}),
  };
}

/**
 * Stable (sorted-keys) JSON serialisation for deep-equal comparison.
 *
 * PostgreSQL JSONB does not preserve insertion key order — it returns keys
 * alphabetically. Using plain JSON.stringify on the round-tripped DB value
 * would give a different string than the original envelope payload even when
 * the contents are semantically identical. Sorting keys before stringifying
 * makes the comparison order-independent.
 *
 * Arrays are preserved in their original order (order matters for arrays),
 * but each element is itself stably stringified — so nested object keys
 * inside array elements are also sorted. This ensures that an alternatives
 * array `[{b:1,a:2}]` produces the same string after a JSONB round-trip
 * as the original (JSONB returns keys alphabetically, so `{a:2,b:1}`).
 */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${(value as unknown[]).map(stableStringify).join(",")}]`;
  }
  const sorted = Object.keys(value as Record<string, unknown>)
    .sort()
    .map(
      (k) =>
        `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`,
    )
    .join(",");
  return `{${sorted}}`;
}

/**
 * Deep-equal check for idempotency conflict detection.
 * Compares ALL envelope identity fields — a mismatch in any of them indicates
 * the caller is incorrectly reusing a messageId for a different message.
 */
function envelopeMatchesRow(
  envelope: MessageEnvelope,
  row: MessageOutbox,
): boolean {
  return (
    envelope.schemaVersion === row.schemaVersion &&
    envelope.messageType === row.messageType &&
    envelope.senderOrgId === row.senderOrgId &&
    envelope.recipientOrgId === row.recipientOrgId &&
    envelope.correlationId === row.correlationId &&
    (envelope.causationId ?? null) === (row.causationId ?? null) &&
    stableStringify(envelope.payload) === stableStringify(row.payload)
  );
}

/**
 * Return the names of envelope fields that differ between an incoming envelope
 * and the stored outbox row. Used to populate `IdempotencyConflictError`.
 */
function findConflictingFields(
  envelope: MessageEnvelope,
  row: MessageOutbox,
): string[] {
  const conflicts: string[] = [];
  if (envelope.schemaVersion !== row.schemaVersion) conflicts.push("schemaVersion");
  if (envelope.messageType !== row.messageType) conflicts.push("messageType");
  if (envelope.senderOrgId !== row.senderOrgId) conflicts.push("senderOrgId");
  if (envelope.recipientOrgId !== row.recipientOrgId) conflicts.push("recipientOrgId");
  if (envelope.correlationId !== row.correlationId) conflicts.push("correlationId");
  if ((envelope.causationId ?? null) !== (row.causationId ?? null)) conflicts.push("causationId");
  if (stableStringify(envelope.payload) !== stableStringify(row.payload)) conflicts.push("payload");
  return conflicts;
}

// ── Implementation ────────────────────────────────────────────────────────────

export class LocalHubTransport implements MessageTransport {
  // ── send ──────────────────────────────────────────────────────────────────

  async send(envelope: MessageEnvelope): Promise<TransportResult> {
    // 1. Validate
    validateEnvelope(envelope);

    // 2. Idempotency check
      const existing = await hubDb
      .select()
      .from(messageOutboxTable)
      .where(eq(messageOutboxTable.messageId, envelope.messageId))
      .limit(1);

    if (existing.length > 0) {
      const row = existing[0];
      if (!envelopeMatchesRow(envelope, row)) {
        const conflictingFields = findConflictingFields(envelope, row);
        throw new IdempotencyConflictError(envelope.messageId, conflictingFields);
      }
      // Same content — return existing result without re-sending
      return rowToTransportResult(row);
    }

    // 3. Insert outbox with PENDING (committed immediately, outside transaction)
    const [outboxRow] = await hubDb
      .insert(messageOutboxTable)
      .values({
        messageId: envelope.messageId,
        schemaVersion: envelope.schemaVersion,
        messageType: envelope.messageType,
        senderOrgId: envelope.senderOrgId,
        recipientOrgId: envelope.recipientOrgId,
        correlationId: envelope.correlationId,
        causationId: envelope.causationId ?? null,
        payload: envelope.payload as Record<string, unknown>,
        status: "PENDING",
      })
      .returning();

    // 4-9. Transactional delivery: SENT → inbox DELIVERED → outbox DELIVERED
    try {
      const now = new Date();

      await hubDb.transaction(async (tx) => {
        // 4-5. Mark outbox as SENT, increment attemptCount
        await tx
          .update(messageOutboxTable)
          .set({
            status: "SENT",
            attemptCount: 1,
            lastAttemptAt: now,
            sentAt: now,
          })
          .where(eq(messageOutboxTable.id, outboxRow.id));

        // 6-7. Create inbox row as DELIVERED
        await tx.insert(messageInboxTable).values({
          messageId: envelope.messageId,
          recipientOrgId: envelope.recipientOrgId,
          senderOrgId: envelope.senderOrgId,
          messageType: envelope.messageType,
          correlationId: envelope.correlationId,
          payload: envelope.payload as Record<string, unknown>,
          status: "DELIVERED",
          receivedAt: now,
        });

        // 8-9. Mark outbox as DELIVERED with deliveredAt
        await tx
          .update(messageOutboxTable)
          .set({ status: "DELIVERED", deliveredAt: now })
          .where(eq(messageOutboxTable.id, outboxRow.id));
      });

      // 10. Return result from the now-committed outbox row
      const [delivered] = await hubDb
        .select()
        .from(messageOutboxTable)
        .where(eq(messageOutboxTable.id, outboxRow.id))
        .limit(1);

      return rowToTransportResult(delivered);
    } catch (err) {
      // Transaction rolled back — outbox is still PENDING; mark it FAILED
      const failureReason =
        err instanceof Error ? err.message : String(err);

      await hubDb
        .update(messageOutboxTable)
        .set({
          status: "FAILED",
          failureReason,
          attemptCount: 1,
          lastAttemptAt: new Date(),
        })
        .where(eq(messageOutboxTable.id, outboxRow.id))
        .catch(() => {
          // Best-effort — do not mask the original failure
        });

      return {
        messageId: envelope.messageId,
        status: "FAILED",
        sentAt: null,
        deliveredAt: null,
        attemptCount: 1,
        error: {
          code: "TRANSPORT_FAILURE",
          message: failureReason,
          cause: err,
        },
      };
    }
  }

  // ── getInbox ──────────────────────────────────────────────────────────────

  async getInbox(
    recipientOrgId: string,
    options?: InboxQueryOptions,
  ): Promise<InboxMessage[]> {
    // Build filter conditions — always scope to the recipient
    const conditions = [eq(messageInboxTable.recipientOrgId, recipientOrgId)];

    if (options?.status) {
      conditions.push(eq(messageInboxTable.status, options.status));
    }
    if (options?.messageType) {
      conditions.push(eq(messageInboxTable.messageType, options.messageType));
    }
    if (options?.correlationId) {
      conditions.push(eq(messageInboxTable.correlationId, options.correlationId));
    }

    const limit = options?.limit ?? 50;
    const offset = options?.offset ?? 0;

    const rows = await hubDb
      .select()
      .from(messageInboxTable)
      .where(and(...conditions))
      .orderBy(desc(messageInboxTable.receivedAt))
      .limit(limit)
      .offset(offset);

    return rows.map((row) => ({
      id: row.id,
      messageId: row.messageId,
      senderOrgId: row.senderOrgId,
      recipientOrgId: row.recipientOrgId,
      // The DB enum is also used for invitation messages. Keep the transport
      // boundary typed against the public contract while accepting the
      // database's complete message enum.
      messageType: row.messageType as DataspaceMessageType,
      correlationId: row.correlationId,
      payload: row.payload as Record<string, unknown>,
      status: row.status,
      receivedAt: row.receivedAt,
      readAt: row.readAt ?? null,
    }));
  }

  // ── markAsRead ────────────────────────────────────────────────────────────

  async markAsRead(messageId: string, recipientOrgId: string): Promise<void> {
    // Look up the inbox row
    const [inboxRow] = await hubDb
      .select()
      .from(messageInboxTable)
      .where(
        and(
          eq(messageInboxTable.messageId, messageId),
          eq(messageInboxTable.recipientOrgId, recipientOrgId),
        ),
      )
      .limit(1);

    if (!inboxRow) {
      // Distinguish: does the message exist for a different recipient?
      const [outboxRow] = await hubDb
        .select()
        .from(messageOutboxTable)
        .where(eq(messageOutboxTable.messageId, messageId))
        .limit(1);

      if (!outboxRow) {
        throw new MessageNotFoundError(messageId);
      }
      // Message exists but not for this recipient
      throw new RecipientForbiddenError(messageId, recipientOrgId);
    }

    // Idempotent: already READ → no-op
    if (inboxRow.status === "READ") {
      return;
    }

    const now = new Date();
    await hubDb
      .update(messageInboxTable)
      .set({ status: "READ", readAt: now })
      .where(
        and(
          eq(messageInboxTable.messageId, messageId),
          eq(messageInboxTable.recipientOrgId, recipientOrgId),
        ),
      );

    // Does NOT touch takt_requests — technical read ≠ business DETAILS_RETRIEVED
  }

  // ── retry ─────────────────────────────────────────────────────────────────

  async retry(messageId: string): Promise<TransportResult> {
    // Find the outbox row
    const [outboxRow] = await hubDb
      .select()
      .from(messageOutboxTable)
      .where(eq(messageOutboxTable.messageId, messageId))
      .limit(1);

    if (!outboxRow) {
      throw new MessageNotFoundError(messageId);
    }
    if (outboxRow.status !== "FAILED") {
      throw new NotRetryableError(messageId, outboxRow.status);
    }

    const now = new Date();
    const newAttemptCount = outboxRow.attemptCount + 1;

    try {
      await hubDb.transaction(async (tx) => {
        // Update outbox to SENT
        await tx
          .update(messageOutboxTable)
          .set({
            status: "SENT",
            attemptCount: newAttemptCount,
            lastAttemptAt: now,
            sentAt: now,
            failureReason: null,
          })
          .where(eq(messageOutboxTable.id, outboxRow.id));

        // Insert inbox row — skip if already delivered (ON CONFLICT DO NOTHING)
        await tx
          .insert(messageInboxTable)
          .values({
            messageId: outboxRow.messageId,
            recipientOrgId: outboxRow.recipientOrgId,
            senderOrgId: outboxRow.senderOrgId,
            messageType: outboxRow.messageType,
            correlationId: outboxRow.correlationId,
            payload: outboxRow.payload as Record<string, unknown>,
            status: "DELIVERED",
            receivedAt: now,
          })
          .onConflictDoNothing();

        // Mark outbox DELIVERED
        await tx
          .update(messageOutboxTable)
          .set({ status: "DELIVERED", deliveredAt: now })
          .where(eq(messageOutboxTable.id, outboxRow.id));
      });

      const [updated] = await hubDb
        .select()
        .from(messageOutboxTable)
        .where(eq(messageOutboxTable.id, outboxRow.id))
        .limit(1);

      return rowToTransportResult(updated);
    } catch (err) {
      const failureReason =
        err instanceof Error ? err.message : String(err);

      await hubDb
        .update(messageOutboxTable)
        .set({
          status: "FAILED",
          failureReason,
          attemptCount: newAttemptCount,
          lastAttemptAt: now,
        })
        .where(eq(messageOutboxTable.id, outboxRow.id))
        .catch(() => {});

      return {
        messageId,
        status: "FAILED",
        sentAt: null,
        deliveredAt: null,
        attemptCount: newAttemptCount,
        error: { code: "TRANSPORT_FAILURE", message: failureReason, cause: err },
      };
    }
  }
}
