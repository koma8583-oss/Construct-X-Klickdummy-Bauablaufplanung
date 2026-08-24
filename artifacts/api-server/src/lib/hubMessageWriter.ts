/**
 * Non-fatal broker helper — writes a hub_message entry after each delegation event.
 * Failures are logged but never propagate to the caller.
 */
import { hubDb, hubMessagesTable } from "@workspace/db";

export type HubMessageType =
  | "DELEGATION_CREATED"
  | "DELEGATION_CONFIRMED"
  | "DELEGATION_REJECTED"
  | "DELEGATION_ALTERNATIVE"
  | "DELEGATION_CANCELLED"
  | "AG_ACCEPTED_ALTERNATIVE"
  | "AG_REJECTED_ALTERNATIVE";

export async function writeHubMessage(
  type: HubMessageType,
  senderOrgId: string,
  recipientOrgId: string,
  delegationId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  try {
    await hubDb.insert(hubMessagesTable).values({
      type,
      senderOrgId,
      recipientOrgId,
      delegationId,
      payload,
    });
  } catch (err) {
    console.error("[hub] Failed to write hub message:", err);
  }
}
