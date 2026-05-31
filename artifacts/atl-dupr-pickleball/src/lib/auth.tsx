import React, { createContext, useContext } from 'react';
import { useGetMe, getGetMeQueryKey } from '@workspace/api-client-react';
import type { User } from '@workspace/api-client-react';

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  isAdmin: boolean;
  canAccessAdmin: boolean;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  isLoading: true,
  isAuthenticated: false,
  isAdmin: false,
  canAccessAdmin: false,
});

const ADMIN_ROLES = new Set(["admin", "event_organizer", "event_captain", "court_leader"]);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { data: user, isLoading, error } = useGetMe({
    query: {
      retry: false,
      queryKey: getGetMeQueryKey(),
    }
  });

  const validUser = error ? null : (user ?? null);
  const role = validUser?.role ?? null;

  return (
    <AuthContext.Provider
      value={{
        user: validUser,
        isLoading,
        isAuthenticated: !!validUser,
        isAdmin: role === 'admin',
        canAccessAdmin: role !== null && ADMIN_ROLES.has(role),
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
