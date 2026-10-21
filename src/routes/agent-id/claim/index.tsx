import { useState } from "react";
import type { FormEvent } from "react";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AppIcon } from "@/components/agent-id/AppIcons";
import { ClaimHeading, ClaimLayout } from "@/components/agent-id/claim/ClaimLayout";
import { Field, Notice } from "@/components/agent-id/ui";
import { CLAIM_APPS, appLabel } from "@/lib/agent-id/apps";
import { writeClaimMemory } from "@/lib/agent-id/claims";
import { errorMessage } from "@/lib/agent-id/client";
import { claimsApi } from "@/lib/agent-id/session";

// Getting an Agent ID without an account: name the agent, say where it works,
// then confirm an email and verify (the next page).
export const Route = createFileRoute("/agent-id/claim/")({
  head: () => ({ meta: [{ title: "Get an Agent ID · Timewarp" }] }),
  component: StartClaimPage,
});

function StartClaimPage() {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [app, setApp] = useState<string | null>(null);
  const start = useMutation({
    mutationFn: () => claimsApi.start({ name: name.trim(), ...(app ? { app } : {}) }),
    onSuccess: (result) => {
      writeClaimMemory(result.claim.code, { secret: result.secret });
      void navigate({ to: "/agent-id/claim/$code", params: { code: result.claim.code } });
    },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    if (name.trim() && !start.isPending) start.mutate();
  }

  return (
    <ClaimLayout
      footer={
        <>
          Already have an account?{" "}
          <Link to="/agent-id/sign-in" className="aid-link font-medium">
            Sign in
          </Link>
        </>
      }
    >
      <ClaimHeading title="Get an Agent ID">
        Your agent gets its own email, phone number and wallet. No sign-up needed.
      </ClaimHeading>
      <form onSubmit={submit} className="grid gap-6" noValidate>
        <Field id="claim-name" label="Agent name">
          <Input
            id="claim-name"
            value={name}
            maxLength={60}
            autoComplete="off"
            placeholder="Research Assistant"
            className="h-11"
            autoFocus
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <fieldset>
          <legend className="text-sm font-medium">
            Where do you use it?{" "}
            <span className="font-normal text-[var(--muted-foreground)]">Optional</span>
          </legend>
          <div role="radiogroup" aria-label="App" className="mt-2 grid grid-cols-3 gap-2">
            {CLAIM_APPS.map((slug) => {
              const chosen = app === slug;
              return (
                <button
                  key={slug}
                  type="button"
                  role="radio"
                  aria-checked={chosen}
                  onClick={() => setApp(chosen ? null : slug)}
                  className={cn(
                    "flex min-w-0 flex-col items-center gap-1.5 rounded-xl border px-1 py-2.5 text-xs transition-colors",
                    chosen
                      ? "border-[var(--aid-ink)] bg-[var(--accent)] font-medium"
                      : "border-[var(--border)] hover:bg-[var(--muted)]",
                  )}
                >
                  <span aria-hidden="true" className="inline-flex">
                    <AppIcon app={slug} size="md" tooltip={false} />
                  </span>
                  <span className="w-full truncate">{appLabel(slug)}</span>
                </button>
              );
            })}
          </div>
        </fieldset>
        {start.isError && <Notice tone="danger">{errorMessage(start.error)}</Notice>}
        <Button type="submit" className="h-11 w-full" disabled={!name.trim() || start.isPending}>
          {start.isPending && <Loader2 className="animate-spin" aria-hidden="true" />}
          Continue
        </Button>
      </form>
    </ClaimLayout>
  );
}
