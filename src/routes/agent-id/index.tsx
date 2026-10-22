import { Link, createFileRoute } from "@tanstack/react-router";
import { ArrowRight, Check, ChevronDown } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { AppIcon } from "@/components/agent-id/AppIcons";
import { Brand, ThemeMenu } from "@/components/agent-id/Brand";
import { ResourceArt, type ArtKind } from "@/components/agent-id/ResourceArt";
import { AgentAvatar, Chip } from "@/components/agent-id/ui";
import { useSession } from "@/lib/agent-id/session";

export const Route = createFileRoute("/agent-id/")({
  head: () => ({ meta: [{ title: "Timewarp Agent ID · Let your AI finish the job" }] }),
  component: AgentIdLanding,
});

// The front door, written for people who don't know they need an Agent ID
// yet: a moment they recognize (the AI plans, they still click), why it
// happens (it has no accounts of its own), what Agent ID gives it, how they
// stay in charge, and the free start. Every promise here is something the
// product does today; nothing is made up.

// Names as people know them; one icon per maker.
const WORKS_WITH: [string, string][] = [
  ["claude-code", "Claude"],
  ["codex", "Codex"],
  ["cursor", "Cursor"],
  ["gemini", "Gemini"],
  ["grok", "Grok"],
  ["copilot", "Copilot"],
];

