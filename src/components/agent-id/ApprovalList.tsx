import { useEffect, useRef } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { counterpartyLabel, formatCents } from "@/lib/agent-id/format";
import { queryKeys, useAgents } from "@/lib/agent-id/queries";
import { api } from "@/lib/agent-id/session";
import type { Approval, AskKind } from "@/lib/agent-id/types";
import { cn } from "@/lib/utils";
import { AgentAvatar, Rows, TimeAgo, toastError } from "./ui";

export const approvalAmount = (a: Approval) =>
  typeof a.request.amount === "number" ? formatCents(a.request.amount, a.request.currency) : "—";

// What an action the owner asked to approve first would do.
const ACTION_VERBS: Record<AskKind, string> = {
  mail: "send an email",
  sms: "send a text",
  call: "make a call",
  contacts: "change its contacts",
  vault: "save to its vault",
};
const ACTION_TABS = {
  mail: "mail",
  sms: "phone",
  call: "phone",
  contacts: "phone",
  vault: "vault",
} as const;
const text = (value: unknown) => (typeof value === "string" ? value : "");
const list = (value: unknown) => (Array.isArray(value) ? value.join(", ") : text(value));

// In a few words, for a notice: "send $25.00" or "send an email to bob@…".
export function approvalText(a: Approval) {
  if (a.kind !== "action") return `send ${approvalAmount(a)}`;
  const to = list(a.request.summary?.["to"]);
  return `${ACTION_VERBS[a.request.kind ?? "mail"] ?? "do something"}${to ? ` to ${to}` : ""}`;
}

function ActionDetail({ approval }: { approval: Approval }) {
  const s = approval.request.summary ?? {};
  const to = list(s["to"]);
  const kind = approval.request.kind;
  const quote =
    kind === "mail"
      ? text(s["preview"])
      : kind === "sms"
        ? text(s["text"])
        : kind === "call"
          ? text(s["say"])
          : "";
  return (
    <>
      <p className="mt-0.5 break-words text-[15px]">
        {kind === "mail" && <span className="font-semibold">{text(s["subject"])}</span>}
        {kind === "contacts" && (
          <span className="font-semibold">
            {text(s["change"]) === "delete"
              ? "Remove"
              : text(s["change"]) === "update"
                ? "Change"
                : "Add"}{" "}
            {text(s["name"]) || "a contact"}
          </span>
        )}
        {kind === "vault" && <span className="font-semibold">{text(s["label"])}</span>}
        {to && (
          <span className="text-[var(--muted-foreground)]">
            {kind === "mail" ? " to " : "To "}
            <span className="font-medium text-[var(--foreground)]">{to}</span>
          </span>
        )}
      </p>
      {quote && (
        <p className="mt-1 line-clamp-3 whitespace-pre-wrap break-words text-sm text-[var(--muted-foreground)]">
          “{quote}”
        </p>
      )}
    </>
  );
}

// Payments, and actions the owner asked to approve first, waiting for the
// owner, each with Approve and Decline, like a bank app asks to confirm a
// payment.
export function PendingApprovals({
  approvals,
  highlight,
}: {
  approvals: Approval[];
  highlight?: string | undefined;
}) {
  return (
    <Rows label="Waiting for you">
      {approvals.map((a) => (
        <PendingRow key={a.id} approval={a} highlighted={a.id === highlight} />
      ))}
    </Rows>
  );
}

function PendingRow({
  approval,
  highlighted = false,
}: {
  approval: Approval;
  highlighted?: boolean;
}) {
  const row = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (highlighted) row.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [highlighted]);
  const queryClient = useQueryClient();
  const agentName = approval.agentName ?? "Your agent";
  // Its face, as on the agent's own page.
  const mascot = useAgents().data?.find((a) => a.id === approval.agentId)?.mascot;
  const decide = useMutation({
    mutationFn: (decision: "approve" | "deny") => api.decideApproval(approval.id, decision),
    onSuccess: async (_result, decision) => {
      toast.success(
        approval.kind === "action"
          ? decision === "approve"
            ? "Approved and done"
            : "Declined"
          : decision === "approve"
            ? `Sent ${approvalAmount(approval)}`
            : "Payment declined",
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.approvals }),
        queryClient.invalidateQueries({ queryKey: ["agent-id", "events"] }),
        queryClient.invalidateQueries({ queryKey: ["agent-id", "me"] }),
        queryClient.invalidateQueries({ queryKey: queryKeys.agents }),
        queryClient.invalidateQueries({ queryKey: queryKeys.agent(approval.agentId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.audit(approval.agentId) }),
      ]);
    },
    onError: async (error) => {
      toastError(error, "Couldn't complete that");
      await queryClient.invalidateQueries({ queryKey: queryKeys.approvals });
    },
  });

  return (
    <li
      ref={row}
      className={cn(
        "flex flex-col gap-4 px-5 py-4 sm:flex-row sm:items-center",
        highlighted && "bg-[var(--accent)]",
      )}
    >
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <AgentAvatar mascot={mascot} id={approval.agentId} size="md" />
        <div className="min-w-0">
          <p className="text-sm text-[var(--muted-foreground)]">
            <Link
              to="/agent-id/agents/$agentId"
              params={{ agentId: approval.agentId }}
              search={{
                tab:
                  approval.kind === "action"
                    ? ACTION_TABS[approval.request.kind ?? "mail"]
                    : "wallet",
              }}
              className="aid-link font-medium"
            >
              {agentName}
            </Link>{" "}
            wants to{" "}
            {approval.kind === "action"
              ? (ACTION_VERBS[approval.request.kind ?? "mail"] ?? "do something")
              : "send"}
          </p>
          {approval.kind === "action" ? (
            <ActionDetail approval={approval} />
          ) : (
            <p className="mt-0.5 break-words text-[15px]">
              <span className="text-lg font-semibold tabular-nums">{approvalAmount(approval)}</span>
              <span className="text-[var(--muted-foreground)]"> to </span>
              <span className="font-medium" title={approval.request.to}>
                {counterpartyLabel(approval.request.to)}
              </span>
            </p>
          )}
          <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">
            {approval.request.memo ? `“${approval.request.memo}” · ` : ""}
            <TimeAgo iso={approval.createdAt} />
          </p>
        </div>
      </div>
      <div className="flex shrink-0 gap-2 sm:pl-4">
        <Button
          variant="outline"
          className="flex-1 sm:flex-none"
          disabled={decide.isPending}
          onClick={() => decide.mutate("deny")}
        >
          {decide.isPending && decide.variables === "deny" && (
            <Loader2 className="animate-spin" aria-hidden="true" />
          )}
          Decline
        </Button>
        <Button
          className="flex-1 sm:flex-none"
          disabled={decide.isPending}
          onClick={() => decide.mutate("approve")}
        >
          {decide.isPending && decide.variables === "approve" ? (
            <Loader2 className="animate-spin" aria-hidden="true" />
          ) : (
            <Check aria-hidden="true" />
          )}
          Approve
        </Button>
      </div>
    </li>
  );
}
