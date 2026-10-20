import { useEffect, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { BadgeCheck, Building2, Loader2, ShieldCheck, UserRound } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
const CONSENT_TEXT =
  "I consent to Stripe checking my ID document and a selfie (biometric data) to verify my identity for Agent ID";

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
  const person = account.data?.person;
  // Back from Stripe: the result arrives by webhook, so keep looking until
  // it's in (or two minutes pass).
  const waiting =
    !!done && (!person || person.status === "pending" || person.status === "unverified");

  useEffect(() => {
    if (!waiting) return;
    const started = Date.now();
    const timer = window.setInterval(() => {
      if (Date.now() - started > 120_000) window.clearInterval(timer);
      void queryClient.invalidateQueries({ queryKey: queryKeys.account });
    }, 3000);
    return () => window.clearInterval(timer);
  }, [waiting, queryClient]);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
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
            checking={waiting}
          />
          {account.data.organizations.map((org) => (
            <BusinessSection
              key={org.id}
              org={org}
              personVerified={account.data.person.status === "verified"}
            />
          ))}
        </>
      )}
    </div>
  );
}

function Heading({ icon, title, status }: { icon: ReactNode; title: string; status: string }) {
  return (
    <span className="flex items-center gap-2">
      {icon}
      {title}
      <StatusChip status={status} />
    </span>
  );
}

function PersonSection({
  person,
  provider,
  checking,
}: {
  person: Person;
  provider: "stripe_identity" | "test" | "manual";
  checking: boolean;
}) {
  const queryClient = useQueryClient();
  const [legalName, setLegalName] = useState(person.legalName ?? "");
  const [country, setCountry] = useState(person.country ?? "");
  const [consent, setConsent] = useState(false);
  const stripe = provider === "stripe_identity";
  const submit = useMutation({
    mutationFn: () =>
      stripe
        ? api.verifyPerson({ consent: true })
        : api.verifyPerson({
            legalName: legalName.trim(),
            country: country.trim().toUpperCase(),
            consent: true,
          }),
    onSuccess: async (result) => {
      if (result.url) {
        window.location.assign(result.url);
        return;
      }
      toast.success(result.person.status === "verified" ? "You're verified" : "Submitted");
      await queryClient.invalidateQueries({ queryKey: queryKeys.all });
    },
  });
  const countryOk = COUNTRY.test(country.trim());
  const consentText = stripe
    ? CONSENT_TEXT
    : "I confirm these are my real details, so Agent ID can trace my agents to me";

  return (
    <Section
      title={
        <Heading
          icon={<UserRound className="h-4 w-4 text-[var(--aid-ink)]" aria-hidden="true" />}
          title="You"
          status={person.status}
        />
      }
    >
      {person.status === "verified" ? (
        <p className="flex items-center gap-2 text-sm">
          <BadgeCheck className="h-5 w-5 text-[var(--aid-success)]" aria-hidden="true" />
          <span className="font-medium">{person.legalName ?? "Verified"}</span>
          <span className="text-[var(--muted-foreground)]">
            {person.country ?? ""}
            {person.verifiedAt ? ` · since ${formatDate(person.verifiedAt)}` : ""}
          </span>
        </p>
      ) : checking && stripe ? (
        <p className="flex items-center gap-2 text-sm">
          <Loader2 className="h-4 w-4 animate-spin text-[var(--aid-ink)]" aria-hidden="true" />
          Checking… This takes a minute, and updates here by itself.
        </p>
      ) : person.status === "pending" && !stripe ? (
        <p className="text-sm text-[var(--muted-foreground)]">
          {person.legalName}
          {person.country ? ` · ${person.country}` : ""} — we're reviewing it.
        </p>
      ) : (
        <form
          className="grid gap-4"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            if (consent && (stripe || (legalName.trim() && countryOk))) submit.mutate();
          }}
        >
          {(person.status === "rejected" || person.lastError) && (
            <Notice tone="danger">
              Try again{person.lastError ? `: ${person.lastError}` : "."}
            </Notice>
          )}
          {stripe ? (
            <p className="text-sm text-[var(--muted-foreground)]">
              A quick check of your ID document and a selfie, done by Stripe. It takes about two
              minutes.
            </p>
          ) : (
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
          )}
          <label className="flex items-start gap-3 rounded-xl bg-[var(--muted)] p-4 text-sm leading-relaxed">
            <Checkbox
              checked={consent}
              onCheckedChange={(v) => setConsent(v === true)}
              className="mt-0.5"
              aria-label={consentText}
            />
            <span>
              {consentText}.{" "}
              <a href="/legal/privacy-policy" target="_blank" rel="noreferrer" className="aid-link">
                Privacy Policy
              </a>
            </span>
          </label>
          {submit.isError && <Notice tone="danger">{errorMessage(submit.error)}</Notice>}
          <div>
            <Button
              type="submit"
              disabled={
                !consent || (!stripe && (!legalName.trim() || !countryOk)) || submit.isPending
              }
            >
              {submit.isPending ? (
                <Loader2 className="animate-spin" aria-hidden="true" />
              ) : (
                <ShieldCheck aria-hidden="true" />
              )}
              {stripe ? "Verify with Stripe" : "Submit"}
            </Button>
          </div>
        </form>
      )}
    </Section>
  );
}

