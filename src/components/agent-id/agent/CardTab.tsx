// Virtual cards aren't open yet: owners apply for early access per agent.
import { useState } from "react";
import type { FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CreditCard, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { AgentIdError, errorMessage } from "@/lib/agent-id/client";
import { formatDate, formatUsd, parseAmount } from "@/lib/agent-id/format";
import { useCardApplication } from "@/lib/agent-id/queries";
import { api } from "@/lib/agent-id/session";
import type { Agent } from "@/lib/agent-id/types";
import { ErrorState, Field, LoadingRows, Notice, Section } from "../ui";

export function CardTab({ agent }: { agent: Agent }) {
  const application = useCardApplication(agent.id);
  // Before the application endpoint exists, a 404 just means "not applied".
  const missing = application.error instanceof AgentIdError && application.error.status === 404;

  if (application.isPending) {
    return (
      <Section flush>
        <LoadingRows rows={3} />
      </Section>
    );
  }
  if (application.isError && !missing) {
    return (
      <Section flush>
        <ErrorState error={application.error} onRetry={() => void application.refetch()} />
      </Section>
    );
  }
  if (application.data) {
    return (
      <Section>
        <div className="flex flex-col items-center gap-3 py-6 text-center">
          <span className="grid h-12 w-12 place-items-center rounded-full bg-[var(--primary)] text-[var(--primary-foreground)]">
            <CreditCard className="h-5 w-5" aria-hidden="true" />
          </span>
          <p className="text-lg font-semibold">Applied {formatDate(application.data.createdAt)}</p>
          <p className="text-sm text-[var(--muted-foreground)]">We'll email you when cards open.</p>
          <p className="text-xs text-[var(--muted-foreground)]">
            {application.data.monthlySpend
              ? `${formatUsd(application.data.monthlySpend.amount)} a month · `
              : ""}
            {application.data.country}
          </p>
        </div>
      </Section>
    );
  }
  return <Apply agent={agent} />;
}

function Apply({ agent }: { agent: Agent }) {
  const [useCase, setUseCase] = useState("");
  const [spend, setSpend] = useState("");
  const [country, setCountry] = useState("");
  const queryClient = useQueryClient();
  const cents = parseAmount(spend);
  const countryOk = /^[A-Za-z]{2}$/.test(country.trim());
  const apply = useMutation({
    mutationFn: () =>
      api.applyForCard(agent.id, {
        useCase: useCase.trim(),
        monthlySpend: cents ?? 0,
        country: country.trim().toUpperCase(),
      }),
    onSuccess: async () => {
      toast.success("You're on the list");
      await queryClient.invalidateQueries({ queryKey: ["agent-id", "card-application", agent.id] });
    },
  });

  return (
    <Section title={`A card for ${agent.name}`}>
      <form
        className="grid max-w-xl gap-5"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          if (useCase.trim() && cents && countryOk) apply.mutate();
        }}
      >
        <p className="text-sm text-[var(--muted-foreground)]">
          Virtual cards are coming soon. Apply and we'll let you know.
        </p>
        <Field id="card-use" label="What will the agent buy?">
          <Textarea
            id="card-use"
            rows={3}
            maxLength={1000}
            placeholder="Cloud credits and software subscriptions"
            value={useCase}
            onChange={(e) => setUseCase(e.target.value)}
          />
        </Field>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(10rem,1fr))] gap-4">
          <Field
            id="card-spend"
            label="Monthly spend"
            error={spend.trim() && !cents ? "Like 500" : null}
          >
            <div className="relative">
              <span className="pointer-events-none absolute inset-y-0 left-3 grid place-items-center text-sm text-[var(--muted-foreground)]">
                $
              </span>
              <Input
                id="card-spend"
                inputMode="decimal"
                placeholder="500"
                className="pl-7"
                value={spend}
                onChange={(e) => setSpend(e.target.value)}
              />
            </div>
          </Field>
          <Field
            id="card-country"
            label="Country"
            error={country.trim() && !countryOk ? "Two letters, like US" : null}
          >
            <Input
              id="card-country"
              maxLength={2}
              placeholder="US"
              value={country}
              onChange={(e) => setCountry(e.target.value.toUpperCase())}
            />
          </Field>
        </div>
        {apply.isError && <Notice tone="danger">{errorMessage(apply.error)}</Notice>}
        <div>
          <Button
            type="submit"
            disabled={!useCase.trim() || !cents || !countryOk || apply.isPending}
          >
            {apply.isPending && <Loader2 className="animate-spin" aria-hidden="true" />}
            Apply for early access
          </Button>
        </div>
      </form>
    </Section>
  );
}
