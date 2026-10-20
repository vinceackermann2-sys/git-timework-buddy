import { useState } from "react";
import type { FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";

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
import { queryKeys, useContacts } from "@/lib/agent-id/queries";
import { api } from "@/lib/agent-id/session";
import type { Agent } from "@/lib/agent-id/types";
import {
  ConfirmButton,
  Empty,
  ErrorState,
  Field,
  LoadingRows,
  Notice,
  Row,
  Rows,
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

// The agent's contacts, inside its Mail tab.
export function Contacts({ agent, canEdit }: { agent: Agent; canEdit: boolean }) {
  const contacts = useContacts(agent.id);
  const [draft, setDraft] = useState<Draft | null>(null);
  const queryClient = useQueryClient();

  const add = canEdit ? (
    <Button size="sm" variant="outline" onClick={() => setDraft({ ...EMPTY })}>
      <Plus aria-hidden="true" /> Add contact
    </Button>
  ) : undefined;

  return (
    <>
      {contacts.isPending ? (
        <LoadingRows rows={3} />
      ) : contacts.isError ? (
        <ErrorState error={contacts.error} onRetry={() => void contacts.refetch()} />
      ) : contacts.data.length === 0 ? (
        <Empty action={add}>No contacts yet.</Empty>
      ) : (
        <>
          <Rows label="Contacts">
            {contacts.data.map((c) => (
              <Row key={c.id}>
                <div className="min-w-0">
                  <p className="text-sm font-medium">{c.name}</p>
                  <p className="aid-mono break-all text-xs text-[var(--muted-foreground)]">
                    {[c.email, c.phone, c.wallet].filter(Boolean).join(" · ") || "—"}
                  </p>
                  {c.note && <p className="text-xs text-[var(--muted-foreground)]">{c.note}</p>}
                </div>
                {canEdit && (
                  <div className="flex shrink-0 gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        setDraft({
                          id: c.id,
                          name: c.name,
                          email: c.email ?? "",
                          phone: c.phone ?? "",
                          wallet: c.wallet ?? "",
                          note: c.note ?? "",
                        })
                      }
                    >
                      Edit
                    </Button>
                    <ConfirmButton
                      title={`Remove ${c.name}?`}
                      description="The agent won't find this contact any more."
                      confirmLabel="Remove"
                      onConfirm={async () => {
                        try {
                          await api.asAgent(agent.id).deleteContact(c.id);
                          toast.success("Contact removed");
                          await queryClient.invalidateQueries({
                            queryKey: queryKeys.contacts(agent.id),
                          });
                        } catch (error) {
                          toastError(error, "Couldn't remove the contact");
                        }
                      }}
                    >
                      Remove
                    </ConfirmButton>
                  </div>
                )}
              </Row>
            ))}
          </Rows>
          {add && <div className="border-t border-[var(--border)] px-5 py-3">{add}</div>}
        </>
      )}
      {draft && <ContactDialog agent={agent} draft={draft} onClose={() => setDraft(null)} />}
    </>
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
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-md sm:rounded-xl">
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
              onChange={(e) => set("name")(e.target.value)}
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
          <Field id="contact-phone" label="Phone">
            <Input
              id="contact-phone"
              inputMode="tel"
              placeholder="+14155550123"
              value={form.phone}
              onChange={(e) => set("phone")(e.target.value)}
            />
          </Field>
          <Field id="contact-wallet" label="Wallet">
            <Input
              id="contact-wallet"
              className="aid-mono"
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
