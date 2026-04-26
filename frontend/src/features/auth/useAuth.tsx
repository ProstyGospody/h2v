import { createContext, PropsWithChildren, useContext, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { apiClient, ApiError } from '@/shared/api/client';
import { Admin } from '@/shared/api/types';

type AuthContextValue = {
  admin: Admin | null;
  ready: boolean;
  login: (input: { username: string; password: string }) => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: PropsWithChildren) {
  const [admin, setAdmin] = useState<Admin | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    apiClient
      .refresh()
      .then((session) => {
        if (session?.admin) {
          setAdmin(session.admin);
        }
      })
      .catch(() => null)
      .finally(() => setReady(true));
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      admin,
      ready,
      async login(input) {
        try {
          const data = await apiClient.request<{ access_token: string; admin: Admin }>('/auth/login', {
            method: 'POST',
            body: JSON.stringify(input),
          });
          apiClient.setAccessToken(data.access_token);
          setAdmin(data.admin);
        } catch (error) {
          const message = error instanceof ApiError ? error.message : 'Unable to sign in';
          toast.error(message);
          throw error;
        }
      },
      async logout() {
        await apiClient.request('/auth/logout', { method: 'POST' });
        apiClient.setAccessToken(null);
        setAdmin(null);
      },
    }),
    [admin, ready],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return value;
}
