// Setting up an Agent ID from its link: confirm an email, verify who you
// are, done. The browser that confirmed the email holds the claim session
// (sessionStorage); without it the link starts at the email step.
import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleCheck, Loader2, ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { Skeleton } from "@/components/ui/skeleton";
import { CommandLine, Field, Muted, Notice } from "../ui";
import { ClaimAgent, ClaimHeading, ClaimLayout } from "./ClaimLayout";
import {
  claimCommand,
  claimScreen,
  claimStepIndex,
  cleanCode,
  isCountryCode,
  readClaimMemory,
  resendWait,
  writeClaimMemory,
  type Claim,
  type ClaimMemory,
  type SentCode,
} from "@/lib/agent-id/claims";
import { AgentIdError, errorMessage } from "@/lib/agent-id/client";
import { claimsApi, signInWithClaim } from "@/lib/agent-id/session";

const TERMS_URL = "/legal/agent-id-terms";
const PRIVACY_URL = "/legal/privacy-policy";

type Provider = "stripe_identity" | "manual" | "test";

// The link expired or someone finished it meanwhile: load it again, so the
// page says so instead of an error under a form.
function useReloadWhenStale(code: string) {
  const queryClient = useQueryClient();
  return useCallback(
    (error: unknown) => {
      if (
        error instanceof AgentIdError &&
        (error.code === "expired" || error.code === "already_claimed")
      )
        void queryClient.invalidateQueries({ queryKey: ["agent-id", "claim", code] });
    },
    [code, queryClient],
  );
}

