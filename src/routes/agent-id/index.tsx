import { Link, createFileRoute } from "@tanstack/react-router";
import { ArrowRight, BadgeCheck, Check, X } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { AppChip, AppIcon } from "@/components/agent-id/AppIcons";
import { Brand, ThemeMenu } from "@/components/agent-id/Brand";
import { ResourceArt, type ArtKind } from "@/components/agent-id/ResourceArt";
import { AgentAvatar } from "@/components/agent-id/ui";
import { useSession } from "@/lib/agent-id/session";

export const Route = createFileRoute("/agent-id/")({
  head: () => ({ meta: [{ title: "Timewarp Agent ID · Identity for AI agents" }] }),
  component: AgentIdLanding,
});

// The front door. Agent ID is one product seen from three needs (the
// problem → solution map): the owner who wants agents to act safely, the
// service that should let in only agents it can trace, and the person whose
// agents are spread over many apps. Each need gets its own part, shown with
// the product itself. Every promise here works today.

const WORKS_WITH: [string, string][] = [
  ["claude-code", "Claude"],
  ["codex", "Codex"],
  ["cursor", "Cursor"],
  ["gemini", "Gemini"],
  ["grok", "Grok"],
  ["copilot", "Copilot"],
];

const ANGLES = [
  { id: "safety", label: "Safety" },
  { id: "verified", label: "Verified only" },
  { id: "one-place", label: "One place" },
] as const;

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
        <section className="mx-auto grid w-full max-w-6xl grid-cols-[minmax(0,1fr)] items-center gap-14 px-4 pb-20 pt-10 sm:px-6 sm:pt-16 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div>
            <h1 className="text-5xl font-semibold leading-[1.04] tracking-tight sm:text-7xl">
              Identity for AI agents.
            </h1>
            <p className="mt-6 max-w-xl text-lg text-[var(--muted-foreground)]">
              Every agent gets{" "}
              <strong className="font-semibold text-[var(--foreground)]">its own ID</strong>, with
              its own email, wallet and computer, tied to you. You set what it may do, services can
              check who stands behind it, and all your agents are in one place.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-x-5 gap-y-3">
              <Start signedIn={signedIn} />
              {!signedIn && (
                <span className="text-sm text-[var(--muted-foreground)]">
                  No card. Just your email.
                </span>
              )}
            </div>
            <nav aria-label="Agent ID for" className="mt-10 flex flex-wrap gap-2">
              {ANGLES.map((angle) => (
                <a
                  key={angle.id}
                  href={`#${angle.id}`}
                  className="rounded-full border border-[var(--border)] bg-[var(--card)] px-3.5 py-1.5 text-sm font-medium transition-colors hover:border-[var(--aid-ink)] hover:text-[var(--aid-ink)]"
                >
                  {angle.label}
                </a>
              ))}
            </nav>
          </div>
          <div className="relative isolate mx-auto w-full max-w-md lg:max-w-none">
            <div
              aria-hidden="true"
              className="absolute -inset-8 -z-10 rounded-[3rem] bg-[var(--aid-glow)] blur-3xl"
            />
            <IdCard />
          </div>
        </section>

        {/* The problem all three needs share. */}
        <section className="border-y border-[var(--border)] bg-[var(--card)]/60">
          <p className="mx-auto max-w-3xl px-4 py-16 text-center text-2xl font-medium leading-snug tracking-tight sm:px-6 sm:text-3xl">
            AI agents now send email, move money and push code.{" "}
            <span className="text-[var(--muted-foreground)]">
              Most do it with your accounts and your keys, under no name of their own: nothing to
              limit, check or trace.
            </span>
          </p>
        </section>

        <Angle
          id="safety"
          eyebrow="Safety"
          title="Let your agents act. Keep the last word."
          lead="Each agent works within the limits you set. Anything more waits for you."
          points={[
            "Spending limits per payment and per day.",
            "Above your limit, it asks. You approve from your phone.",
            "You choose what else waits for you: email, texts, calls.",
            "Pause or revoke it in one click. Its key stops working at once.",
          ]}
          visual={<ApprovalDemo />}
        />

        <Angle
          id="verified"
          eyebrow="Verified only"
          title="Let in only agents you can trace."
          lead="For APIs, stores and code. An agent shows a short-lived passport, and one check tells you which verified person or business it belongs to."
          points={[
            "Checked online: a revoked agent fails at once.",
            "Require a verified person, a business, or only your own team.",
            "Accept Git commits only from your organization's verified agents.",
          ]}
          visual={<VerifyDemo />}
          flip
          tinted
        />

        <Angle
          id="one-place"
          eyebrow="One place"
          title="Every agent's ID, in one place."
          lead="In Claude Code, Codex, Cursor or your own app: each agent keeps one ID, with its own email, wallet, computer and keys."
          points={[
            "See which app, and which model, each action came from.",
            "One agent in several apps keeps the same email and money.",
            "One activity log for everything your agents do.",
          ]}
          visual={<AgentsDemo />}
        />

        {/* How to start, and what it costs. */}
        <section className="border-t border-[var(--border)] bg-[var(--card)]/60">
          <div className="mx-auto grid w-full max-w-6xl gap-12 px-4 py-20 sm:px-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-center">
            <div>
              <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
                Ready in a few minutes.
              </h2>
              <ol className="mt-8 grid gap-5">
                {[
                  ["Sign up with your email.", "A code, and you're in."],
                  [
                    "Give each agent its ID.",
                    "Paste one line on your computer, or open the link your agent shows you.",
                  ],
                  ["Verify once.", "Only when money first leaves a wallet."],
                ].map(([title, line], index) => (
                  <li key={title} className="flex gap-4">
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[var(--aid-ink)] text-sm font-semibold text-[var(--background)]">
                      {index + 1}
                    </span>
                    <p className="pt-1">
                      <span className="font-medium">{title}</span>{" "}
                      <span className="text-[var(--muted-foreground)]">{line}</span>
                    </p>
                  </li>
                ))}
              </ol>
              <div className="mt-8 flex flex-wrap items-center gap-3">
                <span className="text-xs font-medium text-[var(--muted-foreground)]">
                  Works with
                </span>
                {WORKS_WITH.map(([app, name]) => (
                  <AppIcon key={app} app={app} label={name} size="md" />
                ))}
              </div>
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

