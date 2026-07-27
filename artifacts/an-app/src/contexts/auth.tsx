import { useState, useEffect, createContext, useContext, ReactNode } from 'react';
import type { UserProfile } from '@workspace/api-client-react';

type AuthUser = UserProfile & { orgId: string; orgName: string; orgType: string };

interface AuthContextType {
  user: AuthUser | null;
  isLoading: boolean;
  login: (data: { email: string; password: string }) => Promise<void>;
  register: (data: { name: string; email: string; password: string; companyName: string }) => Promise<void>;
  logout: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined);

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: 'include',
    ...init,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw Object.assign(new Error(err.error ?? res.statusText), { status: res.status });
  }
  return res.json() as Promise<T>;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const fetchMe = async () => {
    try {
      // /api/an-auth/me only succeeds for AN-type accounts
      const data = await apiFetch<AuthUser>('/api/an-auth/me');
      setUser(data);
    } catch {
      setUser(null);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchMe();
  }, []);

  const login = async (data: { email: string; password: string }) => {
    await apiFetch('/api/an-auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    await fetchMe();
  };

  const register = async (data: { name: string; email: string; password: string; companyName: string }) => {
    await apiFetch('/api/an-auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    await fetchMe();
  };

  const logout = async () => {
    await apiFetch('/api/an-auth/logout', { method: 'POST' });
    setUser(null);
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
