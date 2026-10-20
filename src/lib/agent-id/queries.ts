// TanStack Query hooks over the Agent ID client. Every key starts with
// "agent-id" so signing out can drop them all at once.
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

import { AgentIdError } from "./client";
import { api } from "./session";
import type { EventKind, MailFolder } from "./types";

export const queryKeys = {
  all: ["agent-id"] as const,
  account: ["agent-id", "account"] as const,
  agents: ["agent-id", "agents"] as const,
  agent: (id: string) => ["agent-id", "agent", id] as const,
  events: (id: string, scope: string) => ["agent-id", "events", id, scope] as const,
  eventsOf: (id: string) => ["agent-id", "events", id] as const,
  contacts: (id: string) => ["agent-id", "contacts", id] as const,
  me: (id: string, what: string) => ["agent-id", "me", id, what] as const,
  meOf: (id: string) => ["agent-id", "me", id] as const,
  approvals: ["agent-id", "approvals"] as const,
  audit: (agent?: string) => ["agent-id", "audit", agent ?? "all"] as const,
  ownerKeys: ["agent-id", "owner-keys"] as const,
  relyingParties: ["agent-id", "relying-parties"] as const,
  reviews: ["agent-id", "reviews"] as const,
};

// Client errors (4xx) won't change on a retry; network and server errors might.
export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (error instanceof AgentIdError && error.status >= 400 && error.status < 500) return false;
  return failureCount < 2;
}

const base = { retry: shouldRetry, staleTime: 15_000 } as const;

export const useAccount = () =>
  useQuery({ ...base, queryKey: queryKeys.account, queryFn: () => api.account() });

export const useAgents = () =>
  useQuery({
    ...base,
    queryKey: queryKeys.agents,
    queryFn: async () => (await api.listAgents()).agents,
  });

export const useAgent = (id: string) =>
  useQuery({ ...base, queryKey: queryKeys.agent(id), queryFn: () => api.getAgent(id) });

export function useEventPages(
  agentId: string,
  scope: { kind: EventKind[]; direction?: "in" | "out" | undefined },
  { enabled = true, limit = 25 }: { enabled?: boolean; limit?: number } = {},
) {
  return useInfiniteQuery({
    ...base,
    enabled,
    queryKey: queryKeys.events(agentId, `${scope.kind.join(",")}:${scope.direction ?? "all"}`),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      api.events(agentId, {
        kind: scope.kind,
        ...(scope.direction ? { direction: scope.direction } : {}),
        ...(pageParam ? { before: pageParam } : {}),
        limit,
      }),
    getNextPageParam: (last) => (last.more ? last.events.at(-1)?.at : undefined),
  });
}

export const useContacts = (agentId: string) =>
  useQuery({
    ...base,
    queryKey: queryKeys.contacts(agentId),
    queryFn: async () => (await api.contacts(agentId)).contacts,
  });

export const useApprovals = ({ poll = false }: { poll?: boolean } = {}) =>
  useQuery({
    ...base,
    queryKey: queryKeys.approvals,
    queryFn: async () => (await api.approvals()).approvals,
    ...(poll ? { refetchInterval: 30_000 } : {}),
  });

export const useAudit = (agent?: string, limit = 100) =>
  useQuery({
    ...base,
    queryKey: queryKeys.audit(agent),
    queryFn: async () => (await api.audit({ ...(agent ? { agent } : {}), limit })).entries,
  });

export const useOwnerKeys = () =>
  useQuery({
    ...base,
    queryKey: queryKeys.ownerKeys,
    queryFn: async () => (await api.ownerKeys()).keys,
  });

export const useRelyingParties = () =>
  useQuery({
    ...base,
    queryKey: queryKeys.relyingParties,
    queryFn: async () => (await api.relyingParties()).relyingParties,
  });

export const useReviews = (enabled: boolean) =>
  useQuery({ ...base, enabled, queryKey: queryKeys.reviews, queryFn: () => api.reviews() });

// After a change to an agent: its detail, the list, its feeds and the log.
export function useRefreshAgent() {
  const queryClient = useQueryClient();
  return useCallback(
    (agentId: string, { events = false }: { events?: boolean } = {}) =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.agent(agentId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.agents }),
        queryClient.invalidateQueries({ queryKey: queryKeys.meOf(agentId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.audit(agentId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.account }),
        ...(events
          ? [queryClient.invalidateQueries({ queryKey: queryKeys.eventsOf(agentId) })]
          : []),
      ]),
    [queryClient],
  );
}

// --- Acting as one agent (the /v1/me routes; they need an active agent) -----------

export const useWalletSummary = (agentId: string, enabled: boolean) =>
  useQuery({
    ...base,
    enabled,
    queryKey: queryKeys.me(agentId, "wallet"),
    queryFn: async () => (await api.asAgent(agentId).wallet()).wallet,
  });

export const useCardApplication = (agentId: string) =>
  useQuery({
    ...base,
    queryKey: ["agent-id", "card-application", agentId] as const,
    queryFn: async () => (await api.cardApplication(agentId)).application ?? null,
  });

export const useMailCounts = (agentId: string, enabled: boolean) =>
  useQuery({
    ...base,
    enabled,
    retry: false,
    queryKey: queryKeys.me(agentId, "mail-counts"),
    queryFn: () => api.asAgent(agentId).mailCounts(),
  });

export function useMailPages(
  agentId: string,
  folder: MailFolder,
  q: string,
  { enabled = true }: { enabled?: boolean } = {},
) {
  return useInfiniteQuery({
    ...base,
    enabled,
    queryKey: [...queryKeys.me(agentId, "mail"), folder, q] as const,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      api.asAgent(agentId).mail({
        folder,
        ...(q ? { q } : {}),
        ...(pageParam ? { before: pageParam } : {}),
        limit: 30,
      }),
    getNextPageParam: (last) => (last.more ? last.messages.at(-1)?.at : undefined),
  });
}

export const useMachineFiles = (agentId: string, path: string, enabled: boolean) =>
  useQuery({
    ...base,
    enabled,
    retry: false,
    queryKey: [...queryKeys.me(agentId, "vm-files"), path] as const,
    queryFn: () => api.asAgent(agentId).machineFiles(path),
  });

// Development deployments have test resources; production never shows them.
export function useTestMode(): boolean {
  const account = useAccount();
  return account.data?.config.testMode ?? import.meta.env.DEV;
}
