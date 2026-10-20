import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { BadgeCheck, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Chip,
  ErrorState,
  Field,
  LoadingRows,
  Muted,
  Notice,
  PageHeader,
  Section,
} from "@/components/agent-id/ui";
import { errorMessage } from "@/lib/agent-id/client";
import { formatDate, verificationStatusLabel } from "@/lib/agent-id/format";
import { queryKeys, useAccount } from "@/lib/agent-id/queries";
import { api } from "@/lib/agent-id/session";
import type { Organization, Person, VerificationStatus } from "@/lib/agent-id/types";

export const Route = createFileRoute("/agent-id/_app/verify")({
  validateSearch: (search: Record<string, unknown>): { done?: string } =>
    search["done"] !== undefined ? { done: String(search["done"]) } : {},
  head: () => ({ meta: [{ title: "Verification · Agent ID" }] }),
  component: VerifyPage,
});

const COUNTRY = /^[A-Za-z]{2}$/;

function StatusChip({ status }: { status: VerificationStatus | string }) {
  const tone =
    status === "verified"
      ? "success"
      : status === "pending"
        ? "warning"
        : status === "rejected"
          ? "danger"
          : "neutral";
  return <Chip tone={tone}>{verificationStatusLabel(status)}</Chip>;
}

function VerifyPage() {
  const account = useAccount();
  const { done } = Route.useSearch();
  const queryClient = useQueryClient();

  // Back from Stripe: the result arrives by webhook, so look again shortly.
  useEffect(() => {
    if (!done) return;
    const timer = window.setTimeout(
      () => void queryClient.invalidateQueries({ queryKey: queryKeys.account }),
      4000,
    );
    return () => window.clearTimeout(timer);
  }, [done, queryClient]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Verification"
        meta="Verified owners make every agent traceable to a real person or business."
      />
      {account.isPending ? (
        <Section flush>
          <LoadingRows rows={3} />
        </Section>
      ) : account.isError ? (
        <Section flush>
          <ErrorState error={account.error} onRetry={() => void account.refetch()} />
        </Section>
      ) : (
        <>
          <PersonSection
            person={account.data.person}
            provider={account.data.config.verification.person}
            returned={!!done}
          />
          {account.data.organizations.map((org) => (
            <BusinessSection key={org.id} org={org} />
          ))}
        </>
      )}
    </div>
  );
}

function PersonSection({
  person,
  provider,
  returned,
}: {
  person: Person;
  provider: "stripe_identity" | "test" | "manual";
  returned: boolean;
}) {
  const queryClient = useQueryClient();
  const [legalName, setLegalName] = useState(person.legalName ?? "");
  const [country, setCountry] = useState(person.country ?? "");
  const submit = useMutation({
    mutationFn: () =>
      provider === "stripe_identity"
        ? api.verifyPerson({})
        : api.verifyPerson({ legalName: legalName.trim(), country: country.trim().toUpperCase() }),
    onSuccess: async (result) => {
      if (result.url) {
        window.location.assign(result.url);
        return;
      }
      toast.success(result.person.status === "verified" ? "Verified" : "Submitted");
      await queryClient.invalidateQueries({ queryKey: queryKeys.all });
    },
  });
  const countryOk = COUNTRY.test(country.trim());
  const canSubmit =
    person.status !== "verified" &&
    !(person.status === "pending" && provider !== "stripe_identity");

  return (
    <Section title="You" actions={<StatusChip status={person.status} />}>
      {person.status === "verified" ? (
        <p className="flex items-center gap-2 text-sm">
          <BadgeCheck className="h-4 w-4 text-[var(--aid-success)]" aria-hidden="true" />
          <span className="font-medium">{person.legalName ?? "Verified"}</span>
          <span className="text-[var(--muted-foreground)]">
            {person.country ?? ""}
            {person.verifiedAt ? ` · since ${formatDate(person.verifiedAt)}` : ""}
          </span>
        </p>
      ) : !canSubmit ? (
        <p className="text-sm">
          {person.legalName}
          {person.country ? ` · ${person.country}` : ""}
        </p>
      ) : provider === "stripe_identity" ? (
        <div className="space-y-3">
          {returned && person.status === "pending" && (
            <Notice>Checking. This updates by itself.</Notice>
          )}
          {person.lastError && <Notice tone="danger">Try again: {person.lastError}</Notice>}
          {submit.isError && <Notice tone="danger">{errorMessage(submit.error)}</Notice>}
          <Button onClick={() => submit.mutate()} disabled={submit.isPending}>
            {submit.isPending && <Loader2 className="animate-spin" aria-hidden="true" />}
            Verify with Stripe
          </Button>
          <Muted>A photo ID and a selfie, checked by Stripe.</Muted>
        </div>
      ) : (
        <form
          className="grid gap-4"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            if (legalName.trim() && countryOk) submit.mutate();
          }}
        >
          {person.status === "rejected" && (
            <Notice tone="danger">
              Try again{person.lastError ? `: ${person.lastError}` : "."}
            </Notice>
          )}
          <div className="grid gap-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <Field id="person-name" label="Legal name">
              <Input
                id="person-name"
                autoComplete="name"
                value={legalName}
                maxLength={200}
                onChange={(e) => setLegalName(e.target.value)}
              />
            </Field>
            <Field
              id="person-country"
              label="Country"
              error={country.trim() && !countryOk ? "Two letters, like US" : null}
            >
              <Input
                id="person-country"
                autoComplete="country"
                placeholder="US"
                value={country}
                maxLength={2}
                onChange={(e) => setCountry(e.target.value.toUpperCase())}
              />
            </Field>
          </div>
          {submit.isError && <Notice tone="danger">{errorMessage(submit.error)}</Notice>}
          <div>
            <Button type="submit" disabled={!legalName.trim() || !countryOk || submit.isPending}>
              {submit.isPending && <Loader2 className="animate-spin" aria-hidden="true" />}
              Submit
            </Button>
          </div>
        </form>
      )}
    </Section>
  );
}

