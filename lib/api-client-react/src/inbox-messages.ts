/**
 * React Query hooks for AN inbox-message endpoints.
 *
 * Returns TAKT_REQUEST_REMINDER and TAKT_REQUEST_EXPIRED messages
 * delivered to this AN organisation via the Datenraum transport layer.
 *
 * Used by the AN-App Datenraum page to show coordination reminders
 * alongside data-offer notifications.
 */
import { useQuery } from "@tanstack/react-query";
import type { UseQueryResult } from "@tanstack/react-query";
import { customFetch } from "./custom-fetch";

// ── Types ─────────────────────────────────────────────────────────────────────

export type InboxMessageType =
  | "TAKT_REQUEST_REMINDER"
  | "TAKT_REQUEST_EXPIRED";

/** Sub-type from the reminder payload (reminderType field). */
export type ReminderType =
  | "RESPONSE_DUE_SOON"
  | "RESPONSE_DUE_TODAY"
  | "RESPONSE_OVERDUE"
  | "GU_DECISION_DUE_SOON"
  | "GU_DECISION_OVERDUE";

export interface InboxReminderPayload {
  taktRequestId?: string;
  requestNumber?: string;
  reminderType?: ReminderType;
  dueAt?: string;
  taktReference?: {
    taktBezeichnung?: string;
    zone?: string;
    gewerk?: string;
  };
  deepLink?: string;
}

export interface InboxMessage {
  id: string;
  messageId: string;
  recipientOrgId: string;
  senderOrgId: string;
  messageType: InboxMessageType;
  correlationId: string;
  payload: InboxReminderPayload;
  status: string;
  receivedAt: string;
  readAt: string | null;
  createdAt: string;
}

// ── Query hooks ────────────────────────────────────────────────────────────────

export function useGetAnInboxMessages(): UseQueryResult<InboxMessage[], Error> {
  return useQuery({
    queryKey: ["an-inbox-messages"],
    queryFn: () =>
      customFetch<InboxMessage[]>("/api/an/inbox-messages", { method: "GET" }),
    refetchInterval: 60_000,
  });
}
