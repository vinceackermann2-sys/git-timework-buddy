// The product itself, drawn for the public pages: the hero windows and the
// small pictures in tiles. Every screen is something Agent ID really does.
// People and companies in them are illustrative.
import { BadgeCheck, Check, Pause, X } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";
import { AppChip, AppIcon } from "@/components/agent-id/AppIcons";
import { ResourceArt, type ArtKind } from "@/components/agent-id/ResourceArt";
import { AgentAvatar } from "@/components/agent-id/ui";

type Mascot = "orbit" | "nova" | "cosmo";

// --- Small parts ----------------------------------------------------------------

function Card({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-[0_12px_30px_-18px_rgba(23,32,51,0.35)]",
        className,
      )}
    >
      {children}
    </div>
  );
}

function Mark({ ok }: { ok: boolean }) {
  return (
    <span
      className={cn(
        "grid h-6 w-6 shrink-0 place-items-center rounded-full",
        ok
          ? "bg-[var(--aid-success-bg)] text-[var(--aid-success)]"
          : "bg-[var(--aid-danger-bg)] text-[var(--aid-danger)]",
      )}
    >
      {ok ? (
        <Check className="h-3.5 w-3.5" aria-hidden="true" />
      ) : (
        <X className="h-3.5 w-3.5" aria-hidden="true" />
      )}
    </span>
  );
}

function Pill({
  children,
  tone = "plain",
}: {
  children: ReactNode;
  tone?: "plain" | "ink" | "ok" | "no";
}) {
  const tones = {
    plain: "bg-[var(--muted)] text-[var(--muted-foreground)]",
    ink: "bg-[var(--aid-ink)] text-[var(--background)]",
    ok: "bg-[var(--aid-success-bg)] text-[var(--aid-success)]",
    no: "bg-[var(--aid-danger-bg)] text-[var(--aid-danger)]",
  };
  return (
    <span
      className={cn(
        "whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium",
        tones[tone],
      )}
    >
      {children}
    </span>
  );
}

function Verified({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 font-medium">
      <BadgeCheck className="h-3.5 w-3.5 text-[var(--aid-success)]" aria-hidden="true" />
      {children}
    </span>
  );
}

// Dark code, as developers read it.
export function Code({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <div className="overflow-hidden rounded-2xl bg-[#1b1530] text-left shadow-[0_24px_60px_-24px_rgba(23,32,51,0.45)]">
      {title && (
        <p className="aid-mono border-b border-white/10 px-4 py-2 text-[11px] text-[#b7aed6]">
          {title}
        </p>
      )}
      <pre className="aid-mono overflow-x-auto p-4 text-[12.5px] leading-6 text-[#e9e3ff]">
        <code>{children}</code>
      </pre>
    </div>
  );
}
const K = ({ children }: { children: ReactNode }) => (
  <span className="text-[#c9a7ff]">{children}</span>
);
const S = ({ children }: { children: ReactNode }) => (
  <span className="text-[#ffb3d9]">{children}</span>
);
const C = ({ children }: { children: ReactNode }) => (
  <span className="text-[#8f86b0]">{children}</span>
);

// --- The home page's window: one agent's ID, and what all of them just did ------

type Event = { who: string; mascot: Mascot; what: ReactNode; meta: ReactNode; end: ReactNode };
const EVENTS: Event[] = [
  {
    who: "Research Assistant",
    mascot: "orbit",
    what: "Emailed ana@nordicprints.se",
    meta: <AppChip app="claude-code" label="Claude Code" model="claude-opus-5-5" />,
    end: <span className="text-[11px] text-[var(--muted-foreground)]">2 min</span>,
  },
  {
    who: "Sales Agent",
    mascot: "nova",
    what: (
      <>
        Wants to pay <strong className="font-semibold tabular-nums">$250</strong> to Nordic Parts
      </>
    ),
    meta: (
      <span className="text-[11px] text-[var(--muted-foreground)]">
        Above your limit, so it asks you
      </span>
    ),
    end: <Pill tone="ink">Approve</Pill>,
  },
  {
    who: "Poster Studio",
    mascot: "cosmo",
    what: "Made autumn-sale.png",
    meta: (
      <span className="text-[11px] text-[var(--muted-foreground)]">Image model · Imagen 4</span>
    ),
    end: <Pill>Traced</Pill>,
  },
  {
    who: "Research Assistant",
    mascot: "orbit",
    what: "Showed its passport to api.acme.com",
    meta: <span className="text-[11px] text-[var(--muted-foreground)]">Owner verified</span>,
    end: <Pill tone="ok">Let in</Pill>,
  },
  {
    who: "Site Builder",
    mascot: "cosmo",
    what: "Signed commit a41f9c2",
    meta: <AppChip app="codex" label="Codex" model="gpt-6" />,
    end: <Mark ok />,
  },
];