function BusinessSection({ org }: { org: Organization }) {
  const queryClient = useQueryClient();
  const b = org.business;
  const admin = org.role === "owner" || org.role === "admin";
  const [legalName, setLegalName] = useState(b.legalName ?? org.name);
  const [registrationNumber, setRegistrationNumber] = useState(b.registrationNumber ?? "");
  const [country, setCountry] = useState(b.country ?? "");
  const [website, setWebsite] = useState(b.website ?? "");
  const submit = useMutation({
    mutationFn: () =>
      api.verifyBusiness({
        organizationId: org.id,
        legalName: legalName.trim(),
        registrationNumber: registrationNumber.trim(),
        country: country.trim().toUpperCase(),
        ...(website.trim() ? { website: website.trim() } : {}),
      }),
    onSuccess: async (result) => {
      toast.success(result.business.status === "verified" ? `${org.name} verified` : "Submitted");
      await queryClient.invalidateQueries({ queryKey: queryKeys.all });
    },
  });
  const countryOk = COUNTRY.test(country.trim());
  const websiteOk = !website.trim() || /^https?:\/\/\S+\.\S+$/i.test(website.trim());
  const id = (s: string) => `biz-${org.id}-${s}`;
  const canSubmit = admin && (b.status === "unverified" || b.status === "rejected");

  return (
    <Section title={org.name} actions={<StatusChip status={b.status} />}>
      {!canSubmit ? (
        <p className="text-sm">
          {b.status === "unverified"
            ? "Only an owner or admin can verify it."
            : [b.legalName, b.registrationNumber, b.country].filter(Boolean).join(" · ")}
        </p>
      ) : (
        <form
          className="grid gap-4"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            if (legalName.trim() && registrationNumber.trim() && countryOk && websiteOk)
              submit.mutate();
          }}
        >
          {b.status === "rejected" && b.note && <Notice tone="danger">{b.note}</Notice>}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id={id("name")} label="Legal name">
              <Input
                id={id("name")}
                value={legalName}
                maxLength={200}
                onChange={(e) => setLegalName(e.target.value)}
              />
            </Field>
            <Field id={id("reg")} label="Registration number">
              <Input
                id={id("reg")}
                value={registrationNumber}
                maxLength={100}
                onChange={(e) => setRegistrationNumber(e.target.value)}
              />
            </Field>
            <Field
              id={id("country")}
              label="Country"
              error={country.trim() && !countryOk ? "Two letters, like US" : null}
            >
              <Input
                id={id("country")}
                placeholder="US"
                value={country}
                maxLength={2}
                onChange={(e) => setCountry(e.target.value.toUpperCase())}
              />
            </Field>
            <Field
              id={id("web")}
              label="Website"
              error={!websiteOk ? "Like https://example.com" : null}
            >
              <Input
                id={id("web")}
                type="url"
                placeholder="https://"
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
              />
            </Field>
          </div>
          {submit.isError && <Notice tone="danger">{errorMessage(submit.error)}</Notice>}
          <div>
            <Button
              type="submit"
              variant="outline"
              disabled={
                !legalName.trim() ||
                !registrationNumber.trim() ||
                !countryOk ||
                !websiteOk ||
                submit.isPending
              }
            >
              {submit.isPending && <Loader2 className="animate-spin" aria-hidden="true" />}
              Submit
            </Button>
          </div>
        </form>
      )}
    </Section>
  );
}
