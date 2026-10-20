// The agent's phone, like the phone on your own: Messages as conversations,
// Recents for calls, and Contacts.
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowUp,
  Loader2,
  MessageCircle,
  Phone,
  PhoneIncoming,
  PhoneMissed,
  PhoneOutgoing,
  Play,
  Search,
  SquarePen,
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
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { errorMessage } from "@/lib/agent-id/client";
import {
  callKind,
  conversations,
  dayLabel,
  formatDuration,
  formatListTime,
  formatPhone,
  formatTime,
  type CallKind,
} from "@/lib/agent-id/format";
import { useContacts, useEventPages } from "@/lib/agent-id/queries";
import { api } from "@/lib/agent-id/session";
import type { Agent, AgentEvent } from "@/lib/agent-id/types";
import {
  Avatar,
  CopyButton,
  ErrorState,
  Field,
  LoadingRows,
  ModeBadge,
  Notice,
  Segmented,
  toastError,
} from "../ui";
import { ContactsBook } from "./Contacts";
import { BlockedNotice, LoadMore, NoResource, blockedReason } from "./common";

type View = "messages" | "calls" | "contacts";

export function PhoneTab({ agent }: { agent: Agent }) {
  const phone = agent.resources.phone;
  const [view, setView] = useState<View>("messages");
  const [openNumber, setOpenNumber] = useState<string | null>(null);
  const [callTo, setCallTo] = useState<string | null>(null);
  const navigate = useNavigate();
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
            { value: "calls", label: "Recents" },
            { value: "contacts", label: "Contacts" },
          ]}
        />
        <span className="flex items-center gap-1.5 text-sm text-[var(--muted-foreground)]">
          My number
          <span className="font-medium text-[var(--foreground)]">{formatPhone(phone.address)}</span>
          {phone.address && (
            <CopyButton text={phone.address} iconOnly variant="ghost" label="Copy number" />
          )}
          <ModeBadge mode={phone.mode} />
        </span>
      </div>
      <BlockedNotice reason={blocked} />
      {view === "messages" && (
        <Messages
          agent={agent}
          disabled={!!blocked}
          openNumber={openNumber}
          onOpenNumber={setOpenNumber}
        />
      )}
      {view === "calls" && (
        <Recents agent={agent} disabled={!!blocked} onCall={(n) => setCallTo(n)} />
      )}
      {view === "contacts" && (
        <ContactsBook
          agent={agent}
          canEdit={!blockedReason(agent)}
          onMessage={(number) => {
            setOpenNumber(number);
            setView("messages");
          }}
          onCall={(number) => setCallTo(number)}
          onMail={(email) =>
            void navigate({
              to: "/agent-id/agents/$agentId",
              params: { agentId: agent.id },
              search: { tab: "mail", compose: email },
            })
          }
        />
      )}
      {callTo !== null && (
        <CallDialog agent={agent} initialTo={callTo} onClose={() => setCallTo(null)} />
      )}
    </div>
  );
}

// --- Messages -----------------------------------------------------------------------

