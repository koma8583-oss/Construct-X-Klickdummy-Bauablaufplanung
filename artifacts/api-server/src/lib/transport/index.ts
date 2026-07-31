/**
 * Transport layer public API — re-export everything needed by consumers.
 */
export type {
  MessageTransport,
  MessageEnvelope,
  TransportResult,
  InboxMessage,
  InboxQueryOptions,
  TransportError,
  TransportErrorCode,
} from "./message-transport";

export {
  TransportDomainError,
  InvalidEnvelopeError,
  MessageNotFoundError,
  RecipientForbiddenError,
  NotRetryableError,
  TransportFailureError,
} from "./transport-errors";
