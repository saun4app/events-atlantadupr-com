import { createContext, useContext, useState, useEffect } from "react";
import { useGetMe } from "@workspace/api-client-react";
import { getGetMeQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { USER_ROLE_IDS, VIRTUAL_USER_ROLE_IDS, hasUserRole } from "./user-roles";

interface User {
  id: number;
  name: string;
  username: string;
  role: string;
  createdAt: string;
  eventAssignments?: Array<{ eventId: number; eventType: string; eventRole: string }>;
}

interface AuthContextType {
  user: User | null;
  role: string;
  isLoading: boolean;
  isAuthenticated: boolean;
  isAdmin: boolean;
  canAccessAdmin: boolean;
  authToken: string | null;
  setAuthToken: (token: string | null) => void;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  role: VIRTUAL_USER_ROLE_IDS.site_visitor,
  isLoading: true,
  isAuthenticated: false,
  isAdmin: false,
  canAccessAdmin: false,
  authToken: null,
  setAuthToken: () => {},
});

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
  const role = validUser?.role ?? VIRTUAL_USER_ROLE_IDS.site_visitor;

  return (
    <AuthContext.Provider
      value={{
        user: validUser,
        role,
        isLoading,
        isAuthenticated: !!validUser,
        isAdmin: role === USER_ROLE_IDS.app_admin,
        canAccessAdmin:
          hasUserRole(role, "adminPanel") ||
          ((validUser as User | null)?.eventAssignments?.length ?? 0) > 0,
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
