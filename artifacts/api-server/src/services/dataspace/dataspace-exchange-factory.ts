import type { DataspaceExchange } from "./dataspace-exchange";
import { RestDataspaceExchange } from "./rest-dataspace-exchange";
import { TractusXEdcExchange } from "./tractusx-edc-exchange";

export function createDataspaceExchange(): DataspaceExchange {
  return process.env.DATASPACE_TRANSPORT === "tractusx-edc"
    ? new TractusXEdcExchange()
    : new RestDataspaceExchange();
}