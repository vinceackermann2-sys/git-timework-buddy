// The agent's mailbox, laid out like the mail apps people use every day: a
// rail with Compose and folders, a message list, a reading pane, and a
// compose window floating in the corner.
import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  File,
  FileImage,
  FileText,
  Inbox,
  Loader2,
  Mail,
  MailOpen,
  Maximize2,
  Minus,
  Paperclip,
  Pencil,
  RefreshCw,
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
import { errorMessage } from "@/lib/agent-id/client";
import { formatBytes, formatDateTime, formatListTime } from "@/lib/agent-id/format";
import { useAgents, useEventPages, useMailCounts, useMailPages } from "@/lib/agent-id/queries";
import { api } from "@/lib/agent-id/session";
import type { Agent, FileRef, MailFolder, MailMessage } from "@/lib/agent-id/types";
import { Avatar, ConfirmButton, Empty, ErrorState, LoadingRows, Notice, toastError } from "../ui";
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

// Icon-only buttons in toolbars and on hover.
function IconButton({
  label,
  onClick,
  children,
  disabled,
}: {
  label: string;
  onClick: (event: React.MouseEvent) => void;
  children: ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="grid h-9 w-9 place-items-center rounded-full text-[var(--muted-foreground)] transition-colors hover:bg-[var(--muted)] hover:text-[var(--foreground)] disabled:opacity-40"
    >
      {children}
    </button>
  );
}

