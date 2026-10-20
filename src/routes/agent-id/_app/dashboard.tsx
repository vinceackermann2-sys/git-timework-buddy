import { Link, createFileRoute } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";

import { CreateAgentDialog } from "@/components/agent-id/CreateAgentDialog";
import { PendingApprovals } from "@/components/agent-id/ApprovalList";
import {
  CommandLine,
  ErrorState,
  LoadingRows,
  Muted,
  PageHeader,
  ModeBadge,
  ResourceChip,
  Rows,
  OriginBadge,
  Section,
  StatusBadge,
  TimeAgo,
} from "@/components/agent-id/ui";
import { ATTACH_COMMAND } from "@/lib/agent-id/connect";
import { useAgents, useApprovals } from "@/lib/agent-id/queries";
import { KINDS, type Agent } from "@/lib/agent-id/types";

export const Route = createFileRoute("/agent-id/_app/dashboard")({
  head: () => ({ meta: [{ title: "Agents · Agent ID" }] }),
  component: AgentsPage,
});

function AgentsPage() {
  const agents = useAgents();
  const approvals = useApprovals();
  const pending = approvals.data ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Agents"
        actions={<CreateAgentDialog variant={agents.data?.length === 0 ? "outline" : "default"} />}
      />

      {pending.length > 0 && (
        <Section title={`Waiting for your approval (${pending.length})`} flush>
          <PendingApprovals approvals={pending} />
        </Section>
      )}

      {agents.isPending ? (
        <Section flush>
          <LoadingRows rows={3} />
        </Section>
      ) : agents.isError ? (
        <Section flush>
          <ErrorState error={agents.error} onRetry={() => void agents.refetch()} />
        </Section>
      ) : agents.data.length === 0 ? (
        <Section title="Attach your agents">
          <CommandLine command={ATTACH_COMMAND} />
          <Muted className="mt-2">
            Finds your agents in Claude Code, Codex, Cursor, Claude Desktop, Timewarp and project
            folders.
          </Muted>
        </Section>
      ) : (
        <Section flush>
          <Rows label="Your agents">
            {agents.data.map((agent) => (
              <AgentRow key={agent.id} agent={agent} />
            ))}
          </Rows>
        </Section>
      )}
    </div>
  );
}

function AgentRow({ agent }: { agent: Agent }) {
  const resources = KINDS.map((kind) => agent.resources[kind]).filter((r) => r !== undefined);
  // One Test/Live badge when every resource is in the same mode.
  const modes = [...new Set(resources.map((r) => r.mode))];
  const oneMode = modes.length === 1 ? modes[0] : undefined;
  return (
    <li>
      <Link
        to="/agent-id/agents/$agentId"
        params={{ agentId: agent.id }}
        search={{}}
        className="group flex flex-col gap-2 px-5 py-4 transition-colors hover:bg-[var(--accent)] sm:flex-row sm:items-center sm:gap-4"
      >
        <div className="min-w-0 sm:w-60 sm:shrink-0">
          <div className="flex min-w-0 items-center gap-2">
            <span className="min-w-0 truncate font-medium">{agent.name}</span>
            <OriginBadge agent={agent} />
            {agent.status !== "active" && <StatusBadge status={agent.status} />}
          </div>
          <p className="aid-mono truncate text-xs text-[var(--muted-foreground)]">{agent.handle}</p>
        </div>
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5 sm:justify-end">
          {resources.map((r) => (
            <ResourceChip key={r.kind} resource={r} showMode={!oneMode} />
          ))}
          {oneMode && <ModeBadge mode={oneMode} />}
        </div>
        <div className="flex items-center justify-between gap-2 text-xs text-[var(--muted-foreground)] sm:w-28 sm:justify-end">
          {agent.lastSeenAt ? <TimeAgo iso={agent.lastSeenAt} /> : <span>Not seen yet</span>}
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </div>
      </Link>
    </li>
  );
}
