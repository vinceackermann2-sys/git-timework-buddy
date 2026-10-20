import { Link } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { counterpartyLabel, formatCents } from "@/lib/agent-id/format";
import { queryKeys } from "@/lib/agent-id/queries";
import { api } from "@/lib/agent-id/session";
import type { Approval } from "@/lib/agent-id/types";
import { Row, Rows, TimeAgo, toastError } from "./ui";

export const approvalAmount = (a: Approval) =>
  typeof a.request.amount === "number" ? formatCents(a.request.amount, a.request.currency) : "—";

// Transfers waiting for the owner, each with Approve and Deny.
export function PendingApprovals({ approvals }: { approvals: Approval[] }) {
  return (
    <Rows label="Waiting for approval">
      {approvals.map((a) => (
        <PendingRow key={a.id} approval={a} />
      ))}
    </Rows>
  );
}

function PendingRow({ approval }: { approval: Approval }) {
  const queryClient = useQueryClient();
  const decide = useMutation({
    mutationFn: (decision: "approve" | "deny") => api.decideApproval(approval.id, decision),
    onSuccess: async (_result, decision) => {
      toast.success(
        decision === "approve" ? `Sent ${approvalAmount(approval)}` : "Transfer denied",
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
    <Row>
      <div className="min-w-0">
        <p className="text-sm">
          <span className="font-semibold">{approvalAmount(approval)}</span>
          <span className="text-[var(--muted-foreground)]"> from </span>
          <Link
            to="/agent-id/agents/$agentId"
            params={{ agentId: approval.agentId }}
            search={{ tab: "wallet" }}
            className="aid-link font-medium"
          >
            {approval.agentName ?? approval.agentId}
          </Link>
          <span className="text-[var(--muted-foreground)]"> to </span>
          <span className="break-all" title={approval.request.to}>
            {counterpartyLabel(approval.request.to)}
          </span>
        </p>
        <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">
          {approval.request.memo ? `“${approval.request.memo}” · ` : ""}
          <TimeAgo iso={approval.createdAt} />
        </p>
      </div>
      <div className="flex shrink-0 gap-2">
        <Button
          size="sm"
          variant="ghost"
          disabled={decide.isPending}
          onClick={() => decide.mutate("deny")}
        >
          Deny
        </Button>
        <Button
          size="sm"
          variant="outline"
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
    </Row>
  );
}