export function MailTab({
  agent,
  composeTo,
  onComposeOpened,
}: {
  agent: Agent;
  composeTo?: string | undefined;
  onComposeOpened?: () => void;
}) {
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
  const agents = useAgents();

  useEffect(() => {
    const timer = window.setTimeout(() => setQ(search.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    if (composeTo && live) {
      setDraft({ to: composeTo, cc: "", subject: "", text: "" });
      onComposeOpened?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [composeTo, live]);

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
  const selected = messages.find((m) => m.id === selectedId) ?? null;

  // Your own agents show by name, like contacts in a mail app.
  const nameOf = (address: string | null) => {
    if (!address) return "";
    const first = address.split(",")[0]?.trim().toLowerCase() ?? "";
    const known = agents.data?.find((a) => a.resources.mail?.address?.toLowerCase() === first);
    return known ? known.name + (address.includes(",") ? " and others" : "") : address;
  };

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["agent-id", "me", agent.id] }),
      queryClient.invalidateQueries({ queryKey: ["agent-id", "events"] }),
    ]);

  const quick = useMutation({
    mutationFn: async (input: { id: string; action: "trash" | "read" | "unread" }) => {
      const me = api.asAgent(agent.id);
      if (input.action === "trash") return me.moveMail(input.id, "trash");
      return me.markRead(input.id, input.action === "read");
    },
    onSuccess: async (_r, input) => {
      if (input.action === "trash") {
        toast.success("Moved to the bin");
        if (input.id === selectedId) setSelectedId(null);
      }
      await refresh();
    },
    onError: (error) => toastError(error),
  });

  if (!mail) return <NoResource agent={agent} kind="mail" />;

  const unread = counts.data?.inbox.unread ?? 0;

  return (
    <div className="space-y-4">
      <BlockedNotice reason={blocked} />
      <section className="aid-card overflow-hidden">
        <div className="grid h-[calc(100svh-10rem)] max-h-[54rem] min-h-[34rem] grid-rows-[auto_minmax(0,1fr)] lg:grid-cols-[13rem_minmax(0,1fr)] lg:grid-rows-1 xl:grid-cols-[13rem_minmax(0,23rem)_minmax(0,1fr)]">
          {/* Rail */}
          <nav
            aria-label="Mail folders"
            className={cn(
              "aid-scroll-x flex items-center gap-1 overflow-x-auto border-b border-[var(--border)] p-3 lg:flex-col lg:items-stretch lg:border-b-0 lg:border-r lg:bg-[var(--muted)]/40",
              selected && "hidden lg:flex",
            )}
          >
            <button
              type="button"
              disabled={!!blocked}
              onClick={() => setDraft({ to: "", cc: "", subject: "", text: "" })}
              className="mr-2 inline-flex h-11 shrink-0 items-center gap-3 rounded-2xl bg-[var(--primary)] px-5 text-sm font-semibold text-[var(--primary-foreground)] shadow-sm transition hover:shadow disabled:opacity-50 lg:mb-4 lg:mr-0 lg:h-14"
            >
              <Pencil className="h-4 w-4" aria-hidden="true" /> Compose
            </button>
            {FOLDERS.filter((f) => live || f.id !== "trash").map((f) => (
              <button
                key={f.id}
                type="button"
                aria-current={folder === f.id ? "page" : undefined}
                onClick={() => {
                  setFolder(f.id);
                  setSelectedId(null);
                }}
                className={cn(
                  "flex h-9 shrink-0 items-center gap-3 rounded-full px-4 text-sm transition-colors",
                  folder === f.id
                    ? "bg-[var(--accent)] font-semibold text-[var(--foreground)]"
                    : "text-[var(--foreground)]/80 hover:bg-[var(--muted)]",
                )}
              >
                <f.icon className="h-4 w-4" aria-hidden="true" />
                <span className="flex-1 text-left">{f.label}</span>
                {f.id === "inbox" && unread > 0 && (
                  <span className="text-xs font-bold" aria-label={`${unread} unread`}>
                    {unread}
                  </span>
                )}
              </button>
            ))}
          </nav>

          {/* Message list */}
          <div
            className={cn(
              "flex min-h-0 min-w-0 flex-col border-[var(--border)] xl:border-r",
              selected && "hidden xl:flex",
            )}
          >
            <div className="flex items-center gap-2 border-b border-[var(--border)] p-3">
              <label className="relative flex-1">
                <Search
                  className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted-foreground)]"
                  aria-hidden="true"
                />
                <input
                  aria-label="Search mail"
                  placeholder="Search mail"
                  className="h-10 w-full rounded-full bg-[var(--muted)] pl-10 pr-4 text-sm outline-none ring-[var(--ring)] focus:bg-[var(--card)] focus:ring-2"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </label>
              <IconButton label="Refresh" onClick={() => void refresh()}>
                <RefreshCw className={cn("h-4 w-4", list.isFetching && "animate-spin")} />
              </IconButton>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {list.isPending ? (
                <LoadingRows rows={6} />
              ) : list.isError ? (
                <ErrorState error={list.error} onRetry={() => void list.refetch()} />
              ) : messages.length === 0 ? (
                <div className="grid h-full place-items-center p-8 text-center">
                  <div>
                    <Mail
                      className="mx-auto mb-3 h-8 w-8 text-[var(--muted-foreground)]/50"
                      aria-hidden="true"
                    />
                    <p className="text-sm text-[var(--muted-foreground)]">
                      {q ? "No messages match your search" : "No messages"}
                    </p>
                  </div>
                </div>
              ) : (
                <ul aria-label="Messages">
                  {messages.map((m) => (
                    <MessageRow
                      key={m.id}
                      message={m}
                      folder={folder}
                      active={m.id === selectedId}
                      name={folder === "sent" ? nameOf(m.counterparty) : nameOf(m.counterparty)}
                      live={live}
                      onOpen={() => setSelectedId(m.id)}
                      onTrash={() => quick.mutate({ id: m.id, action: "trash" })}
                      onToggleRead={() =>
                        quick.mutate({ id: m.id, action: m.read ? "unread" : "read" })
                      }
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
          </div>

          {/* Reading pane */}
          <div className={cn("min-h-0 min-w-0", !selected && "hidden xl:block")}>
            {selected ? (
              <Reader
                agent={agent}
                message={selected}
                live={live}
                folder={folder}
                nameOf={nameOf}
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
              <div className="grid h-full place-items-center p-8 text-center">
                <div>
                  <MailOpen
                    className="mx-auto mb-3 h-8 w-8 text-[var(--muted-foreground)]/50"
                    aria-hidden="true"
                  />
                  <p className="text-sm text-[var(--muted-foreground)]">No message selected</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      {draft && (
        <ComposeWindow
          key={draft.replyTo?.id ?? "new"}
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

function MessageRow({
  message: m,
  folder,
  active,
  name,
  live,
  onOpen,
  onTrash,
  onToggleRead,
}: {
  message: MailMessage;
  folder: MailFolder;
  active: boolean;
  name: string;
  live: boolean;
  onOpen: () => void;
  onTrash: () => void;
  onToggleRead: () => void;
}) {
  const unread = m.direction === "in" && !m.read;
  const preview = (m.preview ?? m.text ?? "").replace(/\s+/g, " ").slice(0, 160);
  const files = attachmentsOf(m);
  return (
    <li
      className={cn(
        "group relative border-b border-[var(--border)] transition-colors",
        active ? "bg-[var(--accent)]" : "hover:bg-[var(--muted)]/60",
      )}
    >
      <button
        type="button"
        onClick={onOpen}
        aria-current={active ? "true" : undefined}
        className="flex w-full gap-3 px-4 py-3 text-left"
      >
        <Avatar name={name || "?"} size="md" colorful />
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline justify-between gap-2">
            <span
              className={cn(
                "truncate text-sm",
                unread ? "font-bold text-[var(--foreground)]" : "text-[var(--foreground)]/85",
              )}
            >
              {folder === "sent" ? `To: ${name}` : name}
            </span>
            <span
              className={cn(
                "shrink-0 text-xs group-hover:invisible",
                unread ? "font-bold text-[var(--foreground)]" : "text-[var(--muted-foreground)]",
              )}
            >
              {formatListTime(m.at)}
            </span>
          </span>
          <span
            className={cn(
              "mt-0.5 block truncate text-sm",
              unread ? "font-bold" : "text-[var(--foreground)]/85",
            )}
          >
            {m.subject || "(no subject)"}
          </span>
          <span className="block truncate text-[13px] text-[var(--muted-foreground)]">
            {preview}
          </span>
          {files.length > 0 && (
            <span className="mt-1.5 inline-flex max-w-full items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--card)] px-2.5 py-0.5 text-xs text-[var(--foreground)]/80">
              <Paperclip className="h-3 w-3 shrink-0" aria-hidden="true" />
              <span className="truncate">{files[0]!.filename}</span>
              {files.length > 1 && <span>+{files.length - 1}</span>}
            </span>
          )}
        </span>
      </button>
      {live && folder !== "trash" && (
        <span className="absolute right-2 top-2 hidden items-center gap-0.5 rounded-full bg-[var(--card)] shadow-sm ring-1 ring-[var(--border)] group-hover:flex">
          <IconButton
            label="Move to bin"
            onClick={(e) => {
              e.stopPropagation();
              onTrash();
            }}
          >
            <Trash2 className="h-4 w-4" />
          </IconButton>
          {m.direction === "in" && (
            <IconButton
              label={m.read ? "Mark as unread" : "Mark as read"}
              onClick={(e) => {
                e.stopPropagation();
                onToggleRead();
              }}
            >
              {m.read ? <Mail className="h-4 w-4" /> : <MailOpen className="h-4 w-4" />}
            </IconButton>
          )}
        </span>
      )}
    </li>
  );
}

function Reader({
  agent,
  message,
  live,
  folder,
  nameOf,
  onBack,
  onReply,
  onChanged,
}: {
  agent: Agent;
  message: MailMessage;
  live: boolean;
  folder: MailFolder;
  nameOf: (address: string | null) => string;
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
  const own = agent.resources.mail?.address?.toLowerCase();
  const from = m.direction === "in" ? (m.counterparty ?? "") : (own ?? "");
  const fromName = m.direction === "in" ? nameOf(m.counterparty) : agent.name;
  const recipients = (m.direction === "in" ? to : to.length ? to : [m.counterparty ?? ""])
    .map((address) => (address.toLowerCase() === own ? "me" : nameOf(address)))
    .join(", ");

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
            ? "Moved back"
            : "Marked as unread",
      );
      await onChanged(true);
    },
    onError: (error) => toastError(error),
  });

  return (
    <article className="flex h-full flex-col" aria-label="Message">
      <div className="flex items-center gap-1 border-b border-[var(--border)] px-3 py-2">
        <span className="xl:hidden">
          <IconButton label="Back" onClick={onBack}>
            <ArrowLeft className="h-4 w-4" />
          </IconButton>
        </span>
        {live && (
          <>
            <IconButton label="Reply" onClick={onReply}>
              <Reply className="h-4 w-4" />
            </IconButton>
            {folder === "trash" ? (
              <IconButton
                label="Move back"
                disabled={act.isPending}
                onClick={() => act.mutate("restore")}
              >
                <RotateCcw className="h-4 w-4" />
              </IconButton>
            ) : (
              <IconButton
                label="Move to bin"
                disabled={act.isPending}
                onClick={() => act.mutate("trash")}
              >
                <Trash2 className="h-4 w-4" />
              </IconButton>
            )}
            {m.direction === "in" && folder !== "trash" && (
              <IconButton
                label="Mark as unread"
                disabled={act.isPending}
                onClick={() => act.mutate("unread")}
              >
                <Mail className="h-4 w-4" />
              </IconButton>
            )}
            {folder === "trash" && (
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
            )}
          </>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        <h3 className="break-words text-[1.375rem] font-normal leading-snug tracking-tight">
          {m.subject || "(no subject)"}
        </h3>
        <div className="mt-5 flex items-start gap-3">
          <Avatar name={fromName || "?"} size="md" colorful />
          <div className="min-w-0 flex-1">
            <p className="flex flex-wrap items-baseline gap-x-1.5 text-sm">
              <span className="font-semibold">{fromName}</span>
              {fromName !== from && (
                <span className="text-xs text-[var(--muted-foreground)]">&lt;{from}&gt;</span>
              )}
            </p>
            <p className="truncate text-xs text-[var(--muted-foreground)]">
              to {recipients}
              {cc.length ? `, cc ${cc.map(nameOf).join(", ")}` : ""}
            </p>
          </div>
          <time
            className="shrink-0 text-xs text-[var(--muted-foreground)]"
            dateTime={m.at}
            title={formatDateTime(m.at)}
          >
            {formatDateTime(m.at)}
          </time>
        </div>
        {m.direction === "out" && (m.status === "simulated" || m.status === "failed") && (
          <Notice tone="warning" className="ml-[3.25rem] mt-3">
            {m.status === "failed"
              ? "This message couldn't be sent."
              : "This message wasn't delivered."}
          </Notice>
        )}
        <div className="mt-5 sm:ml-[3.25rem]">
          {html ? (
            <iframe
              title="Message"
              sandbox=""
              srcDoc={html}
              className="h-[30rem] w-full rounded-lg border border-[var(--border)] bg-white"
            />
          ) : (
            <div className="whitespace-pre-wrap break-words text-[15px] leading-relaxed">
              {full.isPending && live && !m.text ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-label="Loading" />
              ) : (
                m.text
              )}
            </div>
          )}
          {files.length > 0 && (
            <div className="mt-6 border-t border-[var(--border)] pt-4">
              <p className="mb-3 text-sm font-medium">
                {files.length} attachment{files.length === 1 ? "" : "s"}
              </p>
              <div className="flex flex-wrap gap-3">
                {files.map((file) => (
                  <FileCard key={file.id} agent={agent} file={file} />
                ))}
              </div>
            </div>
          )}
          {live && (
            <div className="mt-8">
              <Button variant="outline" className="rounded-full px-5" onClick={onReply}>
                <Reply aria-hidden="true" /> Reply
              </Button>
            </div>
          )}
        </div>
      </div>
    </article>
  );
}

function fileIcon(type: string) {
  if (type.startsWith("image/")) return FileImage;
  if (type.startsWith("text/") || type.includes("pdf") || type.includes("document"))
    return FileText;
  return File;
}

function FileCard({ agent, file }: { agent: Agent; file: FileRef }) {
  const [busy, setBusy] = useState(false);
  const Icon = fileIcon(file.contentType);
  return (
    <button
      type="button"
      disabled={busy}
      title={`Download ${file.filename}`}
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
      className="flex w-52 items-center gap-3 rounded-xl border border-[var(--border)] p-3 text-left transition-colors hover:bg-[var(--muted)]"
    >
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-[var(--accent)] text-[var(--aid-ink)]">
        {busy ? (
          <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
        ) : (
          <Icon className="h-5 w-5" aria-hidden="true" />
        )}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium">{file.filename}</span>
        <span className="block text-xs text-[var(--muted-foreground)]">
          {formatBytes(file.size)}
        </span>
      </span>
    </button>
  );
}

type Upload = { key: string; name: string; size: number; file?: FileRef; error?: string };

// A compose window in the bottom-right corner, like a desktop mail app.
function ComposeWindow({
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
  const [showCc, setShowCc] = useState(!!draft.cc);
  const [subject, setSubject] = useState(draft.subject);
  const [text, setText] = useState(draft.text);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [minimized, setMinimized] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const agents = useAgents();
  const mode = agent.resources.mail?.mode;
  const addresses = (agents.data ?? [])
    .filter(
      (a) => a.id !== agent.id && a.resources.mail?.mode === mode && a.resources.mail?.address,
    )
    .map((a) => ({ name: a.name, address: a.resources.mail?.address ?? "" }));
  const uploading = uploads.some((u) => !u.file && !u.error);
  const title = subject.trim() || (draft.replyTo ? "Reply" : "New message");

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
      else toast.success("Message sent");
      onClose();
      await onSent();
    },
  });

  const canSend = !!text.trim() && (!!to.trim() || !!draft.replyTo) && !uploading;

  return (
    <div
      role="dialog"
      aria-label={title}
      onKeyDown={(e) => e.key === "Escape" && onClose()}
      className={cn(
        "fixed bottom-0 z-50 flex flex-col overflow-hidden rounded-t-xl border border-[var(--border)] bg-[var(--card)] shadow-[0_8px_40px_rgba(15,20,30,0.22)]",
        minimized
          ? "right-4 w-72 sm:right-8"
          : "inset-x-0 top-12 sm:inset-x-auto sm:right-8 sm:top-auto sm:h-[34rem] sm:w-[34rem]",
      )}
    >
      <div className="flex h-11 shrink-0 items-center justify-between bg-[var(--muted)] pl-4 pr-1.5">
        <button
          type="button"
          className="min-w-0 flex-1 truncate text-left text-sm font-medium"
          onClick={() => setMinimized((v) => !v)}
        >
          {title}
        </button>
        <IconButton
          label={minimized ? "Expand" : "Minimise"}
          onClick={() => setMinimized((v) => !v)}
        >
          {minimized ? <Maximize2 className="h-3.5 w-3.5" /> : <Minus className="h-4 w-4" />}
        </IconButton>
        <IconButton label="Close" onClick={onClose}>
          <X className="h-4 w-4" />
        </IconButton>
      </div>
      {!minimized && (
        <form
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            if (canSend && !send.isPending) send.mutate();
          }}
        >
          <div className="flex items-center gap-2 border-b border-[var(--border)] px-4">
            <label htmlFor="compose-to" className="text-sm text-[var(--muted-foreground)]">
              To
            </label>
            <input
              id="compose-to"
              autoComplete="off"
              list="compose-addresses"
              autoFocus={!draft.replyTo}
              className="h-10 min-w-0 flex-1 bg-transparent text-sm outline-none"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
            {!showCc && (
              <button
                type="button"
                className="text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                onClick={() => setShowCc(true)}
              >
                Cc
              </button>
            )}
            <datalist id="compose-addresses">
              {addresses.map((a) => (
                <option key={a.address} value={a.address}>
                  {a.name}
                </option>
              ))}
            </datalist>
          </div>
          {showCc && (
            <div className="flex items-center gap-2 border-b border-[var(--border)] px-4">
              <label htmlFor="compose-cc" className="text-sm text-[var(--muted-foreground)]">
                Cc
              </label>
              <input
                id="compose-cc"
                autoComplete="off"
                className="h-10 min-w-0 flex-1 bg-transparent text-sm outline-none"
                value={cc}
                onChange={(e) => setCc(e.target.value)}
              />
            </div>
          )}
          <input
            aria-label="Subject"
            placeholder="Subject"
            className="h-10 border-b border-[var(--border)] bg-transparent px-4 text-sm outline-none placeholder:text-[var(--muted-foreground)]"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
          />
          <textarea
            aria-label="Message"
            autoFocus={!!draft.replyTo}
            className="min-h-0 flex-1 resize-none bg-transparent px-4 py-3 text-[15px] leading-relaxed outline-none"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          {uploads.length > 0 && (
            <ul className="flex flex-wrap gap-2 px-4 pb-2" aria-label="Attachments">
              {uploads.map((u) => (
                <li
                  key={u.key}
                  className={cn(
                    "inline-flex max-w-full items-center gap-2 rounded-lg border px-2.5 py-1 text-xs",
                    u.error
                      ? "border-[var(--aid-danger)] text-[var(--aid-danger)]"
                      : "border-[var(--border)] bg-[var(--muted)]",
                  )}
                >
                  {!u.file && !u.error ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-label="Uploading" />
                  ) : (
                    <Paperclip className="h-3.5 w-3.5" aria-hidden="true" />
                  )}
                  <span className="max-w-40 truncate font-medium">{u.name}</span>
                  <span className="opacity-70">{u.error ?? formatBytes(u.size)}</span>
                  <button
                    type="button"
                    aria-label={`Remove ${u.name}`}
                    className="rounded p-0.5 hover:bg-[var(--card)]"
                    onClick={() => setUploads((list) => list.filter((x) => x.key !== u.key))}
                  >
                    <X className="h-3 w-3" aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          {send.isError && (
            <Notice tone="danger" className="mx-4 mb-2">
              {errorMessage(send.error)}
            </Notice>
          )}
          <div className="flex items-center gap-1 px-3 py-2.5">
            <Button
              type="submit"
              className="rounded-full px-6"
              disabled={!canSend || send.isPending}
            >
              {send.isPending && <Loader2 className="animate-spin" aria-hidden="true" />}
              Send
            </Button>
            <input
              ref={fileInput}
              type="file"
              multiple
              className="sr-only"
              tabIndex={-1}
              onChange={(e) => void attach(e.target.files)}
            />
            <IconButton label="Attach files" onClick={() => fileInput.current?.click()}>
              <Paperclip className="h-4 w-4" />
            </IconButton>
            <span className="flex-1" />
            <IconButton label="Discard" onClick={onClose}>
              <Trash2 className="h-4 w-4" />
            </IconButton>
          </div>
        </form>
      )}
    </div>
  );
}
