import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api/instance";
import type { User } from "@/lib/api/schemas";
import { tokenStore } from "./tokenStore";

interface AuthValue {
  token: string | null;
  user: User | undefined;
  isLoadingUser: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, fullName?: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => tokenStore.get());
  const qc = useQueryClient();

  useEffect(
    () =>
      tokenStore.subscribe((t, reason) => {
        setToken(t);
        if (!t) {
          qc.clear();
          if (reason === "expired") toast.message("Your session ended. Please sign in again.");
        }
      }),
    [qc],
  );

  // Proactively end the session when the JWT expires.
  useEffect(() => {
    const exp = tokenStore.expiresAt();
    if (!token || !exp) return;
    const id = window.setTimeout(() => tokenStore.clear("expired"), Math.max(0, exp - Date.now()));
    return () => window.clearTimeout(id);
  }, [token]);

  const me = useQuery({
    queryKey: ["me"],
    queryFn: ({ signal }) => api.me(signal),
    enabled: !!token,
    staleTime: 5 * 60_000,
  });

  const login = useCallback(async (email: string, password: string) => {
    const res = await api.login({ email: email.trim(), password });
    tokenStore.set(res.access_token, res.expires_in);
  }, []);

  const register = useCallback(
    async (email: string, password: string, fullName?: string) => {
      await api.register({ email: email.trim(), password, full_name: fullName?.trim() || undefined });
      await login(email, password);
    },
    [login],
  );

  const logout = useCallback(() => tokenStore.clear("logout"), []);

  const value = useMemo<AuthValue>(
    () => ({ token, user: me.data, isLoadingUser: me.isLoading, login, register, logout }),
    [token, me.data, me.isLoading, login, register, logout],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
