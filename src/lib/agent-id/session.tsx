// Who is using the dashboard: a Timewarp account signed in with Supabase, or,
// in development, the token VITE_AGENT_ID_DEV_TOKEN names (the local dev API
// prints one). The API client asks here for the bearer token on every call.
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { createAgentIdClient, resolveApiBase, resolveDevToken, resolveGatewayKey } from "./client";

const env = import.meta.env as unknown as Record<string, string | boolean | undefined>;

// The dev token only ever works in development builds.
export const DEV_TOKEN = import.meta.env.DEV ? resolveDevToken(env) : undefined;
export const API_BASE = resolveApiBase(env);

export async function getAccessToken(): Promise<string | null> {
  if (DEV_TOKEN) return DEV_TOKEN;
  if (typeof window === "undefined") return null;
  try {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  } catch {
    return null;
  }
}

export const api = createAgentIdClient({
  baseUrl: API_BASE,
  getToken: getAccessToken,
  gatewayKey: resolveGatewayKey(env),
});

export type SessionState =
  | { status: "loading" }
  | { status: "signed-out"; problem?: string }
  | { status: "signed-in"; email: string | null; dev: boolean };

type SessionContextValue = SessionState & { signOut: () => Promise<void> };

const SessionContext = createContext<SessionContextValue | null>(null);

export function AgentIdSessionProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<SessionState>({ status: "loading" });

  useEffect(() => {
    if (DEV_TOKEN) {
      setState({ status: "signed-in", email: null, dev: true });
      return;
    }
    let active = true;
    let unsubscribe = () => {};
    try {
      supabase.auth
        .getSession()
        .then(({ data }) => {
          if (!active) return;
          setState(
            data.session
              ? { status: "signed-in", email: data.session.user.email ?? null, dev: false }
              : { status: "signed-out" },
          );
        })
        .catch(() => active && setState({ status: "signed-out" }));
      const { data } = supabase.auth.onAuthStateChange((_event, session) => {
        if (!active) return;
        setState(
          session
            ? { status: "signed-in", email: session.user.email ?? null, dev: false }
            : { status: "signed-out" },
        );
      });
      unsubscribe = () => data.subscription.unsubscribe();
    } catch (error) {
      setState({
        status: "signed-out",
        problem: error instanceof Error ? error.message : "Sign-in isn't available here.",
      });
    }
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const signOut = useCallback(async () => {
    if (DEV_TOKEN) return;
    try {
      await supabase.auth.signOut();
    } finally {
      queryClient.removeQueries({ queryKey: ["agent-id"] });
      setState({ status: "signed-out" });
    }
  }, [queryClient]);

  const value = useMemo(() => ({ ...state, signOut }), [state, signOut]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error("useSession must be used inside AgentIdSessionProvider");
  return value;
}