// The one action on the page, in the brand's strongest color; the small one in
// the header hides on phones, where the big one is right below it.
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

// One need: what it is, in a few lines, beside the product doing it.
function Angle({
  id,
  eyebrow,
  title,
  lead,
  points,
  visual,
  flip = false,
  tinted = false,
}: {
  id: string;
  eyebrow: string;
  title: string;
  lead: string;
  points: string[];
  visual: ReactNode;
  flip?: boolean;
  tinted?: boolean;
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      className={cn("scroll-mt-6", tinted && "border-y border-[var(--border)] bg-[var(--card)]/60")}
    >
      <div className="mx-auto grid w-full max-w-6xl grid-cols-[minmax(0,1fr)] items-center gap-12 px-4 py-20 sm:px-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-16">
        <div className={cn(flip && "lg:order-2")}>
          <p className="text-sm font-semibold uppercase tracking-wider text-[var(--aid-ink)]">
            {eyebrow}
          </p>
          <h2 id={`${id}-title`} className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
            {title}
          </h2>
          <p className="mt-4 text-lg text-[var(--muted-foreground)]">{lead}</p>
          <ul className="mt-6 grid gap-3">
            {points.map((point) => (
              <li key={point} className="flex gap-3">
                <Check
                  className="mt-0.5 h-5 w-5 shrink-0 text-[var(--aid-success)]"
                  aria-hidden="true"
                />
                {point}
              </li>
            ))}
          </ul>
        </div>
        <div className={cn("min-w-0", flip && "lg:order-1")}>{visual}</div>
      </div>
    </section>
  );
}

