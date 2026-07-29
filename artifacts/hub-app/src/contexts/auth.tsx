import { createContext, useContext, useCallback, useState, useEffect, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { setToken } from '@/lib/auth-token';

export type HubRole = 'ADMIN' | 'AG' | 'AN';

export interface HubUser {
  id: string;
  name: string;
  email: string;
  preferredLanguage: string;
  orgId: string | null;
  orgName: string | null;
  orgType: 'AG' | 'AN' | null;
  hubAdmin: boolean;
  /** Derived convenience field for Hub UI role display */
  hubRole: HubRole;
}

interface AuthContextValue {
  user: HubUser | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (data: {
    name: string;
    email: string;
    password: string;
    role: 'AG' | 'AN';
    companyName?: string;
  }) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

async function authFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { credentials: 'include', ...init });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

type RawProfile = {
  id: string;
  name: string;
  email: string;
  preferredLanguage: string;
  orgId: string | null;
  orgName: string | null;
  orgType: 'AG' | 'AN' | null;
  hubAdmin: boolean;
};

function toHubUser(raw: RawProfile): HubUser {
  const hubRole: HubRole = raw.hubAdmin ? 'ADMIN' : (raw.orgType ?? 'AG') as HubRole;
  return { ...raw, hubRole };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<HubUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const queryClient = useQueryClient();

  useEffect(() => {
    initAuth();
  }, []);

  async function initAuth() {
    try {
      const { accessToken, user: raw } = await authFetch<{
        accessToken: string;
        user: RawProfile;
      }>('/auth-service/refresh', { method: 'POST' });
      setToken(accessToken);
      setUser(toHubUser(raw));
    } catch {
      setUser(null);
    } finally {
      setIsLoading(false);
    }
  }

  const login = useCallback(async (email: string, password: string) => {
    const { accessToken, user: raw } = await authFetch<{
      accessToken: string;
      user: RawProfile;
    }>('/auth-service/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    setToken(accessToken);
    setUser(toHubUser(raw));
  }, []);

  const register = useCallback(
    async (data: {
      name: string;
      email: string;
      password: string;
      role: 'AG' | 'AN';
      companyName?: string;
    }) => {
      const { accessToken, user: raw } = await authFetch<{
        accessToken: string;
        user: RawProfile;
      }>('/auth-service/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: data.name,
          email: data.email,
          password: data.password,
          orgType: data.role,
          companyName: data.companyName ?? '',
        }),
      });
      setToken(accessToken);
      setUser(toHubUser(raw));
    },
    [],
  );

  const logout = useCallback(async () => {
    try {
      await authFetch('/auth-service/logout', { method: 'POST' });
    } finally {
      setToken(null);
      queryClient.clear();
      setUser(null);
    }
  }, [queryClient]);

  return (
    <AuthContext.Provider value={{ user, isLoading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
