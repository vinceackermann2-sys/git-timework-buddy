// The public Agent ID site around every page that isn't the app, in the
// style of lovable.dev, claude.ai and Strawberry: a centered hero with one
// box to start in, the product in an app window with the mascots peeking
// over it, then a few airy sections of tiles. The copy follows Deus's
// Copywriting Formula (docs/agent-id-ladder.md).
import { Link, useNavigate } from "@tanstack/react-router";
import { ArrowRight, Loader2 } from "lucide-react";
import { useState } from "react";
import type { FormEvent, ReactNode } from "react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Brand, ThemeMenu } from "@/components/agent-id/Brand";
import { AppIcon } from "@/components/agent-id/AppIcons";
import { useStartClaim } from "@/components/agent-id/claim/ClaimFlow";
import { AgentAvatar, Notice } from "@/components/agent-id/ui";
import { errorMessage } from "@/lib/agent-id/client";
import { useSession } from "@/lib/agent-id/session";

export function SitePage({ children }: { children: ReactNode }) {
  const signedIn = useSession().status === "signed-in";
  return (
    <div className="flex min-h-svh flex-col overflow-x-clip">
      <header className="relative z-10 mx-auto grid h-16 w-full max-w-6xl grid-cols-[1fr_auto] items-center gap-3 px-4 sm:px-6 md:grid-cols-[1fr_auto_1fr]">
        <Brand />
        <nav className="hidden items-center gap-1 text-sm md:flex" aria-label="Agent ID">
          <Link
            to="/agent-id/check"
            className="rounded-full px-3 py-1.5 text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
          >
            AI or real?
          </Link>
          <Link
            to="/agent-id/pricing"
            className="rounded-full px-3 py-1.5 text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
          >
            Pricing
          </Link>
        </nav>
        <div className="flex items-center justify-end gap-1">
          {!signedIn && (
            <Button asChild variant="ghost" size="sm" className="rounded-full">
              <Link to="/agent-id/sign-in">Sign in</Link>
            </Button>
          )}
          <Button asChild size="sm" className={cn(PILL, "px-4")}>
            <Link to={signedIn ? "/agent-id/dashboard" : "/agent-id/claim"}>
              {signedIn ? "Open Agent ID" : "Get started"}
            </Link>
          </Button>
          <ThemeMenu />
        </div>
      </header>
      <main className="flex-1">{children}</main>
      <footer className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-8 text-xs text-[var(--muted-foreground)] sm:px-6">
        <span>© 2026 Timewarp</span>
        <nav className="flex flex-wrap gap-x-4 gap-y-2" aria-label="More">
          <Link to="/agent-id/check" className="hover:text-[var(--foreground)]">
            AI or real?
          </Link>
          <Link to="/agent-id/pricing" className="hover:text-[var(--foreground)]">
            Pricing
          </Link>
          <a href="/legal/agent-id-terms" className="hover:text-[var(--foreground)]">
            Agent ID Terms
          </a>
          <a href="/legal/privacy-policy" className="hover:text-[var(--foreground)]">
            Privacy
          </a>
        </nav>
      </footer>
    </div>
  );
}

// The brand's one strong button: ink, round, with a soft glow.
const PILL =
  "rounded-full bg-[var(--aid-ink)] text-[var(--background)] shadow-[0_8px_24px_-10px_var(--aid-ink)] hover:bg-[var(--aid-ink)] hover:opacity-90";

// The top of every page: one promise, one line under it, the place to start,
// and the product below, on a soft dotted, glowing backdrop.
export function Hero({
  eyebrow,
  title,
  lead,
  action,
  children,
}: {
  eyebrow?: string;
  title: ReactNode;
  lead: ReactNode;
  action?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <section className="relative isolate">
      <div aria-hidden="true" className="absolute inset-x-0 -top-16 -z-10 h-[46rem]">
        <div className="aid-dots absolute inset-0" />
        <div className="absolute left-1/2 top-24 h-80 w-[min(56rem,90vw)] -translate-x-1/2 rounded-full bg-gradient-to-r from-[#A855F7]/25 via-[#EC4899]/20 to-[#A855F7]/10 blur-3xl" />
      </div>
      <div className="mx-auto flex w-full max-w-4xl flex-col items-center px-4 pb-10 pt-12 text-center sm:px-6 sm:pt-20">
        {eyebrow && (
          <p className="mb-5 rounded-full border border-[var(--border)] bg-[var(--card)]/80 px-3.5 py-1 text-xs font-medium text-[var(--aid-ink)] backdrop-blur">
            {eyebrow}
          </p>
        )}
        <h1 className="text-balance text-[2.75rem] font-semibold leading-[1.05] tracking-[-0.03em] sm:text-7xl">
          {title}
        </h1>
        <p className="mt-6 max-w-2xl text-balance text-lg text-[var(--muted-foreground)] sm:text-xl">
          {lead}
        </p>
        <div className="mt-9 w-full max-w-xl">{action ?? <EmailStart />}</div>
      </div>
      {children && <div className="mx-auto w-full max-w-5xl px-4 sm:px-6">{children}</div>}
    </section>
  );
}

