// The agent's phone: texts as conversations, recent calls, and contacts.
import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Loader2,
  MessageSquarePlus,
  Phone,
  PhoneIncoming,
  PhoneMissed,
  PhoneOutgoing,
  Send,
  Voicemail,
} from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { errorMessage } from "@/lib/agent-id/client";
import {
  callKind,
  conversations,
  formatDuration,
  formatListTime,
  type CallKind,
} from "@/lib/agent-id/format";
import { useContacts, useEventPages } from "@/lib/agent-id/queries";
import { api } from "@/lib/agent-id/session";
import type { Agent, AgentEvent } from "@/lib/agent-id/types";
import {
  Avatar,
  CopyButton,
  Empty,
  ErrorState,
  Field,
  LoadingRows,
  ModeBadge,
  Notice,
  Row,
  Rows,
  Section,
  Segmented,
  toastError,
} from "../ui";
import { Contacts } from "./Contacts";
import { BlockedNotice, LoadMore, NoResource, blockedReason } from "./common";

type View = "messages" | "calls" | "contacts";

export function PhoneTab({ agent }: { agent: Agent }) {
  const phone = agent.resources.phone;
  const [view, setView] = useState<View>("messages");
  if (!phone) return <NoResource agent={agent} kind="phone" />;
  const blocked = blockedReason(agent, phone);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented
          label="Phone"
          value={view}
          onChange={setView}
          options={[
            { value: "messages", label: "Messages" },
            { value: "calls", label: "Calls" },
            { value: "contacts", label: "Contacts" },
          ]}
        />
        <span className="flex items-center gap-1 text-sm">
          <span className="aid-mono">{phone.address}</span>
          {phone.address && (
            <CopyButton text={phone.address} iconOnly variant="ghost" label="Copy number" />
          )}
          <ModeBadge mode={phone.mode} />
        </span>
      </div>
      <BlockedNotice reason={blocked} />
      {view === "messages" && <Messages agent={agent} disabled={!!blocked} />}
      {view === "calls" && <Calls agent={agent} disabled={!!blocked} />}
      {view === "contacts" && (
        <Section flush>
          <Contacts agent={agent} canEdit={!blockedReason(agent)} />
        </Section>
      )}
    </div>
  );
}

// --- Messages -----------------------------------------------------------------------------

