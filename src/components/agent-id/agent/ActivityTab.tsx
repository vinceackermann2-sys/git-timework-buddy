import { useState } from "react";

import { Button } from "@/components/ui/button";
import { ACTOR_LABELS, auditActionLabel, auditDetail } from "@/lib/agent-id/format";
import { useAudit } from "@/lib/agent-id/queries";
import type { Agent } from "@/lib/agent-id/types";
import { Empty, ErrorState, LoadingRows, Row, Rows, Section, TimeAgo } from "../ui";

// Everything done by or for the agent, newest first.
export function ActivityTab({ agent }: { agent: Agent }) {
  const audit = useAudit(agent.id, 200);
  const [all, setAll] = useState(false);
  const entries = audit.data ?? [];
  const shown = all ? entries : entries.slice(0, 25);

  return (
    <Section flush>
      {audit.isPending ? (
        <LoadingRows rows={4} />
      ) : audit.isError ? (
        <ErrorState error={audit.error} onRetry={() => void audit.refetch()} />
      ) : entries.length === 0 ? (
        <Empty>Nothing yet.</Empty>
      ) : (
        <>
          <Rows label="Activity">
            {shown.map((entry) => {
              const detail = auditDetail(entry);
              return (
                <Row key={entry.id}>
                  <div className="min-w-0">
                    <p className="text-sm">
                      {auditActionLabel(entry.action)}
                      <span className="text-[var(--muted-foreground)]">
                        {" "}
                        · {ACTOR_LABELS[entry.actor]}
                      </span>
                    </p>
                    {detail && (
                      <p className="break-words text-xs text-[var(--muted-foreground)]">{detail}</p>
                    )}
                  </div>
                  <TimeAgo
                    iso={entry.at}
                    className="shrink-0 text-xs text-[var(--muted-foreground)]"
                  />
                </Row>
              );
            })}
          </Rows>
          {entries.length > 25 && (
            <div className="flex justify-center border-t border-[var(--border)] p-3">
              <Button variant="ghost" size="sm" onClick={() => setAll((v) => !v)}>
                {all ? "Show less" : `Show all ${entries.length}`}
              </Button>
            </div>
          )}
        </>
      )}
    </Section>
  );
}
