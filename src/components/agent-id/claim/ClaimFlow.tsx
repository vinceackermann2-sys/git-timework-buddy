// Setting up an Agent ID from its link: an email and a code, and it's ready.
// The terms are ticked next to the email. Identity is checked later, the
// first time money leaves a wallet. The browser that confirmed the email
// holds the claim session (sessionStorage); without it the link starts at
// the email step.
import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, CommandLine, Field, Notice } from "../ui";
import { ReadyList } from "../ReadyList";
import { ClaimAgent, ClaimHeading, ClaimLayout } from "./ClaimLayout";
import {
  claimCommand,
  claimScreen,
  cleanCode,
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
// A code sent from the start page is still worth entering for ten minutes.
const CODE_MINUTES = 10;

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

// The current version of the Agent ID Terms, for the box next to the email.
export function useTermsVersion() {
  const config = useQuery({
    queryKey: ["agent-id", "public-config"],
    queryFn: () => claimsApi.config(),
    staleTime: 5 * 60_000,
    retry: false,
  });
  return config.data?.legal?.termsVersion ?? null;
}

export function ClaimFlow({ code }: { code: string }) {
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
  const query = useQuery({
    queryKey,
    enabled: memory !== null,
    retry: false,
    queryFn: async () => (await claimsApi.get(code, session)).claim,
    refetchInterval: (q) => {
      const claim = q.state.data;
      if (!claim || claimScreen(claim) !== "done") return false;
      // Its email and wallet are still being set up.
      if (Object.values(claim.agent?.resources ?? {}).some((r) => r?.status === "provisioning"))
        return 2500;
      // Showing the command: notice when the agent has collected its key.
      if (claim.startedBy === "person" && memory?.secret && !claim.keyCollected) return 5000;
      return false;
    },
  });

  // A session this claim no longer accepts: start again from the email.
  const lostSession =
    query.error instanceof AgentIdError && query.error.code === "claim_session" && !!session;
  useEffect(() => {
    if (lostSession) remember({ session: null });
  }, [lostSession, remember]);

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
  const screen = claimScreen(claim);

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

  const onConfirmed = async (result: Awaited<ReturnType<typeof claimsApi.confirmEmail>>) => {
    remember({ session: result.session, sentEmail: null, sentAt: null, devCode: null });
    setClaim(result.claim);
    await signInWithClaim(result.auth);
  };

  return (
    <ClaimLayout
      wide={screen === "done"}
      footer={screen === "email" ? "Have a Timewarp account? Use its email." : undefined}
    >
      {screen === "email" && <EmailStep claim={claim} memory={memory} onConfirmed={onConfirmed} />}
      {screen === "terms" && session && (
        <TermsStep
          claim={claim}
          session={session}
          onDone={setClaim}
          onLostSession={() => remember({ session: null })}
        />
      )}
      {screen === "done" && <Done claim={claim} secret={memory.secret ?? null} />}
    </ClaimLayout>
  );
}

// --- The email -----------------------------------------------------------------------

// The tick next to the email: the terms are accepted with the code.
export function TermsBox({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3 text-sm leading-relaxed">
      <Checkbox
        checked={checked}
        onCheckedChange={(v) => onChange(v === true)}
        className="mt-0.5 h-5 w-5 rounded-md"
      />
      <span>
        I agree to the{" "}
        <a href={TERMS_URL} target="_blank" rel="noreferrer" className="aid-link">
          Agent ID Terms
        </a>{" "}
        and the{" "}
        <a href={PRIVACY_URL} target="_blank" rel="noreferrer" className="aid-link">
          Privacy Policy
        </a>
      </span>
    </label>
  );
}

// An email address and the terms, the one form of the start page and of a link.
export function EmailForm({
  pending,
  error,
  onSubmit,
}: {
  pending: boolean;
  error: string | null;
  onSubmit: (email: string, agreed: boolean) => void;
}) {
  const [email, setEmail] = useState("");
  const [agreed, setAgreed] = useState(false);
  const ready = !!email.trim() && agreed;
  return (
    <form
      className="grid gap-5"
      noValidate
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        if (ready && !pending) onSubmit(email.trim(), agreed);
      }}
    >
      <Field id="claim-email" label="Email">
        <Input
          id="claim-email"
          type="email"
          autoComplete="email"
          inputMode="email"
          placeholder="you@example.com"
          className="h-11"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoFocus
        />
      </Field>
      <TermsBox checked={agreed} onChange={setAgreed} />
      {error && <Notice tone="danger">{error}</Notice>}
      <Button type="submit" className="h-11 w-full" disabled={!ready || pending}>
        {pending && <Loader2 className="animate-spin" aria-hidden="true" />}
        Send code
      </Button>
    </form>
  );
}

function EmailStep({
  claim,
  memory,
  onConfirmed,
}: {
  claim: Claim;
  memory: ClaimMemory;
  onConfirmed: (result: Awaited<ReturnType<typeof claimsApi.confirmEmail>>) => Promise<void>;
}) {
  const termsVersion = useTermsVersion();
  // A code sent from the start page a moment ago: straight to it.
  const fromStart =
    memory.sentEmail && Date.now() - Number(memory.sentAt) < CODE_MINUTES * 60_000
      ? {
          sent: true,
          email: memory.sentEmail,
          ...(memory.devCode ? { devCode: memory.devCode } : {}),
          at: Number(memory.sentAt),
        }
      : null;
  const [sent, setSent] = useState<(SentCode & { at: number }) | null>(fromStart);
  const [terms, setTerms] = useState<string | null>(memory.terms ?? null);
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
        terms={terms}
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
      <ClaimHeading
        title={claim.startedBy === "agent" ? `Set up ${claim.name}` : "Get your Agent ID"}
      >
        Enter your email. We'll send a code, and that's it.
      </ClaimHeading>
      {claim.startedBy === "agent" && (
        <>
          <ClaimAgent name={claim.name} app={claim.app} device={claim.device} />
          <StartedByAgent claim={claim} />
        </>
      )}
      <EmailForm
        pending={send.isPending}
        error={send.isError ? errorMessage(send.error) : null}
        onSubmit={(email, agreed) => {
          setTerms(agreed ? termsVersion : null);
          send.mutate(email);
        }}
      />
    </>
  );
}

