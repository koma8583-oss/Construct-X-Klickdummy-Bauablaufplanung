/**
 * Abstract MessageTransport interface — Task 3.3.
 *
 * This is the single integration point that separates business logic from
 * transport mechanics. Domain services call only this interface; they never
 * reference Hub tables, HTTP clients, or EDC connectors directly.
 *
 * Current PoC implementation: LocalHubTransport (Task 3.4).
 * Future production implementation: EdcTransport — same interface, no changes
 * required in any domain service or route handler.
 *
 * Dependency direction:
 *   Domain service → MessageTransport ← LocalHubTransport
 *                                     ← EdcTransport (future)
 */

import type { DataspaceMessageStatus, DataspaceMessageType } from "@workspace/api-zod";
import type { MessageEnvelope } from "@workspace/api-zod";

export type { MessageEnvelope };

// ── Result type returned by send() and retry() ────────────────────────────────

/**
 * Technical outcome of a single send or retry attempt.
 *
 * `status` reflects the delivery state after this attempt.
 * `error` is only present when status === 'FAILED'.
 * Business logic must never branch on this type to change TaktRequest status —
 * that belongs in TaktRequestNotificationService.
 */
export interface TransportResult {
  /** The message this result refers to */
  messageId: string;
  /** Technical delivery status after the attempt */
  status: DataspaceMessageStatus;
  /** Timestamp of the send attempt; null if the message was never dispatched */
  sentAt: Date | null;
  /** Timestamp of confirmed delivery; null if not yet delivered */
  deliveredAt: Date | null;
  /** Number of total attempts including this one */
  attemptCount: number;
  /** Present only when status === 'FAILED' */
  error?: TransportError;
}

// ── Inbox query options ───────────────────────────────────────────────────────

/**
 * Optional filters for getInbox(). All fields are optional.
 * Implementations MUST apply at least the `recipientOrgId` passed to
 * getInbox() — these options narrow the result further.
 */
export interface InboxQueryOptions {
  /** Return only messages with this delivery status */
  status?: DataspaceMessageStatus;
  /** Return only messages of this business type */
  messageType?: DataspaceMessageType;
  /** Return only messages belonging to this coordination thread */
  correlationId?: string;
  /** Maximum number of results to return (for pagination) */
  limit?: number;
  /** Number of results to skip (for pagination) */
  offset?: number;
}

// ── Inbox message shape ───────────────────────────────────────────────────────

/**
 * A message as seen from the recipient's inbox.
 * Returned by getInbox() — represents the inbox row, not the outbox row.
 */
export interface InboxMessage {
  /** Inbox row ID */
  id: string;
  /** Globally unique message identifier (matches the outbox messageId) */
  messageId: string;
  /** Organisation that sent the message */
  senderOrgId: string;
  /** Organisation that received the message (always the queried recipient) */
  recipientOrgId: string;
  /** Business event type */
  messageType: DataspaceMessageType;
  /** Coordination thread identifier */
  correlationId: string;
  /** Minimal notification payload — no full Takt plans */
  payload: Record<string, unknown>;
  /** Current delivery / read status from the recipient's perspective */
  status: DataspaceMessageStatus;
  /** When the message was delivered to this inbox */
  receivedAt: Date;
  /** When the recipient's application code marked the message as read; null if unread */
  readAt: Date | null;
}

// ── Transport error ───────────────────────────────────────────────────────────

/**
 * Structured error attached to a failed TransportResult.
 * Use this to surface the technical failure reason without throwing.
 */
export interface TransportError {
  code: TransportErrorCode;
  message: string;
  /** Optional underlying cause (e.g. network error, DB constraint violation) */
  cause?: unknown;
}

export type TransportErrorCode =
  | "INVALID_ENVELOPE"      // Envelope failed schema validation
  | "MESSAGE_NOT_FOUND"     // messageId does not exist in outbox or inbox
  | "RECIPIENT_FORBIDDEN"   // Caller is not the addressed recipient
  | "NOT_RETRYABLE"         // Message is in a terminal state (DELIVERED, READ)
  | "TRANSPORT_FAILURE";    // Generic technical failure during send/delivery

// ── The interface ─────────────────────────────────────────────────────────────

/**
 * MessageTransport — the abstract boundary between domain services and transport.
 *
 * Implementations:
 *   - LocalHubTransport  (PoC): writes directly to message_outbox / message_inbox
 *     inside the same DB; simulates Hub routing in-process.
 *   - EdcTransport (future): routes through the Eclipse Dataspace Connector using
 *     DSP protocol; implements this same interface — no domain service changes needed.
 *
 * Rules:
 *   1. Implementations must NOT change TaktRequest.status directly.
 *      Status transitions belong to TaktRequestNotificationService.
 *   2. send() must be idempotent on messageId — retrying with the same messageId
 *      must not create a duplicate inbox row.
 *   3. getInbox() must always scope results to the provided recipientOrgId —
 *      never return messages addressed to other organisations.
 *   4. markAsRead() must verify recipientOrgId before setting status = READ.
 *   5. retry() must reuse the original messageId — it is not a new message.
 */
export interface MessageTransport {
  /**
   * Dispatch a message envelope to its recipient.
   *
   * The caller (typically the delivery service reading from the outbox) is
   * responsible for persisting the outbox row before calling send(). The
   * transport's job is only to route the message and return a technical result.
   *
   * Returns a TransportResult — does not throw on delivery failure so that
   * the caller can record the failure and schedule a retry.
   */
  send(envelope: MessageEnvelope): Promise<TransportResult>;

  /**
   * Return inbox messages for a specific recipient.
   *
   * Implementations MUST filter by recipientOrgId. Returning a global unfiltered
   * inbox is a security violation — each organisation can only see its own messages.
   */
  getInbox(
    recipientOrgId: string,
    options?: InboxQueryOptions,
  ): Promise<InboxMessage[]>;

  /**
   * Mark a message as read from the recipient's perspective.
   *
   * Only the addressed recipient (recipientOrgId) may call this. Throws
   * TransportDomainError with code RECIPIENT_FORBIDDEN if the caller is not
   * the intended recipient.
   *
   * Does NOT change TaktRequest.status — business acknowledgement is separate.
   */
  markAsRead(messageId: string, recipientOrgId: string): Promise<void>;

  /**
   * Retry a previously failed message.
   *
   * Only messages in FAILED status are retryable. Reuses the original messageId
   * for idempotency — this is not a new message with new business meaning.
   *
   * Throws TransportDomainError with code NOT_RETRYABLE if the message is in
   * DELIVERED, READ, or SENT status.
   */
  retry(messageId: string): Promise<TransportResult>;
}
