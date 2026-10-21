import { useEffect, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  BadgeCheck,
  Building2,
  FileText,
  Loader2,
  ShieldCheck,
  Upload,
  UserRound,
} from "lucide-react";
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
import {
  DOCUMENT_TYPES,
  documentProblem,
  formatDate,
  vatCheckLabel,
  verificationStatusLabel,
} from "@/lib/agent-id/format";
import { queryKeys, useAccount } from "@/lib/agent-id/queries";
import { api } from "@/lib/agent-id/session";
import type { Business, Organization, Person, VerificationStatus } from "@/lib/agent-id/types";

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
  // Back from the check: the result arrives by webhook, so keep looking until
  // it's in (or two minutes pass).
  const waiting =
    !!done &&
    (!person ||
      person.status === "pending" ||
      person.status === "unverified" ||
      !!account.data?.organizations.some((o) => o.business.status === "pending"));

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
    <div className="space-y-6">
      <PageHeader
        title="Verification"
        meta="Verify yourself, and your business if your agents work for one."
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
              provider={account.data.config.verification.business}
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
  provider: "bridge" | "stripe_identity" | "test" | "manual";
  checking: boolean;
}) {
  if (provider === "bridge") return <BridgeCheck person={person} checking={checking} />;
  return <FormCheck person={person} provider={provider} checking={checking} />;
}

// Bridge checks people itself (its terms, an ID and a selfie, on its page),
// and that one check is the identity check here too.
function BridgeCheck({ person, checking }: { person: Person; checking: boolean }) {
  const start = useMutation({
    mutationFn: () => api.verifyPerson({ consent: true }),
    onSuccess: (result) => {
      if (result.url) window.location.assign(result.url);
    },
  });
  return (
    <Section
      title={
        <Heading
          icon={<UserRound className="h-4 w-4 text-[var(--aid-ink)]" aria-hidden="true" />}
          title="Your identity"
          status={person.status}
        />
      }
    >
      {person.status === "verified" ? (
        <VerifiedLine person={person} />
      ) : person.status === "rejected" ? (
        <Notice tone="danger">
          Bridge couldn't verify you{person.lastError ? `: ${person.lastError}` : "."} Contact
          support if you think this is wrong.
        </Notice>
      ) : checking ? (
        <p className="flex items-center gap-2 text-sm">
          <Loader2 className="h-4 w-4 animate-spin text-[var(--aid-ink)]" aria-hidden="true" />
          Checking… This usually takes a minute, and updates here by itself.
        </p>
      ) : (
        <div className="grid gap-4">
          <p className="text-sm text-[var(--muted-foreground)]">
            Verify once to send and withdraw money. Bridge, a Stripe company, checks your ID and a
            selfie. It takes about two minutes, and it also opens bank transfers.
          </p>
          {start.isError && <Notice tone="danger">{errorMessage(start.error)}</Notice>}
          <div>
            <Button disabled={start.isPending} onClick={() => start.mutate()}>
              {start.isPending ? (
                <Loader2 className="animate-spin" aria-hidden="true" />
              ) : (
                <ShieldCheck aria-hidden="true" />
              )}
              {person.status === "pending" ? "Continue verifying" : "Verify my identity"}
            </Button>
          </div>
        </div>
      )}
    </Section>
  );
}

function VerifiedLine({ person }: { person: Person }) {
  return (
    <p className="flex items-center gap-2 text-sm">
      <BadgeCheck className="h-5 w-5 text-[var(--aid-success)]" aria-hidden="true" />
      <span className="font-medium">{person.legalName ?? "Verified"}</span>
      <span className="text-[var(--muted-foreground)]">
        {person.country ?? ""}
        {person.verifiedAt ? ` · since ${formatDate(person.verifiedAt)}` : ""}
      </span>
    </p>
  );
}

