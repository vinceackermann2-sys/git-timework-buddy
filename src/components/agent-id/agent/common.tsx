// Pieces the agent tabs share.
import type { ReactNode } from "react";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { KIND_NOUNS, NOT_LIVE_YET } from "@/lib/agent-id/format";
import { useAccount, useTestMode } from "@/lib/agent-id/queries";
import type { Agent, Kind, Resource } from "@/lib/agent-id/types";
import { CopyButton, Empty, ModeBadge, Notice, Section, StatusBadge } from "../ui";
import { ProvisionDialog } from "./ProvisionDialog";

// Why the owner can't act as this agent right now, or null when they can.
export function blockedReason(agent: Agent, resource?: Resource): string | null {
  if (agent.status === "revoked") return "This agent is revoked.";
  if (agent.status === "suspended") return "This agent is paused.";
  if (resource?.status === "suspended") return "This is paused.";
  if (resource?.status === "provisioning") return "This is still being set up.";
  return null;
}

export function NoResource({ agent, kind }: { agent: Agent; kind: Kind }) {
  const testMode = useTestMode();
  const account = useAccount();
  if (!testMode && account.data && !account.data.config.resources[kind]?.live) {
    return (
      <Section>
        <Empty>{NOT_LIVE_YET[kind]}.</Empty>
      </Section>
    );
  }
  return (
    <Section>
      <Empty
        action={
          agent.status === "active" ? (
            <ProvisionDialog agent={agent} kind={kind} primary />
          ) : undefined
        }
      >
        No {KIND_NOUNS[kind].replace(/^an? /, "")} yet.
      </Empty>
    </Section>
  );
}

// The line above a resource tab: its address, test or live, paused, and the
// tab's actions.
export function ResourceHeading({
  resource,
  copy,
  children,
}: {
  resource: Resource;
  copy?: boolean;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <span className="aid-mono break-all text-sm font-medium">
          {resource.address ?? resource.label}
        </span>
        {copy && resource.address && (
          <CopyButton text={resource.address} iconOnly variant="ghost" label="Copy address" />
        )}
        <ModeBadge mode={resource.mode} />
        {resource.status !== "active" && <StatusBadge status={resource.status} />}
      </div>
      {children && <div className="flex flex-wrap gap-2">{children}</div>}
    </div>
  );
}

export function BlockedNotice({ reason }: { reason: string | null }) {
  if (!reason) return null;
  return <Notice tone="warning">{reason}</Notice>;
}

export function LoadMore({
  hasMore,
  loading,
  onClick,
}: {
  hasMore: boolean | undefined;
  loading: boolean;
  onClick: () => void;
}) {
  if (!hasMore) return null;
  return (
    <div className="flex justify-center border-t border-[var(--border)] p-3">
      <Button variant="ghost" size="sm" onClick={onClick} disabled={loading}>
        {loading && <Loader2 className="animate-spin" aria-hidden="true" />}
        Show older
      </Button>
    </div>
  );
}
