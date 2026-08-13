import React, { createContext, useContext, useEffect, useState } from 'react';
import { setToken } from '@/lib/auth-token';

export type UserRole =
  | 'AG_ADMIN'
  | 'GENERAL_PLANNER'
  | 'AN_ADMIN'
  | 'AN_DISPATCHER'
  | 'HUB_ADMIN';

export type User = {
  id: string;
  name: string;
  email: string;
  orgId: string | null;
  orgName: string | null;
  orgType: 'AG' | 'AN' | null;
  preferredLanguage: string;
  hubAdmin: boolean;
  /** Fine-grained role assignments. Empty = legacy / unassigned. */
  roles: UserRole[];
};

type AuthContextType = {
  user: User | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (data: { name: string; email: string; password: string; companyName: string }) => Promise<void>;
  logout: () => Promise<void>;
  /** Returns true if the current user has at least one of the given roles. */
  hasRole: (...roles: UserRole[]) => boolean;
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

async function authFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { credentials: 'include', ...init });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw Object.assign(
      new Error((err as { error?: string }).error ?? res.statusText),
      { status: res.status },
    );
  }
  return res.json() as Promise<T>;
}

function normaliseUser(raw: User): User {
  return { ...raw, roles: raw.roles ?? [] };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    initAuth();
  }, []);

  async function initAuth() {
    try {
      const { accessToken, user: userData } = await authFetch<{
        accessToken: string;
        user: User;
      }>('/auth-service/refresh', { method: 'POST' });

      // AG-App only accepts AG accounts — clear any cross-app session silently
      if (userData.orgType !== 'AG') {
        await authFetch('/auth-service/logout', { method: 'POST' }).catch(() => {});
        setToken(null);
        const url = new URL(window.location.href);
        url.searchParams.set('wrong_role', '1');
        url.searchParams.delete('session_expired');
        window.history.replaceState({}, '', url.toString());
        setUser(null);
        return;
      }

      setToken(accessToken);
      setUser(normaliseUser(userData));
    } catch {
      setUser(null);
    } finally {
      setIsLoading(false);
    }
  }

  const login = async (email: string, password: string) => {
    const { accessToken, user: userData } = await authFetch<{
      accessToken: string;
      user: User;
    }>('/auth-service/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });

    // Reject non-AG accounts with a clear error
    if (userData.orgType !== 'AG') {
      await authFetch('/auth-service/logout', { method: 'POST' }).catch(() => {});
      throw new Error(
        'Dieses Konto ist ein Nachunternehmer-Konto. Bitte melden Sie sich in der Nachunternehmer-App an.',
      );
    }

    setToken(accessToken);
    setUser(normaliseUser(userData));
  };

  const register = async (data: {
    name: string;
    email: string;
    password: string;
    companyName: string;
  }) => {
    const { accessToken, user: userData } = await authFetch<{
      accessToken: string;
      user: User;
    }>('/auth-service/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...data, orgType: 'AG' }),
    });
    setToken(accessToken);
    setUser(normaliseUser(userData));
  };

  const logout = async () => {
    try {
      await authFetch('/auth-service/logout', { method: 'POST' });
    } finally {
      setToken(null);
      setUser(null);
    }
  };

  const hasRole = (...roles: UserRole[]): boolean => {
    if (!user || user.roles.length === 0) return false;
    return roles.some((r) => user.roles.includes(r));
  };

  return (
    <AuthContext.Provider value={{ user, isLoading, login, register, logout, hasRole }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
