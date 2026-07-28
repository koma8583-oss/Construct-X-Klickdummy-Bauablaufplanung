import { createContext, useContext, useCallback, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { hubApi, type HubUser, type HubRole } from '@/lib/api';

interface AuthContextValue {
  user: HubUser | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (data: {
    name: string;
    email: string;
    password: string;
    role: HubRole;
    companyName?: string;
  }) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();

  const { data: user = null, isLoading } = useQuery({
    queryKey: ['hub-me'],
    queryFn: hubApi.auth.me,
    retry: false,
    staleTime: Infinity,
  });

  const login = useCallback(
    async (email: string, password: string) => {
      await hubApi.auth.login(email, password);
      await queryClient.invalidateQueries({ queryKey: ['hub-me'] });
    },
    [queryClient]
  );

  const register = useCallback(
    async (data: {
      name: string;
      email: string;
      password: string;
      role: HubRole;
      companyName?: string;
    }) => {
      await hubApi.auth.register(data);
      await queryClient.invalidateQueries({ queryKey: ['hub-me'] });
    },
    [queryClient]
  );

  const logout = useCallback(async () => {
    await hubApi.auth.logout();
    queryClient.clear();
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
