import { db, organizationsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import type { DataspaceParticipant } from "./external-contracts";

/**
 * Deliberately local-only for the REST PoC. A later connector integration may
 * enrich this at the transport boundary without changing domain services.
 */
export async function resolveDataspaceParticipant(localOrgId: string): Promise<DataspaceParticipant | null> {
  const [org] = await db.select().from(organizationsTable)
    .where(eq(organizationsTable.id, localOrgId)).limit(1);
  if (!org) return null;
  return {
    localOrgId: org.id,
    participantId: `local:${org.id}`,
    organizationName: org.name,
    organizationType: org.type,
    identityStatus: "VERIFIED",
    connectorStatus: "UNKNOWN",
  };
}

export async function listDataspaceParticipants(
  organizationType?: "AG" | "AN",
): Promise<DataspaceParticipant[]> {
  const organizations = await db.select().from(organizationsTable);
  return organizations
    .filter((org) => !organizationType || org.type === organizationType)
    .map((org) => ({
      localOrgId: org.id,
      participantId: `local:${org.id}`,
      organizationName: org.name,
      organizationType: org.type,
      identityStatus: "VERIFIED" as const,
      connectorStatus: "UNKNOWN" as const,
    }));
}