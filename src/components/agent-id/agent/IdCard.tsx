// The top of an agent's page: its mascot, name, who stands behind it, and the
// apps it's used in. What it has is down the left of the page (AgentNav).
import { Link } from "@tanstack/react-router";
import { BadgeCheck } from "lucide-react";

import { agentApps } from "@/lib/agent-id/apps";
import { modelKindText } from "@/lib/agent-id/format";
import type { AgentDetail } from "@/lib/agent-id/types";
import { AppChip } from "../AppIcons";
import { AgentAvatar, Chip, StatusBadge } from "../ui";

export function IdCard({ detail }: { detail: AgentDetail }) {
  const { agent, verification } = detail;
  const apps = agentApps(agent);
  const kind = modelKindText(agent.model);

  return (
    <section className="aid-card overflow-hidden" aria-label={`${agent.name}'s identity`}>
      <div className="flex items-start gap-4 p-5">
        <AgentAvatar mascot={agent.mascot} id={agent.id} size="lg" />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1">
            <h1 className="min-w-0 truncate text-2xl font-semibold tracking-tight">{agent.name}</h1>
            {verification.verified ? (
              <Chip
                tone="success"
                title={verification.level === "kyb" ? "Verified business" : "Verified person"}
              >
                <BadgeCheck className="h-3 w-3" aria-hidden="true" />
                Verified owner
              </Chip>
            ) : (
              <Link to="/agent-id/verify" className="rounded-full">
                <Chip>Owner not verified</Chip>
              </Link>
            )}
            {agent.status !== "active" && <StatusBadge status={agent.status} />}
          </div>
          {kind && <p className="mt-1 text-sm text-[var(--muted-foreground)]">{kind}</p>}
          {apps.length > 0 && (
            <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
              <span className="mr-0.5 text-xs text-[var(--muted-foreground)]">Used in</span>
              {apps.map((item) => (
                <AppChip
                  key={item.app}
                  app={item.app}
                  label={item.label}
                  model={item.model}
                  models={item.models}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
