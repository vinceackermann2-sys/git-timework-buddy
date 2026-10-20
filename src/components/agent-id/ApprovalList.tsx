import { Link } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { counterpartyLabel, formatCents } from "@/lib/agent-id/format";
import { queryKeys } from "@/lib/agent-id/queries";
import { api } from "@/lib/agent-id/session";
import type { Approval } from "@/lib/agent-id/types";
import { Avatar, Rows, TimeAgo, toastError } from "./ui";

export const approvalAmount = (a: Approval) =>
  typeof a.request.amount === "number" ? formatCents(a.request.amount, a.request.currency) : "—";

// Payments waiting for the owner, each with Approve and Decline, like a
// bank app asks to confirm a payment.
export function PendingApprovals({ approvals }: { approvals: Approval[] }) {
  return (
    <Rows label="Waiting for you">
      {approvals.map((a) => (
        <PendingRow key={a.id} approval={a} />
      ))}
    </Rows>
  );
}

function PendingRow({ approval }: { approval: Approval }) {
  const queryClient = useQueryClient();
  const agentName = approval.agentName ?? "Your agent";
  const decide = useMutation({
    mutationFn: (decision: "approve" | "deny") => api.decideApproval(approval.id, decision),
    onSuccess: async (_result, decision) => {
      toast.success(
        decision === "approve" ? `Sent ${approvalAmount(approval)}` : "Payment declined",
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
    <li className="flex flex-col gap-4 px-5 py-4 sm:flex-row sm:items-center">
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <Avatar name={agentName} size="md" />
        <div className="min-w-0">
          <p className="text-sm text-[var(--muted-foreground)]">
            <Link
              to="/agent-id/agents/$agentId"
              params={{ agentId: approval.agentId }}
              search={{ tab: "wallet" }}
              className="aid-link font-medium"
            >
              {agentName}
            </Link>{" "}
            wants to send
          </p>
          <p className="mt-0.5 break-words text-[15px]">
            <span className="text-lg font-semibold tabular-nums">{approvalAmount(approval)}</span>
            <span className="text-[var(--muted-foreground)]"> to </span>
            <span className="font-medium" title={approval.request.to}>
              {counterpartyLabel(approval.request.to)}
            </span>
          </p>
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