// Where everyone starts: an email in one rounded box, the way Lovable and
// Claude start with a prompt. It sends the code at once; the terms come with
// the code. Signed in, it opens Agent ID instead.
export function EmailStart({ note = "Free. No card. We'll email you a code." }: { note?: string }) {
  const signedIn = useSession().status === "signed-in";
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const start = useStartClaim();
  if (signedIn) {
    return (
      <Button asChild size="lg" className={cn(PILL, "h-12 px-7 text-base")}>
        <Link to="/agent-id/dashboard">
          Open Agent ID <ArrowRight aria-hidden="true" />
        </Link>
      </Button>
    );
  }
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (start.isPending) return;
    // An empty box: the button points at it instead of doing nothing.
    if (!email.trim()) {
      (event.currentTarget as HTMLFormElement).querySelector("input")?.focus();
      return;
    }
    start.mutate(
      { email: email.trim(), agreed: false },
      { onSuccess: (code) => void navigate({ to: "/agent-id/claim/$code", params: { code } }) },
    );
  };
  return (
    <form onSubmit={submit} className="text-left" noValidate>
      <div className="flex items-center gap-2 rounded-[1.75rem] border border-[var(--border)] bg-[var(--card)] p-2 pl-5 shadow-[0_20px_50px_-20px_rgba(76,29,149,0.35)] focus-within:border-[var(--aid-ink)]">
        <label htmlFor="start-email" className="sr-only">
          Your email
        </label>
        <input
          id="start-email"
          type="email"
          autoComplete="email"
          inputMode="email"
          placeholder="you@company.com"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-[var(--muted-foreground)]"
        />
        <Button
          type="submit"
          size="lg"
          disabled={start.isPending}
          className={cn(PILL, "h-11 shrink-0 px-5")}
        >
          {start.isPending && <Loader2 className="animate-spin" aria-hidden="true" />}
          <span className="hidden sm:inline">Get started for free</span>
          <span className="sm:hidden">Start free</span>
        </Button>
      </div>
      {start.isError ? (
        <Notice tone="danger" className="mt-3">
          {errorMessage(start.error)}
        </Notice>
      ) : (
        <p className="mt-3 text-center text-sm text-[var(--muted-foreground)]">{note}</p>
      )}
    </form>
  );
}

// The product in an app window, with Timewarp's mascots peeking over its top
// edge.
export function Window({
  title,
  children,
  mascots = true,
  className,
}: {
  title: string;
  children: ReactNode;
  mascots?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("relative pt-16 sm:pt-[5.5rem]", className)}>
      {mascots && (
        // Behind the window, so the bottom of each mascot hides under its edge.
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-4 top-0 flex justify-between sm:inset-x-14"
        >
          <span className="flex items-end gap-1 sm:gap-4">
            <AgentAvatar mascot="nova" size="xl" className="h-20 w-20 -rotate-6 sm:h-28 sm:w-28" />
            <AgentAvatar mascot="orbit" size="xl" className="h-16 w-16 sm:h-24 sm:w-24" />
          </span>
          <AgentAvatar mascot="cosmo" size="xl" className="h-20 w-20 rotate-6 sm:h-28 sm:w-28" />
        </div>
      )}
      <div className="relative z-10 overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-[0_40px_90px_-40px_rgba(23,32,51,0.45)]">
        <div className="flex items-center gap-3 border-b border-[var(--border)] bg-[var(--muted)]/70 px-4 py-2.5">
          <span aria-hidden="true" className="flex gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
          </span>
          <span className="mx-auto truncate rounded-md bg-[var(--card)] px-3 py-0.5 text-xs text-[var(--muted-foreground)]">
            {title}
          </span>
          <span className="w-12" aria-hidden="true" />
        </div>
        {children}
      </div>
    </div>
  );
}

