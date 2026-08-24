export * from "./generated/api";

// Dataspace transport contracts remain Takt-named on the wire until a
// versioned external dataspace contract is introduced.
export { DataspaceMessageType } from "./generated/types/dataspaceMessageType";
export type { DataspaceMessageStatus } from "./generated/types/dataspaceMessageStatus";
export type { MessageEnvelope } from "./generated/types/messageEnvelope";