function Messages({ agent, disabled }: { agent: Agent; disabled: boolean }) {
  const pages = useEventPages(agent.id, { kind: ["sms"] }, { limit: 100 });
  const contacts = useContacts(agent.id);
  const [open, setOpen] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);
  const threads = useMemo(
    () => conversations(pages.data?.pages.flatMap((p) => p.events) ?? [], contacts.data ?? []),
    [pages.data, contacts.data],
  );
  const thread = threads.find((t) => t.number === open) ?? null;
  const showChat = !!open || composing;

  return (
    <section className="aid-card overflow-hidden">
      <div className="grid min-h-[32rem] md:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
        <div
          className={cn(
            "flex min-w-0 flex-col border-[var(--border)] md:border-r",
            showChat && "hidden md:flex",
          )}
        >
          <div className="border-b border-[var(--border)] p-3">
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              disabled={disabled}
              onClick={() => {
                setOpen(null);
                setComposing(true);
              }}
            >
              <MessageSquarePlus aria-hidden="true" /> New message
            </Button>
          </div>
          {pages.isPending ? (
            <LoadingRows rows={4} />
          ) : pages.isError ? (
            <ErrorState error={pages.error} onRetry={() => void pages.refetch()} />
          ) : threads.length === 0 ? (
            <Empty>No messages yet.</Empty>
          ) : (
            <ul
              className="flex-1 divide-y divide-[var(--border)] overflow-y-auto"
              aria-label="Conversations"
            >
              {threads.map((t) => (
                <li key={t.number}>
                  <button
                    type="button"
                    onClick={() => {
                      setComposing(false);
                      setOpen(t.number);
                    }}
                    aria-current={open === t.number ? "true" : undefined}
                    className={cn(
                      "flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-[var(--muted)]",
                      open === t.number && "bg-[var(--accent)] hover:bg-[var(--accent)]",
                    )}
                  >
                    <Avatar name={t.name ?? t.number.replace(/\D/g, "").slice(-2)} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-medium">{t.name ?? t.number}</span>
                        <span className="shrink-0 text-xs text-[var(--muted-foreground)]">
                          {formatListTime(t.last.at)}
                        </span>
                      </span>
                      <span className="block truncate text-xs text-[var(--muted-foreground)]">
                        {t.last.direction === "out" ? "You: " : ""}
                        {t.last.text}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <LoadMore
            hasMore={pages.hasNextPage}
            loading={pages.isFetchingNextPage}
            onClick={() => void pages.fetchNextPage()}
          />
        </div>

        <div className={cn("min-w-0", !showChat && "hidden md:block")}>
          {showChat ? (
            <Chat
              key={thread?.number ?? "new"}
              agent={agent}
              number={thread?.number ?? null}
              name={thread?.name ?? null}
              messages={thread?.messages ?? []}
              disabled={disabled}
              onBack={() => {
                setOpen(null);
                setComposing(false);
              }}
              onSent={(number) => {
                setComposing(false);
                setOpen(number);
              }}
            />
          ) : (
            <Empty>Choose a conversation.</Empty>
          )}
        </div>
      </div>
    </section>
  );
}

function Chat({
  agent,
  number,
  name,
  messages,
  disabled,
  onBack,
  onSent,
}: {
  agent: Agent;
  number: string | null;
  name: string | null;
  messages: AgentEvent[];
  disabled: boolean;
  onBack: () => void;
  onSent: (number: string) => void;
}) {
  const [to, setTo] = useState("");
  const [text, setText] = useState("");
  const end = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();
  const target = number ?? to.trim();

  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  const send = useMutation({
    mutationFn: () => api.asAgent(agent.id).sendSms({ to: target, text }),
    onSuccess: async (result) => {
      if (result.message.status === "simulated")
        toast.warning("Not delivered", { description: "Test numbers reach only test numbers." });
      setText("");
      await queryClient.invalidateQueries({ queryKey: ["agent-id", "events"] });
      onSent(result.message.counterparty ?? target);
    },
  });

  return (
    <div className="flex h-full min-h-[32rem] flex-col">
      <div className="flex items-center gap-2 border-b border-[var(--border)] p-3">
        <Button
          variant="ghost"
          size="icon"
          className="md:hidden"
          aria-label="Back"
          onClick={onBack}
        >
          <ArrowLeft aria-hidden="true" />
        </Button>
        {number ? (
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{name ?? number}</p>
            {name && <p className="aid-mono text-xs text-[var(--muted-foreground)]">{number}</p>}
          </div>
        ) : (
          <Input
            aria-label="To"
            placeholder="To: +14155550123"
            inputMode="tel"
            autoFocus
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="max-w-xs"
          />
        )}
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto bg-[var(--muted)]/40 p-4" aria-live="polite">
        {messages.map((m) => {
          const mine = m.direction === "out";
          return (
            <div key={m.id} className={cn("flex", mine ? "justify-end" : "justify-start")}>
              <div
                className={cn(
                  "max-w-[80%] rounded-2xl px-3.5 py-2 text-sm",
                  mine
                    ? "rounded-br-md bg-[var(--primary)] text-[var(--primary-foreground)]"
                    : "rounded-bl-md bg-[var(--card)] ring-1 ring-[var(--border)]",
                )}
              >
                <p className="whitespace-pre-wrap break-words">{m.text}</p>
                <p
                  className={cn(
                    "mt-0.5 text-right text-[10px]",
                    mine ? "opacity-60" : "text-[var(--muted-foreground)]",
                  )}
                >
                  {formatListTime(m.at)}
                  {mine && m.status === "simulated" ? " · not delivered" : ""}
                  {mine && m.status === "failed" ? " · failed" : ""}
                </p>
              </div>
            </div>
          );
        })}
        <div ref={end} />
      </div>
      <form
        className="flex items-end gap-2 border-t border-[var(--border)] p-3"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          if (target && text.trim() && !send.isPending) send.mutate();
        }}
      >
        <Textarea
          aria-label="Message"
          rows={1}
          placeholder="Message"
          className="min-h-9 flex-1 resize-none"
          value={text}
          disabled={disabled}
          maxLength={1600}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              if (target && text.trim() && !send.isPending) send.mutate();
            }
          }}
        />
        <Button
          type="submit"
          size="icon"
          aria-label="Send"
          disabled={disabled || !target || !text.trim() || send.isPending}
        >
          {send.isPending ? (
            <Loader2 className="animate-spin" aria-hidden="true" />
          ) : (
            <Send aria-hidden="true" />
          )}
        </Button>
      </form>
      {send.isError && (
        <Notice tone="danger" className="m-3 mt-0">
          {errorMessage(send.error)}
        </Notice>
      )}
    </div>
  );
}

// --- Calls --------------------------------------------------------------------------------

const CALL_ICONS: Record<CallKind, typeof Phone> = {
  missed: PhoneMissed,
  voicemail: Voicemail,
  incoming: PhoneIncoming,
  outgoing: PhoneOutgoing,
};
const CALL_LABELS: Record<CallKind, string> = {
  missed: "Missed",
  voicemail: "Voicemail",
  incoming: "Incoming",
  outgoing: "Outgoing",
};

