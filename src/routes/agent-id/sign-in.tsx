import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { KeyRound, Loader2, MailCheck } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Brand, ThemeMenu } from "@/components/agent-id/Brand";
import { Field, Notice } from "@/components/agent-id/ui";
import { safeRedirect } from "@/lib/agent-id/format";
import { useSession } from "@/lib/agent-id/session";

export const Route = createFileRoute("/agent-id/sign-in")({
  validateSearch: (search: Record<string, unknown>): { redirect?: string } =>
    typeof search["redirect"] === "string" ? { redirect: search["redirect"] } : {},
  head: () => ({ meta: [{ title: "Sign in · Agent ID" }] }),
  component: SignInPage,
});

// Supabase's messages, in words a person can act on.
function friendly(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("invalid login credentials"))
    return "That email and password don't match a Timewarp account. Check them, or sign in with an email code.";
  if (m.includes("email not confirmed"))
    return "Confirm your email address first: open the link Timewarp sent you, then sign in.";
  if (m.includes("signups not allowed") || m.includes("user not found"))
    return "There's no Timewarp account with this email yet. Get an Agent ID to make one, or create one in the Timewarp app.";
  if (m.includes("token has expired") || (m.includes("invalid") && m.includes("token")))
    return "That code is wrong or has expired. Request a new one.";
  if (m.includes("rate limit") || m.includes("security purposes"))
    return "Too many attempts right now. Wait a minute and try again.";
  if (m.includes("failed to fetch") || m.includes("network"))
    return "Can't reach Timewarp. Check your connection and try again.";
  return message;
}

function SignInPage() {
  const session = useSession();
  const navigate = useNavigate();
  const { redirect } = Route.useSearch();
  const target = safeRedirect(redirect);

  useEffect(() => {
    if (session.status === "signed-in") void navigate({ href: target, replace: true });
  }, [session.status, navigate, target]);

  return (
    <div className="flex min-h-svh flex-col">
      <header className="mx-auto flex h-16 w-full max-w-5xl items-center justify-between px-4 sm:px-6">
        <Brand />
        <ThemeMenu />
      </header>
      <main className="flex flex-1 items-start justify-center px-4 pb-16 pt-6 sm:items-center sm:pt-0">
        <div className="w-full max-w-md">
          <div className="aid-card p-6 sm:p-8">
            <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
            <p className="mt-1 text-sm text-[var(--muted-foreground)]">
              With your Timewarp account.
            </p>
            {session.status === "signed-out" && session.problem && (
              <Notice tone="danger" className="mt-4">
                {session.problem}
              </Notice>
            )}
            {session.status === "signed-in" ? (
              <div className="mt-6 flex items-center gap-2 text-sm text-[var(--muted-foreground)]">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Opening your
                dashboard…
              </div>
            ) : (
              <Tabs defaultValue="code" className="mt-6">
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="code">Email code</TabsTrigger>
                  <TabsTrigger value="password">Password</TabsTrigger>
                </TabsList>
                <TabsContent value="code" className="mt-5">
                  <CodeSignIn />
                </TabsContent>
                <TabsContent value="password" className="mt-5">
                  <PasswordSignIn />
                </TabsContent>
              </Tabs>
            )}
          </div>
          <p className="mt-6 text-center text-sm text-[var(--muted-foreground)]">
            No account?{" "}
            <Link to="/agent-id/claim" className="aid-link font-medium">
              Get an Agent ID
            </Link>
          </p>
        </div>
      </main>
    </div>
  );
}

function PasswordSignIn() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { error: failure } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (failure) setError(friendly(failure.message));
    } catch (caught) {
      setError(friendly(caught instanceof Error ? caught.message : "Sign-in failed."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <Field id="password-email" label="Email">
        <Input
          id="password-email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </Field>
      <Field id="password-password" label="Password">
        <Input
          id="password-password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </Field>
      {error && <Notice tone="danger">{error}</Notice>}
      <Button type="submit" className="w-full" disabled={busy || !email.trim() || !password}>
        {busy ? (
          <Loader2 className="animate-spin" aria-hidden="true" />
        ) : (
          <KeyRound aria-hidden="true" />
        )}
        Sign in
      </Button>
    </form>
  );
}

function CodeSignIn() {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function sendCode(event?: FormEvent) {
    event?.preventDefault();
    const address = email.trim();
    if (!address) return;
    setBusy(true);
    setError(null);
    try {
      const { error: failure } = await supabase.auth.signInWithOtp({
        email: address,
        options: { shouldCreateUser: false },
      });
      if (failure) setError(friendly(failure.message));
      else {
        setSentTo(address);
        setCode("");
      }
    } catch (caught) {
      setError(friendly(caught instanceof Error ? caught.message : "Couldn't send a code."));
    } finally {
      setBusy(false);
    }
  }

  async function verify(event: FormEvent) {
    event.preventDefault();
    if (!sentTo) return;
    setBusy(true);
    setError(null);
    try {
      const { error: failure } = await supabase.auth.verifyOtp({
        email: sentTo,
        token: code.trim(),
        type: "email",
      });
      if (failure) setError(friendly(failure.message));
    } catch (caught) {
      setError(friendly(caught instanceof Error ? caught.message : "Couldn't check the code."));
    } finally {
      setBusy(false);
    }
  }

  if (!sentTo) {
    return (
      <form onSubmit={sendCode} className="space-y-4" noValidate>
        <Field id="code-email" label="Email" hint="We'll email you a one-time code.">
          <Input
            id="code-email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>
        {error && <Notice tone="danger">{error}</Notice>}
        <Button type="submit" className="w-full" disabled={busy || !email.trim()}>
          {busy ? (
            <Loader2 className="animate-spin" aria-hidden="true" />
          ) : (
            <MailCheck aria-hidden="true" />
          )}
          Email me a code
        </Button>
      </form>
    );
  }

  return (
    <form onSubmit={verify} className="space-y-4" noValidate>
      <Notice>
        We sent a code to <strong>{sentTo}</strong>. It's in the email from Timewarp.
      </Notice>
      <Field id="code-token" label="Code">
        <Input
          id="code-token"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]*"
          maxLength={10}
          autoFocus
          className="aid-mono text-lg tracking-[0.3em]"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
        />
      </Field>
      {error && <Notice tone="danger">{error}</Notice>}
      <Button type="submit" className="w-full" disabled={busy || code.trim().length < 6}>
        {busy && <Loader2 className="animate-spin" aria-hidden="true" />}
        Sign in
      </Button>
      <div className="flex flex-wrap justify-between gap-2 text-sm">
        <button type="button" className="aid-link" onClick={() => setSentTo(null)}>
          Use a different email
        </button>
        <button type="button" className="aid-link" disabled={busy} onClick={() => void sendCode()}>
          Send a new code
        </button>
      </div>
    </form>
  );
}
