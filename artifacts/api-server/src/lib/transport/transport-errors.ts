/**
 * Domain error classes for the transport layer — Task 3.3.
 *
 * These errors are thrown by MessageTransport implementations and the services
 * that orchestrate them. They are NOT HTTP errors — route handlers must map
 * them to appropriate HTTP status codes.
 *
 * Error hierarchy:
 *   TransportDomainError        (base — always has a code)
 *     InvalidEnvelopeError      (400-level — caller sent a bad message)
 *     MessageNotFoundError      (404-level — messageId unknown)
 *     RecipientForbiddenError   (403-level — wrong org tried to act)
 *     NotRetryableError         (409-level — message is in a terminal state)
 *     IdempotencyConflictError  (409-level — same messageId, different envelope fields)
 *     TransportFailureError     (502-level — technical delivery failure)
 */

import type { TransportErrorCode } from "./message-transport";

// ── Base ──────────────────────────────────────────────────────────────────────

export class TransportDomainError extends Error {
  readonly code: TransportErrorCode;

  constructor(code: TransportErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "TransportDomainError";
    this.code = code;
  }
}

// ── Specific errors ───────────────────────────────────────────────────────────

/**
 * The MessageEnvelope failed schema validation before being dispatched.
 * The message was never written to the outbox.
 */
export class InvalidEnvelopeError extends TransportDomainError {
  constructor(message: string, cause?: unknown) {
    super("INVALID_ENVELOPE", message, { cause });
    this.name = "InvalidEnvelopeError";
  }
}

/**
 * A messageId was provided but does not exist in the outbox or inbox.
 */
export class MessageNotFoundError extends TransportDomainError {
  readonly messageId: string;

  constructor(messageId: string) {
    super("MESSAGE_NOT_FOUND", `Message not found: ${messageId}`);
    this.name = "MessageNotFoundError";
    this.messageId = messageId;
  }
}

/**
 * The caller tried to act on a message (e.g. markAsRead) as an organisation
 * that is not the addressed recipient.
 */
export class RecipientForbiddenError extends TransportDomainError {
  readonly messageId: string;
  readonly callerOrgId: string;

  constructor(messageId: string, callerOrgId: string) {
    super(
      "RECIPIENT_FORBIDDEN",
      `Organisation ${callerOrgId} is not the recipient of message ${messageId}`,
    );
    this.name = "RecipientForbiddenError";
    this.messageId = messageId;
    this.callerOrgId = callerOrgId;
  }
}

/**
 * retry() was called on a message that is not in FAILED status.
 * Only technically failed messages may be retried.
 */
export class NotRetryableError extends TransportDomainError {
  readonly messageId: string;
  readonly currentStatus: string;

  constructor(messageId: string, currentStatus: string) {
    super(
      "NOT_RETRYABLE",
      `Message ${messageId} cannot be retried — current status is ${currentStatus}`,
    );
    this.name = "NotRetryableError";
    this.messageId = messageId;
    this.currentStatus = currentStatus;
  }
}

/**
 * A previous message with the same `messageId` already exists in the outbox,
 * but one or more envelope fields (schemaVersion, messageType, senderOrgId,
 * recipientOrgId, correlationId, causationId, or payload) differ from the
 * original.
 *
 * This indicates a misuse of the idempotency key — the caller is trying to
 * reuse a messageId for a semantically different message.
 * Callers should surface this as HTTP 409 Conflict.
 */
export class IdempotencyConflictError extends TransportDomainError {
  readonly messageId: string;
  readonly conflictingFields: string[];

  constructor(messageId: string, conflictingFields: string[]) {
    super(
      "IDEMPOTENCY_CONFLICT",
      `Idempotency conflict: messageId "${messageId}" already exists with different ` +
      `content in fields: ${conflictingFields.join(", ")}.`,
    );
    this.name = "IdempotencyConflictError";
    this.messageId = messageId;
    this.conflictingFields = conflictingFields;
  }
}

/**
 * A technical failure occurred during the send or delivery attempt.
 * The message may or may not have reached the recipient.
 * Callers should record this as a FAILED attempt and may schedule a retry.
 */
export class TransportFailureError extends TransportDomainError {
  constructor(message: string, cause?: unknown) {
    super("TRANSPORT_FAILURE", message, { cause });
    this.name = "TransportFailureError";
  }
}