export function HomeShot() {
  const has: [ArtKind, string][] = [
    ["mail", "Email"],
    ["wallet", "$1,240"],
    ["vm", "Computer"],
    ["vault", "Vault"],
  ];
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] text-left md:grid-cols-[minmax(0,5fr)_minmax(0,8fr)]">
      <div className="border-b border-[var(--border)] p-5 md:border-b-0 md:border-r">
        <div className="overflow-hidden rounded-2xl border border-[var(--border)]">
          <div className="flex items-center justify-between bg-gradient-to-r from-[#A855F7] to-[#EC4899] px-4 py-2 text-white">
            <span className="text-[10px] font-semibold uppercase tracking-[0.2em]">Agent ID</span>
            <span className="text-[10px] opacity-90">Timewarp</span>
          </div>
          <div className="flex items-center gap-3 p-4">
            <span className="grid h-16 w-16 shrink-0 place-items-center rounded-2xl bg-[var(--muted)]">
              <AgentAvatar mascot="orbit" size="lg" className="h-14 w-14" />
            </span>
            <div className="min-w-0 text-sm">
              <p className="truncate font-semibold">Research Assistant</p>
              <p className="truncate text-xs text-[var(--muted-foreground)]">
                AI agent · Claude Opus 5.5
              </p>
              <p className="mt-1 text-xs">
                <Verified>Acme AB</Verified>
              </p>
            </div>
          </div>
          <div className="grid grid-cols-4 gap-1 border-t border-[var(--border)] px-3 py-3">
            {has.map(([kind, label]) => (
              <span key={kind} className="flex min-w-0 flex-col items-center gap-1">
                <ResourceArt kind={kind} size={22} />
                <span className="truncate text-[10px] text-[var(--muted-foreground)]">{label}</span>
              </span>
            ))}
          </div>
        </div>
        <div className="mt-4 flex items-center gap-2 text-xs text-[var(--muted-foreground)]">
          Works in
          {["claude-code", "codex", "cursor"].map((app) => (
            <AppIcon key={app} app={app} size="sm" tooltip={false} />
          ))}
        </div>
      </div>
      <div className="p-5">
        <p className="mb-3 text-xs font-medium text-[var(--muted-foreground)]">
          Your agents, just now
        </p>
        <ul className="grid gap-2">
          {EVENTS.map((event, index) => (
            <li
              key={index}
              className="flex items-center gap-3 rounded-xl border border-[var(--border)] px-3 py-2.5"
            >
              <AgentAvatar mascot={event.mascot} size="sm" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm">
                  <span className="font-medium">{event.who}</span>{" "}
                  <span className="text-[var(--muted-foreground)]">·</span> {event.what}
                </p>
                <div className="mt-0.5 truncate">{event.meta}</div>
              </div>
              <span className="shrink-0">{event.end}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

// --- Tile pictures --------------------------------------------------------------

export function CommitsMini() {
  return (
    <Card className="mx-auto max-w-sm divide-y divide-[var(--border)] text-left text-sm">
      {(
        [
          ["a41f9c2", "Research Assistant", true],
          ["7d02e11", "Ada L. (your key)", true],
          ["c9e3b70", "Unknown agent", false],
        ] as const
      ).map(([sha, who, ok]) => (
        <div key={sha} className="flex items-center gap-3 px-4 py-2.5">
          <Mark ok={ok} />
          <span className="aid-mono text-xs">{sha}</span>
          <span className="min-w-0 flex-1 truncate text-xs text-[var(--muted-foreground)]">
            {who}
          </span>
          <Pill tone={ok ? "ok" : "no"}>{ok ? "Passed" : "Blocked"}</Pill>
        </div>
      ))}
    </Card>
  );
}

export function TracedMini() {
  return (
    <Card className="mx-auto max-w-xs overflow-hidden text-left">
      <TracedPicture />
      <div className="flex items-center gap-2 p-3">
        <Pill tone="ink">Made by AI</Pill>
        <span className="min-w-0 truncate text-xs text-[var(--muted-foreground)]">
          Poster Studio · <Verified>Nordic Prints AB</Verified>
        </span>
      </div>
    </Card>
  );
}

// A poster of a lake at dusk, drawn here, with the mark's pattern hinted over it.
export function TracedPicture() {
  return (
    <svg
      viewBox="0 0 400 180"
      role="img"
      aria-label="A poster of a lake at dusk"
      className="block h-auto w-full"
    >
      <defs>
        <linearGradient id="aid-sky" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#2b1b54" />
          <stop offset="0.6" stopColor="#c0508a" />
          <stop offset="1" stopColor="#f6a96b" />
        </linearGradient>
        <pattern id="aid-mark" width="10" height="10" patternUnits="userSpaceOnUse">
          <rect width="5" height="5" fill="white" opacity="0.06" />
          <rect x="5" y="5" width="5" height="5" fill="white" opacity="0.06" />
        </pattern>
      </defs>
      <rect width="400" height="180" fill="url(#aid-sky)" />
      <circle cx="285" cy="108" r="24" fill="#ffd9a0" opacity="0.9" />
      <path
        d="M0 122 L70 84 L120 110 L180 72 L250 118 L320 88 L400 116 L400 180 L0 180 Z"
        fill="#1d1338"
      />
      <rect y="138" width="400" height="42" fill="#2a1c4d" />
      <rect width="400" height="180" fill="url(#aid-mark)" />
    </svg>
  );
}

export function WhoMini() {
  return (
    <Card className="mx-auto max-w-sm p-4 text-left text-xs">
      <div className="flex items-center gap-2.5">
        <AgentAvatar mascot="cosmo" size="sm" />
        <p className="min-w-0 flex-1 truncate text-sm font-medium">Sent 3,000 emails</p>
        <span className="flex items-center gap-1 rounded-full bg-[var(--aid-ink)] px-2.5 py-1 text-[11px] font-medium text-[var(--background)]">
          <Pause className="h-3 w-3" aria-hidden="true" /> Pause
        </span>
      </div>
      <dl className="mt-3 grid grid-cols-[6rem_minmax(0,1fr)] gap-x-2 gap-y-1.5">
        <dt className="text-[var(--muted-foreground)]">Answers for it</dt>
        <dd className="truncate">
          <Verified>Erik L., Acme AB</Verified>
        </dd>
        <dt className="text-[var(--muted-foreground)]">App and model</dt>
        <dd className="truncate font-medium">Codex · GPT-6</dd>
        <dt className="text-[var(--muted-foreground)]">Computer</dt>
        <dd className="truncate font-medium">build-server-2 · 203.0.113.7</dd>
      </dl>
    </Card>
  );
}

export function GateMini() {
  return (
    <div className="mx-auto grid max-w-sm grid-cols-[minmax(0,1fr)] gap-3">
      <Code>
        <K>app</K>.use(<K>agentIdMiddleware</K>({"{"} require: <S>"verified"</S> {"}"}));
      </Code>
      <Card className="divide-y divide-[var(--border)] text-left text-xs">
        <div className="flex items-center gap-2.5 px-4 py-2.5">
          <Mark ok />
          <span className="min-w-0 flex-1 truncate">Booking Agent · for a verified person</span>
          <Pill tone="ok">Let in</Pill>
        </div>
        <div className="flex items-center gap-2.5 px-4 py-2.5">
          <Mark ok={false} />
          <span className="min-w-0 flex-1 truncate">No passport</span>
          <Pill tone="no">Kept out</Pill>
        </div>
      </Card>
    </div>
  );
}

export function SwitchMini() {
  return (
    <div className="mx-auto grid max-w-sm grid-cols-[repeat(2,minmax(0,1fr))] gap-3">
      {(
        [
          ["claude-code", "Claude Code", "claude-opus-5-5"],
          ["codex", "Codex", "gpt-6"],
        ] as const
      ).map(([app, label, model]) => (
        <Card key={app} className="p-3 text-left">
          <AppChip app={app} label={label} model={model} />
          <div className="mt-3 flex items-center gap-2">
            <AgentAvatar mascot="orbit" size="sm" />
            <span className="truncate text-xs font-medium">Research Assistant</span>
          </div>
          <div className="mt-2 flex gap-1">
            {(["mail", "wallet", "vm", "vault"] as ArtKind[]).map((kind) => (
              <ResourceArt key={kind} kind={kind} size={18} />
            ))}
          </div>
        </Card>
      ))}
    </div>
  );
}

// One line, in a box like a prompt.
export function Terminal({ command, note }: { command: string; note?: string }) {
  return (
    <Card className="mx-auto max-w-sm px-4 py-3 text-left">
      {note && <p className="text-[11px] text-[var(--muted-foreground)]">{note}</p>}
      <p className="aid-mono mt-1 truncate text-[13px]">
        <span className="text-[var(--muted-foreground)]">$ </span>
        {command}
      </p>
    </Card>
  );
}

export function KeyMini() {
  return (
    <div className="mx-auto grid max-w-sm grid-cols-[minmax(0,1fr)] gap-3">
      <Terminal command="timewarp-id git setup" note="On the agent's computer" />
      <Card className="flex items-center gap-3 px-4 py-3 text-left text-xs">
        <AgentAvatar mascot="orbit" size="sm" />
        <span className="min-w-0 flex-1 truncate">
          <span className="font-medium">Signs as</span>{" "}
          <span className="aid-mono">agt_7f3k…@agents.timewarpdev.com</span>
        </span>
      </Card>
    </div>
  );
}

export function RevokeMini({ what = "Key removed from your signers" }: { what?: string }) {
  return (
    <Card className="mx-auto flex max-w-sm items-center gap-3 px-4 py-3 text-left text-sm">
      <AgentAvatar mascot="nova" size="sm" />
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">Sales Agent</p>
        <p className="truncate text-xs text-[var(--muted-foreground)]">{what}</p>
      </div>
      <Pill tone="no">Revoked</Pill>
    </Card>
  );
}

export function OwnerMini() {
  return (
    <Card className="mx-auto max-w-sm p-4 text-left text-sm">
      <div className="flex items-center gap-3">
        <AgentAvatar mascot="cosmo" size="md" />
        <div className="min-w-0">
          <p className="truncate font-medium">Outreach Agent</p>
          <p className="truncate text-xs text-[var(--muted-foreground)]">AI agent · GPT-6</p>
        </div>
      </div>
      <div className="mt-3 rounded-xl bg-[var(--muted)] px-3 py-2 text-xs">
        <span className="text-[var(--muted-foreground)]">Answers for it: </span>
        <Verified>Erik L., verified person</Verified>
      </div>
    </Card>
  );
}

export function PolicyMini() {
  return (
    <Card className="mx-auto grid max-w-sm gap-2 p-4 text-left text-sm">
      {(
        [
          ["Any verified person", true],
          ["Verified businesses only", false],
          ["Only our own team's agents", false],
        ] as const
      ).map(([label, on]) => (
        <div key={label} className="flex items-center gap-3">
          <span
            className={cn(
              "grid h-4 w-4 place-items-center rounded-full border",
              on ? "border-[var(--aid-ink)]" : "border-[var(--input)]",
            )}
          >
            {on && <span className="h-2 w-2 rounded-full bg-[var(--aid-ink)]" />}
          </span>
          {label}
        </div>
      ))}
    </Card>
  );
}

export function VaultMini() {
  return (
    <Card className="mx-auto max-w-sm divide-y divide-[var(--border)] text-left text-xs">
      {["Resend API", "GitHub", "Stripe (test)"].map((label) => (
        <div key={label} className="flex items-center gap-3 px-4 py-2.5">
          <ResourceArt kind="vault" size={18} />
          <span className="min-w-0 flex-1 truncate font-medium">{label}</span>
          <span className="aid-mono text-[var(--muted-foreground)]">••••••••</span>
        </div>
      ))}
    </Card>
  );
}

export function ToolsMini() {
  const tools: [ArtKind, string][] = [
    ["mail", "Email"],
    ["phone", "Phone"],
    ["wallet", "Wallet"],
    ["vm", "Computer"],
  ];
  return (
    <div className="mx-auto grid max-w-sm grid-cols-[repeat(4,minmax(0,1fr))] gap-2 sm:gap-3">
      {tools.map(([kind, label]) => (
        <Card key={kind} className="flex flex-col items-center gap-2 px-2 py-3">
          <ResourceArt kind={kind} size={30} />
          <span className="text-[11px] font-medium">{label}</span>
        </Card>
      ))}
    </div>
  );
}

export function ReceiptMini() {
  return (
    <Card className="mx-auto max-w-sm p-4 text-left text-xs">
      <p className="font-medium">Signed receipt</p>
      <dl className="mt-2 grid grid-cols-[5rem_minmax(0,1fr)] gap-x-2 gap-y-1">
        <dt className="text-[var(--muted-foreground)]">Made by</dt>
        <dd className="truncate">Poster Studio</dd>
        <dt className="text-[var(--muted-foreground)]">When</dt>
        <dd>21 Oct 2026, 14:02</dd>
        <dt className="text-[var(--muted-foreground)]">Trace</dt>
        <dd className="aid-mono truncate">tr_9a41c07e52d3b816</dd>
      </dl>
    </Card>
  );
}

// --- Angle heroes: the product doing it, in a window ------------------------------

export function CommitShot() {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5 p-5 text-left md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] md:p-8">
      <Card className="divide-y divide-[var(--border)] text-sm">
        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <span className="font-semibold">Agent ID commit check</span>
          <Pill tone="no">1 of 3 failed</Pill>
        </div>
        {(
          [
            ["a41f9c2 · Cache the build", "Research Assistant · Acme AB's verified agent", true],
            ["7d02e11 · Fix the login copy", "Ada L. · a human key you listed", true],
            ["c9e3b70 · Update CI secrets", "Not signed by any of your agents", false],
          ] as const
        ).map(([title, line, ok]) => (
          <div key={title} className="flex items-center gap-3 px-4 py-3">
            <Mark ok={ok} />
            <div className="min-w-0 flex-1">
              <p className="aid-mono truncate text-[13px]">{title}</p>
              <p className="truncate text-xs text-[var(--muted-foreground)]">{line}</p>
            </div>
            <Pill tone={ok ? "ok" : "no"}>{ok ? "Passed" : "Blocked"}</Pill>
          </div>
        ))}
      </Card>
      <Code title=".github/workflows/agents.yml">
        <K>- uses</K>: …/agent-id/action@main{"\n"}
        {"  "}
        <K>with</K>:{"\n"}
        {"    "}
        <K>organization</K>: <S>{"<your org id>"}</S>
      </Code>
    </div>
  );
}

export function RogueShot() {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5 p-5 text-left md:grid-cols-2 md:p-8">
      <WhoMini />
      <Card className="divide-y divide-[var(--border)] text-sm">
        {(
          [
            ["Ask before sending email", true],
            ["Ask before paying above $100", true],
            ["Ask before texting or calling", true],
          ] as const
        ).map(([label]) => (
          <div key={label} className="flex items-center justify-between px-4 py-3">
            <span className="text-[var(--muted-foreground)]">{label}</span>
            <span
              aria-label="On"
              className="relative h-5 w-9 rounded-full bg-[var(--aid-ink)] after:absolute after:right-0.5 after:top-0.5 after:h-4 after:w-4 after:rounded-full after:bg-[var(--background)]"
            />
          </div>
        ))}
      </Card>
    </div>
  );
}

