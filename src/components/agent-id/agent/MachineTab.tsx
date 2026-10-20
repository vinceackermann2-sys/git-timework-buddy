// The agent's own computer: it keeps the agent's files, starts for work and
// stops after. A terminal to run commands, and its files.
import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, File, Folder, Loader2, Play, Square } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { AgentIdError } from "@/lib/agent-id/client";
import { formatBytes, formatListTime } from "@/lib/agent-id/format";
import {
  queryKeys,
  shouldRetry,
  useEventPages,
  useMachineFiles,
  useRefreshAgent,
} from "@/lib/agent-id/queries";
import { api } from "@/lib/agent-id/session";
import type { Agent, CommandResult } from "@/lib/agent-id/types";
import { Chip, Empty, ErrorState, LoadingRows, ModeBadge, Muted, Section, toastError } from "../ui";
import { BlockedNotice, LoadMore, NoResource, blockedReason } from "./common";

const SIZE_LABELS: Record<string, string> = {
  small: "Small · ½ vCPU · 1 GB",
  medium: "Medium · 1 vCPU · 2 GB",
};
const HOME = "~";

export function MachineTab({ agent }: { agent: Agent }) {
  const vm = agent.resources.vm;
  const blocked = blockedReason(agent, vm?.status === "provisioning" ? undefined : vm);
  const queryClient = useQueryClient();
  const refresh = useRefreshAgent();
  const machine = useQuery({
    queryKey: queryKeys.me(agent.id, "vm"),
    queryFn: async () => (await api.asAgent(agent.id).machine()).machine,
    enabled: !!vm && !blocked,
    retry: shouldRetry,
    refetchInterval: (query) => (query.state.data?.status === "provisioning" ? 10_000 : false),
  });
  const power = useMutation({
    mutationFn: (action: "start" | "stop") =>
      action === "start"
        ? api.asAgent(agent.id).startMachine()
        : api.asAgent(agent.id).stopMachine(),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.me(agent.id, "vm") }),
        refresh(agent.id),
      ]);
    },
    onError: (error) => toastError(error, "The machine didn't respond"),
  });

  if (!vm) return <NoResource agent={agent} kind="vm" />;

  const state = machine.data?.state ?? vm.details.machine ?? "unknown";
  const running = state === "running";
  const live = vm.mode === "live";

  return (
    <div className="space-y-6">
      <BlockedNotice reason={blocked} />
      <section className="aid-card flex flex-col gap-4 p-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className={cn(
                "h-2.5 w-2.5 rounded-full",
                running ? "bg-[var(--aid-success)]" : "bg-[var(--muted-foreground)]/40",
              )}
            />
            <p className="text-lg font-semibold">
              {vm.status === "provisioning"
                ? "Setting up"
                : state.charAt(0).toUpperCase() + state.slice(1)}
            </p>
            <ModeBadge mode={vm.mode} />
          </div>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">
            {SIZE_LABELS[vm.details.size ?? ""] ?? vm.details.size ?? "Machine"} · Your agent's
            files stay on this machine.
          </p>
        </div>
        <Button
          variant="outline"
          disabled={!!blocked || power.isPending}
          onClick={() => power.mutate(running ? "stop" : "start")}
        >
          {power.isPending ? (
            <Loader2 className="animate-spin" aria-hidden="true" />
          ) : running ? (
            <Square aria-hidden="true" />
          ) : (
            <Play aria-hidden="true" />
          )}
          {running ? "Stop" : "Start"}
        </Button>
      </section>
      {machine.isError && <ErrorState error={machine.error} />}

      {live ? (
        <>
          <Terminal agent={agent} disabled={!!blocked || vm.status !== "active"} />
          <Files agent={agent} enabled={!blocked && vm.status === "active"} />
          <History agent={agent} />
        </>
      ) : (
        <>
          <Muted>Test machines don't run commands or keep files.</Muted>
          <History agent={agent} />
        </>
      )}
    </div>
  );
}

