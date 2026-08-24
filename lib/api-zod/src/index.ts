export * from "./generated/api";

// These transport contracts are intentionally re-exported from the generated
// type modules. They remain Takt-named on the wire until a versioned external
// dataspace contract is introduced.
export { DataspaceMessageType } from "./generated/types/dataspaceMessageType";
export type { DataspaceMessageStatus } from "./generated/types/dataspaceMessageStatus";
export type { MessageEnvelope } from "./generated/types/messageEnvelope";
export * from './generated/api';
export * from './generated/types';
