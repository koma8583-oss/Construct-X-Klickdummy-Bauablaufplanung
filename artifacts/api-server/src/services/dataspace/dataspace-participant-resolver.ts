import type { DataspaceParticipant } from "./external-contracts";

/**
 * Deliberately local-only for the REST PoC. A later connector integration may
 * enrich this at the transport boundary without changing domain services.
 */
export function resolveDataspaceParticipant(localOrgId: string): DataspaceParticipant {
  return { localOrgId };
}