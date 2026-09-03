import { z } from "zod";

/**
 * Catena-X Industry Core notification header.
 *
 * This is deliberately separate from the internal MessageEnvelope used by the
 * local outbox. The internal transport can therefore remain backwards
 * compatible while connector adapters exchange the standard { header, content }
 * shape later.
 */
const uuidOrUrn = z.string().regex(
  /^(?:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}|urn:uuid:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$/,
  "messageId must be a UUID v4 or urn:uuid UUID",
);

const bpnL = z.string().regex(/^BPNL[a-zA-Z0-9]{12}$/, "BPNL must match BPNL + 12 alphanumeric characters");
const timestamp = z.string().datetime({ offset: true });
const semanticVersion = z.string().regex(
  /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/,
  "version must be a semantic version",
);

export const NotificationHeaderSchema = z.object({
  messageId: uuidOrUrn,
  context: z.string().trim().min(1).max(500),
  sentDateTime: timestamp,
  senderBpn: bpnL,
  receiverBpn: bpnL,
  expectedResponseBy: timestamp.optional(),
  relatedMessageId: uuidOrUrn.optional(),
  version: semanticVersion,
}).strict();

export const NotificationEnvelopeSchema = z.object({
  header: NotificationHeaderSchema,
  content: z.record(z.string(), z.unknown()),
}).strict();

export type NotificationHeader = z.infer<typeof NotificationHeaderSchema>;
export type NotificationEnvelope = z.infer<typeof NotificationEnvelopeSchema>;

/**
 * The stable header version is the MessageHeaderAspect version, not the
 * version of an individual business payload.
 */
export const CATENA_X_MESSAGE_HEADER_VERSION = "3.0.0";
/**
 * The registry is the single source of truth for the Notification API
 * operation, its public context, and the use-case major version. The header
 * version above is the Catena-X MessageHeaderAspect version and is deliberately
 * independent from the version of a business operation.
 */
export const TAKTKOORD_NOTIFICATION_OPERATIONS = {
  TAKT_REQUEST_NOTIFICATION: {
    api: "Notification API",
    operation: "service-request",
    majorVersion: 1,
    context: "urn:taktkoord:notification-api:construction-service-coordination:service-request:v1",
  },
  TAKT_REQUEST_REVISED: {
    api: "Notification API",
    operation: "service-request-revision",
    majorVersion: 1,
    context: "urn:taktkoord:notification-api:construction-service-coordination:service-request-revision:v1",
  },
  TAKT_REQUEST_CANCELLED: {
    api: "Notification API",
    operation: "service-request-cancellation",
    majorVersion: 1,
    context: "urn:taktkoord:notification-api:construction-service-coordination:service-request-cancellation:v1",
  },
  TAKT_DETAILS_RETRIEVED: {
    api: "Notification API",
    operation: "service-request-details-retrieved",
    majorVersion: 1,
    context: "urn:taktkoord:notification-api:construction-service-coordination:service-request-details-retrieved:v1",
  },
  TAKT_RESPONSE_SUBMITTED: {
    api: "Notification API",
    operation: "service-response",
    majorVersion: 1,
    context: "urn:taktkoord:notification-api:construction-service-coordination:service-response:v1",
  },
  TAKT_RESPONSE_ACCEPTED: {
    api: "Notification API",
    operation: "service-response-accepted",
    majorVersion: 1,
    context: "urn:taktkoord:notification-api:construction-service-coordination:service-response-accepted:v1",
  },
  TAKT_RESPONSE_REVISION_REQUESTED: {
    api: "Notification API",
    operation: "service-response-revision-requested",
    majorVersion: 1,
    context: "urn:taktkoord:notification-api:construction-service-coordination:service-response-revision-requested:v1",
  },
  TAKT_REQUEST_EXPIRED: {
    api: "Notification API",
    operation: "service-request-expired",
    majorVersion: 1,
    context: "urn:taktkoord:notification-api:construction-service-coordination:service-request-expired:v1",
  },
  TAKT_REQUEST_REMINDER: {
    api: "Notification API",
    operation: "service-request-reminder",
    majorVersion: 1,
    context: "urn:taktkoord:notification-api:construction-service-coordination:service-request-reminder:v1",
  },
  DATA_OFFER_PUBLISHED: {
    api: "Notification API",
    operation: "data-offer-published",
    majorVersion: 1,
    context: "urn:taktkoord:notification-api:data-publication:data-offer-published:v1",
  },
  DATA_OFFER_RESPONSE: {
    api: "Notification API",
    operation: "data-offer-response",
    majorVersion: 1,
    context: "urn:taktkoord:notification-api:data-publication:data-offer-response:v1",
  },
  PROJECT_INVITATION: {
    api: "Notification API",
    operation: "project-invitation",
    majorVersion: 1,
    context: "urn:taktkoord:notification-api:project-membership:project-invitation:v1",
  },
  PROJECT_INVITATION_RESPONSE: {
    api: "Notification API",
    operation: "project-invitation-response",
    majorVersion: 1,
    context: "urn:taktkoord:notification-api:project-membership:project-invitation-response:v1",
  },
} as const;

export const TAKTKOORD_NOTIFICATION_CONTEXTS = Object.fromEntries(
  Object.entries(TAKTKOORD_NOTIFICATION_OPERATIONS).map(([type, definition]) => [
    type,
    definition.context,
  ]),
) as { [K in keyof typeof TAKTKOORD_NOTIFICATION_OPERATIONS]: string };

export type TaktKoordNotificationType = keyof typeof TAKTKOORD_NOTIFICATION_OPERATIONS;
export type NotificationOperation = typeof TAKTKOORD_NOTIFICATION_OPERATIONS[TaktKoordNotificationType];

export function notificationOperationForContext(context: string): TaktKoordNotificationType | null {
  const entry = Object.entries(TAKTKOORD_NOTIFICATION_OPERATIONS)
    .find(([, definition]) => definition.context === context);
  return (entry?.[0] as TaktKoordNotificationType | undefined) ?? null;
}

export function createNotificationEnvelope(input: {
  messageId: NotificationHeader["messageId"];
  messageType: TaktKoordNotificationType;
  senderBpn: string;
  receiverBpn: string;
  content: Record<string, unknown>;
  sentDateTime?: string;
  expectedResponseBy?: string;
  relatedMessageId?: NotificationHeader["relatedMessageId"];
  context?: string;
}): NotificationEnvelope {
  return NotificationEnvelopeSchema.parse({
    header: {
      messageId: input.messageId,
      context: input.context ?? TAKTKOORD_NOTIFICATION_CONTEXTS[input.messageType],
      sentDateTime: input.sentDateTime ?? new Date().toISOString(),
      senderBpn: input.senderBpn,
      receiverBpn: input.receiverBpn,
      ...(input.expectedResponseBy ? { expectedResponseBy: input.expectedResponseBy } : {}),
      ...(input.relatedMessageId ? { relatedMessageId: input.relatedMessageId } : {}),
      version: CATENA_X_MESSAGE_HEADER_VERSION,
    },
    content: input.content,
  });
}