function Calls({ agent, disabled }: { agent: Agent; disabled: boolean }) {
  const pages = useEventPages(agent.id, { kind: ["call"] }, { limit: 50 });
  const contacts = useContacts(agent.id);
  const names = new Map(
    (contacts.data ?? []).filter((c) => c.phone).map((c) => [c.phone!, c.name]),
  );
  const calls = pages.data?.pages.flatMap((p) => p.events) ?? [];

  return (
    <Section title="Recents" flush actions={<CallDialog agent={agent} disabled={disabled} />}>
      {pages.isPending ? (
        <LoadingRows rows={4} />
      ) : pages.isError ? (
        <ErrorState error={pages.error} onRetry={() => void pages.refetch()} />
      ) : calls.length === 0 ? (
        <Empty>No calls yet.</Empty>
      ) : (
        <>
          <Rows label="Calls">
            {calls.map((call) => {
              const kind = callKind(call);
              const Icon = CALL_ICONS[kind];
              const seconds = Number(call.data["recordingSeconds"] ?? call.data["duration"] ?? 0);
              const recording =
                typeof call.data["recordingUrl"] === "string" ? call.data["recordingUrl"] : null;
              return (
                <Row key={call.id}>
                  <div className="flex min-w-0 items-start gap-3">
                    <Icon
                      className={cn(
                        "mt-0.5 h-4 w-4 shrink-0",
                        kind === "missed"
                          ? "text-[var(--aid-danger)]"
                          : "text-[var(--muted-foreground)]",
                      )}
                      aria-hidden="true"
                    />
                    <div className="min-w-0">
                      <p
                        className={cn(
                          "text-sm font-medium",
                          kind === "missed" && "text-[var(--aid-danger)]",
                        )}
                      >
                        {names.get(call.counterparty ?? "") ?? call.counterparty}
                      </p>
                      <p className="text-xs text-[var(--muted-foreground)]">
                        {CALL_LABELS[kind]}
                        {seconds > 0 ? ` · ${formatDuration(seconds)}` : ""}
                        {call.status === "simulated" ? " · not placed" : ""}
                      </p>
                      {call.text && (
                        <p className="mt-0.5 truncate text-xs text-[var(--muted-foreground)]">
                          “{call.text}”
                        </p>
                      )}
                      {recording && (
                        <a
                          href={recording}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="aid-link text-xs font-medium"
                        >
                          Play voicemail
                        </a>
                      )}
                    </div>
                  </div>
                  <span className="shrink-0 text-xs text-[var(--muted-foreground)]">
                    {formatListTime(call.at)}
                  </span>
                </Row>
              );
            })}
          </Rows>
          <LoadMore
            hasMore={pages.hasNextPage}
            loading={pages.isFetchingNextPage}
            onClick={() => void pages.fetchNextPage()}
          />
        </>
      )}
      {agent.resources.phone?.mode === "live" && <Greeting agent={agent} />}
    </Section>
  );
}

function CallDialog({ agent, disabled }: { agent: Agent; disabled: boolean }) {
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState("");
  const [say, setSay] = useState("");
  const queryClient = useQueryClient();
  const call = useMutation({
    mutationFn: () => api.asAgent(agent.id).placeCall({ to: to.trim(), say }),
    onSuccess: async (result) => {
      if (result.call.status === "simulated")
        toast.warning("Not placed", { description: "Test numbers reach only test numbers." });
      else toast.success("Calling");
      setOpen(false);
      setSay("");
      await queryClient.invalidateQueries({ queryKey: ["agent-id", "events"] });
    },
  });
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) call.reset();
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" disabled={disabled}>
          <Phone aria-hidden="true" /> Call
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md sm:rounded-xl">
        <form
          className="grid gap-4"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            if (to.trim() && say.trim()) call.mutate();
          }}
        >
          <DialogHeader>
            <DialogTitle>Call</DialogTitle>
          </DialogHeader>
          <Field id="call-to" label="Number">
            <Input
              id="call-to"
              inputMode="tel"
              placeholder="+14155550123"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </Field>
          <Field id="call-say" label="What the agent says">
            <Textarea
              id="call-say"
              rows={3}
              maxLength={1000}
              value={say}
              onChange={(e) => setSay(e.target.value)}
            />
          </Field>
          {call.isError && <Notice tone="danger">{errorMessage(call.error)}</Notice>}
          <DialogFooter>
            <Button type="submit" disabled={!to.trim() || !say.trim() || call.isPending}>
              {call.isPending && <Loader2 className="animate-spin" aria-hidden="true" />}
              Call
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Greeting({ agent }: { agent: Agent }) {
  const current =
    typeof agent.resources.phone?.settings.greeting === "string"
      ? agent.resources.phone.settings.greeting
      : "";
  const [greeting, setGreeting] = useState(current);
  const queryClient = useQueryClient();
  const save = useMutation({
    mutationFn: () =>
      api.updateResource(agent.id, "phone", {
        settings: { greeting: greeting.trim() ? greeting.trim() : null },
      }),
    onSuccess: async () => {
      toast.success("Greeting saved");
      await queryClient.invalidateQueries({ queryKey: ["agent-id", "agent", agent.id] });
    },
    onError: (error) => toastError(error, "Couldn't save the greeting"),
  });
  return (
    <form
      className="flex flex-col gap-2 border-t border-[var(--border)] p-5 sm:flex-row sm:items-end"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <Field id="phone-greeting" label="Voicemail greeting" className="flex-1">
        <Input
          id="phone-greeting"
          maxLength={300}
          placeholder="Standard greeting"
          value={greeting}
          onChange={(e) => setGreeting(e.target.value)}
        />
      </Field>
      <Button
        type="submit"
        variant="outline"
        disabled={save.isPending || greeting.trim() === current}
      >
        Save
      </Button>
    </form>
  );
}
