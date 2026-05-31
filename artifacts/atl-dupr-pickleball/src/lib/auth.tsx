import { createContext, useContext, useState, useEffect } from "react";
import { useGetMe } from "@workspace/api-client-react";
import { getGetMeQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";

interface User {
  id: number;
  name: string;
  username: string;
  role: string;
  createdAt: string;
}

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  isAdmin: boolean;
  canAccessAdmin: boolean;
  authToken: string | null;
  setAuthToken: (token: string | null) => void;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  isLoading: true,
  isAuthenticated: false,
  isAdmin: false,
  canAccessAdmin: false,
  authToken: null,
  setAuthToken: () => {},
});

const ADMIN_ROLES = new Set(["admin", "event_organizer", "event_captain", "court_leader"]);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [authToken, setAuthTokenState] = useState<string | null>(() => {
    return localStorage.getItem("authToken");
  });
  const queryClient = useQueryClient();

  const { data: user, isLoading } = useGetMe({
    query: {
      retry: false,
      queryKey: getGetMeQueryKey(),
      staleTime: 5 * 60 * 1000,
      refetchOnWindowFocus: false,
    },
  });

  const setAuthToken = (token: string | null) => {
    if (token) {
      localStorage.setItem("authToken", token);
    } else {
      localStorage.removeItem("authToken");
    }
    setAuthTokenState(token);
    if (!token) {
      queryClient.removeQueries({ queryKey: getGetMeQueryKey() });
    }
  };

  const validUser = user ?? null;
  const role = validUser?.role ?? null;

  return (
    <AuthContext.Provider
      value={{
        user: validUser,
        isLoading,
        isAuthenticated: !!validUser,
        isAdmin: role === "admin",
        canAccessAdmin: role !== null && ADMIN_ROLES.has(role),
        authToken,
        setAuthToken,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