function AgentIdLanding() {
  const session = useSession();
  const signedIn = session.status === "signed-in";

  return (
    <div className="flex min-h-svh flex-col overflow-x-clip">
      <header className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
        <Brand />
        <nav className="flex items-center gap-1" aria-label="Agent ID">
          <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex">
            <Link to="/agent-id/pricing">Pricing</Link>
          </Button>
          {!signedIn && (
            <Button asChild variant="ghost" size="sm">
              <Link to="/agent-id/sign-in">Sign in</Link>
            </Button>
          )}
          <Start signedIn={signedIn} size="sm" />
          <ThemeMenu />
        </nav>
      </header>

      <main className="flex-1">
        {/* A moment they recognize, and the way out of it. */}
        <section className="mx-auto grid w-full max-w-6xl grid-cols-[minmax(0,1fr)] items-center gap-12 px-4 pb-20 pt-10 sm:px-6 sm:pt-16 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] lg:gap-16">
          <div>
            <h1 className="max-w-xl text-4xl font-semibold leading-[1.08] tracking-tight sm:text-6xl">
              Your AI does the thinking. You still do the clicking.
            </h1>
            <p className="mt-6 max-w-lg text-lg text-[var(--muted-foreground)]">
              Agent ID gives your AI the last step:{" "}
              <strong className="font-semibold text-[var(--foreground)]">
                its own email, wallet, computer and memory
              </strong>
              . So it sends, pays and gets it done for you, under your rules.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-x-5 gap-y-3">
              <Start signedIn={signedIn} />
              {!signedIn && (
                <span className="text-sm text-[var(--muted-foreground)]">
                  No card. Just your email.
                </span>
              )}
            </div>
            <WorksWith className="mt-12" />
          </div>
          <div className="relative isolate mx-auto w-full max-w-md lg:max-w-none">
            <div
              aria-hidden="true"
              className="absolute -inset-6 -z-10 rounded-[2.5rem] bg-[var(--aid-glow)] blur-3xl"
            />
            <FinishedTask />
          </div>
        </section>

        {/* Where it stops today, and why. */}
        <Band>
          <Heading
            title="AI can plan almost anything. It just can't finish."
            lead={
              <>
                <strong className="font-semibold text-[var(--foreground)]">
                  It has no accounts of its own.
                </strong>{" "}
                So the last step is always yours.
              </>
            }
          />
          <ul className="mt-10 grid gap-3 sm:grid-cols-3">
            {[
              ["It writes the perfect reply.", "You copy it, paste it and press send."],
              ["It finds the right supplier.", "You email them, then chase them for days."],
              ["It works out who to pay.", "You log in and send the money yourself."],
            ].map(([ai, you]) => (
              <li key={ai} className="aid-card p-5">
                <p className="font-medium">{ai}</p>
                <p className="mt-1 text-[var(--muted-foreground)]">{you}</p>
              </li>
            ))}
          </ul>
        </Band>

        {/* What it gets: its own accounts, each with what it means. */}
        <section className="mx-auto w-full max-w-6xl px-4 py-20 sm:px-6">
          <Heading
            title="Agent ID gives your AI its own accounts."
            lead="Its own, not yours. Tied to you, with the limits you choose."
          />
          <ul className="mt-10 grid gap-x-10 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
            {(
              [
                ["mail", "Email", "Its own address. It sends, reads and answers mail."],
                ["wallet", "Wallet", "Dollars it can spend, up to your limits."],
                ["vm", "Computer", "Runs code and long jobs while you do other things."],
                [
                  "vault",
                  "Vault",
                  "Keys locked on its own computer. It uses them without seeing them.",
                ],
                ["memory", "Memory", "Remembers you in every app it works in."],
                ["phone", "Phone and card", "Its own number and virtual card.", true],
              ] as [ArtKind, string, string, boolean?][]
            ).map(([kind, name, line, soon]) => (
              <li key={kind} className="flex gap-4">
                <ResourceArt kind={kind} size={44} />
                <div className="min-w-0">
                  <p className="flex items-center gap-2 font-semibold">
                    {name}
                    {soon && <Chip>Coming soon</Chip>}
                  </p>
                  <p className="mt-0.5 text-[var(--muted-foreground)]">{line}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>

        {/* The objection that matters most: is it safe to let it act? */}
        <Band>
          <div className="grid gap-10 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:items-center">
            <Heading title="You stay in charge." lead="It acts for you, never instead of you." />
            <ul className="aid-card divide-y divide-[var(--border)]">
              {[
                ["Payments over your limit wait for your yes.", "You approve them on your phone."],
                ["You choose what it asks you first.", "Sending email, texting or calling."],
                ["Every step shows in its activity.", "Pause or remove it in one click."],
                [
                  "It's tied to you.",
                  "Verify once, and others can check a real person stands behind it.",
                ],
              ].map(([title, line]) => (
                <li key={title} className="flex gap-3 px-5 py-4">
                  <Check
                    className="mt-0.5 h-5 w-5 shrink-0 text-[var(--aid-success)]"
                    aria-hidden="true"
                  />
                  <p>
                    <span className="font-medium">{title}</span>{" "}
                    <span className="text-[var(--muted-foreground)]">{line}</span>
                  </p>
                </li>
              ))}
            </ul>
          </div>
        </Band>

        {/* Where it works, and the free start. */}
        <section className="mx-auto w-full max-w-6xl px-4 py-20 sm:px-6">
          <div className="grid gap-12 lg:grid-cols-2">
            <div>
              <Heading
                title="Works in the AI you already use."
                lead="Paste one line on your computer, or open the link your AI gives you."
              />
              <ul className="mt-8 flex flex-wrap gap-2">
                {WORKS_WITH.map(([app, name]) => (
                  <li
                    key={app}
                    className="flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--card)] py-1.5 pl-1.5 pr-3.5 text-sm font-medium"
                  >
                    <AppIcon app={app} label={name} size="sm" tooltip={false} />
                    {name}
                  </li>
                ))}
              </ul>
            </div>
            <div className="aid-card p-6 sm:p-8">
              <h2 className="text-2xl font-semibold tracking-tight">Free to start.</h2>
              <p className="mt-3 text-[var(--muted-foreground)]">
                <strong className="font-semibold text-[var(--foreground)]">
                  Email, wallet and 5 hours of computer time are free.
                </strong>{" "}
                No subscription. Extra computer time and phone numbers use Timewarp credits.
              </p>
              <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-3">
                <Start signedIn={signedIn} />
                <Link to="/agent-id/pricing" className="aid-link text-sm">
                  See pricing
                </Link>
              </div>
            </div>
          </div>
        </section>

        {/* What someone new asks before they try it. */}
        <Band>
          <Heading title="Questions" />
          <div className="mt-8 grid gap-3">
            <Question q="What's an AI agent?">
              An AI like Claude or Codex that does tasks for you step by step, instead of only
              answering. Agent ID gives it what it needs to finish them.
            </Question>
            <Question q="Do I need to know how to code?">
              No. Sign up with your email. To connect your AI, you paste one line into your
              computer's terminal, or open the link your AI shows you.
            </Question>
            <Question q="Is my money safe?">
              It can only spend what you put in its wallet, up to the limits you set. Anything
              bigger waits for your yes, and you can pause it at any time.
            </Question>
            <Question q="What does it cost?">
              Nothing to start: email, wallet and 5 hours of computer time are free. You only pay,
              in Timewarp credits, for extra computer time and phone numbers.
            </Question>
          </div>
        </Band>

        <section className="mx-auto w-full max-w-6xl px-4 py-20 text-center sm:px-6">
          <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            Let your AI finish the job.
          </h2>
          <div className="mt-8 flex flex-col items-center gap-3">
            <Start signedIn={signedIn} />
            {!signedIn && (
              <span className="text-sm text-[var(--muted-foreground)]">
                No card. Just your email.
              </span>
            )}
          </div>
        </section>
      </main>

      <footer className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-6 text-xs text-[var(--muted-foreground)] sm:px-6">
        <span>© 2026 Timewarp</span>
        <nav className="flex gap-4" aria-label="Legal">
          <a href="/legal/agent-id-terms" className="hover:text-[var(--foreground)]">
            Agent ID Terms
          </a>
          <a href="/legal/privacy-policy" className="hover:text-[var(--foreground)]">
            Privacy
          </a>
          <a href="/legal/terms-of-service" className="hover:text-[var(--foreground)]">
            Terms
          </a>
        </nav>
      </footer>
    </div>
  );
}

// The one action on the page, everywhere it appears, in the brand's strongest
// color so it can't be missed (the small one in the header hides on phones,
// where the big one is right below it).
function Start({ signedIn, size = "lg" }: { signedIn: boolean; size?: "sm" | "lg" }) {
  return (
    <Button
      asChild
      size={size}
      className={cn(
        "rounded-full bg-[var(--aid-ink)] text-[var(--background)] shadow-[0_8px_24px_-8px_var(--aid-ink)] hover:bg-[var(--aid-ink)] hover:opacity-90",
        size === "lg" ? "h-12 px-7 text-base" : "hidden px-4 sm:inline-flex",
      )}
    >
      <Link to={signedIn ? "/agent-id/dashboard" : "/agent-id/claim"}>
        {signedIn ? "Open Agent ID" : size === "sm" ? "Get started free" : "Get started for free"}
        {size === "lg" && <ArrowRight aria-hidden="true" />}
      </Link>
    </Button>
  );
}

function WorksWith({ className }: { className?: string }) {
  return (
    <div className={className}>
      <span className="flex flex-wrap items-center gap-3">
        <span className="text-xs font-medium text-[var(--muted-foreground)]">Works with</span>
        <span className="flex items-center gap-1.5">
          {WORKS_WITH.map(([app, name]) => (
            <AppIcon key={app} app={app} label={name} size="md" />
          ))}
        </span>
      </span>
    </div>
  );
}

// A tinted full-width band, to separate one part of the story from the next.
function Band({ children }: { children: ReactNode }) {
  return (
    <section className="border-y border-[var(--border)] bg-[var(--card)]/60">
      <div className="mx-auto w-full max-w-6xl px-4 py-20 sm:px-6">{children}</div>
    </section>
  );
}

function Heading({ title, lead }: { title: string; lead?: ReactNode }) {
  return (
    <div className="max-w-2xl">
      <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h2>
      {lead && <p className="mt-3 text-lg text-[var(--muted-foreground)]">{lead}</p>}
    </div>
  );
}

function Question({ q, children }: { q: string; children: ReactNode }) {
  return (
    <details className="aid-card group px-5 py-4">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-medium [&::-webkit-details-marker]:hidden">
        {q}
        <ChevronDown
          className="h-4 w-4 shrink-0 text-[var(--muted-foreground)] transition-transform group-open:rotate-180"
          aria-hidden="true"
        />
      </summary>
      <p className="mt-2 max-w-3xl text-[var(--muted-foreground)]">{children}</p>
    </details>
  );
}

// An example of a task an agent finishes with Agent ID, end to end: the
// scenario the page is about, shown rather than told.
function FinishedTask() {
  const steps: { kind: ArtKind; done: string; detail: string }[] = [
    { kind: "mail", done: "Emailed 3 suppliers", detail: "from its own address" },
    { kind: "mail", done: "Read their quotes", detail: "Nordic Parts is cheapest" },
    {
      kind: "wallet",
      done: "Paid the $412.50 deposit",
      detail: "in USDC, after you tapped Approve",
    },
    { kind: "memory", done: "Remembered", detail: "that you prefer Nordic Parts" },
  ];
  return (
    <div className="aid-card overflow-hidden shadow-[0_24px_60px_-20px_rgba(23,32,51,0.25)]">
      <div className="flex items-center gap-4 border-b border-[var(--border)] px-6 py-5">
        <AgentAvatar mascot="orbit" size="lg" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-lg font-semibold">Your agent</p>
          <p className="mt-0.5 text-sm text-[var(--muted-foreground)]">
            “Get 3 quotes and order the cheapest.”
          </p>
        </div>
        <Chip>Example</Chip>
      </div>
      <ol className="divide-y divide-[var(--border)]">
        {steps.map((step) => (
          <li key={step.done} className="flex items-center gap-4 px-6 py-4">
            <ResourceArt kind={step.kind} size={32} />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{step.done}</p>
              <p className="truncate text-xs text-[var(--muted-foreground)]">{step.detail}</p>
            </div>
            <Check className="h-4 w-4 shrink-0 text-[var(--aid-success)]" aria-hidden="true" />
          </li>
        ))}
      </ol>
      <p className="border-t border-[var(--border)] bg-[var(--muted)]/50 px-6 py-3 text-sm">
        <span className="font-medium">Done.</span>{" "}
        <span className="text-[var(--muted-foreground)]">You did one thing: tap Approve.</span>
      </p>
    </div>
  );
}