export function ClaimFlow({ code, checked }: { code: string; checked: boolean }) {
  const queryClient = useQueryClient();
  // Read after mounting: the server has no sessionStorage.
  const [memory, setMemory] = useState<ClaimMemory | null>(null);
  useEffect(() => setMemory(readClaimMemory(code)), [code]);
  const remember = useCallback(
    (patch: Partial<Record<keyof ClaimMemory, string | null>>) =>
      setMemory(writeClaimMemory(code, patch)),
    [code],
  );

  const session = memory?.session ?? null;
  const queryKey = ["agent-id", "claim", code, session ? "session" : "open"] as const;
  // Back from Stripe: the result arrives by webhook, so wait a little for it.
  const [waitingSince] = useState(() => Date.now());
  const query = useQuery({
    queryKey,
    enabled: memory !== null,
    retry: false,
    queryFn: async () => (await claimsApi.get(code, session)).claim,
    refetchInterval: (q) => {
      const claim = q.state.data;
      if (!claim) return false;
      const screen = claimScreen(claim);
      if (screen === "checking") return 4000;
      if (checked && screen === "identity" && Date.now() - waitingSince < 120_000) return 3000;
      // Showing the command: notice when the agent has collected its key.
      if (
        screen === "done" &&
        claim.startedBy === "person" &&
        memory?.secret &&
        !claim.keyCollected
      )
        return 5000;
      return false;
    },
  });

  // A session this claim no longer accepts: start again from the email.
  const lostSession =
    query.error instanceof AgentIdError && query.error.code === "claim_session" && !!session;
  useEffect(() => {
    if (lostSession) remember({ session: null });
  }, [lostSession, remember]);

  const config = useQuery({
    queryKey: ["agent-id", "public-config"],
    queryFn: () => claimsApi.config(),
    staleTime: 5 * 60_000,
    retry: false,
  });
  // Someone who left Stripe's check before finishing can start it again.
  const [restart, setRestart] = useState(false);

  const setClaim = (claim: Claim) =>
    queryClient.setQueryData(["agent-id", "claim", code, "session"], claim);

  if (memory === null || query.isPending || lostSession) {
    return (
      <ClaimLayout>
        <div aria-busy="true" aria-label="Loading" className="space-y-4">
          <Skeleton className="h-8 w-2/3 bg-[var(--muted)]" />
          <Skeleton className="h-16 w-full bg-[var(--muted)]" />
          <Skeleton className="h-11 w-full bg-[var(--muted)]" />
        </div>
      </ClaimLayout>
    );
  }

  if (query.isError) {
    const missing = query.error instanceof AgentIdError && query.error.status === 404;
    return (
      <ClaimLayout>
        <ClaimHeading title={missing ? "This link doesn't work" : "Something went wrong"}>
          {missing
            ? "Check that you copied the whole link, or get a new Agent ID."
            : errorMessage(query.error)}
        </ClaimHeading>
        {missing ? (
          <Button asChild className="h-11 w-full">
            <Link to="/agent-id/claim">Get an Agent ID</Link>
          </Button>
        ) : (
          <Button className="h-11 w-full" onClick={() => void query.refetch()}>
            Try again
          </Button>
        )}
      </ClaimLayout>
    );
  }

  const claim = query.data;
  let screen = claimScreen(claim);
  const stillChecking =
    checked &&
    screen === "identity" &&
    claim.person?.status !== "rejected" &&
    !claim.person?.lastError &&
    Date.now() - waitingSince < 120_000;
  if (stillChecking) screen = "checking";
  if (restart && screen === "checking") screen = "identity";
  const provider: Provider =
    (claim.person?.provider as Provider | undefined) ??
    config.data?.verification.person ??
    "stripe_identity";

  if (screen === "expired") {
    return (
      <ClaimLayout>
        <ClaimHeading title="This link has expired">
          {claim.startedBy === "agent"
            ? `Links work for an hour. Ask ${claim.app?.label ?? "your agent"} for a new one.`
            : "Links work for an hour. Start again; it only takes a minute."}
        </ClaimHeading>
        {claim.startedBy === "person" && (
          <Button asChild className="h-11 w-full">
            <Link to="/agent-id/claim">Start again</Link>
          </Button>
        )}
      </ClaimLayout>
    );
  }

  if (screen === "claimed-elsewhere") {
    return (
      <ClaimLayout>
        <ClaimHeading title={`${claim.name} is already set up`}>
          Sign in to Agent ID to see it.
        </ClaimHeading>
        <Button asChild className="h-11 w-full">
          <Link to="/agent-id/sign-in">Sign in</Link>
        </Button>
      </ClaimLayout>
    );
  }

  return (
    <ClaimLayout
      step={claimStepIndex(screen)}
      footer={screen === "email" ? "Have a Timewarp account? Use its email." : undefined}
    >
      {screen === "email" && (
        <EmailStep
          claim={claim}
          onConfirmed={async (result) => {
            remember({ session: result.session });
            setClaim(result.claim);
            await signInWithClaim(result.auth);
          }}
        />
      )}
      {screen === "identity" && session && (
        <IdentityStep
          claim={claim}
          session={session}
          provider={provider}
          onDone={(next) => {
            setRestart(false);
            setClaim(next);
          }}
          onLostSession={() => remember({ session: null })}
        />
      )}
      {screen === "checking" && (
        <Checking
          claim={claim}
          provider={provider}
          onRestart={session && provider === "stripe_identity" ? () => setRestart(true) : null}
        />
      )}
      {screen === "done" && <Done claim={claim} secret={memory.secret ?? null} />}
    </ClaimLayout>
  );
}

// --- Step 1: email ------------------------------------------------------------------

