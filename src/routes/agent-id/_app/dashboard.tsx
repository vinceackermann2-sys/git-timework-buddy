import { Link, createFileRoute } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";

import { cn } from "@/lib/utils";
import { CreateAgentDialog } from "@/components/agent-id/CreateAgentDialog";
import { AppIconRow } from "@/components/agent-id/AppIcons";
import { AgentsIcon } from "@/components/agent-id/icons";
import {
  AgentAvatar,
  CommandLine,
  ErrorState,
  KIND_ICONS,
  LoadingRows,
  PageHeader,
  Section,
  TimeAgo,
} from "@/components/agent-id/ui";
import { agentApps } from "@/lib/agent-id/apps";
import { ATTACH_COMMAND } from "@/lib/agent-id/connect";
import { KIND_LABELS, statusLabel } from "@/lib/agent-id/format";
import { useAgents } from "@/lib/agent-id/queries";
import { KINDS, type Agent, type Kind } from "@/lib/agent-id/types";

export const Route = createFileRoute("/agent-id/_app/dashboard")({
  head: () => ({ meta: [{ title: "Agents · Agent ID" }] }),
  component: AgentsPage,
});

function AgentsPage() {
  const agents = useAgents();

  return (
    <div>
      <PageHeader
        title="Agents"
        actions={<CreateAgentDialog variant={agents.data?.length === 0 ? "outline" : "default"} />}
      />

      {agents.isPending ? (
        <Section flush>
          <LoadingRows rows={3} />
        </Section>
      ) : agents.isError ? (
        <Section flush>
          <ErrorState error={agents.error} onRetry={() => void agents.refetch()} />
        </Section>
      ) : agents.data.length === 0 ? (
        <Section>
          <div className="mx-auto flex max-w-lg flex-col items-center py-6 text-center">
            <span className="grid h-12 w-12 place-items-center rounded-2xl bg-[var(--primary)] text-[var(--primary-foreground)]">
              <AgentsIcon className="h-6 w-6" />
            </span>
            <h2 className="mt-4 text-lg font-semibold">Add your agents</h2>
            <p className="mt-1 text-sm text-[var(--muted-foreground)]">
              Run this on your computer. It finds the agents you use in Claude Code, Codex, Cursor
              and more, and gives each one its Agent ID.
            </p>
            <div className="mt-5 w-full text-left">
              <CommandLine command={ATTACH_COMMAND} />
            </div>
          </div>
        </Section>
      ) : (
        <Section flush>
          <div className="@container">
            <ul className="divide-y divide-[var(--border)]" aria-label="Your agents">
              {agents.data.map((agent) => (
                <AgentRow key={agent.id} agent={agent} />
              ))}
            </ul>
          </div>
        </Section>
      )}
    </div>
  );
}

// One agent: its name with the apps it's used in, what it has, and when it
// was last active. Phones put what it has on a second line; it never wraps.
function AgentRow({ agent }: { agent: Agent }) {
  const kinds = KINDS.filter((kind) => !!agent.resources[kind]);
  const active = agent.status === "active";
  const when = active ? (
    agent.lastSeenAt ? (
      <TimeAgo iso={agent.lastSeenAt} />
    ) : (
      <span>Not used yet</span>
    )
  ) : (
    <span className="font-medium text-[var(--aid-warning)]">{statusLabel(agent.status)}</span>
  );
  return (
    <li>
      <Link
        to="/agent-id/agents/$agentId"
        params={{ agentId: agent.id }}
        search={{}}
        className="group flex items-center gap-3 px-4 py-3.5 transition-colors hover:bg-[var(--accent)] sm:px-5"
      >
        <span className={cn(!active && "opacity-60")}>
          <AgentAvatar mascot={agent.mascot} id={agent.id} size="md" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <span className="min-w-0 truncate text-[15px] font-medium">{agent.name}</span>
            <AppIconRow apps={agentApps(agent)} />
          </div>
          {agent.resources.mail?.address && (
            <p className="aid-mono mt-0.5 hidden truncate text-xs text-[var(--muted-foreground)] sm:block">
              {agent.resources.mail.address}
            </p>
          )}
          <div className="mt-1.5 flex min-w-0 items-center gap-2 text-xs text-[var(--muted-foreground)] sm:hidden">
            <Capabilities kinds={kinds} />
            {kinds.length > 0 && <span aria-hidden="true">·</span>}
            <span className="truncate">{when}</span>
          </div>
        </div>
        {/* A fixed width, so every row's chips start in the same place. */}
        <div className="hidden w-[9.75rem] shrink-0 sm:block @4xl:w-[24.5rem]">
          <Capabilities kinds={kinds} />
        </div>
        <span className="hidden w-24 shrink-0 truncate text-right text-xs text-[var(--muted-foreground)] sm:block">
          {when}
        </span>
        <ChevronRight
          className="h-4 w-4 shrink-0 text-[var(--muted-foreground)] transition-transform group-hover:translate-x-0.5"
          aria-hidden="true"
        />
      </Link>
    </li>
  );
}

// What the agent has, in one row: icons, with their names where there's room.
function Capabilities({ kinds }: { kinds: Kind[] }) {
  if (!kinds.length) return null;
  return (
    <ul
      className="flex shrink-0 flex-nowrap items-center gap-1 @4xl:gap-1.5"
      aria-label={`Has ${kinds.map((k) => KIND_LABELS[k].toLowerCase()).join(", ")}`}
    >
      {kinds.map((kind) => {
        const Icon = KIND_ICONS[kind];
        return (
          <li
            key={kind}
            title={KIND_LABELS[kind]}
            className="inline-flex h-6 min-w-6 items-center justify-center gap-1.5 rounded-full bg-[var(--accent)] text-xs font-medium text-[var(--aid-ink)] sm:h-7 sm:min-w-7 @4xl:px-2.5"
          >
            <Icon className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="sr-only @4xl:not-sr-only">{KIND_LABELS[kind]}</span>
          </li>
        );
      })}
    </ul>
  );
}
