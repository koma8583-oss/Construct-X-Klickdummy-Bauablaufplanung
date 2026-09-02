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
export const TAKTKOORD_NOTIFICATION_CONTEXTS = {
  TAKT_REQUEST_NOTIFICATION: "TaktKoord-ServiceCoordination-TaktRequest:1.0.0",
  TAKT_REQUEST_REVISED: "TaktKoord-ServiceCoordination-TaktRequestRevision:1.0.0",
  TAKT_REQUEST_CANCELLED: "TaktKoord-ServiceCoordination-TaktRequestCancellation:1.0.0",
  TAKT_DETAILS_RETRIEVED: "TaktKoord-ServiceCoordination-TaktDetailsRetrieved:1.0.0",
  TAKT_RESPONSE_SUBMITTED: "TaktKoord-ServiceCoordination-TaktResponse:1.0.0",
  TAKT_RESPONSE_ACCEPTED: "TaktKoord-ServiceCoordination-TaktDecision:1.0.0",
  TAKT_RESPONSE_REVISION_REQUESTED: "TaktKoord-ServiceCoordination-TaktRevisionRequest:1.0.0",
  TAKT_REQUEST_EXPIRED: "TaktKoord-ServiceCoordination-TaktRequestExpired:1.0.0",
  TAKT_REQUEST_REMINDER: "TaktKoord-ServiceCoordination-TaktRequestReminder:1.0.0",
  DATA_OFFER_PUBLISHED: "TaktKoord-DataPublication-DataOffer:1.0.0",
  DATA_OFFER_RESPONSE: "TaktKoord-DataPublication-DataOfferResponse:1.0.0",
  PROJECT_INVITATION: "TaktKoord-ProjectMembership-Invitation:1.0.0",
  PROJECT_INVITATION_RESPONSE: "TaktKoord-ProjectMembership-InvitationResponse:1.0.0",
} as const;

export type TaktKoordNotificationType = keyof typeof TAKTKOORD_NOTIFICATION_CONTEXTS;

export function createNotificationEnvelope(input: {
  messageId: NotificationHeader["messageId"];
  messageType: TaktKoordNotificationType;
  senderBpn: string;
  receiverBpn: string;
  content: Record<string, unknown>;
  sentDateTime?: string;
  expectedResponseBy?: string;
  relatedMessageId?: NotificationHeader["relatedMessageId"];
}): NotificationEnvelope {
  return NotificationEnvelopeSchema.parse({
    header: {
      messageId: input.messageId,
      context: TAKTKOORD_NOTIFICATION_CONTEXTS[input.messageType],
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