function EmailStep({
  claim,
  onConfirmed,
}: {
  claim: Claim;
  onConfirmed: (result: Awaited<ReturnType<typeof claimsApi.confirmEmail>>) => Promise<void>;
}) {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState<(SentCode & { at: number }) | null>(null);
  const reloadWhenStale = useReloadWhenStale(claim.code);

  const send = useMutation({
    mutationFn: (address: string) => claimsApi.sendCode(claim.code, address),
    onSuccess: (result) => setSent({ ...result, at: Date.now() }),
    onError: reloadWhenStale,
  });

  if (sent) {
    return (
      <CodeForm
        claim={claim}
        sent={sent}
        resend={() => send.mutate(sent.email)}
        resending={send.isPending}
        resendError={send.isError ? errorMessage(send.error) : null}
        onChangeEmail={() => {
          setSent(null);
          send.reset();
        }}
        onConfirmed={onConfirmed}
      />
    );
  }

  return (
    <>
      <ClaimHeading title="What's your email?">
        We'll send you a code. It also makes your Timewarp account, so you can manage {claim.name}{" "}
        later.
      </ClaimHeading>
      <ClaimAgent name={claim.name} app={claim.app} device={claim.device} />
      {claim.startedBy === "agent" && <StartedByAgent claim={claim} />}
      <form
        className="grid gap-4"
        noValidate
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          if (email.trim() && !send.isPending) send.mutate(email.trim());
        }}
      >
        <Field id="claim-email" label="Email">
          <Input
            id="claim-email"
            type="email"
            autoComplete="email"
            inputMode="email"
            className="h-11"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>
        {send.isError && <Notice tone="danger">{errorMessage(send.error)}</Notice>}
        <Button type="submit" className="h-11 w-full" disabled={!email.trim() || send.isPending}>
          {send.isPending && <Loader2 className="animate-spin" aria-hidden="true" />}
          Send code
        </Button>
      </form>
    </>
  );
}

// An agent asked for this link: show its code to compare, and say plainly
// what continuing means.
function StartedByAgent({ claim }: { claim: Claim }) {
  return (
    <div className="mb-6 rounded-xl border border-[var(--border)] p-4 text-sm">
      <p>
        Check that your agent shows{" "}
        <strong className="aid-mono whitespace-nowrap tracking-wider">{claim.matchCode}</strong>.
      </p>
      <p className="mt-1.5 text-[var(--muted-foreground)]">
        Only continue if you started this. You'll be responsible for what {claim.name} does.
      </p>
    </div>
  );
}

function CodeForm({
  claim,
  sent,
  resend,
  resending,
  resendError,
  onChangeEmail,
  onConfirmed,
}: {
  claim: Claim;
  sent: SentCode & { at: number };
  resend: () => void;
  resending: boolean;
  resendError: string | null;
  onChangeEmail: () => void;
  onConfirmed: (result: Awaited<ReturnType<typeof claimsApi.confirmEmail>>) => Promise<void>;
}) {
  const [digits, setDigits] = useState("");
  const otp = useRef<HTMLInputElement>(null);
  const reloadWhenStale = useReloadWhenStale(claim.code);
  const [now, setNow] = useState(() => Date.now());
  const wait = resendWait(sent.at, now);
  useEffect(() => {
    if (wait <= 0) return;
    const timer = window.setTimeout(() => setNow(Date.now()), 1000);
    return () => window.clearTimeout(timer);
  }, [wait, now]);

  const confirm = useMutation({
    mutationFn: (value: string) => claimsApi.confirmEmail(claim.code, value),
    onSuccess: (result) => onConfirmed(result),
    // A wrong code: clear it and let them type again straight away.
    onError: (error) => {
      setDigits("");
      reloadWhenStale(error);
      window.setTimeout(() => otp.current?.focus(), 0);
    },
  });
  const submit = (value: string) => {
    if (value.length === 6 && !confirm.isPending) confirm.mutate(value);
  };

  return (
    <>
      <ClaimHeading title="Enter the code">
        We sent a 6-digit code to <strong className="text-[var(--foreground)]">{sent.email}</strong>
        .
      </ClaimHeading>
      {sent.devCode && (
        <Notice className="mb-4">
          Development: the code is <strong className="aid-mono">{sent.devCode}</strong>
        </Notice>
      )}
      <form
        className="grid gap-5"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          submit(digits);
        }}
      >
        <div className="flex justify-center">
          <InputOTP
            ref={otp}
            maxLength={6}
            value={digits}
            autoFocus
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="^[0-9]*$"
            aria-label="6-digit code"
            disabled={confirm.isPending}
            onChange={(value) => setDigits(cleanCode(value))}
            onComplete={(value: string) => submit(cleanCode(value))}
          >
            <InputOTPGroup className="gap-2">
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <InputOTPSlot
                  key={i}
                  index={i}
                  className="h-12 w-11 rounded-lg border text-lg font-semibold first:rounded-lg last:rounded-lg sm:w-12"
                />
              ))}
            </InputOTPGroup>
          </InputOTP>
        </div>
        {confirm.isError && <Notice tone="danger">{errorMessage(confirm.error)}</Notice>}
        {resendError && <Notice tone="danger">{resendError}</Notice>}
        <Button
          type="submit"
          className="h-11 w-full"
          disabled={digits.length < 6 || confirm.isPending}
        >
          {confirm.isPending && <Loader2 className="animate-spin" aria-hidden="true" />}
          Continue
        </Button>
        <div className="flex flex-wrap justify-between gap-2 text-sm">
          <button type="button" className="aid-link" onClick={onChangeEmail}>
            Use a different email
          </button>
          <button
            type="button"
            className="aid-link disabled:text-[var(--muted-foreground)] disabled:no-underline"
            disabled={wait > 0 || resending}
            onClick={resend}
          >
            {wait > 0 ? `Send a new code (${wait}s)` : "Send a new code"}
          </button>
        </div>
      </form>
    </>
  );
}

