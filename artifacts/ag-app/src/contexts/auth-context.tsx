import React, { createContext, useContext, useEffect, useState } from 'react';
import { setToken } from '@/lib/auth-token';

export type User = {
  id: string;
  name: string;
  email: string;
  orgId: string | null;
  orgName: string | null;
  orgType: 'AG' | 'AN' | null;
  preferredLanguage: string;
  hubAdmin: boolean;
};

type AuthContextType = {
  user: User | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (data: { name: string; email: string; password: string; companyName: string }) => Promise<void>;
  logout: () => Promise<void>;
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
      setToken(accessToken);
      setUser(userData);
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
    setToken(accessToken);
    setUser(userData);
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
    setUser(userData);
  };

  const logout = async () => {
    try {
      await authFetch('/auth-service/logout', { method: 'POST' });
    } finally {
      setToken(null);
      setUser(null);
    }
  };

  return (
    <AuthContext.Provider value={{ user, isLoading, login, register, logout }}>
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
