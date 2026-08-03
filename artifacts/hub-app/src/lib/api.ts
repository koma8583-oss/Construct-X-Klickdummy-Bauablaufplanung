/**
 * Hub API client — direct fetch wrapper for /api/hub/* endpoints.
 * No generated hooks: hub routes are separate from the main OpenAPI spec.
 *
 * Auth is handled via the global fetch interceptor in main.tsx — the Bearer
 * token is injected automatically. This client no longer manages credentials.
 */

const BASE = '/api/hub';

export type HubRole = 'ADMIN' | 'AG' | 'AN';

export type HubMessageType =
  | 'DELEGATION_CREATED'
  | 'DELEGATION_CONFIRMED'
  | 'DELEGATION_REJECTED'
  | 'DELEGATION_ALTERNATIVE'
  | 'DELEGATION_CANCELLED'
  | 'AG_ACCEPTED_ALTERNATIVE'
  | 'AG_REJECTED_ALTERNATIVE'
  | 'TAKT_REQUEST_EXPIRED'
  | 'TAKT_REQUEST_REMINDER';

export interface HubUser {
  id: string;
  name: string;
  email: string;
  preferredLanguage: string;
  hubRole: HubRole;
  orgId: string | null;
  orgName: string | null;
  orgType: 'AG' | 'AN' | null;
  hubAdmin: boolean;
}

export interface HubOrg {
  id: string;
  name: string;
  type: 'AG' | 'AN';
}

export interface HubMessage {
  id: string;
  type: HubMessageType;
  senderOrgId: string;
  recipientOrgId: string;
  delegationId: string | null;
  /** correlationId links messages to their TaktRequest (taktRequestId) */
  correlationId: string | null;
  payload: Record<string, unknown> | null;
  createdAt: string;
  senderOrg?: HubOrg;
  recipientOrg?: HubOrg;
}

export interface HubTimeline {
  delegation: {
    id: string;
    taktId: string;
    projectId: string;
    agOrgId: string;
    anOrgId: string;
    requestedStart: string;
    requestedEnd: string;
    status: string;
    message?: string | null;
    createdAt: string;
    takt?: { taktBezeichnung: string; gewerk: string; zone: string } | null;
    project?: { id: string; name: string } | null;
  };
  timeline: HubMessage[];
}

export interface HubAdminUser {
  id: string;
  name: string;
  email: string;
  hubRole: HubRole;
  orgId: string | null;
  orgName: string | null;
  orgType: 'AG' | 'AN' | null;
  createdAt: string;
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const hubApi = {
  messages: {
    list: (params?: {
      type?: HubMessageType;
      delegationId?: string;
      limit?: number;
    }) => {
      const q = new URLSearchParams();
      if (params?.type) q.set('type', params.type);
      if (params?.delegationId) q.set('delegationId', params.delegationId);
      if (params?.limit) q.set('limit', String(params.limit));
      const qs = q.toString();
      return apiFetch<HubMessage[]>(`/messages${qs ? `?${qs}` : ''}`);
    },
    timeline: (delegationId: string) =>
      apiFetch<HubTimeline>(`/messages/timeline/${delegationId}`),
    delete: (messageId: string) =>
      apiFetch<void>(`/messages/${messageId}`, { method: 'DELETE' }),
  },
  admin: {
    users: () => apiFetch<HubAdminUser[]>('/admin/users'),
    orgs: () => apiFetch<HubOrg[]>('/admin/orgs'),
  },
};