// A terminal: the commands run so far (with output), and a prompt.
function Terminal({ agent, disabled }: { agent: Agent; disabled: boolean }) {
  const [command, setCommand] = useState("");
  const [session, setSession] = useState<{ command: string; result: CommandResult }[]>([]);
  const scroller = useRef<HTMLDivElement>(null);
  const refresh = useRefreshAgent();
  const queryClient = useQueryClient();
  const run = useMutation({
    mutationFn: (cmd: string) => api.asAgent(agent.id).runCommand({ command: cmd }),
    onSuccess: async (result, cmd) => {
      setSession((s) => [...s, { command: cmd, result }]);
      setCommand("");
      await Promise.all([
        refresh(agent.id, { events: true }),
        queryClient.invalidateQueries({ queryKey: queryKeys.me(agent.id, "vm-files") }),
      ]);
    },
  });

  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [session.length, run.isPending]);

  return (
    <section className="overflow-hidden rounded-[calc(var(--radius)+4px)] border border-[var(--border)] bg-[#12151c] text-[#e6e9ef]">
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-2 text-xs text-white/60">
        <span>Terminal</span>
        <span className="aid-mono">{agent.handle}</span>
      </div>
      <div
        ref={scroller}
        className="aid-mono max-h-96 min-h-48 overflow-y-auto p-4 text-[13px] leading-relaxed"
      >
        {session.length === 0 && !run.isPending && (
          <p className="text-white/40">Run a command on {agent.name}'s machine.</p>
        )}
        {session.map((entry, i) => (
          <div key={i} className="mb-3">
            <p>
              <span className="text-[#c9a2f0]">$</span> {entry.command}
            </p>
            <pre className="whitespace-pre-wrap break-words text-white/85">
              {entry.result.stdout}
              {entry.result.stderr && <span className="text-[#f28da0]">{entry.result.stderr}</span>}
            </pre>
            {entry.result.exitCode !== 0 && (
              <p className="text-xs text-[#f28da0]">exit {entry.result.exitCode}</p>
            )}
          </div>
        ))}
        {run.isPending && (
          <p className="flex items-center gap-2 text-white/60">
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> Running…
          </p>
        )}
        {run.isError && <p className="text-[#f28da0]">{(run.error as Error).message}</p>}
      </div>
      <form
        className="flex items-center gap-2 border-t border-white/10 px-4 py-2"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          if (command.trim() && !run.isPending) run.mutate(command.trim());
        }}
      >
        <span className="aid-mono text-[#c9a2f0]" aria-hidden="true">
          $
        </span>
        <input
          aria-label="Command"
          className="aid-mono min-w-0 flex-1 bg-transparent text-[13px] text-[#e6e9ef] outline-none placeholder:text-white/30"
          placeholder={disabled ? "The machine isn't ready" : "ls -la"}
          disabled={disabled}
          value={command}
          onChange={(e) => setCommand(e.target.value)}
        />
        <Button type="submit" size="sm" disabled={disabled || !command.trim() || run.isPending}>
          Run
        </Button>
      </form>
    </section>
  );
}