function BusinessSection({ org, personVerified }: { org: Organization; personVerified: boolean }) {
  const queryClient = useQueryClient();
  const b = org.business;
  const admin = org.role === "owner" || org.role === "admin";
  const [legalName, setLegalName] = useState(b.legalName ?? org.name);
  const [registrationNumber, setRegistrationNumber] = useState(b.registrationNumber ?? "");
  const [country, setCountry] = useState(b.country ?? "");
  const [website, setWebsite] = useState(b.website ?? "");
  const [role, setRole] = useState("");
  const [attest, setAttest] = useState(false);
  const submit = useMutation({
    mutationFn: () =>
      api.verifyBusiness({
        organizationId: org.id,
        legalName: legalName.trim(),
        registrationNumber: registrationNumber.trim(),
        country: country.trim().toUpperCase(),
        ...(website.trim() ? { website: website.trim() } : {}),
        representativeRole: role.trim(),
        attestation: true,
      }),
    onSuccess: async (result) => {
      toast.success(
        result.business.status === "verified" ? `${org.name} is verified` : "Submitted for review",
      );
      await queryClient.invalidateQueries({ queryKey: queryKeys.all });
    },
  });
  const countryOk = COUNTRY.test(country.trim());
  const websiteOk = !website.trim() || /^https?:\/\/\S+\.\S+$/i.test(website.trim());
  const ready =
    legalName.trim() &&
    registrationNumber.trim() &&
    countryOk &&
    websiteOk &&
    role.trim() &&
    attest;
  const id = (s: string) => `biz-${org.id}-${s}`;
  const canSubmit = admin && (b.status === "unverified" || b.status === "rejected");

  return (
    <Section
      title={
        <Heading
          icon={<Building2 className="h-4 w-4 text-[var(--aid-ink)]" aria-hidden="true" />}
          title={org.name}
          status={b.status}
        />
      }
    >
      {b.status === "verified" || b.status === "pending" ? (
        <p className="text-sm">
          {[b.legalName, b.registrationNumber, b.country].filter(Boolean).join(" · ")}
          {b.status === "pending" && (
            <span className="text-[var(--muted-foreground)]"> — we're reviewing it.</span>
          )}
        </p>
      ) : !admin ? (
        <Muted>Only an owner or admin of {org.name} can verify it.</Muted>
      ) : !personVerified ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-[var(--muted-foreground)]">
            Verify yourself first. A business is verified by a verified person who represents it.
          </p>
          <Button
            size="sm"
            variant="outline"
            onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
          >
            Verify yourself
          </Button>
        </div>
      ) : canSubmit ? (
        <form
          className="grid gap-4"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            if (ready) submit.mutate();
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
            <Field id={id("role")} label="Your role">
              <Input
                id={id("role")}
                placeholder="CEO, director…"
                value={role}
                maxLength={100}
                onChange={(e) => setRole(e.target.value)}
              />
            </Field>
          </div>
          <label className="flex items-start gap-3 rounded-xl bg-[var(--muted)] p-4 text-sm leading-relaxed">
            <Checkbox
              checked={attest}
              onCheckedChange={(v) => setAttest(v === true)}
              className="mt-0.5"
              aria-label="I'm authorised to act for this business and the details are correct"
            />
            <span>I'm authorised to act for this business and the details are correct.</span>
          </label>
          {submit.isError && <Notice tone="danger">{errorMessage(submit.error)}</Notice>}
          <div>
            <Button type="submit" variant="outline" disabled={!ready || submit.isPending}>
              {submit.isPending && <Loader2 className="animate-spin" aria-hidden="true" />}
              Verify {org.name}
            </Button>
          </div>
        </form>
      ) : null}
    </Section>
  );
}
