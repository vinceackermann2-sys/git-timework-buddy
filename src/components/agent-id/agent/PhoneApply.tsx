// Phone numbers aren't open yet: owners apply for one per agent, like cards.
import { useState } from "react";
import type { FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Phone } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { AgentIdError, errorMessage } from "@/lib/agent-id/client";
import { formatDate } from "@/lib/agent-id/format";
import { usePhoneApplication } from "@/lib/agent-id/queries";
import { api } from "@/lib/agent-id/session";
import type { Agent, PhoneUse } from "@/lib/agent-id/types";
import { ErrorState, Field, LoadingRows, Notice, Section } from "../ui";

const USE_LABELS: Record<PhoneUse, string> = { sms: "Texts", calls: "Calls" };

export function PhoneApply({ agent }: { agent: Agent }) {
  const application = usePhoneApplication(agent.id);
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
            <Phone className="h-5 w-5" aria-hidden="true" />
          </span>
          <p className="text-lg font-semibold">Applied {formatDate(application.data.createdAt)}</p>
          <p className="text-sm text-[var(--muted-foreground)]">
            We'll email you when {agent.name}'s number is ready.
          </p>
          <p className="text-xs text-[var(--muted-foreground)]">
            {application.data.uses.map((use) => USE_LABELS[use]).join(" and ")}
            {application.data.country ? ` · ${application.data.country}` : ""}
          </p>
        </div>
      </Section>
    );
  }
  return <ApplyForm agent={agent} />;
}

function ApplyForm({ agent }: { agent: Agent }) {
  const [useCase, setUseCase] = useState("");
  const [uses, setUses] = useState<PhoneUse[]>(["sms", "calls"]);
  const [country, setCountry] = useState("");
  const queryClient = useQueryClient();
  const countryOk = /^[A-Za-z]{2}$/.test(country.trim());
  const apply = useMutation({
    mutationFn: () =>
      api.applyForPhone(agent.id, {
        useCase: useCase.trim(),
        uses,
        country: country.trim().toUpperCase(),
      }),
    onSuccess: async () => {
      toast.success("You're on the list");
      await queryClient.invalidateQueries({
        queryKey: ["agent-id", "phone-application", agent.id],
      });
    },
  });
  const toggle = (use: PhoneUse, on: boolean) =>
    setUses((current) => (on ? [...new Set([...current, use])] : current.filter((u) => u !== use)));
  const ready = !!useCase.trim() && uses.length > 0 && countryOk && !apply.isPending;

  return (
    <Section title={`Get a phone number for ${agent.name}`}>
      <form
        className="grid max-w-xl gap-5"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          if (ready) apply.mutate();
        }}
      >
        <Field id="phone-use" label="What will it use the number for?">
          <Textarea
            id="phone-use"
            rows={3}
            maxLength={1000}
            placeholder="Booking appointments and answering customer texts"
            value={useCase}
            onChange={(e) => setUseCase(e.target.value)}
          />
        </Field>
        <fieldset className="grid gap-2">
          <legend className="mb-1 text-sm font-medium">It needs</legend>
          <div className="flex flex-wrap gap-5">
            {(Object.keys(USE_LABELS) as PhoneUse[]).map((use) => (
              <label key={use} className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={uses.includes(use)}
                  onCheckedChange={(checked) => toggle(use, checked === true)}
                />
                {USE_LABELS[use]}
              </label>
            ))}
          </div>
        </fieldset>
        <Field
          id="phone-country"
          label="Country"
          error={country.trim() && !countryOk ? "Two letters, like US" : null}
        >
          <Input
            id="phone-country"
            maxLength={2}
            placeholder="US"
            className="max-w-[10rem]"
            value={country}
            onChange={(e) => setCountry(e.target.value.toUpperCase())}
          />
        </Field>
        {apply.isError && <Notice tone="danger">{errorMessage(apply.error)}</Notice>}
        <div>
          <Button type="submit" disabled={!ready}>
            {apply.isPending && <Loader2 className="animate-spin" aria-hidden="true" />}
            Apply for a phone number
          </Button>
        </div>
      </form>
    </Section>
  );
}
