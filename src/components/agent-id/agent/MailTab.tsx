// The agent's mailbox, laid out like a mail app: folders, a message list and
// a reading pane, with compose, attachments and a bin.
import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Inbox,
  Loader2,
  MailOpen,
  Paperclip,
  PenSquare,
  Reply,
  RotateCcw,
  Search,
  Send,
  Trash2,
  X,
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
import { formatBytes, formatDateTime, formatListTime } from "@/lib/agent-id/format";
import { useAgents, useEventPages, useMailCounts, useMailPages } from "@/lib/agent-id/queries";
import { api } from "@/lib/agent-id/session";
import type { Agent, FileRef, MailFolder, MailMessage } from "@/lib/agent-id/types";
import {
  ConfirmButton,
  Empty,
  ErrorState,
  EventStatus,
  Field,
  LoadingRows,
  Notice,
  toastError,
} from "../ui";
import { BlockedNotice, LoadMore, NoResource, blockedReason } from "./common";

const MAX_FILE = 10 * 1024 * 1024;

const FOLDERS: { id: MailFolder; label: string; icon: typeof Inbox }[] = [
  { id: "inbox", label: "Inbox", icon: Inbox },
  { id: "sent", label: "Sent", icon: Send },
  { id: "trash", label: "Bin", icon: Trash2 },
];

type Draft = { to: string; cc: string; subject: string; text: string; replyTo?: MailMessage };

const listOf = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
const attachmentsOf = (m: MailMessage): FileRef[] =>
  m.attachments ??
  (Array.isArray(m.data["attachments"]) ? (m.data["attachments"] as FileRef[]) : []);