// --- Step 2: identity ----------------------------------------------------------------

function Consent({
  checked,
  onChange,
  children,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  children: ReactNode;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3 text-sm leading-relaxed">
      <Checkbox
        checked={checked}
        onCheckedChange={(v) => onChange(v === true)}
        className="mt-0.5 h-5 w-5 rounded-md"
      />
      <span>{children}</span>
    </label>
  );
}

function IdentityStep({
  claim,
  session,
  provider,
  onDone,
  onLostSession,
}: {
  claim: Claim;
  session: string;
  provider: Provider;
  onDone: (claim: Claim) => void;
  onLostSession: () => void;
}) {
  const stripe = provider === "stripe_identity";
  const reloadWhenStale = useReloadWhenStale(claim.code);
  const needsTerms = !claim.terms?.accepted;
  const [terms, setTerms] = useState(false);
  const [consent, setConsent] = useState(false);
  const [legalName, setLegalName] = useState(claim.person?.legalName ?? "");
  const [country, setCountry] = useState(claim.person?.country ?? "");
  const detailsOk = stripe || (!!legalName.trim() && isCountryCode(country));
  const ready = (!needsTerms || terms) && consent && detailsOk;

  const verify = useMutation({
    mutationFn: () =>
      claimsApi.verifyIdentity(claim.code, session, {
        consent: true,
        ...(claim.terms?.current ? { terms: claim.terms.current } : {}),
        ...(stripe ? {} : { legalName: legalName.trim(), country: country.trim().toUpperCase() }),
      }),
    onSuccess: (result) => {
      if (result.url) {
        window.location.assign(result.url);
        return;
      }
      onDone(result.claim);
    },
    onError: (error) => {
      if (error instanceof AgentIdError && error.code === "claim_session") onLostSession();
      reloadWhenStale(error);
    },
  });

  const failed = claim.person?.status === "rejected" || !!claim.person?.lastError;

  return (
    <>
      <ClaimHeading title="Verify it's you">
        {stripe
          ? "Agent ID ties every agent to a real person. Stripe checks your ID and a selfie; it takes about two minutes."
          : "Agent ID ties every agent to a real person. Enter your name and country as they are on your ID."}
      </ClaimHeading>
      <ClaimAgent name={claim.name} app={claim.app} device={claim.device} />
      {failed && (
        <Notice tone="danger" className="mb-4">
          That check didn't go through{claim.person?.lastError ? `: ${claim.person.lastError}` : ""}
          . Try again.
        </Notice>
      )}
      <form
        className="grid gap-5"
        noValidate
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          if (ready && !verify.isPending) verify.mutate();
        }}
      >
        {!stripe && (
          <div className="grid grid-cols-[minmax(0,1fr)_6rem] gap-3">
            <Field id="claim-legal-name" label="Legal name">
              <Input
                id="claim-legal-name"
                autoComplete="name"
                className="h-11"
                maxLength={200}
                value={legalName}
                onChange={(e) => setLegalName(e.target.value)}
              />
            </Field>
            <Field
              id="claim-country"
              label="Country"
              error={country.trim() && !isCountryCode(country) ? "Two letters" : null}
            >
              <Input
                id="claim-country"
                autoComplete="country"
                placeholder="US"
                className="h-11 uppercase"
                maxLength={2}
                value={country}
                onChange={(e) => setCountry(e.target.value.toUpperCase())}
              />
            </Field>
          </div>
        )}
        <div className="grid gap-3 rounded-xl bg-[var(--muted)] p-4">
          {needsTerms && (
            <Consent checked={terms} onChange={setTerms}>
              I agree to the{" "}
              <a href={TERMS_URL} target="_blank" rel="noreferrer" className="aid-link">
                Agent ID Terms
              </a>
            </Consent>
          )}
          <Consent checked={consent} onChange={setConsent}>
            {stripe ? (
              <>
                I agree to Stripe checking my ID and a selfie (biometric data) to verify me.{" "}
                <a href={PRIVACY_URL} target="_blank" rel="noreferrer" className="aid-link">
                  Privacy
                </a>
              </>
            ) : (
              "These are my real details"
            )}
          </Consent>
        </div>
        {verify.isError && <Notice tone="danger">{errorMessage(verify.error)}</Notice>}
        <Button type="submit" className="h-11 w-full" disabled={!ready || verify.isPending}>
          {verify.isPending ? (
            <Loader2 className="animate-spin" aria-hidden="true" />
          ) : (
            <ShieldCheck aria-hidden="true" />
          )}
          {stripe ? "Verify with Stripe" : "Continue"}
        </Button>
      </form>
    </>
  );
}

