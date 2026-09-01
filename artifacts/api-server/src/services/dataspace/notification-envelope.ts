import {
  CATENA_X_MESSAGE_HEADER_VERSION,
  createNotificationEnvelope,
  NotificationEnvelopeSchema,
  TAKTKOORD_NOTIFICATION_CONTEXTS,
  type MessageEnvelope,
  type NotificationEnvelope,
  type TaktKoordNotificationType,
} from "@workspace/api-zod";

/**
 * Maps the existing internal business event names to the stable notification
 * context names. The map is intentionally explicit: adding a new event must
 * result in a reviewed, versioned context rather than an accidental fallback.
 */
const MESSAGE_TYPE_TO_NOTIFICATION_TYPE: Partial<Record<string, TaktKoordNotificationType>> = {
  TAKT_REQUEST_NOTIFICATION: "TAKT_REQUEST_NOTIFICATION",
  TAKT_REQUEST_REVISED: "TAKT_REQUEST_REVISED",
  TAKT_REQUEST_CANCELLED: "TAKT_REQUEST_CANCELLED",
  TAKT_DETAILS_RETRIEVED: "TAKT_DETAILS_RETRIEVED",
  TAKT_RESPONSE_SUBMITTED: "TAKT_RESPONSE_SUBMITTED",
  TAKT_RESPONSE_ACCEPTED: "TAKT_RESPONSE_ACCEPTED",
  TAKT_RESPONSE_REVISION_REQUESTED: "TAKT_RESPONSE_REVISION_REQUESTED",
  TAKT_REQUEST_EXPIRED: "TAKT_REQUEST_EXPIRED",
  TAKT_REQUEST_REMINDER: "TAKT_REQUEST_REMINDER",
  DATA_OFFER_PUBLISHED: "DATA_OFFER_PUBLISHED",
  PROJECT_INVITATION: "PROJECT_INVITATION",
  PROJECT_INVITATION_RESPONSE: "PROJECT_INVITATION_RESPONSE",
};

export function notificationTypeForMessageType(messageType: string): TaktKoordNotificationType {
  const notificationType = MESSAGE_TYPE_TO_NOTIFICATION_TYPE[messageType];
  if (!notificationType) {
    throw new Error(`No versioned notification context registered for message type: ${messageType}`);
  }
  return notificationType;
}

/**
 * Builds the standards-compliant external body at the connector boundary.
 * BPNs are explicit inputs, never derived from local organisation IDs.
 */
export function toNotificationEnvelope(input: {
  message: MessageEnvelope;
  senderBpn: string;
  receiverBpn: string;
  expectedResponseBy?: string;
  relatedMessageId?: string;
}): NotificationEnvelope {
  const messageType = notificationTypeForMessageType(input.message.messageType);
  return createNotificationEnvelope({
    messageId: input.message.messageId,
    messageType,
    senderBpn: input.senderBpn,
    receiverBpn: input.receiverBpn,
    sentDateTime: input.message.createdAt.toISOString(),
    expectedResponseBy: input.expectedResponseBy,
    relatedMessageId: input.relatedMessageId ?? input.message.causationId ?? undefined,
    content: input.message.payload,
  });
}

export function parseNotificationEnvelope(value: unknown): NotificationEnvelope {
  return NotificationEnvelopeSchema.parse(value);
}

export { CATENA_X_MESSAGE_HEADER_VERSION, TAKTKOORD_NOTIFICATION_CONTEXTS };