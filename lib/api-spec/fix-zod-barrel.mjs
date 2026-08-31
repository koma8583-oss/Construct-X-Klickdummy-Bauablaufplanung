import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

// Orval appends broad generated/types exports to this hand-maintained barrel.
// Several names intentionally exist in both generated API schemas and TS
// transport types, so broad exports make TypeScript reject every codegen run.
const content = `export * from "./generated/api";

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
`;

await writeFile(resolve(import.meta.dirname, "..", "api-zod", "src", "index.ts"), content);