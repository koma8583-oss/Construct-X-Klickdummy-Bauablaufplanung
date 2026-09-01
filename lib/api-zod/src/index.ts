export * from "./generated/api";

// Dataspace transport contracts remain Takt-named on the wire until a
// versioned external dataspace contract is introduced.
export { DataspaceMessageType } from "./generated/types/dataspaceMessageType";
export type { DataspaceMessageStatus } from "./generated/types/dataspaceMessageStatus";
export type { MessageEnvelope } from "./generated/types/messageEnvelope";

// This hand-maintained transport contract is intentionally outside Orval's
// generated OpenAPI surface and must survive every codegen run.
export {
  TaktRequestSnapshotPayloadSchema,
  TAKT_REQUEST_SNAPSHOT_PUBLIC_FIELDS,
} from "./taktRequestSnapshotPayload";
export type { TaktRequestSnapshotPayload } from "./taktRequestSnapshotPayload";

export {
  CATENA_X_MESSAGE_HEADER_VERSION,
  NotificationEnvelopeSchema,
  NotificationHeaderSchema,
  TAKTKOORD_NOTIFICATION_CONTEXTS,
  createNotificationEnvelope,
} from "./notification-envelope";
export type {
  NotificationEnvelope,
  NotificationHeader,
  TaktKoordNotificationType,
} from "./notification-envelope";
