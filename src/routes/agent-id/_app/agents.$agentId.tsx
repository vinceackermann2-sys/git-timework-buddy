import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Empty, ErrorState, Notice, Section } from "@/components/agent-id/ui";
import { IdCard } from "@/components/agent-id/agent/IdCard";
import { MailTab } from "@/components/agent-id/agent/MailTab";
import { PhoneTab } from "@/components/agent-id/agent/PhoneTab";
import { WalletTab } from "@/components/agent-id/agent/WalletTab";
import { CardTab } from "@/components/agent-id/agent/CardTab";
import { MachineTab } from "@/components/agent-id/agent/MachineTab";
import { ActivityTab } from "@/components/agent-id/agent/ActivityTab";
import { SettingsTab } from "@/components/agent-id/agent/SettingsTab";
import {
  defaultTab,
  parseAgentTab,
  visibleTabs,
  type AgentTab,
} from "@/components/agent-id/agent/tabs";
import { AgentIdError } from "@/lib/agent-id/client";
import { useAgent } from "@/lib/agent-id/queries";

export const Route = createFileRoute("/agent-id/_app/agents/$agentId")({
  validateSearch: (search: Record<string, unknown>): { tab?: AgentTab } => {
    const tab = parseAgentTab(search["tab"]);
    return tab ? { tab } : {};
  },
  head: () => ({ meta: [{ title: "Agent · Agent ID" }] }),
  component: AgentPage,
});

function AgentPage() {
  const { agentId } = Route.useParams();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const query = useAgent(agentId);

  const back = (
    <Link to="/agent-id/dashboard" className="aid-link inline-flex items-center gap-1 text-sm">
      <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" /> Agents
    </Link>
  );

  if (query.isPending) {
    return (
      <div aria-busy="true" aria-label="Loading agent">
        <div className="mb-4">{back}</div>
        <Skeleton className="mb-6 h-44 w-full rounded-xl bg-[var(--muted)]" />
        <Skeleton className="mb-6 h-9 w-full bg-[var(--muted)]" />
        <Skeleton className="h-64 w-full bg-[var(--muted)]" />
      </div>
    );
  }
  if (query.isError) {
    const missing = query.error instanceof AgentIdError && query.error.status === 404;
    return (
      <>
        <div className="mb-4">{back}</div>
        <Section>
          {missing ? (
            <Empty>This agent doesn't exist.</Empty>
          ) : (
            <ErrorState error={query.error} onRetry={() => void query.refetch()} />
          )}
        </Section>
      </>
    );
  }

  const { agent } = query.data;
  const tab = search.tab ?? defaultTab(agent);
  const tabs = visibleTabs(agent, tab);

  return (
    <div className="space-y-6">
      <div>{back}</div>
      <IdCard detail={query.data} />

      {agent.status !== "active" && (
        <Notice tone={agent.status === "revoked" ? "danger" : "warning"}>
          {agent.status === "revoked"
            ? "Revoked: its keys no longer work and its resources were released."
            : "Paused: it can't act until you resume it in Settings."}
        </Notice>
      )}

      <Tabs
        value={tab}
        onValueChange={(next) =>
          void navigate({ search: { tab: next as AgentTab }, replace: true, resetScroll: false })
        }
      >
        <div className="aid-scroll-x -mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          <TabsList className="h-10 w-max justify-start rounded-lg bg-[var(--muted)]">
            {tabs.map(([id, label]) => (
              <TabsTrigger key={id} value={id} className="px-3">
                {label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
        <div className="mt-6">
          <TabsContent value="mail" className="mt-0">
            <MailTab agent={agent} />
          </TabsContent>
          <TabsContent value="phone" className="mt-0">
            <PhoneTab agent={agent} />
          </TabsContent>
          <TabsContent value="wallet" className="mt-0">
            <WalletTab agent={agent} />
          </TabsContent>
          <TabsContent value="card" className="mt-0">
            <CardTab agent={agent} />
          </TabsContent>
          <TabsContent value="machine" className="mt-0">
            <MachineTab agent={agent} />
          </TabsContent>
          <TabsContent value="activity" className="mt-0">
            <ActivityTab agent={agent} />
          </TabsContent>
          <TabsContent value="settings" className="mt-0">
            <SettingsTab detail={query.data} />
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}