function Checking({
  claim,
  provider,
  onRestart,
}: {
  claim: Claim;
  provider: Provider;
  onRestart: (() => void) | null;
}) {
  return (
    <div className="flex flex-col items-center py-4 text-center" role="status">
      <Loader2 className="h-10 w-10 animate-spin text-[var(--aid-ink)]" aria-hidden="true" />
      <h1 className="mt-5 text-2xl font-semibold tracking-tight">
        {provider === "manual" ? "We're checking your details" : "Checking your ID"}
      </h1>
      <p className="mt-2 text-sm text-[var(--muted-foreground)]">
        {provider === "manual"
          ? `A person at Timewarp reviews it, usually within a day. ${claim.name} is set up as soon as you're verified.`
          : `This usually takes a minute or two. You can close this page; ${claim.name} is set up as soon as you're verified.`}
      </p>
      {onRestart && (
        <button type="button" className="aid-link mt-6 text-sm" onClick={onRestart}>
          Didn't finish the check? Start it again
        </button>
      )}
    </div>
  );
}

// --- Done ------------------------------------------------------------------------------

function Done({ claim, secret }: { claim: Claim; secret: string | null }) {
  const byAgent = claim.startedBy === "agent";
  const showCommand = !byAgent && !!secret && !claim.keyCollected;
  return (
    <div>
      <div className="flex flex-col items-center text-center">
        <CircleCheck className="h-12 w-12 text-[var(--aid-success)]" aria-hidden="true" />
        <h1 className="mt-4 text-2xl font-semibold tracking-tight">{claim.name} is ready</h1>
        <p className="mt-2 text-sm text-[var(--muted-foreground)]">
          {byAgent
            ? `Go back to ${claim.app?.label ?? "your agent"}. It's set up.`
            : showCommand
              ? `Last step: run this on the computer where you use ${claim.name}.`
              : claim.keyCollected
                ? `${claim.name} is connected.`
                : `Open Agent ID to connect ${claim.name} to your apps.`}
        </p>
      </div>
      {showCommand && secret && (
        <div className="mt-6 space-y-2">
          <CommandLine command={claimCommand(secret)} />
          <Muted>
            It connects {claim.name} to Claude Code, Codex, Cursor or wherever you use it. The
            command works once.
          </Muted>
        </div>
      )}
      <Button asChild variant={showCommand ? "outline" : "default"} className="mt-6 h-11 w-full">
        <Link to="/agent-id/dashboard">Open Agent ID</Link>
      </Button>
    </div>
  );
}