// The apps it works in, as a quiet row under the hero.
const APPS: [string, string][] = [
  ["claude-code", "Claude Code"],
  ["codex", "Codex"],
  ["cursor", "Cursor"],
  ["gemini", "Gemini"],
  ["copilot", "Copilot"],
  ["grok", "Grok"],
];
export function WorksIn() {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col items-center gap-4 px-4 py-14 sm:px-6">
      <p className="text-sm text-[var(--muted-foreground)]">Works in the apps you already use</p>
      <div className="flex flex-wrap justify-center gap-3">
        {APPS.map(([app, name]) => (
          <AppIcon key={app} app={app} label={name} size="md" />
        ))}
      </div>
    </div>
  );
}

// A section: a centered heading, a line, and what it shows.
export function Section({
  title,
  lead,
  children,
  label,
  narrow = false,
}: {
  title: ReactNode;
  lead?: ReactNode;
  children?: ReactNode;
  label?: string;
  narrow?: boolean;
}) {
  return (
    <section aria-label={label} className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
      <div className={cn("mx-auto text-center", narrow ? "max-w-2xl" : "max-w-3xl")}>
        <h2 className="text-balance text-3xl font-semibold tracking-[-0.02em] sm:text-5xl">
          {title}
        </h2>
        {lead && (
          <div className="mt-5 text-balance text-lg text-[var(--muted-foreground)] sm:text-xl">
            {lead}
          </div>
        )}
      </div>
      {children && <div className="mt-12">{children}</div>}
    </section>
  );
}

// The relatable moment, told the way the visitor would tell it: a few short
// lines, then the turn.
export function Scenario({ lines, turn }: { lines: ReactNode[]; turn: ReactNode }) {
  return (
    <div className="mx-auto max-w-3xl text-center">
      <div className="grid gap-3 text-balance text-2xl leading-snug tracking-[-0.01em] text-[var(--muted-foreground)] sm:text-3xl">
        {lines.map((line, index) => (
          <p key={index}>{line}</p>
        ))}
      </div>
      <p className="mt-8 text-balance text-2xl font-semibold leading-snug tracking-[-0.01em] sm:text-3xl">
        {turn}
      </p>
    </div>
  );
}

// Tiles: a picture of the product on a soft stage, a title and a line under
// it. `wide` tiles take two thirds of a row on large screens.
export function Tiles({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-[minmax(0,1fr)] gap-5 md:grid-cols-6">{children}</div>;
}
export function Tile({
  title,
  line,
  visual,
  span = 2,
  to,
}: {
  title: string;
  line: ReactNode;
  visual: ReactNode;
  span?: 2 | 3 | 4 | 6;
  to?: ReactNode;
}) {
  const spans = { 2: "md:col-span-2", 3: "md:col-span-3", 4: "md:col-span-4", 6: "md:col-span-6" };
  return (
    <article className={cn("group flex min-w-0 flex-col", spans[span])}>
      <div className="relative grid min-h-56 place-items-center overflow-hidden rounded-3xl border border-[var(--border)] bg-[var(--muted)]/70 p-6">
        <div aria-hidden="true" className="aid-dots absolute inset-0 opacity-60" />
        <div className="relative w-full">{visual}</div>
      </div>
      <h3 className="mt-4 text-lg font-semibold tracking-[-0.01em]">{title}</h3>
      <p className="mt-1 text-[var(--muted-foreground)]">{line}</p>
      {to && <div className="mt-2 text-sm">{to}</div>}
    </article>
  );
}

// The close: the dream in one line, and the same box to start.
export function Closing({ title, lead }: { title: ReactNode; lead: ReactNode }) {
  return (
    <section aria-label="Start" className="relative isolate overflow-hidden px-4 py-24 sm:px-6">
      <div aria-hidden="true" className="absolute inset-0 -z-10">
        <div className="absolute left-1/2 top-1/2 h-72 w-[min(48rem,90vw)] -translate-x-1/2 -translate-y-1/2 rounded-full bg-gradient-to-r from-[#A855F7]/20 via-[#EC4899]/15 to-[#A855F7]/10 blur-3xl" />
      </div>
      <div className="mx-auto flex max-w-3xl flex-col items-center text-center">
        <h2 className="text-balance text-4xl font-semibold tracking-[-0.03em] sm:text-6xl">
          {title}
        </h2>
        <p className="mt-5 text-balance text-lg text-[var(--muted-foreground)]">{lead}</p>
        <div className="mt-9 w-full max-w-xl">
          <EmailStart />
        </div>
      </div>
    </section>
  );
}

// Questions people ask before they start, answered plainly.
export function Questions({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="mx-auto grid max-w-4xl gap-x-12 gap-y-8 md:grid-cols-2">
      {items.map(([question, answer]) => (
        <div key={question}>
          <dt className="font-semibold">{question}</dt>
          <dd className="mt-2 text-[var(--muted-foreground)]">{answer}</dd>
        </div>
      ))}
    </dl>
  );
}