// An agent asked for this link: show its code to compare, and say plainly
// what continuing means.
function StartedByAgent({ claim }: { claim: Claim }) {
  return (
    <p className="-mt-3 mb-6 text-sm text-[var(--muted-foreground)]">
      Check that your agent shows{" "}
      <strong className="aid-mono whitespace-nowrap tracking-wider text-[var(--foreground)]">
        {claim.matchCode}
      </strong>
      . Only continue if you started this: you're responsible for what {claim.name} does.
    </p>
  );
}

function CodeForm({
  claim,
  sent,
  terms,
  resend,
  resending,
  resendError,
  onChangeEmail,
  onConfirmed,
}: {
  claim: Claim;
  sent: SentCode & { at: number };
  terms: string | null;
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
    mutationFn: (value: string) => claimsApi.confirmEmail(claim.code, value, terms ?? undefined),
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
      <ClaimHeading title="Check your email">
        Enter the 6-digit code we sent to{" "}
        <strong className="text-[var(--foreground)]">{sent.email}</strong>.
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

// --- The terms, when the code was confirmed without them ----------------------------

function TermsStep({
  claim,
  session,
  onDone,
  onLostSession,
}: {
  claim: Claim;
  session: string;
  onDone: (claim: Claim) => void;
  onLostSession: () => void;
}) {
  const [agreed, setAgreed] = useState(false);
  const reloadWhenStale = useReloadWhenStale(claim.code);
  const accept = useMutation({
    mutationFn: () => claimsApi.acceptTerms(claim.code, session, claim.terms?.current ?? ""),
    onSuccess: (result) => onDone(result.claim),
    onError: (error) => {
      if (error instanceof AgentIdError && error.code === "claim_session") onLostSession();
      reloadWhenStale(error);
    },
  });
  return (
    <>
      <ClaimHeading title="One last thing">
        Agree to the terms and {claim.name} is ready.
      </ClaimHeading>
      <div className="grid gap-5">
        <TermsBox checked={agreed} onChange={setAgreed} />
        {accept.isError && <Notice tone="danger">{errorMessage(accept.error)}</Notice>}
        <Button
          className="h-11 w-full"
          disabled={!agreed || accept.isPending}
          onClick={() => accept.mutate()}
        >
          {accept.isPending && <Loader2 className="animate-spin" aria-hidden="true" />}
          Continue
        </Button>
      </div>
    </>
  );
}

// --- Ready ------------------------------------------------------------------------------

function Done({ claim, secret }: { claim: Claim; secret: string | null }) {
  const byAgent = claim.startedBy === "agent";
  const showCommand = !byAgent && !!secret && !claim.keyCollected;
  const name = claim.agent?.name ?? claim.name;
  const app = claim.app?.label;
  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-6">
      <div className="flex flex-col items-center text-center">
        <span className="relative">
          <Avatar name={name} size="xl" />
          <span className="absolute -bottom-1 -right-1 grid h-8 w-8 place-items-center rounded-full border-4 border-[var(--card)] bg-[var(--aid-success)] text-white">
            <Check className="h-4 w-4" strokeWidth={3} aria-hidden="true" />
          </span>
        </span>
        <h1 className="mt-4 text-2xl font-semibold tracking-tight text-balance">{name} is ready</h1>
        <p className="mt-1.5 text-sm text-[var(--muted-foreground)]">
          Its own email address and wallet, a phone number when you want one, and a computer.
        </p>
      </div>

      {claim.agent && (
        <ReadyList resources={claim.agent.resources ?? {}} agentId={claim.agent.id} />
      )}

      {byAgent ? (
        <NextStep title={`Go back to ${app ?? "your agent"}`}>
          {claim.keyCollected ? "It's connected." : "It finishes connecting there in a moment."}{" "}
          Then try asking it: “What's my Agent ID email address?”
        </NextStep>
      ) : showCommand && secret ? (
        <NextStep title="Connect it to your AI app">
          Run this on the computer where you use Claude Code, Codex, Cursor or another AI app. It
          works once.
          <div className="mt-3">
            <CommandLine command={claimCommand(secret)} />
          </div>
        </NextStep>
      ) : claim.keyCollected ? (
        <NextStep title={`${name} is connected`}>
          You'll find everything it does in Agent ID.
        </NextStep>
      ) : null}

      <Button asChild variant={showCommand ? "outline" : "default"} className="h-11 w-full">
        <Link to="/agent-id/dashboard">Open Agent ID</Link>
      </Button>
    </div>
  );
}

function NextStep({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-xl bg-[var(--muted)] p-4 text-sm">
      <h2 className="font-semibold">{title}</h2>
      <div className="mt-1 text-[var(--muted-foreground)]">{children}</div>
    </section>
  );
}
