import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";

import { PendingApprovals, approvalAmount } from "@/components/agent-id/ApprovalList";
import {
  Chip,
  Empty,
  ErrorState,
  LoadingRows,
  PageHeader,
  Row,
  Rows,
  Section,
  TimeAgo,
} from "@/components/agent-id/ui";
import { counterpartyLabel } from "@/lib/agent-id/format";
import { queryKeys, shouldRetry, useApprovals } from "@/lib/agent-id/queries";
import { api } from "@/lib/agent-id/session";
import type { Approval } from "@/lib/agent-id/types";

export const Route = createFileRoute("/agent-id/_app/approvals")({
  head: () => ({ meta: [{ title: "Approvals · Agent ID" }] }),
  component: ApprovalsPage,
});

const OUTCOMES: Record<Approval["status"], [string, "success" | "danger" | "neutral"]> = {
  completed: ["Sent", "success"],
  approved: ["Approved", "success"],
  denied: ["Declined", "neutral"],
  failed: ["Failed", "danger"],
  pending: ["Pending", "neutral"],
};

function ApprovalsPage() {
  const pending = useApprovals();
  const history = useQuery({
    queryKey: [...queryKeys.approvals, "all"],
    queryFn: async () => (await api.approvals("all")).approvals,
    retry: shouldRetry,
  });
  const decided = (history.data ?? []).filter((a) => a.status !== "pending");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Approvals"
        meta="Payments your agents want to make above the limit you set."
      />
      <Section title="Waiting for you" flush>
        {pending.isPending ? (
          <LoadingRows rows={2} />
        ) : pending.isError ? (
          <ErrorState error={pending.error} onRetry={() => void pending.refetch()} />
        ) : pending.data.length === 0 ? (
          <Empty>Nothing waiting for you.</Empty>
        ) : (
          <PendingApprovals approvals={pending.data} />
        )}
      </Section>

      {decided.length > 0 && (
        <Section title="History" flush>
          <Rows label="History">
            {decided.map((a) => {
              const [label, tone] =
                a.status === "denied" && a.reason === "expired"
                  ? (["Expired", "neutral"] as const)
                  : OUTCOMES[a.status];
              return (
                <Row key={a.id}>
                  <p className="min-w-0 break-words text-sm">
                    <span className="font-semibold">{approvalAmount(a)}</span>
                    <span className="text-[var(--muted-foreground)]"> from </span>
                    {a.agentName ?? a.agentId}
                    <span className="text-[var(--muted-foreground)]"> to </span>
                    {counterpartyLabel(a.request.to)}
                  </p>
                  <span className="flex shrink-0 items-center gap-2 text-xs text-[var(--muted-foreground)]">
                    <Chip tone={tone}>{label}</Chip>
                    <TimeAgo iso={a.decidedAt ?? a.createdAt} />
                  </span>
                </Row>
              );
            })}
          </Rows>
        </Section>
      )}
    </div>
  );
}
