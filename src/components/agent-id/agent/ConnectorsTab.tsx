// The owner's connected apps (Gmail, Slack…, connected in Timewarp) that this
// agent may use, wherever it runs. For a Timewarp agent this is its Tools
// setting in the app: a change here reaches Timewarp at its next sync.
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { Switch } from "@/components/ui/switch";
import { connectorsChange } from "@/lib/agent-id/format";
import {
  isConnectorsUnavailable,
  queryKeys,
  useConnectors,
  useConnectorsAvailable,
} from "@/lib/agent-id/queries";
import { api } from "@/lib/agent-id/session";
import type { Agent, AgentConnectors, ConnectorsChange } from "@/lib/agent-id/types";
import { AppIcon } from "../AppIcons";
import { Empty, ErrorState, LoadingRows, Section, toastError } from "../ui";

// What the list looks like once the change is saved, shown at once.
function applied(data: AgentConnectors, change: ConnectorsChange): AgentConnectors {
  const all = "all" in change;
  const ids = new Set("connections" in change ? change.connections : []);
  return {
    ...data,
    all,
    connectors: data.connectors.map((c) => ({ ...c, allowed: all || ids.has(c.id) })),
  };
}

export function ConnectorsTab({ agent }: { agent: Agent }) {
  const available = useConnectorsAvailable();
  const connectors = useConnectors(agent.id, available === true);
  const queryClient = useQueryClient();
  const key = queryKeys.connectors(agent.id);
  const save = useMutation({
    mutationFn: (change: ConnectorsChange) => api.setConnectors(agent.id, change),
    onMutate: async (change) => {
      await queryClient.cancelQueries({ queryKey: key });
      const before = queryClient.getQueryData<AgentConnectors>(key);
      if (before) queryClient.setQueryData(key, applied(before, change));
      return { before };
    },
    onSuccess: (data) => queryClient.setQueryData(key, data),
    onError: (error, _change, context) => {
      if (context?.before) queryClient.setQueryData(key, context.before);
      toastError(error, "Couldn't change its apps");
      void queryClient.invalidateQueries({ queryKey: key });
    },
  });

  if (available === false || isConnectorsUnavailable(connectors.error))
    return (
      <Section>
        <Empty>Connected apps aren't available on Agent ID yet.</Empty>
      </Section>
    );
  if (connectors.isError)
    return (
      <Section>
        <ErrorState error={connectors.error} onRetry={() => void connectors.refetch()} />
      </Section>
    );
  if (!connectors.data)
    return (
      <Section>
        <LoadingRows rows={3} />
      </Section>
    );

  const data = connectors.data;
  const locked = agent.status === "revoked" || save.isPending;

  return (
    <Section title="Connectors" flush>
      <ul className="divide-y divide-[var(--border)]" aria-label="Connected apps">
        <li className="flex items-center justify-between gap-3 px-5 py-3">
          <label htmlFor="connectors-all" className="text-sm font-medium">
            All connected apps
          </label>
          <Switch
            id="connectors-all"
            checked={data.all}
            disabled={locked}
            onCheckedChange={(on) => save.mutate(on ? { all: true } : { connections: [] })}
          />
        </li>
        {data.connectors.map((connector) => (
          <li key={connector.id} className="flex items-center gap-3 px-5 py-3">
            <span aria-hidden="true" className="inline-flex">
              <AppIcon
                app={connector.toolkit}
                label={connector.app}
                size="md"
                tooltip={false}
                className="h-9 w-9 rounded-xl text-base"
              />
            </span>
            <label htmlFor={`connector-${connector.id}`} className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{connector.app}</span>
              {connector.label && (
                <span className="block truncate text-xs text-[var(--muted-foreground)]">
                  {connector.label}
                </span>
              )}
            </label>
            <Switch
              id={`connector-${connector.id}`}
              aria-label={connector.label ? `${connector.app}, ${connector.label}` : connector.app}
              checked={connector.allowed}
              disabled={locked}
              onCheckedChange={(on) => save.mutate(connectorsChange(data, connector.id, on))}
            />
          </li>
        ))}
      </ul>
      {data.connectors.length === 0 && (
        <p className="border-t border-[var(--border)] px-5 py-4 text-sm text-[var(--muted-foreground)]">
          No connected apps yet. Connect them in the Timewarp app.
        </p>
      )}
      {data.timewarp && (
        <p className="border-t border-[var(--border)] px-5 py-3 text-xs text-[var(--muted-foreground)]">
          The same setting as {agent.name}'s Tools in Timewarp.
        </p>
      )}
    </Section>
  );
}
