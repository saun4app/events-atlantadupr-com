import React, { createContext, useContext } from 'react';
import { useGetMe, getGetMeQueryKey } from '@workspace/api-client-react';
import type { User } from '@workspace/api-client-react';

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  isAdmin: boolean;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  isLoading: true,
  isAuthenticated: false,
  isAdmin: false,
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { data: user, isLoading, error } = useGetMe({
    query: {
      retry: false,
      queryKey: getGetMeQueryKey(),
    }
  });

  const validUser = error ? null : (user ?? null);
  
  return (
    <AuthContext.Provider
      value={{
        user: validUser,
        isLoading,
        isAuthenticated: !!validUser,
        isAdmin: validUser?.role === 'admin' || validUser?.role === 'event_organizer' || validUser?.role === 'event_captain' || validUser?.role === 'court_leader',
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
