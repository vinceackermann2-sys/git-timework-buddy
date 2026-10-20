import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Empty,
  ErrorState,
  LoadingRows,
  PageHeader,
  Row,
  Rows,
  Section,
  TimeAgo,
  toastError,
} from "@/components/agent-id/ui";
import { Operator } from "@/components/agent-id/Operator";
import { queryKeys, useAccount, useReviews } from "@/lib/agent-id/queries";
import { api } from "@/lib/agent-id/session";

export const Route = createFileRoute("/agent-id/_app/reviews")({
  head: () => ({ meta: [{ title: "Review queue · Agent ID" }] }),
  component: ReviewsPage,
});

function ReviewsPage() {
  const account = useAccount();
  const reviewer = account.data?.reviewer === true;
  const reviews = useReviews(reviewer);
  const people = reviews.data?.people ?? [];
  const businesses = reviews.data?.businesses ?? [];

  return (
    <div className="space-y-6">
      <PageHeader title="Review queue" meta="Staff only." />
      {account.isPending || (reviewer && reviews.isPending) ? (
        <Section flush>
          <LoadingRows rows={3} />
        </Section>
      ) : !reviewer ? (
        <Section flush>
          <Empty>Only Agent ID reviewers can see this.</Empty>
        </Section>
      ) : reviews.isError ? (
        <Section flush>
          <ErrorState error={reviews.error} onRetry={() => void reviews.refetch()} />
        </Section>
      ) : (
        <>
          <Operator />
          <Section title="People" flush>
            {people.length === 0 ? (
              <Empty>Nothing to review.</Empty>
            ) : (
              <Rows label="People">
                {people.map((p) => (
                  <ReviewRow
                    key={p.userId}
                    kind="person"
                    id={p.userId}
                    title={p.legalName ?? "—"}
                    detail={[p.country, p.userId].filter(Boolean).join(" · ")}
                    submittedAt={p.submittedAt}
                  />
                ))}
              </Rows>
            )}
          </Section>
          <Section title="Businesses" flush>
            {businesses.length === 0 ? (
              <Empty>Nothing to review.</Empty>
            ) : (
              <Rows label="Businesses">
                {businesses.map((b) => (
                  <ReviewRow
                    key={b.organizationId}
                    kind="business"
                    id={b.organizationId}
                    title={b.legalName ?? "—"}
                    detail={[b.registrationNumber, b.country, b.website]
                      .filter(Boolean)
                      .join(" · ")}
                    submittedAt={b.submittedAt}
                  />
                ))}
              </Rows>
            )}
          </Section>
        </>
      )}
    </div>
  );
}

function ReviewRow({
  kind,
  id,
  title,
  detail,
  submittedAt,
}: {
  kind: "person" | "business";
  id: string;
  title: string;
  detail: string;
  submittedAt: string;
}) {
  const [note, setNote] = useState("");
  const queryClient = useQueryClient();
  const decide = useMutation({
    mutationFn: (decision: "approve" | "reject") =>
      api.decideReview(kind, id, decision, note.trim() || undefined),
    onSuccess: async (_r, decision) => {
      toast.success(decision === "approve" ? `${title} verified` : `${title} rejected`);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.reviews }),
        queryClient.invalidateQueries({ queryKey: queryKeys.account }),
        queryClient.invalidateQueries({ queryKey: ["agent-id", "agent"] }),
      ]);
    },
    onError: (error) => toastError(error, "Couldn't record the decision"),
  });

  return (
    <Row className="sm:items-start">
      <div className="min-w-0">
        <p className="text-sm font-medium">{title}</p>
        <p className="aid-mono break-all text-xs text-[var(--muted-foreground)]">{detail}</p>
        <TimeAgo iso={submittedAt} className="text-xs text-[var(--muted-foreground)]" />
      </div>
      <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
        <Input
          aria-label={`Note for ${title}`}
          placeholder="Note (shown if rejected)"
          className="h-8 sm:w-56"
          value={note}
          maxLength={1000}
          onChange={(e) => setNote(e.target.value)}
        />
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="ghost"
            disabled={decide.isPending}
            onClick={() => decide.mutate("reject")}
          >
            Reject
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={decide.isPending}
            onClick={() => decide.mutate("approve")}
          >
            {decide.isPending && decide.variables === "approve" && (
              <Loader2 className="animate-spin" aria-hidden="true" />
            )}
            Approve
          </Button>
        </div>
      </div>
    </Row>
  );
}
