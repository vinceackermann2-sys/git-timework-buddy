// An agent's automations, as Timewarp reports them from the computer that runs
// them. Pausing, resuming or running one now waits until Timewarp on that
// computer picks it up; until then the list is looked at again every few seconds.
import type { ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  eventStatusLabel,
  eventStatusTone,
  formatDateTime,
  formatNextRun,
  formatRelativeTime,
} from "@/lib/agent-id/format";
import { queryKeys, useAutomations } from "@/lib/agent-id/queries";
import { api } from "@/lib/agent-id/session";
import type {
  Agent,
  AgentAutomations,
  Automation,
  AutomationAction,
  AutomationRequest,
} from "@/lib/agent-id/types";
import { Empty, ErrorState, LoadingRows, Section, toastError } from "../ui";

const ACTION_LABELS: Record<AutomationAction, string> = {
  pause: "Pause",
  resume: "Resume",
  run: "Run now",
};

export function AutomationsTab({ agent }: { agent: Agent }) {
  const automations = useAutomations(agent.id);
  const queryClient = useQueryClient();
  const key = queryKeys.automations(agent.id);
  const ask = useMutation({
    mutationFn: ({ automation, action }: { automation: Automation; action: AutomationAction }) =>
      api.automationRequest(agent.id, automation.id, action),
    onSuccess: async ({ request }) => {
      queryClient.setQueryData<AgentAutomations>(key, (data) =>
        data && !data.pending.some((p) => p.id === request.id)
          ? { ...data, pending: [...data.pending, request] }
          : data,
      );
      await queryClient.invalidateQueries({ queryKey: key });
    },
    onError: (error) => toastError(error, "Couldn't ask Timewarp"),
  });

  if (automations.isPending)
    return (
      <Section>
        <LoadingRows rows={3} />
      </Section>
    );
  if (automations.isError)
    return (
      <Section>
        <ErrorState error={automations.error} onRetry={() => void automations.refetch()} />
      </Section>
    );

  const { automations: list, pending } = automations.data;
  const revoked = agent.status === "revoked";

  return (
    <Section title="Automations" flush>
      {list.length === 0 ? (
        <Empty icon={CalendarClock}>
          Automations are made in Timewarp, for example by asking {agent.name} for one.
        </Empty>
      ) : (
        <ul className="divide-y divide-[var(--border)]" aria-label="Automations">
          {list.map((automation) => {
            const waiting = pending.filter((p) => p.automationId === automation.id);
            const asking = (action: AutomationAction) =>
              ask.isPending &&
              ask.variables?.automation.id === automation.id &&
              ask.variables.action === action;
            const button = (action: AutomationAction, variant: "ghost" | "outline") => (
              <Button
                size="sm"
                variant={variant}
                disabled={
                  revoked || ask.isPending || waiting.some((request) => request.action === action)
                }
                onClick={() => ask.mutate({ automation, action })}
              >
                {asking(action) && <Loader2 className="animate-spin" aria-hidden="true" />}
                {ACTION_LABELS[action]}
              </Button>
            );
            return (
              <li
                key={automation.id}
                className="flex flex-col gap-3 px-5 py-3 sm:flex-row sm:items-center"
              >
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[var(--muted)] text-[var(--muted-foreground)]">
                    <CalendarClock className="h-4 w-4" aria-hidden="true" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{automation.name}</span>
                    <span className="block text-xs text-[var(--muted-foreground)]">
                      {details(automation)}
                    </span>
                    {waiting.map((request) => (
                      <Waiting key={request.id} request={request} device={automation.device} />
                    ))}
                  </span>
                </div>
                <div className="flex shrink-0 gap-1 pl-12 sm:pl-0">
                  {button(automation.enabled ? "pause" : "resume", "ghost")}
                  {button("run", "outline")}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}

// "Weekdays at 08:30 · Next run in 3 h · Last run completed yesterday · on DESK-PC"
function details(automation: Automation): ReactNode {
  const parts: ReactNode[] = [];
  const summary = automation.enabled ? automation.summary : "Paused";
  if (summary) parts.push(summary);
  if (automation.enabled && automation.nextRunAt)
    parts.push(
      <time
        dateTime={automation.nextRunAt}
        title={formatDateTime(automation.nextRunAt)}
        suppressHydrationWarning
      >
        Next run {formatNextRun(automation.nextRunAt)}
      </time>,
    );
  const last = lastRun(automation.lastRun);
  if (last) parts.push(last);
  if (automation.device) parts.push(`on ${automation.device}`);
  return parts.map((part, i) => (
    <span key={i}>
      {i > 0 && " · "}
      {part}
    </span>
  ));
}

function lastRun(run: Automation["lastRun"]): ReactNode {
  if (!run || (!run.status && !run.at)) return null;
  if (run.status === "running") return "Running now";
  if (run.status === "queued") return "Queued to run";
  const status = run.status ? `${eventStatusLabel(run.status).toLowerCase()} ` : "";
  const text = `Last run ${status}${run.at ? formatRelativeTime(run.at) : ""}`.trim();
  return (
    <span
      title={run.at ? formatDateTime(run.at) : undefined}
      className={cn(
        run.status && eventStatusTone(run.status) === "danger" && "text-[var(--aid-danger)]",
      )}
      suppressHydrationWarning
    >
      {text}
    </span>
  );
}

function Waiting({ request, device }: { request: AutomationRequest; device: string | null }) {
  return (
    <span className="mt-1 flex items-center gap-1.5 text-xs text-[var(--aid-warning)]">
      <Loader2 className="h-3 w-3 shrink-0 animate-spin" aria-hidden="true" />
      {ACTION_LABELS[request.action]}: waiting for Timewarp{device ? ` on ${device}` : ""}
    </span>
  );
}