export function GateShot() {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5 p-5 text-left md:grid-cols-2 md:p-8">
      <Code title="server.js">
        <K>app</K>.use(<S>"/mcp"</S>, <K>agentIdMiddleware</K>({"{"}
        {"\n"}
        {"  "}audience: <S>"https://mcp.acme.com"</S>,{"\n"}
        {"  "}require: <S>"verified"</S>,{"\n"}
        {"  "}online: <K>true</K>, <C>// revoked = out</C>
        {"\n"}
        {"}"}));
      </Code>
      <Card className="divide-y divide-[var(--border)] text-sm">
        {(
          [
            ["Booking Agent", "For a verified person · checked online", true],
            ["An agent with no ID", "No passport · 401", false],
            ["Scraper 7", "Owner not verified · 403", false],
          ] as const
        ).map(([title, line, ok]) => (
          <div key={title} className="flex items-center gap-3 px-4 py-3">
            <Mark ok={ok} />
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{title}</p>
              <p className="truncate text-xs text-[var(--muted-foreground)]">{line}</p>
            </div>
            <Pill tone={ok ? "ok" : "no"}>{ok ? "Let in" : "Kept out"}</Pill>
          </div>
        ))}
      </Card>
    </div>
  );
}

export function SwitchShot() {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5 p-5 text-left md:grid-cols-2 md:p-8">
      {(
        [
          ["claude-code", "Claude Code", "claude-opus-5-5"],
          ["codex", "Codex", "gpt-6"],
        ] as const
      ).map(([app, label, model]) => (
        <Card key={app} className="overflow-hidden">
          <div className="border-b border-[var(--border)] px-4 py-2.5">
            <AppChip app={app} label={label} model={model} />
          </div>
          <div className="grid gap-2.5 p-4 text-sm">
            <div className="flex items-center gap-2.5">
              <AgentAvatar mascot="orbit" size="sm" />
              <span className="font-medium">Research Assistant</span>
            </div>
            {(
              [
                ["mail", "research@agents.timewarpdev.com"],
                ["wallet", "$1,240.00"],
                ["vm", "Its computer, running"],
                ["vault", "6 keys and sign-ins, sealed"],
              ] as [ArtKind, string][]
            ).map(([kind, value]) => (
              <div key={kind} className="flex min-w-0 items-center gap-2.5 text-xs">
                <ResourceArt kind={kind} size={20} />
                <span className="truncate">{value}</span>
              </div>
            ))}
          </div>
        </Card>
      ))}
    </div>
  );
}
