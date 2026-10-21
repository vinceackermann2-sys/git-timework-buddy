// What a new Agent ID has: its email address and wallet straight away, a
// phone number to apply for, and a computer that starts the first time the
// agent uses it. Anything still being set up says so, and anything left out
// says why in plain words.
import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { formatPhone, shortAddress } from "@/lib/agent-id/format";
import type { AgentSetup, Kind } from "@/lib/agent-id/types";
import { CopyButton } from "./ui";
import { ResourceArt } from "./ResourceArt";

type Ready = Partial<Record<string, { status: string; address: string | null } | undefined>>;

// Why a kind wasn't given, as the owner can act on it.
function skippedReason(code: string): { text: string; verify?: boolean } {
  if (code === "verification_required")
    return { text: "Verify your identity to add it", verify: true };
  if (code === "plan_required") return { text: "Needs a paid plan" };
  return { text: "Not available yet" };
}

type Row = {
  kind: Kind;
  label: string;
  value: ReactNode;
  mono?: boolean;
  copy?: string | null | undefined;
  quiet?: boolean;
};

export function ReadyList({
  resources,
  skipped = [],
  agentId,
}: {
  resources: Ready;
  skipped?: AgentSetup["skipped"] | undefined;
  // For the links to apply for a number (else they open Agent ID).
  agentId?: string | undefined;
}) {
  const at = (kind: Kind) => resources[kind];
  const copyOf = (kind: Kind) => (at(kind)?.status === "provisioning" ? null : at(kind)?.address);
  const skip = (kind: Kind) => skipped.find((item) => item.kind === kind && !resources[kind]);
  const settingUp = (
    <span className="flex items-center gap-1.5 font-normal text-[var(--muted-foreground)]">
      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
      Setting up
    </span>
  );
  const valueOf = (kind: Kind, show: (address: string) => string) => {
    const resource = resources[kind];
    if (!resource) return null;
    if (resource.status === "provisioning" || !resource.address) return settingUp;
    return show(resource.address);
  };
  const missing = (kind: Kind, fallback: ReactNode) => {
    const left = skip(kind);
    if (!left || left.code === "waitlist") return fallback;
    const reason = skippedReason(left.code);
    return reason.verify ? (
      <Link to="/agent-id/verify" className="aid-link">
        {reason.text}
      </Link>
    ) : (
      reason.text
    );
  };
  const phoneLink = agentId ? (
    <Link
      to="/agent-id/agents/$agentId"
      params={{ agentId }}
      search={{ tab: "phone" }}
      className="aid-link"
    >
      Apply for a number
    </Link>
  ) : (
    <Link to="/agent-id/dashboard" className="aid-link">
      Apply for a number in Agent ID
    </Link>
  );

  const rows: Row[] = [
    {
      kind: "mail",
      label: "Email",
      value: valueOf("mail", (a) => a) ?? missing("mail", "Not available yet"),
      mono: !!at("mail")?.address,
      copy: copyOf("mail"),
    },
    {
      kind: "wallet",
      label: "Wallet",
      value: valueOf("wallet", (a) => shortAddress(a)) ?? missing("wallet", "Not available yet"),
      mono: !!at("wallet")?.address,
      copy: copyOf("wallet"),
    },
    {
      kind: "phone",
      label: "Phone",
      value: valueOf("phone", (a) => formatPhone(a)) ?? missing("phone", phoneLink),
      copy: copyOf("phone"),
    },
    {
      kind: "vm",
      label: "Computer",
      value: at("vm")
        ? at("vm")?.status === "provisioning"
          ? settingUp
          : "Ready"
        : "Starts the first time it's used",
      quiet: !at("vm"),
    },
  ];

  return (
    <ul className="aid-card divide-y divide-[var(--border)] overflow-hidden text-left">
      {rows.map(({ kind, label, value, mono, copy, quiet }) => {
        return (
          <li key={kind} className="flex min-h-16 items-center gap-3.5 px-4 py-3">
            <ResourceArt kind={kind === "card" ? "wallet" : kind} />
            <span className="min-w-0 flex-1">
              <span className="block text-xs text-[var(--muted-foreground)]">{label}</span>
              <span
                className={cn(
                  "block truncate text-sm font-medium",
                  mono && "aid-mono text-[13px]",
                  quiet && "font-normal text-[var(--muted-foreground)]",
                )}
                title={typeof value === "string" ? value : undefined}
              >
                {value}
              </span>
            </span>
            {copy && (
              <CopyButton
                text={copy}
                iconOnly
                variant="ghost"
                label={`Copy ${label.toLowerCase()}`}
              />
            )}
          </li>
        );
      })}
    </ul>
  );
}