function FormCheck({
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
          title="Your identity"
          status={person.status}
        />
      }
    >
      {person.status === "verified" ? (
        <VerifiedLine person={person} />
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

function BusinessSection({
  org,
  provider,
  personVerified,
}: {
  org: Organization;
  provider: "bridge" | "test" | "manual";
  personVerified: boolean;
}) {
  const queryClient = useQueryClient();
  const b = org.business;
  // Bridge checks the business on its page, the same way it checked you.
  const bridge = provider === "bridge";
  const admin = org.role === "owner" || org.role === "admin";
  const [legalName, setLegalName] = useState(b.legalName ?? org.name);
  const [registrationNumber, setRegistrationNumber] = useState(b.registrationNumber ?? "");
  const [vatNumber, setVatNumber] = useState(b.vatNumber ?? "");
  const [country, setCountry] = useState(b.country ?? "");
  const [website, setWebsite] = useState(b.website ?? "");
  const [role, setRole] = useState(b.representativeRole ?? "");
  const [attest, setAttest] = useState(false);
  const submit = useMutation({
    mutationFn: () =>
      api.verifyBusiness({
        organizationId: org.id,
        legalName: legalName.trim(),
        ...(registrationNumber.trim() ? { registrationNumber: registrationNumber.trim() } : {}),
        ...(vatNumber.trim() ? { vatNumber: vatNumber.trim() } : {}),
        country: country.trim().toUpperCase(),
        ...(website.trim() ? { website: website.trim() } : {}),
        representativeRole: role.trim(),
        attestation: true,
      }),
    onSuccess: async (result) => {
      if (result.url) return window.location.assign(result.url);
      toast.success(
        result.business.status === "verified" ? `${org.name} is verified` : "Sent for review",
      );
      await queryClient.invalidateQueries({ queryKey: queryKeys.all });
    },
  });
  const countryOk = COUNTRY.test(country.trim());
  const websiteOk = !website.trim() || /^https?:\/\/\S+\.\S+$/i.test(website.trim());
  const vatOk = !vatNumber.trim() || /^[A-Za-z0-9 .-]{4,30}$/.test(vatNumber.trim());
  const ready =
    legalName.trim() &&
    (bridge || registrationNumber.trim()) &&
    countryOk &&
    websiteOk &&
    vatOk &&
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
        <div className="space-y-3">
          {b.status === "pending" &&
            (b.link ? (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-[var(--muted-foreground)]">
                  Finish the business check: the registration, the owners and a document, on
                  Bridge's page.
                </p>
                <Button asChild size="sm">
                  <a href={b.link}>
                    <ShieldCheck aria-hidden="true" />
                    Continue verifying
                  </a>
                </Button>
              </div>
            ) : (
              <p className="text-sm text-[var(--muted-foreground)]">
                {b.provider === "bridge"
                  ? "Bridge is reviewing it, usually within a business day."
                  : "We're reviewing it, usually within a day."}
              </p>
            ))}
          <BusinessFacts business={b} />
        </div>
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
          className="grid gap-5"
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
            {!bridge && (
              <Field id={id("reg")} label="Registration number">
                <Input
                  id={id("reg")}
                  value={registrationNumber}
                  maxLength={100}
                  onChange={(e) => setRegistrationNumber(e.target.value)}
                />
              </Field>
            )}
            <Field
              id={id("vat")}
              label={
                <>
                  VAT number{" "}
                  <span className="font-normal text-[var(--muted-foreground)]">Optional</span>
                </>
              }
              hint="EU businesses: we check it in the EU's VAT register."
              error={!vatOk ? "Like SE556000000001" : null}
            >
              <Input
                id={id("vat")}
                placeholder="SE556000000001"
                value={vatNumber}
                maxLength={30}
                onChange={(e) => setVatNumber(e.target.value.toUpperCase())}
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
          {bridge ? (
            <Muted>
              Next, Bridge asks for the registration, who owns the business and a document. It
              usually takes ten minutes, and the review a business day.
            </Muted>
          ) : (
            <DocumentUpload org={org} />
          )}
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
            <Button type="submit" disabled={!ready || submit.isPending}>
              {submit.isPending && <Loader2 className="animate-spin" aria-hidden="true" />}
              Verify {org.name}
            </Button>
          </div>
        </form>
      ) : null}
    </Section>
  );
}

// What a business sent: its details, the VAT register's answer and its document.
function BusinessFacts({ business: b }: { business: Business }) {
  const vat = vatCheckLabel(b.checks?.vat);
  const rows: { term: string; value: ReactNode }[] = [
    ...(b.legalName ? [{ term: "Legal name", value: b.legalName }] : []),
    ...(b.registrationNumber ? [{ term: "Registration number", value: b.registrationNumber }] : []),
    ...(b.country ? [{ term: "Country", value: b.country }] : []),
    ...(b.vatNumber
      ? [
          {
            term: "VAT number",
            value: (
              <span className="flex flex-wrap items-center gap-2">
                {b.vatNumber}
                {vat && <Chip tone={vat.tone}>{vat.label}</Chip>}
              </span>
            ),
          },
        ]
      : []),
    ...(b.document
      ? [
          {
            term: "Registration document",
            value: (
              <span className="inline-flex min-w-0 items-center gap-1.5">
                <FileText className="h-4 w-4 shrink-0 text-[var(--aid-ink)]" aria-hidden="true" />
                <span className="truncate">{b.document.name}</span>
              </span>
            ),
          },
        ]
      : []),
  ];
  return (
    <dl className="grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
      {rows.map((row) => (
        <div key={row.term} className="min-w-0">
          <dt className="aid-label">{row.term}</dt>
          <dd className="mt-0.5 break-words">{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

// The registration certificate or registry extract, sent as soon as it's picked.
function DocumentUpload({ org }: { org: Organization }) {
  const queryClient = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const upload = useMutation({
    mutationFn: (file: File) => api.uploadBusinessDocument(org.id, file),
    onSuccess: async () => {
      toast.success("Document added");
      await queryClient.invalidateQueries({ queryKey: queryKeys.account });
    },
  });
  const name = org.business.document?.name;
  const error = problem ?? (upload.isError ? errorMessage(upload.error) : null);
  return (
    <div className="space-y-1.5">
      <p className="text-sm font-medium">Registration certificate</p>
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-dashed border-[var(--input)] p-3">
        <FileText className="h-5 w-5 shrink-0 text-[var(--aid-ink)]" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate text-sm">
          {name ?? (
            <span className="text-[var(--muted-foreground)]">
              A registry extract or certificate. PDF or photo, up to 10 MB.
            </span>
          )}
        </span>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={upload.isPending}
          onClick={() => input.current?.click()}
        >
          {upload.isPending ? (
            <Loader2 className="animate-spin" aria-hidden="true" />
          ) : (
            <Upload aria-hidden="true" />
          )}
          {name ? "Replace" : "Upload"}
        </Button>
        <input
          ref={input}
          type="file"
          className="hidden"
          accept={DOCUMENT_TYPES.join(",")}
          aria-label="Registration certificate"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (!file) return;
            const issue = documentProblem(file);
            setProblem(issue);
            if (!issue) upload.mutate(file);
          }}
        />
      </div>
      {error && (
        <p className="text-xs text-[var(--aid-danger)]" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
