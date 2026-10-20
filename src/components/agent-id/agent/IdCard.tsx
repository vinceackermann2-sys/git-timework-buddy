// The top of an agent's page: its identity at a glance, like an ID card.
import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { BadgeCheck } from "lucide-react";

import { cn } from "@/lib/utils";
import { agentApps } from "@/lib/agent-id/apps";
import { formatPhone, formatUsd } from "@/lib/agent-id/format";
import { useCardApplication, useWalletSummary } from "@/lib/agent-id/queries";
import type { AgentDetail, Kind } from "@/lib/agent-id/types";
import { AppChip } from "../AppIcons";
import { Avatar, Chip, KIND_ICONS, ModeBadge, StatusBadge } from "../ui";
import { ProvisionDialog } from "./ProvisionDialog";
import { KIND_TABS } from "./tabs";

export function IdCard({ detail }: { detail: AgentDetail }) {
  const { agent, verification } = detail;
  const wallet = agent.resources.wallet;
  const vm = agent.resources.vm;
  const active = agent.status === "active";
  const summary = useWalletSummary(agent.id, !!wallet && active && wallet.status === "active");
  const application = useCardApplication(agent.id);
  const balance = summary.data?.balance ?? wallet?.balance ?? null;
  const apps = agentApps(agent);

  // Two columns on phones (mail across both), one row of five on wide screens.
  const line = (kind: Kind, value: ReactNode) => (
    <IdLine
      kind={kind}
      agentId={agent.id}
      has={!!agent.resources[kind] || kind === "card"}
      className={LINE_BORDERS[kind]}
    >
      {value}
    </IdLine>
  );

  return (
    <section className="aid-card overflow-hidden" aria-label={`${agent.name}'s identity`}>
      <div className="flex items-start gap-4 p-5">
        <Avatar name={agent.name} large />
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
          {apps.length > 0 && (
            <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
              <span className="mr-0.5 text-xs text-[var(--muted-foreground)]">Used in</span>
              {apps.map((item) => (
                <AppChip key={item.app} app={item.app} label={item.label} />
              ))}
            </div>
          )}
        </div>
      </div>

      <dl className="grid grid-cols-2 border-t border-[var(--border)] lg:grid-cols-[minmax(0,2fr)_repeat(4,minmax(0,1fr))]">
        {line(
          "mail",
          agent.resources.mail ? (
            <span
              className="aid-mono block truncate text-[13px]"
              title={agent.resources.mail.address ?? ""}
            >
              {agent.resources.mail.address}
            </span>
          ) : (
            <ProvisionDialog agent={agent} kind="mail" inline />
          ),
        )}
        {line(
          "phone",
          agent.resources.phone ? (
            <span className="text-[13px] tabular-nums">
              {formatPhone(agent.resources.phone.address)}
            </span>
          ) : (
            <ProvisionDialog agent={agent} kind="phone" inline />
          ),
        )}
        {line(
          "wallet",
          wallet ? (
            <span className="flex items-center gap-1.5">
              <span className="font-semibold">{balance ? formatUsd(balance.amount) : "—"}</span>
              {wallet.mode === "test" && <ModeBadge mode="test" />}
            </span>
          ) : (
            <ProvisionDialog agent={agent} kind="wallet" inline />
          ),
        )}
        {line(
          "card",
          application.data ? (
            <Chip tone="ink">Applied</Chip>
          ) : (
            <Link
              to="/agent-id/agents/$agentId"
              params={{ agentId: agent.id }}
              search={{ tab: "card" }}
              className="aid-link text-sm font-medium"
            >
              Apply
            </Link>
          ),
        )}
        {line(
          "vm",
          vm ? (
            <Chip tone={vm.details.machine === "running" ? "success" : "neutral"}>
              {vm.status === "provisioning"
                ? "Setting up"
                : vm.details.machine
                  ? vm.details.machine.charAt(0).toUpperCase() + vm.details.machine.slice(1)
                  : "Ready"}
            </Chip>
          ) : (
            <ProvisionDialog agent={agent} kind="vm" inline />
          ),
        )}
      </dl>
    </section>
  );
}

const LINE_BORDERS: Record<Kind, string> = {
  mail: "col-span-2 border-b lg:col-span-1 lg:border-b-0 lg:border-r",
  phone: "border-b border-r lg:border-b-0",
  wallet: "border-b lg:border-b-0 lg:border-r",
  card: "border-r",
  vm: "",
};

const LINE_LABELS: Record<Kind, string> = {
  mail: "Mail",
  phone: "Phone",
  wallet: "Wallet",
  card: "Card",
  vm: "Machine",
};

function IdLine({
  kind,
  agentId,
  has,
  className,
  children,
}: {
  kind: Kind;
  agentId: string;
  has: boolean;
  className: string;
  children: ReactNode;
}) {
  const Icon = KIND_ICONS[kind];
  const label = (
    <>
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      {LINE_LABELS[kind]}
    </>
  );
  return (
    <div className={cn("min-w-0 border-[var(--border)] px-4 py-3 sm:px-5", className)}>
      <dt className="aid-label flex items-center gap-1.5">
        {has ? (
          <Link
            to="/agent-id/agents/$agentId"
            params={{ agentId }}
            search={{ tab: KIND_TABS[kind] }}
            className="flex items-center gap-1.5 hover:text-[var(--foreground)]"
          >
            {label}
          </Link>
        ) : (
          label
        )}
      </dt>
      <dd className="mt-1 min-w-0 text-sm">{children}</dd>
    </div>
  );
}
