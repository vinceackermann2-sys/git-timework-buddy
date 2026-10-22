// The agent's contacts, like a phone's address book: an A–Z list and a card
// per contact with message, call and mail actions.
import { useMemo, useState } from "react";
import type { FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Mail, MessageCircle, Phone, Plus, Search, Wallet } from "lucide-react";
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
import { formatPhone } from "@/lib/agent-id/format";
import { queryKeys, useContacts } from "@/lib/agent-id/queries";
import { api } from "@/lib/agent-id/session";
import type { Agent, Contact } from "@/lib/agent-id/types";
import {
  Avatar,
  ConfirmButton,
  ErrorState,
  Field,
  LoadingRows,
  Notice,
  Popup,
  toastError,
} from "../ui";

type Draft = {
  id?: string;
  name: string;
  email: string;
  phone: string;
  wallet: string;
  note: string;
};
const EMPTY: Draft = { name: "", email: "", phone: "", wallet: "", note: "" };

// Contacts under their first letter, A to Z, then everything else under #.
export function alphabetical(contacts: Contact[]): { letter: string; contacts: Contact[] }[] {
  const groups = new Map<string, Contact[]>();
  for (const c of [...contacts].sort((a, b) => a.name.localeCompare(b.name))) {
    const first = c.name.trim().charAt(0).toUpperCase();
    const letter = /[A-Z]/.test(first) ? first : "#";
    groups.set(letter, [...(groups.get(letter) ?? []), c]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => (a === "#" ? 1 : b === "#" ? -1 : a.localeCompare(b)))
    .map(([letter, list]) => ({ letter, contacts: list }));
}

export function ContactsBook({
  agent,
  canEdit,
  onMessage,
  onCall,
  onMail,
}: {
  agent: Agent;
  canEdit: boolean;
  onMessage: (phone: string) => void;
  onCall: (phone: string) => void;
  onMail: (email: string) => void;
}) {
  const contacts = useContacts(agent.id);
  const [search, setSearch] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const queryClient = useQueryClient();
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const all = contacts.data ?? [];
    return q
      ? all.filter((c) =>
          [c.name, c.email, c.phone, c.wallet].some((v) => v?.toLowerCase().includes(q)),
        )
      : all;
  }, [contacts.data, search]);
  const open = contacts.data?.find((c) => c.id === openId) ?? null;

  return (
    <section className="aid-card overflow-hidden">
      <div className="flex items-center gap-2 border-b border-[var(--border)] p-3">
        <label className="relative flex-1">
          <Search
            className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted-foreground)]"
            aria-hidden="true"
          />
          <input
            aria-label="Search contacts"
            placeholder="Search"
            className="h-10 w-full rounded-full bg-[var(--muted)] pl-10 pr-4 text-sm outline-none focus:ring-2 focus:ring-[var(--ring)]"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        {canEdit && (
          <Button
            size="icon"
            variant="ghost"
            className="rounded-full"
            aria-label="Add contact"
            onClick={() => setDraft({ ...EMPTY })}
          >
            <Plus aria-hidden="true" />
          </Button>
        )}
      </div>

      {contacts.isPending ? (
        <LoadingRows rows={4} />
      ) : contacts.isError ? (
        <ErrorState error={contacts.error} onRetry={() => void contacts.refetch()} />
      ) : filtered.length === 0 ? (
        <div className="px-5 py-14 text-center text-sm text-[var(--muted-foreground)]">
          {search ? "No contacts match" : "No contacts"}
        </div>
      ) : (
        <div>
          {alphabetical(filtered).map((group) => (
            <section key={group.letter} aria-label={group.letter}>
              <h3 className="sticky top-0 bg-[var(--muted)]/80 px-5 py-1 text-xs font-semibold text-[var(--muted-foreground)] backdrop-blur">
                {group.letter}
              </h3>
              <ul>
                {group.contacts.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => setOpenId(c.id)}
                      className="flex w-full items-center gap-3 border-b border-[var(--border)] px-5 py-2.5 text-left last:border-b-0 hover:bg-[var(--muted)]/60"
                    >
                      <Avatar name={c.name} size="md" colorful />
                      <span className="min-w-0">
                        <span className="block truncate text-[15px] font-medium">{c.name}</span>
                        <span className="block truncate text-xs text-[var(--muted-foreground)]">
                          {c.phone ? formatPhone(c.phone) : (c.email ?? c.wallet ?? "")}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      <Popup open={!!open} onOpenChange={(next) => !next && setOpenId(null)} title="Contact">
        {open && (
          <div className="flex flex-col items-center text-center">
            <Avatar name={open.name} size="xl" colorful />
            <p className="mt-3 text-2xl font-semibold tracking-tight">{open.name}</p>
            <div className="mt-5 grid w-full grid-cols-3 gap-2">
              <ContactAction
                label="Message"
                icon={MessageCircle}
                disabled={!open.phone || !canEdit}
                onClick={() => {
                  setOpenId(null);
                  onMessage(open.phone!);
                }}
              />
              <ContactAction
                label="Call"
                icon={Phone}
                disabled={!open.phone || !canEdit}
                onClick={() => {
                  setOpenId(null);
                  onCall(open.phone!);
                }}
              />
              <ContactAction
                label="Mail"
                icon={Mail}
                disabled={!open.email || !canEdit}
                onClick={() => {
                  setOpenId(null);
                  onMail(open.email!);
                }}
              />
            </div>
            <dl className="mt-6 w-full divide-y divide-[var(--border)] overflow-hidden rounded-xl border border-[var(--border)] text-left">
              {open.phone && <Detail term="Phone" value={formatPhone(open.phone)} />}
              {open.email && <Detail term="Email" value={open.email} />}
              {open.wallet && (
                <Detail
                  term="Wallet"
                  value={
                    <span className="flex items-center gap-1.5">
                      <Wallet className="h-3.5 w-3.5" aria-hidden="true" />
                      <span className="aid-mono break-all">{open.wallet}</span>
                    </span>
                  }
                />
              )}
              {open.note && <Detail term="Note" value={open.note} />}
            </dl>
            {canEdit && (
              <div className="mt-6 flex gap-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    setDraft({
                      id: open.id,
                      name: open.name,
                      email: open.email ?? "",
                      phone: open.phone ?? "",
                      wallet: open.wallet ?? "",
                      note: open.note ?? "",
                    });
                    setOpenId(null);
                  }}
                >
                  Edit
                </Button>
                <ConfirmButton
                  title={`Delete ${open.name}?`}
                  description="The agent won't find this contact any more."
                  confirmLabel="Delete"
                  variant="outline"
                  size="default"
                  onConfirm={async () => {
                    try {
                      await api.asAgent(agent.id).deleteContact(open.id);
                      toast.success("Contact deleted");
                      setOpenId(null);
                      await queryClient.invalidateQueries({
                        queryKey: queryKeys.contacts(agent.id),
                      });
                    } catch (error) {
                      toastError(error, "Couldn't delete the contact");
                    }
                  }}
                >
                  Delete
                </ConfirmButton>
              </div>
            )}
          </div>
        )}
      </Popup>

      {draft && <ContactDialog agent={agent} draft={draft} onClose={() => setDraft(null)} />}
    </section>
  );
}