// An agent's ID, drawn like the identity card it is: who it is, who stands
// behind it, where it works and what it has.
function IdCard() {
  const has: [ArtKind, string][] = [
    ["mail", "research@agents.timewarpdev.com"],
    ["wallet", "$1,240.00"],
    ["vm", "Running"],
  ];
  return (
    <div className="aid-card overflow-hidden shadow-[0_30px_70px_-24px_rgba(23,32,51,0.35)] lg:rotate-[-1.5deg]">
      <div className="flex items-center justify-between bg-gradient-to-r from-[#A855F7] to-[#EC4899] px-6 py-3 text-white">
        <span className="text-xs font-semibold uppercase tracking-[0.2em]">Agent ID</span>
        <span className="text-xs font-medium opacity-90">Timewarp</span>
      </div>
      <div className="flex gap-5 px-6 py-6">
        <div className="grid h-24 w-24 shrink-0 place-items-center rounded-2xl bg-[var(--muted)]">
          <AgentAvatar mascot="orbit" size="lg" />
        </div>
        <dl className="grid min-w-0 flex-1 gap-2.5 text-sm">
          <Field term="Name">
            <span className="text-base font-semibold">Research Assistant</span>
          </Field>
          <Field term="ID">
            <span className="aid-mono">agt_7f3k9q2mx4…</span>
          </Field>
          <Field term="Owner">
            <span className="flex items-center gap-1.5 font-medium">
              <BadgeCheck className="h-4 w-4 text-[var(--aid-success)]" aria-hidden="true" />
              Verified person
            </span>
          </Field>
          <Field term="Works in">
            <span className="flex items-center gap-1">
              {["claude-code", "codex", "cursor"].map((app) => (
                <AppIcon key={app} app={app} size="sm" tooltip={false} />
              ))}
            </span>
          </Field>
        </dl>
      </div>
      <ul className="grid gap-2 border-t border-[var(--border)] px-6 py-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
        {has.map(([kind, value]) => (
          <li key={kind} className="flex min-w-0 items-center gap-2">
            <ResourceArt kind={kind} size={24} />
            <span className="truncate text-xs font-medium">{value}</span>
          </li>
        ))}
      </ul>
      <p
        aria-hidden="true"
        className="aid-mono overflow-hidden whitespace-nowrap border-t border-[var(--border)] bg-[var(--muted)]/60 px-6 py-3 text-[11px] leading-5 tracking-[0.18em] text-[var(--muted-foreground)]"
      >
        AGT&lt;RESEARCH&lt;ASSISTANT&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;
        <br />
        7F3K9Q2MX4&lt;VERIFIED&lt;ACTIVE&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;
      </p>
    </div>
  );
}

function Field({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[4.5rem_minmax(0,1fr)] items-center gap-2">
      <dt className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">{term}</dt>
      <dd className="min-w-0 truncate">{children}</dd>
    </div>
  );
}

// Safety: a payment above the limit, waiting for the owner, and what else they
// chose to approve first.
function ApprovalDemo() {
  return (
    <div className="grid gap-4">
      <div className="aid-card p-5">
        <div className="flex items-start gap-3">
          <AgentAvatar mascot="nova" size="md" />
          <div className="min-w-0 flex-1">
            <p className="text-sm text-[var(--muted-foreground)]">
              <span className="font-medium text-[var(--foreground)]">Sales Agent</span> wants to
              send
            </p>
            <p className="mt-0.5 text-[15px]">
              <span className="text-lg font-semibold tabular-nums">$250.00</span>
              <span className="text-[var(--muted-foreground)]"> to </span>
              <span className="font-medium">Nordic Parts</span>
            </p>
            <p className="text-xs text-[var(--muted-foreground)]">“Deposit for 500 units”</p>
          </div>
        </div>
        <div className="mt-4 flex gap-2">
          <span className="flex h-9 flex-1 items-center justify-center rounded-md border border-[var(--border)] text-sm font-medium">
            Decline
          </span>
          <span className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-md bg-[var(--aid-ink)] text-sm font-medium text-[var(--background)]">
            <Check className="h-4 w-4" aria-hidden="true" /> Approve
          </span>
        </div>
      </div>
      <div className="aid-card divide-y divide-[var(--border)] text-sm">
        {[
          ["Most per payment", "$500"],
          ["Ask me above", "$100"],
        ].map(([term, value]) => (
          <div key={term} className="flex items-center justify-between px-5 py-3">
            <span className="text-[var(--muted-foreground)]">{term}</span>
            <span className="font-medium tabular-nums">{value}</span>
          </div>
        ))}
        {["Ask before sending email", "Ask before texting or calling"].map((label) => (
          <div key={label} className="flex items-center justify-between px-5 py-3">
            <span className="text-[var(--muted-foreground)]">{label}</span>
            <span
              aria-label="On"
              className="relative h-5 w-9 rounded-full bg-[var(--aid-ink)] after:absolute after:right-0.5 after:top-0.5 after:h-4 after:w-4 after:rounded-full after:bg-[var(--background)]"
            />
          </div>
        ))}
      </div>
    </div>
  );
}

