/**
 * Hub API client — direct fetch wrapper for /api/hub/* endpoints.
 * No generated hooks: hub routes are separate from the main OpenAPI spec.
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
  | 'AG_REJECTED_ALTERNATIVE';

export interface HubUser {
  id: string;
  name: string;
  email: string;
  hubRole: HubRole;
  orgId: string | null;
  orgName: string | null;
  orgType: 'AG' | 'AN' | null;
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
    credentials: 'include',
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
  auth: {
    me: () => apiFetch<HubUser>('/auth/me'),
    login: (email: string, password: string) =>
      apiFetch<HubUser>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      }),
    register: (data: {
      name: string;
      email: string;
      password: string;
      role: HubRole;
      companyName?: string;
    }) =>
      apiFetch<HubUser>('/auth/register', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    logout: () =>
      apiFetch<{ ok: boolean }>('/auth/logout', { method: 'POST' }),
  },
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
  },
  admin: {
    users: () => apiFetch<HubAdminUser[]>('/admin/users'),
    orgs: () => apiFetch<HubOrg[]>('/admin/orgs'),
  },
};