function Files({ agent, enabled }: { agent: Agent; enabled: boolean }) {
  const [path, setPath] = useState(HOME);
  const files = useMachineFiles(agent.id, path, enabled);
  // The machine answers with the full path (~ becomes the home folder).
  const shown = files.data?.path ?? path;
  const parts = shown.split("/").filter(Boolean);
  const unavailable =
    files.error instanceof AgentIdError &&
    (files.error.status === 404 || files.error.status === 409);

  return (
    <Section
      title="Files"
      flush
      actions={
        <nav aria-label="Folder" className="flex flex-wrap items-center gap-0.5 text-sm">
          <button type="button" className="aid-link" onClick={() => setPath("/")}>
            /
          </button>
          {parts.map((part, i) => (
            <span key={i} className="flex items-center gap-0.5">
              {i > 0 && <ChevronRight className="h-3.5 w-3.5 text-[var(--muted-foreground)]" />}
              <button
                type="button"
                className="aid-link"
                onClick={() => setPath("/" + parts.slice(0, i + 1).join("/"))}
              >
                {part}
              </button>
            </span>
          ))}
        </nav>
      }
    >
      {!enabled ? (
        <Empty>Files show when the machine is ready.</Empty>
      ) : files.isPending ? (
        <LoadingRows rows={4} />
      ) : unavailable ? (
        <Empty>Files aren't available for this machine yet.</Empty>
      ) : files.isError ? (
        <ErrorState error={files.error} onRetry={() => void files.refetch()} />
      ) : files.data.entries.length === 0 ? (
        <Empty>This folder is empty.</Empty>
      ) : (
        <ul className="divide-y divide-[var(--border)]" aria-label={`Files in ${files.data.path}`}>
          {[...files.data.entries]
            .sort((a, b) =>
              a.type === b.type ? a.name.localeCompare(b.name) : a.type === "dir" ? -1 : 1,
            )
            .map((entry) => {
              const full = `${files.data.path.replace(/\/$/, "")}/${entry.name}`;
              const inner = (
                <>
                  {entry.type === "dir" ? (
                    <Folder className="h-4 w-4 shrink-0 text-[var(--aid-ink)]" aria-hidden="true" />
                  ) : (
                    <File
                      className="h-4 w-4 shrink-0 text-[var(--muted-foreground)]"
                      aria-hidden="true"
                    />
                  )}
                  <span className="min-w-0 flex-1 truncate text-sm">{entry.name}</span>
                  <span className="shrink-0 text-xs text-[var(--muted-foreground)]">
                    {entry.type === "file" ? formatBytes(entry.size) : ""}
                  </span>
                  <span className="hidden w-24 shrink-0 text-right text-xs text-[var(--muted-foreground)] sm:block">
                    {formatListTime(entry.modifiedAt)}
                  </span>
                </>
              );
              return (
                <li key={entry.name}>
                  {entry.type === "dir" ? (
                    <button
                      type="button"
                      onClick={() => setPath(full)}
                      className="flex w-full items-center gap-3 px-5 py-2.5 text-left hover:bg-[var(--muted)]"
                    >
                      {inner}
                    </button>
                  ) : (
                    <div className="flex items-center gap-3 px-5 py-2.5">{inner}</div>
                  )}
                </li>
              );
            })}
        </ul>
      )}
    </Section>
  );
}

// Every command run on the machine, with its output.
function History({ agent }: { agent: Agent }) {
  const pages = useEventPages(agent.id, { kind: ["vm"] });
  const events = pages.data?.pages.flatMap((p) => p.events) ?? [];
  return (
    <Section title="Commands" flush>
      {pages.isPending ? (
        <LoadingRows rows={2} />
      ) : events.length === 0 ? (
        <Empty>No commands yet.</Empty>
      ) : (
        <>
          <ul className="divide-y divide-[var(--border)]">
            {events.map((e) => (
              <li key={e.id} className="px-5 py-2.5">
                <details>
                  <summary className="flex cursor-pointer items-center justify-between gap-3">
                    <code className="aid-mono min-w-0 truncate text-sm">$ {e.subject}</code>
                    <span className="flex shrink-0 items-center gap-2">
                      {e.status !== "completed" && (
                        <Chip tone="danger">
                          {e.status === "exited"
                            ? `exit ${String(e.data["exitCode"] ?? "")}`
                            : e.status}
                        </Chip>
                      )}
                      <span className="text-xs text-[var(--muted-foreground)]">
                        {formatListTime(e.at)}
                      </span>
                    </span>
                  </summary>
                  <pre className="aid-code mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words p-3">
                    {e.text || "(no output)"}
                  </pre>
                </details>
              </li>
            ))}
          </ul>
          <LoadMore
            hasMore={pages.hasNextPage}
            loading={pages.isFetchingNextPage}
            onClick={() => void pages.fetchNextPage()}
          />
        </>
      )}
    </Section>
  );
}