function ContactAction({
  label,
  icon: Icon,
  onClick,
  disabled,
}: {
  label: string;
  icon: typeof Phone;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="flex flex-col items-center gap-1 rounded-xl bg-[var(--muted)] py-3 text-xs font-medium text-[var(--aid-ink)] transition-colors hover:bg-[var(--accent)] disabled:opacity-40"
    >
      <Icon className="h-5 w-5" aria-hidden="true" />
      {label}
    </button>
  );
}

function Detail({ term, value }: { term: string; value: React.ReactNode }) {
  return (
    <div className="px-4 py-3">
      <dt className="text-xs text-[var(--muted-foreground)]">{term}</dt>
      <dd className="mt-0.5 break-words text-sm">{value}</dd>
    </div>
  );
}

function ContactDialog({
  agent,
  draft,
  onClose,
}: {
  agent: Agent;
  draft: Draft;
  onClose: () => void;
}) {
  const [form, setForm] = useState<Draft>(draft);
  const queryClient = useQueryClient();
  const set = (key: keyof Draft) => (value: string) => setForm((f) => ({ ...f, [key]: value }));
  const save = useMutation({
    mutationFn: () =>
      api.asAgent(agent.id).saveContact({
        ...(form.id ? { id: form.id } : {}),
        name: form.name.trim(),
        email: form.email.trim(),
        phone: form.phone.trim(),
        wallet: form.wallet.trim(),
        note: form.note.trim(),
      }),
    onSuccess: async () => {
      toast.success("Contact saved");
      onClose();
      await queryClient.invalidateQueries({ queryKey: queryKeys.contacts(agent.id) });
    },
  });
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        aria-describedby={undefined}
        className="max-h-[90svh] overflow-y-auto sm:max-w-md sm:rounded-2xl"
      >
        <form
          className="grid gap-4"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            if (form.name.trim()) save.mutate();
          }}
        >
          <DialogHeader>
            <DialogTitle>{form.id ? "Edit contact" : "New contact"}</DialogTitle>
          </DialogHeader>
          <Field id="contact-name" label="Name">
            <Input
              id="contact-name"
              value={form.name}
              maxLength={120}
              autoFocus
              onChange={(e) => set("name")(e.target.value)}
            />
          </Field>
          <Field id="contact-phone" label="Phone">
            <Input
              id="contact-phone"
              inputMode="tel"
              placeholder="+1 415 555 0100"
              value={form.phone}
              onChange={(e) => set("phone")(e.target.value)}
            />
          </Field>
          <Field id="contact-email" label="Email">
            <Input
              id="contact-email"
              type="email"
              value={form.email}
              onChange={(e) => set("email")(e.target.value)}
            />
          </Field>
          <Field id="contact-wallet" label="Wallet">
            <Input
              id="contact-wallet"
              className={cn("aid-mono")}
              placeholder="0x… or an agent's handle"
              value={form.wallet}
              onChange={(e) => set("wallet")(e.target.value)}
            />
          </Field>
          <Field id="contact-note" label="Note">
            <Textarea
              id="contact-note"
              rows={2}
              maxLength={1000}
              value={form.note}
              onChange={(e) => set("note")(e.target.value)}
            />
          </Field>
          {save.isError && <Notice tone="danger">{errorMessage(save.error)}</Notice>}
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!form.name.trim() || save.isPending}>
              {save.isPending && <Loader2 className="animate-spin" aria-hidden="true" />}
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
