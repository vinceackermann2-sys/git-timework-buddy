import { Link, createFileRoute } from "@tanstack/react-router";
import { ArrowRight, BadgeCheck } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { AppIcon } from "@/components/agent-id/AppIcons";
import { Brand, ThemeMenu } from "@/components/agent-id/Brand";
import { AgentAvatar, KIND_ICONS } from "@/components/agent-id/ui";
import { useSession } from "@/lib/agent-id/session";

export const Route = createFileRoute("/agent-id/")({ component: AgentIdLanding });

// One icon per maker (Codex stands for OpenAI).
const WORKS_WITH = ["claude-code", "codex", "cursor", "gemini", "grok", "copilot"];

// Agent ID's home for everyone, signed in or not: what it is in one line, the
// way to get one, and an agent's ID as it looks.
function AgentIdLanding() {
  const session = useSession();
  const signedIn = session.status === "signed-in";

  return (
    <div className="flex min-h-svh flex-col">
      <header className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
        <Brand />
        <div className="flex items-center gap-1">
          {!signedIn && (
            <Button asChild variant="ghost" size="sm">
              <Link to="/agent-id/sign-in">Sign in</Link>
            </Button>
          )}
          <ThemeMenu />
        </div>
      </header>

      <main className="mx-auto grid w-full max-w-6xl flex-1 grid-cols-[minmax(0,1fr)] items-center gap-12 overflow-x-clip px-4 py-12 sm:px-6 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] lg:gap-16">
        <section>
          <h1 className="max-w-xl text-4xl font-semibold leading-[1.1] tracking-tight sm:text-6xl">
            An identity for every AI agent.
          </h1>
          <p className="mt-5 max-w-lg text-lg text-[var(--muted-foreground)]">
            Its own email, phone number, wallet and computer, in every app it works in, and always
            traceable to you.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-3">
            <Button asChild size="lg" className="h-12 rounded-full px-7 text-base">
              <Link to={signedIn ? "/agent-id/dashboard" : "/agent-id/claim"}>
                {signedIn ? "Open Agent ID" : "Get an Agent ID"}
                <ArrowRight aria-hidden="true" />
              </Link>
            </Button>
            {!signedIn && (
              <span className="text-sm text-[var(--muted-foreground)]">
                Free to start. No sign-up needed.
              </span>
            )}
          </div>
          <div className="mt-12 flex items-center gap-3">
            <span className="text-xs font-medium text-[var(--muted-foreground)]">Works with</span>
            <span className="flex items-center gap-1.5">
              {WORKS_WITH.map((app) => (
                <AppIcon key={app} app={app} size="md" />
              ))}
            </span>
          </div>
        </section>

        <section
          aria-label="An agent's ID"
          className="relative isolate mx-auto w-full max-w-md lg:max-w-none"
        >
          <div
            aria-hidden="true"
            className="absolute -inset-6 -z-10 rounded-[2.5rem] bg-[var(--aid-glow)] blur-3xl"
          />
          <SampleId />
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

// What an agent's ID looks like in Agent ID: who it is, where it works, what it has.
function SampleId() {
  const rows: { icon: LucideIcon; label: string; value: string }[] = [
    { icon: KIND_ICONS.mail, label: "Mail", value: "research@agents.timewarpdev.com" },
    { icon: KIND_ICONS.phone, label: "Phone", value: "+1 415 555 0142" },
    { icon: KIND_ICONS.wallet, label: "Wallet", value: "$1,240.00" },
    { icon: KIND_ICONS.vm, label: "Computer", value: "Running" },
  ];
  return (
    <div className="aid-card overflow-hidden shadow-[0_24px_60px_-20px_rgba(23,32,51,0.25)]">
      <div className="flex items-center gap-4 border-b border-[var(--border)] px-6 py-5">
        <AgentAvatar mascot="orbit" size="lg" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-lg font-semibold">Research Assistant</p>
          <p className="mt-0.5 flex items-center gap-1.5 text-sm text-[var(--muted-foreground)]">
            <BadgeCheck className="h-4 w-4 text-[var(--aid-success)]" aria-hidden="true" />
            Verified owner
          </p>
        </div>
        <span className="flex items-center gap-1">
          {["claude-code", "codex", "cursor"].map((app) => (
            <AppIcon key={app} app={app} size="sm" tooltip={false} />
          ))}
        </span>
      </div>
      <dl className="divide-y divide-[var(--border)]">
        {rows.map(({ icon: Icon, label, value }) => (
          <div key={label} className="flex items-center gap-4 px-6 py-4">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[var(--accent)] text-[var(--aid-ink)]">
              <Icon className="h-4 w-4" aria-hidden="true" />
            </span>
            <dt className="sr-only w-20 shrink-0 text-sm text-[var(--muted-foreground)] sm:not-sr-only">
              {label}
            </dt>
            <dd className="min-w-0 truncate text-sm font-medium">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
