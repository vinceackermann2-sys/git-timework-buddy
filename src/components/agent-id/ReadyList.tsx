// What a new Agent ID has, ready to use: its mail address, phone number,
// wallet and machine, each shown as "Setting up" until it's ready, and
// anything that was left out with the reason in plain words.
import { Link } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";

import { formatPhone, KIND_LABELS, shortAddress } from "@/lib/agent-id/format";
import type { AgentSetup, Kind } from "@/lib/agent-id/types";
import { CopyButton, KIND_ICONS } from "./ui";

type Ready = Partial<Record<string, { status: string; address: string | null } | undefined>>;

const ORDER: Kind[] = ["mail", "phone", "wallet", "vm"];

// Why a kind wasn't given, as the owner can act on it.
function skippedReason(code: string): { text: string; verify?: boolean } {
  if (code === "verification_required")
    return { text: "Verify your identity to add it", verify: true };
  if (code === "plan_required") return { text: "Needs a paid plan" };
  return { text: "Not available yet" };
}

export function ReadyList({
  resources,
  skipped = [],
}: {
  resources: Ready;
  skipped?: AgentSetup["skipped"] | undefined;
}) {
  const rows = ORDER.filter((kind) => resources[kind]);
  const left = skipped.filter((item) => item.kind !== "card" && !resources[item.kind]);
  if (!rows.length && !left.length) return null;
  return (
    <ul className="divide-y divide-[var(--border)] rounded-xl border border-[var(--border)]">
      {rows.map((kind) => {
        const resource = resources[kind]!;
        const Icon = KIND_ICONS[kind];
        const value =
          resource.status === "provisioning"
            ? null
            : kind === "phone"
              ? formatPhone(resource.address)
              : kind === "wallet" && resource.address
                ? shortAddress(resource.address)
                : kind === "vm"
                  ? "Ready"
                  : resource.address;
        return (
          <li key={kind} className="flex min-h-12 items-center gap-3 px-3.5 py-2.5">
            <Icon className="h-4 w-4 shrink-0 text-[var(--muted-foreground)]" aria-hidden="true" />
            <span className="w-16 shrink-0 text-sm font-medium">{KIND_LABELS[kind]}</span>
            {value === null ? (
              <span className="flex items-center gap-1.5 text-sm text-[var(--muted-foreground)]">
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                Setting up
              </span>
            ) : (
              <span
                className={
                  kind === "mail" || kind === "wallet"
                    ? "aid-mono min-w-0 flex-1 truncate text-[13px]"
                    : "min-w-0 flex-1 truncate text-sm"
                }
                title={resource.address ?? undefined}
              >
                {value}
              </span>
            )}
            {value !== null && resource.address && kind !== "vm" && (
              <CopyButton
                text={resource.address}
                iconOnly
                variant="ghost"
                label={`Copy ${KIND_LABELS[kind].toLowerCase()}`}
                className="ml-auto"
              />
            )}
          </li>
        );
      })}
      {left.map((item) => {
        const Icon = KIND_ICONS[item.kind];
        const reason = skippedReason(item.code);
        return (
          <li
            key={item.kind}
            className="flex min-h-12 items-center gap-3 px-3.5 py-2.5 text-[var(--muted-foreground)]"
          >
            <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="w-16 shrink-0 text-sm font-medium">{KIND_LABELS[item.kind]}</span>
            {reason.verify ? (
              <Link to="/agent-id/verify" className="aid-link text-sm">
                {reason.text}
              </Link>
            ) : (
              <span className="text-sm">{reason.text}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