export function MailTab({ agent }: { agent: Agent }) {
  const mail = agent.resources.mail;
  const blocked = blockedReason(agent, mail);
  // The mailbox routes act as the agent, so a paused agent's mail is read
  // from its history instead (inbox and sent only).
  const live = !!mail && !blocked;
  const [folder, setFolder] = useState<MailFolder>("inbox");
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const queryClient = useQueryClient();

  useEffect(() => {
    const timer = window.setTimeout(() => setQ(search.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  const pages = useMailPages(agent.id, folder, q, { enabled: live });
  const history = useEventPages(
    agent.id,
    { kind: ["mail"], direction: folder === "sent" ? "out" : "in" },
    { enabled: !!mail && !live && folder !== "trash" },
  );
  const counts = useMailCounts(agent.id, live);

  const messages: MailMessage[] = useMemo(() => {
    if (live) {
      const all = pages.data?.pages.flatMap((p) => p.messages) ?? [];
      // Until every message carries its folder, keep folders apart by it.
      return all.filter((m) =>
        folder === "trash" ? m.folder === "trash" : m.folder === undefined || m.folder === folder,
      );
    }
    const all = (history.data?.pages.flatMap((p) => p.events) ?? []) as MailMessage[];
    const needle = q.toLowerCase();
    return needle
      ? all.filter((m) => `${m.subject} ${m.counterparty} ${m.text}`.toLowerCase().includes(needle))
      : all;
  }, [live, pages.data, history.data, folder, q]);
  const list = live ? pages : history;
  // Your own agents show by name, like contacts in a mail app.
  const agents = useAgents();
  const nameOf = (address: string | null) => {
    if (!address) return "";
    const first = address.split(",")[0]?.trim().toLowerCase() ?? "";
    const known = agents.data?.find((a) => a.resources.mail?.address?.toLowerCase() === first);
    return known ? known.name + (address.includes(",") ? " and others" : "") : address;
  };
  const selected = messages.find((m) => m.id === selectedId) ?? null;

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["agent-id", "me", agent.id] }),
      queryClient.invalidateQueries({ queryKey: ["agent-id", "events"] }),
    ]);

  if (!mail) return <NoResource agent={agent} kind="mail" />;

  return (
    <div className="space-y-4">
      <BlockedNotice reason={blocked} />
      <section className="aid-card overflow-hidden">
        <div className="grid min-h-[34rem] lg:grid-cols-[11rem_minmax(0,1fr)] xl:grid-cols-[11rem_minmax(0,20rem)_minmax(0,1fr)]">
          {/* Folders */}
          <nav
            aria-label="Folders"
            className={cn(
              "flex gap-1 border-b border-[var(--border)] p-3 lg:flex-col lg:border-b-0 lg:border-r",
              selected && "hidden lg:flex",
            )}
          >
            <Button
              className="mr-2 lg:mb-3 lg:mr-0 lg:w-full lg:justify-start"
              disabled={!!blocked}
              onClick={() => setDraft({ to: "", cc: "", subject: "", text: "" })}
            >
              <PenSquare aria-hidden="true" /> Compose
            </Button>
            {FOLDERS.filter((f) => live || f.id !== "trash").map((f) => {
              const unread = f.id === "inbox" ? counts.data?.inbox.unread : undefined;
              return (
                <button
                  key={f.id}
                  type="button"
                  aria-current={folder === f.id ? "page" : undefined}
                  onClick={() => {
                    setFolder(f.id);
                    setSelectedId(null);
                  }}
                  className={cn(
                    "flex items-center gap-2.5 rounded-lg px-3 py-1.5 text-sm transition-colors lg:w-full",
                    folder === f.id
                      ? "bg-[var(--accent)] font-semibold text-[var(--aid-ink)]"
                      : "text-[var(--foreground)]/80 hover:bg-[var(--muted)]",
                  )}
                >
                  <f.icon className="h-4 w-4" aria-hidden="true" />
                  <span className="flex-1 text-left">{f.label}</span>
                  {!!unread && (
                    <span className="text-xs font-semibold" aria-label={`${unread} unread`}>
                      {unread}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>

          {/* Message list */}
          <div
            className={cn(
              "flex min-w-0 flex-col border-[var(--border)] lg:border-r",
              selected && "hidden xl:flex",
            )}
          >
            <div className="relative border-b border-[var(--border)] p-3">
              <Search
                className="pointer-events-none absolute left-6 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted-foreground)]"
                aria-hidden="true"
              />
              <Input
                aria-label="Search mail"
                placeholder="Search mail"
                className="pl-9"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            {list.isPending ? (
              <LoadingRows rows={5} />
            ) : list.isError ? (
              <ErrorState error={list.error} onRetry={() => void list.refetch()} />
            ) : messages.length === 0 ? (
              <Empty>
                {q
                  ? "No messages match."
                  : folder === "inbox"
                    ? "No mail yet."
                    : folder === "sent"
                      ? "Nothing sent yet."
                      : "The bin is empty."}
              </Empty>
            ) : (
              <ul
                className="flex-1 divide-y divide-[var(--border)] overflow-y-auto"
                aria-label="Messages"
              >
                {messages.map((m) => (
                  <MessageItem
                    key={m.id}
                    message={m}
                    sent={folder === "sent"}
                    active={m.id === selectedId}
                    onOpen={() => setSelectedId(m.id)}
                    nameOf={nameOf}
                  />
                ))}
              </ul>
            )}
            <LoadMore
              hasMore={list.hasNextPage}
              loading={list.isFetchingNextPage}
              onClick={() => void list.fetchNextPage()}
            />
          </div>

          {/* Reading pane */}
          <div className={cn("min-w-0", !selected && "hidden xl:block")}>
            {selected ? (
              <Reader
                agent={agent}
                message={selected}
                live={live}
                folder={folder}
                onBack={() => setSelectedId(null)}
                onChanged={async (closed) => {
                  if (closed) setSelectedId(null);
                  await refresh();
                }}
                onReply={() =>
                  setDraft({
                    to:
                      selected.direction === "in"
                        ? (selected.counterparty ?? "")
                        : listOf(selected.data["to"]).join(", "),
                    cc: "",
                    subject: /^re:/i.test(selected.subject ?? "")
                      ? (selected.subject ?? "")
                      : `Re: ${selected.subject ?? ""}`.trim(),
                    text: "",
                    replyTo: selected,
                  })
                }
              />
            ) : (
              <Empty>
                <MailOpen className="mx-auto mb-2 h-5 w-5" aria-hidden="true" />
                Choose a message to read it.
              </Empty>
            )}
          </div>
        </div>
      </section>

      {draft && (
        <Compose
          agent={agent}
          draft={draft}
          onClose={() => setDraft(null)}
          onSent={async () => {
            setFolder("sent");
            setSelectedId(null);
            await refresh();
          }}
        />
      )}
    </div>
  );
}

function MessageItem({
  message: m,
  sent,
  active,
  onOpen,
  nameOf,
}: {
  message: MailMessage;
  sent: boolean;
  active: boolean;
  onOpen: () => void;
  nameOf: (address: string | null) => string;
}) {
  const unread = m.direction === "in" && !m.read;
  const preview = (m.preview ?? m.text ?? "").replace(/\s+/g, " ").slice(0, 140);
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        aria-current={active ? "true" : undefined}
        className={cn(
          "flex w-full gap-2 px-4 py-3 text-left transition-colors hover:bg-[var(--muted)]",
          active && "bg-[var(--accent)] hover:bg-[var(--accent)]",
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
            "mt-1.5 h-2 w-2 shrink-0 rounded-full",
            unread ? "bg-[var(--aid-ink)]" : "bg-transparent",
          )}
        />
        <span className="min-w-0 flex-1">
          <span className="flex items-center justify-between gap-2">
            <span className={cn("truncate text-sm", unread && "font-semibold")}>
              {sent ? `To ${nameOf(m.counterparty)}` : nameOf(m.counterparty)}
            </span>
            <span className="flex shrink-0 items-center gap-1 text-xs text-[var(--muted-foreground)]">
              {attachmentsOf(m).length > 0 && (
                <Paperclip className="h-3.5 w-3.5" aria-label="Has attachments" />
              )}
              {formatListTime(m.at)}
            </span>
          </span>
          <span
            className={cn(
              "block truncate text-sm",
              unread ? "font-semibold" : "text-[var(--foreground)]/90",
            )}
          >
            {m.subject || "(no subject)"}
          </span>
          <span className="block truncate text-xs text-[var(--muted-foreground)]">{preview}</span>
        </span>
      </button>
    </li>
  );
}

function Reader({
  agent,
  message,
  live,
  folder,
  onBack,
  onReply,
  onChanged,
}: {
  agent: Agent;
  message: MailMessage;
  live: boolean;
  folder: MailFolder;
  onBack: () => void;
  onReply: () => void;
  onChanged: (closed: boolean) => Promise<unknown>;
}) {
  const me = api.asAgent(agent.id);
  // The list carries a preview; the full message (text, HTML) comes on open.
  const full = useQuery({
    queryKey: ["agent-id", "me", agent.id, "mail-message", message.id],
    queryFn: async () => (await me.readMail(message.id)).message,
    enabled: live,
    retry: false,
  });
  const m: MailMessage = { ...message, ...(full.data ?? {}) };
  const html = typeof m.data["html"] === "string" ? (m.data["html"] as string) : null;
  const to = listOf(m.data["to"]);
  const cc = listOf(m.data["cc"]);
  const files = attachmentsOf(m);

  const markedRead = useRef<string | null>(null);
  useEffect(() => {
    if (!live || message.direction !== "in" || message.read || markedRead.current === message.id)
      return;
    markedRead.current = message.id;
    me.markRead(message.id, true)
      .then(() => onChanged(false))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [message.id, live]);

  const act = useMutation({
    mutationFn: async (action: "trash" | "restore" | "unread") => {
      if (action === "unread") return me.markRead(message.id, false);
      return me.moveMail(message.id, action === "trash" ? "trash" : "inbox");
    },
    onSuccess: async (_r, action) => {
      toast.success(
        action === "trash"
          ? "Moved to the bin"
          : action === "restore"
            ? "Moved to the inbox"
            : "Marked unread",
      );
      await onChanged(true);
    },
    onError: (error) => toastError(error),
  });

  const rows: [string, string][] = [
    [
      m.direction === "in" ? "From" : "To",
      (m.direction === "in" ? m.counterparty : to.join(", ") || m.counterparty) ?? "",
    ],
    ...(m.direction === "in" && to.length ? [["To", to.join(", ")] as [string, string]] : []),
    ...(cc.length ? [["Cc", cc.join(", ")] as [string, string]] : []),
    ["Date", formatDateTime(m.at)],
  ];

  return (
    <article className="flex h-full flex-col" aria-label="Message">
      <div className="flex flex-wrap items-center gap-1 border-b border-[var(--border)] p-3">
        <Button variant="ghost" size="sm" className="xl:hidden" onClick={onBack}>
          <ArrowLeft aria-hidden="true" /> Back
        </Button>
        {live && (
          <>
            <Button size="sm" variant="outline" onClick={onReply}>
              <Reply aria-hidden="true" /> Reply
            </Button>
            {folder === "trash" ? (
              <>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={act.isPending}
                  onClick={() => act.mutate("restore")}
                >
                  <RotateCcw aria-hidden="true" /> Restore
                </Button>
                <ConfirmButton
                  title="Delete forever?"
                  description="The message and its attachments are gone for good."
                  confirmLabel="Delete forever"
                  onConfirm={async () => {
                    try {
                      await me.deleteMail(message.id);
                      toast.success("Deleted");
                      await onChanged(true);
                    } catch (error) {
                      toastError(error, "Couldn't delete it");
                    }
                  }}
                >
                  Delete forever
                </ConfirmButton>
              </>
            ) : (
              <>
                {m.direction === "in" && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={act.isPending}
                    onClick={() => act.mutate("unread")}
                  >
                    <MailOpen aria-hidden="true" /> Mark unread
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={act.isPending}
                  onClick={() => act.mutate("trash")}
                >
                  <Trash2 aria-hidden="true" /> Bin
                </Button>
              </>
            )}
          </>
        )}
      </div>
      <div className="min-w-0 flex-1 overflow-y-auto p-5">
        <div className="flex items-start justify-between gap-3">
          <h3 className="break-words text-lg font-semibold">{m.subject || "(no subject)"}</h3>
          {m.direction === "out" && <EventStatus status={m.status} />}
        </div>
        <dl className="mt-3 grid gap-1 text-sm">
          {rows.map(([term, value]) => (
            <div key={term} className="flex gap-3">
              <dt className="w-10 shrink-0 text-[var(--muted-foreground)]">{term}</dt>
              <dd className="min-w-0 break-all">{value}</dd>
            </div>
          ))}
        </dl>
        {files.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {files.map((file) => (
              <AttachmentChip key={file.id} agent={agent} file={file} />
            ))}
          </div>
        )}
        <div className="mt-5 border-t border-[var(--border)] pt-5">
          {html ? (
            <iframe
              title="Message"
              sandbox=""
              srcDoc={html}
              className="h-[28rem] w-full rounded-lg border border-[var(--border)] bg-white"
            />
          ) : (
            <div className="whitespace-pre-wrap break-words text-sm leading-relaxed">
              {full.isPending && live && !m.text ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-label="Loading" />
              ) : (
                m.text
              )}
            </div>
          )}
        </div>
      </div>
    </article>
  );
}

function AttachmentChip({ agent, file }: { agent: Agent; file: FileRef }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          const blob = await api.asAgent(agent.id).downloadFile(file.id);
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = file.filename;
          a.click();
          window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
        } catch (error) {
          toastError(error, "Couldn't download it");
        } finally {
          setBusy(false);
        }
      }}
      className="inline-flex max-w-full items-center gap-2 rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm hover:bg-[var(--muted)]"
    >
      {busy ? (
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
      ) : (
        <Paperclip className="h-4 w-4 text-[var(--aid-ink)]" aria-hidden="true" />
      )}
      <span className="truncate">{file.filename}</span>
      <span className="shrink-0 text-xs text-[var(--muted-foreground)]">
        {formatBytes(file.size)}
      </span>
    </button>
  );
}

type Upload = { key: string; name: string; size: number; file?: FileRef; error?: string };

function Compose({
  agent,
  draft,
  onClose,
  onSent,
}: {
  agent: Agent;
  draft: Draft;
  onClose: () => void;
  onSent: () => Promise<unknown>;
}) {
  const [to, setTo] = useState(draft.to);
  const [cc, setCc] = useState(draft.cc);
  const [subject, setSubject] = useState(draft.subject);
  const [text, setText] = useState(draft.text);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);
  const agents = useAgents();
  const mode = agent.resources.mail?.mode;
  const addresses = (agents.data ?? [])
    .filter(
      (a) => a.id !== agent.id && a.resources.mail?.mode === mode && a.resources.mail?.address,
    )
    .map((a) => ({ name: a.name, address: a.resources.mail?.address ?? "" }));
  const uploading = uploads.some((u) => !u.file && !u.error);

  async function attach(files: FileList | null) {
    for (const file of Array.from(files ?? [])) {
      const key = `${file.name}-${file.size}-${Math.random()}`;
      if (file.size > MAX_FILE) {
        setUploads((u) => [...u, { key, name: file.name, size: file.size, error: "Over 10 MB" }]);
        continue;
      }
      setUploads((u) => [...u, { key, name: file.name, size: file.size }]);
      try {
        const { file: ref } = await api.asAgent(agent.id).uploadFile(file);
        setUploads((u) => u.map((x) => (x.key === key ? { ...x, file: ref } : x)));
      } catch (error) {
        setUploads((u) => u.map((x) => (x.key === key ? { ...x, error: errorMessage(error) } : x)));
      }
    }
    if (fileInput.current) fileInput.current.value = "";
  }

  const send = useMutation({
    mutationFn: () =>
      api.asAgent(agent.id).sendMail({
        ...(to.trim() ? { to: to.trim() } : {}),
        ...(cc.trim() ? { cc: cc.trim() } : {}),
        ...(subject.trim() ? { subject: subject.trim() } : {}),
        text,
        ...(draft.replyTo ? { replyTo: draft.replyTo.id } : {}),
        ...(uploads.some((u) => u.file)
          ? { attachments: uploads.flatMap((u) => (u.file ? [u.file.id] : [])) }
          : {}),
      }),
    onSuccess: async (result) => {
      if (result.note) toast.warning("Not delivered", { description: result.note });
      else toast.success("Sent");
      onClose();
      await onSent();
    },
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[92svh] overflow-y-auto sm:max-w-2xl sm:rounded-xl">
        <form
          className="grid gap-4"
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            if (text.trim() && !uploading && !send.isPending) send.mutate();
          }}
        >
          <DialogHeader>
            <DialogTitle>{draft.replyTo ? "Reply" : "New message"}</DialogTitle>
          </DialogHeader>
          <Field id="mail-to" label="To">
            <Input
              id="mail-to"
              inputMode="email"
              autoComplete="off"
              list="agent-addresses"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
            <datalist id="agent-addresses">
              {addresses.map((a) => (
                <option key={a.address} value={a.address}>
                  {a.name}
                </option>
              ))}
            </datalist>
          </Field>
          <Field id="mail-cc" label="Cc">
            <Input
              id="mail-cc"
              inputMode="email"
              autoComplete="off"
              value={cc}
              onChange={(e) => setCc(e.target.value)}
            />
          </Field>
          <Field id="mail-subject" label="Subject">
            <Input id="mail-subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
          </Field>
          <Textarea
            aria-label="Message"
            rows={10}
            autoFocus={!!draft.replyTo}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          {uploads.length > 0 && (
            <ul className="flex flex-wrap gap-2" aria-label="Attachments">
              {uploads.map((u) => (
                <li
                  key={u.key}
                  className={cn(
                    "inline-flex max-w-full items-center gap-2 rounded-lg border px-3 py-1.5 text-sm",
                    u.error
                      ? "border-[var(--aid-danger)] text-[var(--aid-danger)]"
                      : "border-[var(--border)]",
                  )}
                >
                  {!u.file && !u.error ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-label="Uploading" />
                  ) : (
                    <Paperclip className="h-4 w-4" aria-hidden="true" />
                  )}
                  <span className="truncate">{u.name}</span>
                  <span className="shrink-0 text-xs opacity-70">
                    {u.error ?? formatBytes(u.size)}
                  </span>
                  <button
                    type="button"
                    aria-label={`Remove ${u.name}`}
                    className="rounded p-0.5 hover:bg-[var(--muted)]"
                    onClick={() => setUploads((list) => list.filter((x) => x.key !== u.key))}
                  >
                    <X className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          {send.isError && <Notice tone="danger">{errorMessage(send.error)}</Notice>}
          <DialogFooter className="flex-row items-center justify-between gap-2 sm:justify-between">
            <div>
              <input
                ref={fileInput}
                type="file"
                multiple
                className="sr-only"
                id="mail-attach"
                onChange={(e) => void attach(e.target.files)}
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => fileInput.current?.click()}
              >
                <Paperclip aria-hidden="true" /> Attach
              </Button>
            </div>
            <Button
              type="submit"
              disabled={
                !text.trim() || (!to.trim() && !draft.replyTo) || uploading || send.isPending
              }
            >
              {send.isPending ? (
                <Loader2 className="animate-spin" aria-hidden="true" />
              ) : (
                <Send aria-hidden="true" />
              )}
              Send
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
