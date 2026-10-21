// For Agent ID staff: what this deployment has switched on, and connecting
// its webhooks, which is the last step of going live.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Loader2 } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { KIND_LABELS } from "@/lib/agent-id/format";
import { shouldRetry } from "@/lib/agent-id/queries";
import { api } from "@/lib/agent-id/session";
import { KINDS, type AdminSetup, type AdminStatus } from "@/lib/agent-id/types";
import { ErrorState, LoadingRows, Notice, Section, toastError } from "./ui";

const KEY = ["agent-id", "admin-status"] as const;

const PERSON_PROVIDERS: Record<string, string> = {
  stripe_identity: "Stripe Identity",
  manual: "Reviewed by staff",
  test: "Test (verified at once)",
};

function Item({ ok, label, note }: { ok: boolean; label: string; note?: ReactNode }) {
  return (
    <li className="flex items-start gap-3 py-2">
      <span
        aria-hidden="true"
        className={cn(
          "mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full",
          ok ? "bg-[var(--aid-success-bg)] text-[var(--aid-success)]" : "bg-[var(--muted)]",
        )}
      >
        {ok ? (
          <Check className="h-3 w-3" />
        ) : (
          <span className="h-1.5 w-1.5 rounded-full bg-[var(--muted-foreground)]/50" />
        )}
      </span>
      <span className="min-w-0 text-sm">
        <span className="font-medium">{label}</span>
        <span className="sr-only">{ok ? " (done)" : " (not yet)"}</span>
        {note && <span className="block text-xs text-[var(--muted-foreground)]">{note}</span>}
      </span>
    </li>
  );
}

const resourceNote = (r: AdminStatus["resources"][keyof AdminStatus["resources"]]) =>
  r.live
    ? `Live with ${r.provider}`
    : r.enabled
      ? `Switched on, but ${r.provider} isn't set up`
      : r.configured
        ? `${r.provider} is set up; add it to AGENT_ID_LIVE to go live`
        : "Test only";

const SETUP_WORDS: Record<string, string> = {
  registered: "connected",
  kept: "already connected",
  not_needed: "not needed",
};

export function Operator() {
  const queryClient = useQueryClient();
  const status = useQuery({ queryKey: KEY, queryFn: () => api.adminStatus(), retry: shouldRetry });
  const setup = useMutation({
    mutationFn: () => api.adminSetup(),
    onSuccess: (result: AdminSetup) => queryClient.setQueryData(KEY, result.status),
    onError: (error) => toastError(error, "Couldn't connect the webhooks"),
  });
  const s = status.data;
  const hooksNeeded = s ? Object.values(s.webhooks).some((w) => w.needed && !w.registered) : false;

  return (
    <Section
      title="Operator"
      actions={
        <Button size="sm" disabled={!s || setup.isPending} onClick={() => setup.mutate()}>
          {setup.isPending && <Loader2 className="animate-spin" aria-hidden="true" />}
          Connect webhooks
        </Button>
      }
      flush={!s}
    >
      {status.isPending ? (
        <LoadingRows rows={3} />
      ) : status.isError ? (
        <ErrorState error={status.error} onRetry={() => void status.refetch()} />
      ) : (
        <div className="grid gap-x-10 gap-y-2 md:grid-cols-2">
          <ul aria-label="Resources" className="divide-y divide-[var(--border)]">
            {KINDS.map((kind) => (
              <Item
                key={kind}
                ok={s!.resources[kind].live}
                label={KIND_LABELS[kind]}
                note={resourceNote(s!.resources[kind])}
              />
            ))}
          </ul>
          <ul aria-label="Trust and webhooks" className="divide-y divide-[var(--border)]">
            <Item ok={s!.passports} label="Passports are signed" />
            <Item ok={s!.phoneWebhooks} label="Phone webhooks are protected" />
            <Item
              ok={s!.verification.person === "stripe_identity"}
              label="Identity checks"
              note={PERSON_PROVIDERS[s!.verification.person] ?? s!.verification.person}
            />
            {(["stripe", "resend"] as const).map((name) => {
              const hook = s!.webhooks[name];
              return (
                <Item
                  key={name}
                  ok={hook.needed && hook.registered}
                  label={`${name === "stripe" ? "Stripe" : "Resend"} webhook`}
                  note={
                    !hook.needed
                      ? "Not needed yet"
                      : hook.registered
                        ? "Connected"
                        : "Not connected"
                  }
                />
              );
            })}
          </ul>
          {(setup.data || hooksNeeded) && (
            <div className="md:col-span-2 md:pt-2">
              {setup.data ? (
                <Notice
                  tone={
                    Object.values(setup.data.setup).some((v) => v === "registered" || v === "kept")
                      ? "success"
                      : "neutral"
                  }
                >
                  Stripe {SETUP_WORDS[setup.data.setup.stripe] ?? setup.data.setup.stripe} · Resend{" "}
                  {SETUP_WORDS[setup.data.setup.resend] ?? setup.data.setup.resend}
                </Notice>
              ) : (
                <Notice>Connect the webhooks to finish going live.</Notice>
              )}
            </div>
          )}
        </div>
      )}
    </Section>
  );
}