function Messages({
  agent,
  disabled,
  openNumber,
  onOpenNumber,
}: {
  agent: Agent;
  disabled: boolean;
  openNumber: string | null;
  onOpenNumber: (number: string | null) => void;
}) {
  const pages = useEventPages(agent.id, { kind: ["sms"] }, { limit: 100 });
  const contacts = useContacts(agent.id);
  const [composing, setComposing] = useState(false);
  const [search, setSearch] = useState("");
  const threads = useMemo(
    () => conversations(pages.data?.pages.flatMap((p) => p.events) ?? [], contacts.data ?? []),
    [pages.data, contacts.data],
  );
  const shown = threads.filter((t) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return [t.name, t.number, t.last.text].some((v) => v?.toLowerCase().includes(q));
  });
  const thread = threads.find((t) => t.number === openNumber) ?? null;
  const known = contacts.data?.find((c) => c.phone === openNumber)?.name ?? null;
  const showChat = !!openNumber || composing;

  return (
    <section className="aid-card overflow-hidden">
      <div className="grid h-[calc(100svh-12rem)] max-h-[50rem] min-h-[32rem] md:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
        <div
          className={cn(
            "flex min-h-0 min-w-0 flex-col border-[var(--border)] md:border-r",
            showChat && "hidden md:flex",
          )}
        >
          <div className="flex items-center justify-between px-4 pb-2 pt-4">
            <h3 className="text-lg font-semibold">Messages</h3>
            <Button
              size="icon"
              variant="ghost"
              className="rounded-full text-[var(--aid-ink)]"
              aria-label="New message"
              disabled={disabled}
              onClick={() => {
                onOpenNumber(null);
                setComposing(true);
              }}
            >
              <SquarePen aria-hidden="true" />
            </Button>
          </div>
          <div className="px-3 pb-2">
            <label className="relative block">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted-foreground)]"
                aria-hidden="true"
              />
              <input
                aria-label="Search messages"
                placeholder="Search"
                className="h-9 w-full rounded-xl bg-[var(--muted)] pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-[var(--ring)]"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {pages.isPending ? (
              <LoadingRows rows={4} />
            ) : pages.isError ? (
              <ErrorState error={pages.error} onRetry={() => void pages.refetch()} />
            ) : shown.length === 0 ? (
              <p className="px-5 py-14 text-center text-sm text-[var(--muted-foreground)]">
                {search ? "No results" : "No messages"}
              </p>
            ) : (
              <ul aria-label="Conversations" className="px-2">
                {shown.map((t) => {
                  const title = t.name ?? formatPhone(t.number);
                  return (
                    <li key={t.number}>
                      <button
                        type="button"
                        onClick={() => {
                          setComposing(false);
                          onOpenNumber(t.number);
                        }}
                        aria-current={openNumber === t.number ? "true" : undefined}
                        className={cn(
                          "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors",
                          openNumber === t.number
                            ? "bg-[var(--primary)] text-[var(--primary-foreground)]"
                            : "hover:bg-[var(--muted)]",
                        )}
                      >
                        <Avatar name={t.name ?? t.number} size="md" colorful />
                        <span className="min-w-0 flex-1">
                          <span className="flex items-baseline justify-between gap-2">
                            <span className="truncate text-[15px] font-semibold">{title}</span>
                            <span className="shrink-0 text-xs opacity-70">
                              {formatListTime(t.last.at)}
                            </span>
                          </span>
                          <span className="line-clamp-2 text-[13px] leading-snug opacity-70">
                            {t.last.direction === "out" ? "You: " : ""}
                            {t.last.text}
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            <LoadMore
              hasMore={pages.hasNextPage}
              loading={pages.isFetchingNextPage}
              onClick={() => void pages.fetchNextPage()}
            />
          </div>
        </div>

        <div className={cn("min-h-0 min-w-0", !showChat && "hidden md:block")}>
          {showChat ? (
            <Conversation
              key={openNumber ?? "new"}
              agent={agent}
              number={openNumber}
              name={thread?.name ?? known}
              messages={thread?.messages ?? []}
              disabled={disabled}
              onBack={() => {
                onOpenNumber(null);
                setComposing(false);
              }}
              onSent={(number) => {
                setComposing(false);
                onOpenNumber(number);
              }}
            />
          ) : (
            <div className="grid h-full place-items-center p-8 text-center">
              <div>
                <MessageCircle
                  className="mx-auto mb-3 h-8 w-8 text-[var(--muted-foreground)]/50"
                  aria-hidden="true"
                />
                <p className="text-sm text-[var(--muted-foreground)]">No conversation selected</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

// Messages from one side within a couple of minutes sit together.
function grouped(messages: AgentEvent[]) {
  return messages.map((m, i) => {
    const prev = messages[i - 1];
    const next = messages[i + 1];
    const near = (a?: AgentEvent, b?: AgentEvent) =>
      !!a &&
      !!b &&
      a.direction === b.direction &&
      Math.abs(Date.parse(a.at) - Date.parse(b.at)) < 3 * 60_000 &&
      dayLabel(a.at) === dayLabel(b.at);
    return {
      message: m,
      newDay: !prev || dayLabel(prev.at) !== dayLabel(m.at),
      first: !near(prev, m),
      last: !near(m, next),
    };
  });
}

function Conversation({
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
  const scroller = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();
  const target = number ?? to.trim();
  const items = grouped(messages);
  const lastMine = [...messages].reverse().find((m) => m.direction === "out");

  // Keep the newest message in view without scrolling the page itself.
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  const send = useMutation({
    mutationFn: () => api.asAgent(agent.id).sendSms({ to: target, text }),
    onSuccess: async (result) => {
      setText("");
      await queryClient.invalidateQueries({ queryKey: ["agent-id", "events"] });
      onSent(result.message.counterparty ?? target);
    },
  });
  const submit = () => {
    if (target && text.trim() && !send.isPending) send.mutate();
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-[var(--border)] px-4 py-3">
        <Button
          variant="ghost"
          size="icon"
          className="rounded-full md:hidden"
          aria-label="Back"
          onClick={onBack}
        >
          <ArrowLeft aria-hidden="true" />
        </Button>
        {number ? (
          <>
            <Avatar name={name ?? number} size="md" colorful />
            <div className="min-w-0">
              <p className="truncate text-[15px] font-semibold">{name ?? formatPhone(number)}</p>
              {name && (
                <p className="text-xs text-[var(--muted-foreground)]">{formatPhone(number)}</p>
              )}
            </div>
          </>
        ) : (
          <label className="flex flex-1 items-center gap-2">
            <span className="text-sm text-[var(--muted-foreground)]">To:</span>
            <input
              aria-label="To"
              placeholder="+1 415 555 0100"
              inputMode="tel"
              autoFocus
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="h-9 min-w-0 flex-1 bg-transparent text-[15px] outline-none"
            />
          </label>
        )}
      </div>

      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto px-4 py-4" aria-live="polite">
        {items.map(({ message: m, newDay, first, last }) => {
          const mine = m.direction === "out";
          return (
            <Fragment key={m.id}>
              {newDay && (
                <p className="my-3 text-center text-xs font-medium text-[var(--muted-foreground)]">
                  {dayLabel(m.at)} {formatTime(m.at)}
                </p>
              )}
              <div
                className={cn(
                  "flex",
                  mine ? "justify-end" : "justify-start",
                  first ? "mt-2" : "mt-0.5",
                )}
              >
                <div
                  title={formatTime(m.at)}
                  className={cn(
                    "max-w-[75%] whitespace-pre-wrap break-words rounded-[18px] px-3.5 py-2 text-[15px] leading-snug",
                    mine
                      ? "bg-[var(--primary)] text-[var(--primary-foreground)]"
                      : "bg-[var(--aid-bubble-in)] text-[var(--foreground)]",
                    last && (mine ? "aid-tail-out rounded-br-md" : "aid-tail-in rounded-bl-md"),
                  )}
                >
                  {m.text}
                </div>
              </div>
              {mine && m.id === lastMine?.id && (
                <p className="mr-1 mt-1 text-right text-[11px] font-medium text-[var(--muted-foreground)]">
                  {m.status === "simulated"
                    ? "Not delivered"
                    : m.status === "failed" || m.status === "undelivered"
                      ? "Not sent"
                      : m.status === "queued" || m.status === "sending"
                        ? "Sending…"
                        : "Delivered"}
                </p>
              )}
            </Fragment>
          );
        })}
      </div>

      {send.isError && (
        <Notice tone="danger" className="mx-4 mb-2">
          {errorMessage(send.error)}
        </Notice>
      )}
      <form
        className="flex items-end gap-2 px-4 pb-4 pt-2"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="flex min-h-10 flex-1 items-end rounded-[20px] border border-[var(--input)] bg-[var(--card)] px-4 py-2 focus-within:ring-2 focus-within:ring-[var(--ring)]">
          <textarea
            aria-label="Message"
            rows={1}
            placeholder="Text Message"
            className="max-h-32 min-h-6 flex-1 resize-none bg-transparent text-[15px] leading-6 outline-none"
            value={text}
            disabled={disabled}
            maxLength={1600}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
          />
        </div>
        <button
          type="submit"
          aria-label="Send"
          disabled={disabled || !target || !text.trim() || send.isPending}
          className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[var(--aid-ink)] text-[var(--background)] transition-opacity disabled:opacity-30"
        >
          {send.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <ArrowUp className="h-5 w-5" aria-hidden="true" />
          )}
        </button>
      </form>
    </div>
  );
}

// --- Recents --------------------------------------------------------------------------

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

function Recents({
  agent,
  disabled,
  onCall,
}: {
  agent: Agent;
  disabled: boolean;
  onCall: (number: string) => void;
}) {
  const pages = useEventPages(agent.id, { kind: ["call"] }, { limit: 50 });
  const contacts = useContacts(agent.id);
  const [filter, setFilter] = useState<"all" | "missed">("all");
  const names = new Map(
    (contacts.data ?? []).filter((c) => c.phone).map((c) => [c.phone!, c.name]),
  );
  const calls = (pages.data?.pages.flatMap((p) => p.events) ?? []).filter(
    (c) => filter === "all" || callKind(c) === "missed",
  );

  return (
    <section className="aid-card overflow-hidden">
      <div className="flex items-center justify-between gap-2 border-b border-[var(--border)] px-4 py-3">
        <Segmented
          label="Calls"
          value={filter}
          onChange={setFilter}
          options={[
            { value: "all", label: "All" },
            { value: "missed", label: "Missed" },
          ]}
        />
        <Button size="sm" className="rounded-full" disabled={disabled} onClick={() => onCall("")}>
          <Phone aria-hidden="true" /> Call
        </Button>
      </div>
      {pages.isPending ? (
        <LoadingRows rows={4} />
      ) : pages.isError ? (
        <ErrorState error={pages.error} onRetry={() => void pages.refetch()} />
      ) : calls.length === 0 ? (
        <p className="px-5 py-14 text-center text-sm text-[var(--muted-foreground)]">
          {filter === "missed" ? "No missed calls" : "No recent calls"}
        </p>
      ) : (
        <>
          <ul aria-label="Recent calls">
            {calls.map((call) => {
              const kind = callKind(call);
              const Icon = CALL_ICONS[kind];
              const seconds = Number(call.data["recordingSeconds"] ?? call.data["duration"] ?? 0);
              const recording =
                typeof call.data["recordingUrl"] === "string" ? call.data["recordingUrl"] : null;
              const number = call.counterparty ?? "";
              return (
                <li
                  key={call.id}
                  className="flex items-center gap-3 border-b border-[var(--border)] px-5 py-3 last:border-b-0"
                >
                  <Icon
                    className={cn(
                      "h-4 w-4 shrink-0",
                      kind === "missed"
                        ? "text-[var(--aid-danger)]"
                        : "text-[var(--muted-foreground)]",
                    )}
                    aria-label={CALL_LABELS[kind]}
                  />
                  <button
                    type="button"
                    disabled={disabled || !number}
                    onClick={() => onCall(number)}
                    className="min-w-0 flex-1 text-left"
                    title="Call back"
                  >
                    <span
                      className={cn(
                        "block truncate text-[15px] font-medium",
                        kind === "missed" && "text-[var(--aid-danger)]",
                      )}
                    >
                      {names.get(number) ?? formatPhone(number)}
                    </span>
                    <span className="block truncate text-xs text-[var(--muted-foreground)]">
                      {CALL_LABELS[kind]}
                      {seconds > 0 ? ` · ${formatDuration(seconds)}` : ""}
                      {call.text ? ` · “${call.text}”` : ""}
                    </span>
                  </button>
                  <span className="shrink-0 text-sm text-[var(--muted-foreground)]">
                    {formatListTime(call.at)}
                  </span>
                  {recording && (
                    <a
                      href={recording}
                      target="_blank"
                      rel="noreferrer noopener"
                      aria-label="Play voicemail"
                      title="Play voicemail"
                      className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[var(--accent)] text-[var(--aid-ink)] hover:bg-[var(--primary)]"
                    >
                      <Play className="h-3.5 w-3.5" aria-hidden="true" />
                    </a>
                  )}
                </li>
              );
            })}
          </ul>
          <LoadMore
            hasMore={pages.hasNextPage}
            loading={pages.isFetchingNextPage}
            onClick={() => void pages.fetchNextPage()}
          />
        </>
      )}
    </section>
  );
}

function CallDialog({
  agent,
  initialTo,
  onClose,
}: {
  agent: Agent;
  initialTo: string;
  onClose: () => void;
}) {
  const [to, setTo] = useState(initialTo);
  const [say, setSay] = useState("");
  const queryClient = useQueryClient();
  const call = useMutation({
    mutationFn: () => api.asAgent(agent.id).placeCall({ to: to.trim(), say }),
    onSuccess: async (result) => {
      if (result.call.status === "simulated") toast.warning("The call didn't connect");
      else toast.success("Calling…");
      onClose();
      await queryClient.invalidateQueries({ queryKey: ["agent-id", "events"] });
    },
    onError: (error) => toastError(error, "Couldn't place the call"),
  });
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent aria-describedby={undefined} className="sm:max-w-md sm:rounded-2xl">
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
              placeholder="+1 415 555 0100"
              autoFocus={!initialTo}
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </Field>
          <Field id="call-say" label={`What ${agent.name} says`}>
            <Textarea
              id="call-say"
              rows={3}
              maxLength={1000}
              autoFocus={!!initialTo}
              value={say}
              onChange={(e) => setSay(e.target.value)}
            />
          </Field>
          {call.isError && <Notice tone="danger">{errorMessage(call.error)}</Notice>}
          <DialogFooter>
            <Button
              type="submit"
              className="rounded-full"
              disabled={!to.trim() || !say.trim() || call.isPending}
            >
              {call.isPending ? (
                <Loader2 className="animate-spin" aria-hidden="true" />
              ) : (
                <Phone aria-hidden="true" />
              )}
              Call
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
