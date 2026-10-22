// What an agent remembers, in every app it works in (Claude Code, Codex,
// Cursor…): saved by the agent, brought from those apps by the CLI, or added
// here. Agent ID keeps it encrypted; the owner reads, edits and forgets it.
import { useMemo, useState } from "react";
import type { FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { appLabel } from "@/lib/agent-id/apps";
import { errorMessage } from "@/lib/agent-id/client";
import { formatRelativeTime, modelLabel } from "@/lib/agent-id/format";
import { queryKeys, shouldRetry } from "@/lib/agent-id/queries";
import { api } from "@/lib/agent-id/session";
import type { Agent, Memory } from "@/lib/agent-id/types";
import { AppIcon } from "../AppIcons";
import {
  CommandLine,
  ConfirmButton,
  ErrorState,
  LoadingRows,
  Muted,
  Notice,
  Section,
  toastError,
} from "../ui";

export const memoryKey = (agentId: string) => [...queryKeys.agent(agentId), "memory"] as const;
export const useMemories = (agentId: string) =>
  useQuery({
    queryKey: memoryKey(agentId),
    queryFn: () => api.memories(agentId),
    retry: shouldRetry,
  });

const IMPORT_COMMAND = "npx @timewarp/agent-id memory import";

// Who it came from, in a few words.
function origin(memory: Memory) {
  const parts: string[] = [];
  if (memory.source === "owner") parts.push("Added by you");
  else if (memory.source === "import" && memory.from) parts.push(`From ${appLabel(memory.from)}`);
  else if (memory.from) parts.push(`In ${appLabel(memory.from)}`);
  if (memory.model) parts.push(modelLabel(memory.model));
  parts.push(formatRelativeTime(memory.updatedAt || memory.createdAt));
  return parts.join(" · ");
}

export function MemoryTab({ agent }: { agent: Agent }) {
  const memories = useMemories(agent.id);
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const list = useMemo(() => memories.data?.memories ?? [], [memories.data]);
  const shown = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return list;
    return list.filter((m) =>
      words.every((word) => `${m.text ?? ""} ${m.topic ?? ""}`.toLowerCase().includes(word)),
    );
  }, [list, query]);
  const reload = () => queryClient.invalidateQueries({ queryKey: memoryKey(agent.id) });

  const forget = useMutation({
    mutationFn: (memory: Memory) => api.forgetMemory(agent.id, memory.id),
    onSuccess: async () => {
      toast.success("Forgotten");
      await reload();
    },
    onError: (error) => toastError(error),
  });
  const forgetAll = useMutation({
    mutationFn: () => api.forgetAllMemories(agent.id),
    onSuccess: async () => {
      toast.success("Memory cleared");
      await reload();
    },
    onError: (error) => toastError(error),
  });

  if (memories.isPending) return <LoadingRows rows={4} />;
  if (memories.isError)
    return <ErrorState error={memories.error} onRetry={() => void memories.refetch()} />;

  const active = agent.status === "active";
  return (
    <Section
      title="Memory"
      actions={
        active && (
          <>
            {list.length > 0 && (
              <ConfirmButton
                title="Forget everything?"
                description={`${agent.name} forgets all ${list.length} memories, in every app.`}
                confirmLabel="Forget all"
                onConfirm={() => forgetAll.mutateAsync()}
              >
                Forget all
              </ConfirmButton>
            )}
            <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
              <Plus aria-hidden="true" /> Add
            </Button>
          </>
        )
      }
      flush
    >
      <p className="px-5 pt-4 text-sm text-[var(--muted-foreground)]">
        What {agent.name} remembers in every app it works in. Kept encrypted, and never keys or
        passwords: those go in its vault.
      </p>
      {adding && (
        <div className="px-5 pt-4">
          <MemoryForm
            agent={agent}
            onDone={async () => {
              setAdding(false);
              await reload();
            }}
            onCancel={() => setAdding(false)}
          />
        </div>
      )}
      {list.length > 5 && (
        <div className="px-5 pt-4">
          <Input
            type="search"
            aria-label="Search memories"
            placeholder="Search memories"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      )}
      {list.length === 0 ? (
        <div className="grid gap-3 px-5 pb-6 pt-4">
          <p className="text-sm">Nothing remembered yet.</p>
          <Muted>
            On the computer {agent.name} works on, this brings what Claude Code, Codex, Cursor and
            Antigravity already remember (it asks first, and leaves keys and passwords out):
          </Muted>
          <CommandLine command={IMPORT_COMMAND} primary={false} />
        </div>
      ) : shown.length === 0 ? (
        <p className="px-5 pb-6 pt-4 text-sm">Nothing matches “{query}”.</p>
      ) : (
        <ul className="mt-3 divide-y divide-[var(--border)] border-t border-[var(--border)]">
          {shown.map((memory) => (
            <li key={memory.id} className="flex items-start gap-3 px-5 py-3">
              {memory.from && memory.source !== "owner" ? (
                <AppIcon app={memory.from} size="xs" className="mt-0.5" />
              ) : (
                <span className="mt-0.5 inline-block h-5 w-5 shrink-0" aria-hidden="true" />
              )}
              <div className="min-w-0 flex-1">
                {editing === memory.id ? (
                  <MemoryForm
                    agent={agent}
                    memory={memory}
                    onDone={async () => {
                      setEditing(null);
                      await reload();
                    }}
                    onCancel={() => setEditing(null)}
                  />
                ) : (
                  <>
                    {memory.topic && (
                      <p className="text-xs font-medium text-[var(--muted-foreground)]">
                        {memory.topic}
                      </p>
                    )}
                    <p className="whitespace-pre-wrap break-words text-sm">
                      {memory.text ?? memory.note}
                    </p>
                    <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">
                      {origin(memory)}
                    </p>
                  </>
                )}
              </div>
              {active && editing !== memory.id && (
                <div className="flex shrink-0 gap-1">
                  {memory.text !== null && (
                    <Button size="sm" variant="ghost" onClick={() => setEditing(memory.id)}>
                      Edit
                    </Button>
                  )}
                  <ConfirmButton
                    title="Forget this?"
                    description={`${agent.name} won't remember it in any app.`}
                    confirmLabel="Forget"
                    onConfirm={() => forget.mutateAsync(memory)}
                  >
                    Forget
                  </ConfirmButton>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function MemoryForm({
  agent,
  memory,
  onDone,
  onCancel,
}: {
  agent: Agent;
  memory?: Memory;
  onDone: () => void | Promise<void>;
  onCancel: () => void;
}) {
  const [text, setText] = useState(memory?.text ?? "");
  const [topic, setTopic] = useState(memory?.topic ?? "");
  const save = useMutation({
    mutationFn: () => {
      const input = { text: text.trim(), ...(topic.trim() ? { topic: topic.trim() } : {}) };
      return memory ? api.editMemory(agent.id, memory.id, input) : api.addMemory(agent.id, input);
    },
    onSuccess: async () => {
      toast.success(memory ? "Saved" : "Remembered");
      await onDone();
    },
  });
  return (
    <form
      className="grid gap-2"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        if (text.trim()) save.mutate();
      }}
    >
      <Textarea
        aria-label="Memory"
        placeholder={`Something ${agent.name} should remember`}
        value={text}
        maxLength={4000}
        rows={3}
        autoFocus
        onChange={(e) => setText(e.target.value)}
      />
      <Input
        aria-label="Topic"
        placeholder="Topic (optional)"
        value={topic}
        maxLength={80}
        onChange={(e) => setTopic(e.target.value)}
      />
      {save.isError && <Notice tone="danger">{errorMessage(save.error)}</Notice>}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={!text.trim() || save.isPending}>
          {save.isPending && <Loader2 className="animate-spin" aria-hidden="true" />}
          {memory ? "Save" : "Remember"}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