// Verified only: a service that accepts verified agents, and what one check
// returns for an agent it should let in and one it shouldn't.
function VerifyDemo() {
  return (
    <div className="grid gap-4">
      <pre className="aid-mono overflow-x-auto rounded-2xl bg-[#1b1530] p-5 text-[13px] leading-6 text-[#e9e3ff] shadow-[0_24px_60px_-24px_rgba(23,32,51,0.45)]">
        <code>
          <span className="text-[#c9a7ff]">app</span>.use(
          <span className="text-[#ffb3d9]">"/api"</span>,{" "}
          <span className="text-[#c9a7ff]">agentIdMiddleware</span>({"{"}
          {"\n"}
          {"  "}audience: <span className="text-[#ffb3d9]">"https://api.acme.com"</span>,{"\n"}
          {"  "}require: <span className="text-[#ffb3d9]">"verified"</span>,{"\n"}
          {"}"}));
        </code>
      </pre>
      <div className="aid-card divide-y divide-[var(--border)] text-sm">
        <div className="flex items-center gap-3 px-5 py-4">
          <span className="grid h-7 w-7 place-items-center rounded-full bg-[var(--aid-success-bg)] text-[var(--aid-success)]">
            <Check className="h-4 w-4" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-medium">Research Assistant</p>
            <p className="text-xs text-[var(--muted-foreground)]">
              Verified business · Acme AB · active
            </p>
          </div>
          <span className="text-xs font-medium text-[var(--aid-success)]">Let in</span>
        </div>
        <div className="flex items-center gap-3 px-5 py-4">
          <span className="grid h-7 w-7 place-items-center rounded-full bg-[var(--aid-danger-bg)] text-[var(--aid-danger)]">
            <X className="h-4 w-4" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-medium">An agent with no ID</p>
            <p className="text-xs text-[var(--muted-foreground)]">No passport · 401</p>
          </div>
          <span className="text-xs font-medium text-[var(--aid-danger)]">Kept out</span>
        </div>
      </div>
    </div>
  );
}

// One place: several agents, each with its app and model, and what it has.
function AgentsDemo() {
  const agents: {
    name: string;
    mascot: "orbit" | "nova" | "cosmo";
    app: string;
    label: string;
    model?: string;
    has: ArtKind[];
  }[] = [
    {
      name: "Research Assistant",
      mascot: "orbit",
      app: "claude-code",
      label: "Claude Code",
      model: "claude-opus-5-5",
      has: ["mail", "wallet", "vm"],
    },
    {
      name: "Sales Agent",
      mascot: "nova",
      app: "codex",
      label: "Codex",
      model: "gpt-6",
      has: ["mail", "wallet"],
    },
    {
      name: "Site Builder",
      mascot: "cosmo",
      app: "cursor",
      label: "Cursor",
      has: ["mail", "vm", "vault"],
    },
  ];
  return (
    <div className="aid-card overflow-hidden">
      <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-3">
        <span className="text-sm font-semibold">Your agents</span>
        <span className="text-xs text-[var(--muted-foreground)]">3 agents</span>
      </div>
      <ul className="divide-y divide-[var(--border)]">
        {agents.map((agent) => (
          <li key={agent.name} className="flex items-center gap-3 px-5 py-4">
            <AgentAvatar mascot={agent.mascot} size="md" />
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{agent.name}</p>
              <div className="mt-1">
                <AppChip app={agent.app} label={agent.label} model={agent.model} />
              </div>
            </div>
            <span className="hidden shrink-0 items-center gap-1 sm:flex">
              {agent.has.map((kind) => (
                <ResourceArt key={kind} kind={kind} size={22} />
              ))}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
