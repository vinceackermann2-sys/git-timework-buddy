// The product itself, drawn for the public pages: each need is shown with the
// screen, code or result that does it, never with feature cards. People and
// companies in them are illustrative.
import { BadgeCheck, Check, Pause, X } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";
import { AppChip, AppIcon } from "@/components/agent-id/AppIcons";
import { ResourceArt, type ArtKind } from "@/components/agent-id/ResourceArt";
import { AgentAvatar } from "@/components/agent-id/ui";

// An agent's ID, drawn like the identity card it is: who it is, what kind of
// AI, who answers for it, where it works and what it has.
export function IdCardArt() {
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
          <CardField term="Name">
            <span className="text-base font-semibold">Research Assistant</span>
          </CardField>
          <CardField term="Kind">AI agent · Claude Opus 5.5</CardField>
          <CardField term="Owner">
            <span className="flex items-center gap-1.5 font-medium">
              <BadgeCheck className="h-4 w-4 text-[var(--aid-success)]" aria-hidden="true" />
              Acme AB, verified
            </span>
          </CardField>
          <CardField term="Works in">
            <span className="flex items-center gap-1">
              {["claude-code", "codex", "cursor"].map((app) => (
                <AppIcon key={app} app={app} size="sm" tooltip={false} />
              ))}
            </span>
          </CardField>
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

function CardField({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[4.5rem_minmax(0,1fr)] items-center gap-2">
      <dt className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">{term}</dt>
      <dd className="min-w-0 truncate">{children}</dd>
    </div>
  );
}

// Dark code, as developers read it.
export function Code({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <div className="overflow-hidden rounded-2xl bg-[#1b1530] shadow-[0_24px_60px_-24px_rgba(23,32,51,0.45)]">
      {title && (
        <p className="aid-mono border-b border-white/10 px-5 py-2.5 text-xs text-[#b7aed6]">
          {title}
        </p>
      )}
      <pre className="aid-mono overflow-x-auto p-5 text-[13px] leading-6 text-[#e9e3ff]">
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

function Verdict({
  ok,
  title,
  line,
  result,
}: {
  ok: boolean;
  title: ReactNode;
  line: ReactNode;
  result: string;
}) {
  return (
    <div className="flex items-center gap-3 px-5 py-4">
      <span
        className={cn(
          "grid h-7 w-7 shrink-0 place-items-center rounded-full",
          ok
            ? "bg-[var(--aid-success-bg)] text-[var(--aid-success)]"
            : "bg-[var(--aid-danger-bg)] text-[var(--aid-danger)]",
        )}
      >
        {ok ? (
          <Check className="h-4 w-4" aria-hidden="true" />
        ) : (
          <X className="h-4 w-4" aria-hidden="true" />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{title}</p>
        <p className="truncate text-xs text-[var(--muted-foreground)]">{line}</p>
      </div>
      <span
        className={cn(
          "shrink-0 text-xs font-medium",
          ok ? "text-[var(--aid-success)]" : "text-[var(--aid-danger)]",
        )}
      >
        {result}
      </span>
    </div>
  );
}

// Code: the commit check on a pull request, and the one step that runs it.
export function CommitDemo() {
  return (
    <div className="grid gap-4">
      <div className="aid-card divide-y divide-[var(--border)] text-sm">
        <div className="flex items-center justify-between gap-3 px-5 py-3">
          <span className="font-semibold">Agent ID commit check</span>
          <span className="rounded-full bg-[var(--aid-danger-bg)] px-2.5 py-0.5 text-xs font-medium text-[var(--aid-danger)]">
            1 of 3 failed
          </span>
        </div>
        <Verdict
          ok
          title={<span className="aid-mono">a41f9c2 · Cache the build</span>}
          line="Research Assistant · Acme AB's verified agent"
          result="Passed"
        />
        <Verdict
          ok
          title={<span className="aid-mono">7d02e11 · Fix the login copy</span>}
          line="Ada L. · a human key you listed"
          result="Passed"
        />
        <Verdict
          ok={false}
          title={<span className="aid-mono">c9e3b70 · Update CI secrets</span>}
          line="Not signed by any of your agents"
          result="Blocked"
        />
      </div>
      <Code title=".github/workflows/agent-commits.yml">
        <K>- uses</K>: …/agent-id/action@main{"\n"}
        {"  "}
        <K>with</K>:{"\n"}
        {"    "}
        <K>organization</K>: <S>{"<your organization id>"}</S>
      </Code>
    </div>
  );
}

// AI or real: a picture someone sent, and what the check finds in it.
export function TraceDemo() {
  return (
    <div className="aid-card overflow-hidden">
      <TracedPicture />
      <div className="grid gap-3 p-5">
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-[var(--aid-ink)] px-2.5 py-0.5 text-xs font-semibold text-[var(--background)]">
            Made by AI
          </span>
          <span className="text-xs text-[var(--muted-foreground)]">Agent ID mark found</span>
        </div>
        <div className="flex items-center gap-3">
          <AgentAvatar mascot="nova" size="md" />
          <div className="min-w-0">
            <p className="font-medium">Poster Studio</p>
            <p className="text-xs text-[var(--muted-foreground)]">Image model · Google Imagen 4</p>
          </div>
        </div>
        <dl className="grid grid-cols-2 gap-3 border-t border-[var(--border)] pt-3 text-xs">
          <div>
            <dt className="text-[var(--muted-foreground)]">Answers for it</dt>
            <dd className="mt-0.5 flex items-center gap-1 font-medium">
              <BadgeCheck className="h-3.5 w-3.5 text-[var(--aid-success)]" aria-hidden="true" />
              Nordic Prints AB
            </dd>
          </div>
          <div>
            <dt className="text-[var(--muted-foreground)]">Made</dt>
            <dd className="mt-0.5 font-medium">21 Oct 2026, 14:02</dd>
          </div>
        </dl>
      </div>
    </div>
  );
}

// A picture drawn here (an AI poster of a lake at dusk), with the mark's
// pattern hinted over it.
function TracedPicture() {
  return (
    <svg
      viewBox="0 0 400 200"
      role="img"
      aria-label="A poster of a lake at dusk"
      className="block h-auto w-full"
    >
      <defs>
        <linearGradient id="sky" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#2b1b54" />
          <stop offset="0.6" stopColor="#c0508a" />
          <stop offset="1" stopColor="#f6a96b" />
        </linearGradient>
        <pattern id="mark" width="10" height="10" patternUnits="userSpaceOnUse">
          <rect width="5" height="5" fill="white" opacity="0.06" />
          <rect x="5" y="5" width="5" height="5" fill="white" opacity="0.06" />
        </pattern>
      </defs>
      <rect width="400" height="200" fill="url(#sky)" />
      <circle cx="285" cy="118" r="26" fill="#ffd9a0" opacity="0.9" />
      <path
        d="M0 132 L70 92 L120 120 L180 80 L250 128 L320 96 L400 126 L400 200 L0 200 Z"
        fill="#1d1338"
      />
      <rect y="150" width="400" height="50" fill="#2a1c4d" />
      <path
        d="M250 156 h70 M262 166 h46 M272 176 h26"
        stroke="#ffd9a0"
        strokeWidth="2"
        opacity="0.6"
      />
      <rect width="400" height="200" fill="url(#mark)" />
    </svg>
  );
}

// Rogue agents: one action, who answers for it and where it ran, and the
// switch that stops it.
export function ActivityDemo() {
  return (
    <div className="grid gap-4">
      <div className="aid-card p-5">
        <div className="flex items-start gap-3">
          <AgentAvatar mascot="cosmo" size="md" />
          <div className="min-w-0 flex-1">
            <p className="font-medium">Sent 3,000 emails</p>
            <p className="text-xs text-[var(--muted-foreground)]">Tonight, 02:14</p>
          </div>
          <span className="flex h-8 shrink-0 items-center gap-1.5 rounded-md bg-[var(--aid-ink)] px-3 text-xs font-medium text-[var(--background)]">
            <Pause className="h-3.5 w-3.5" aria-hidden="true" /> Pause agent
          </span>
        </div>
        <dl className="mt-4 grid gap-2.5 border-t border-[var(--border)] pt-4 text-sm">
          {(
            [
              ["Agent", "Outreach Agent · agt_9x2k…"],
              ["Answers for it", "Erik L., verified person · Acme AB"],
              ["App and model", "Codex · GPT-6"],
              ["Computer", "build-server-2"],
              ["Network", "203.0.113.7"],
            ] as const
          ).map(([term, value]) => (
            <div key={term} className="grid grid-cols-[7.5rem_minmax(0,1fr)] gap-2">
              <dt className="text-[var(--muted-foreground)]">{term}</dt>
              <dd className="min-w-0 truncate font-medium">{value}</dd>
            </div>
          ))}
        </dl>
      </div>
      <div className="aid-card divide-y divide-[var(--border)] text-sm">
        {[
          ["Ask before sending email", true],
          ["Most per payment", "$500"],
        ].map(([label, value]) => (
          <div key={String(label)} className="flex items-center justify-between px-5 py-3">
            <span className="text-[var(--muted-foreground)]">{label}</span>
            {value === true ? (
              <span
                aria-label="On"
                className="relative h-5 w-9 rounded-full bg-[var(--aid-ink)] after:absolute after:right-0.5 after:top-0.5 after:h-4 after:w-4 after:rounded-full after:bg-[var(--background)]"
              />
            ) : (
              <span className="font-medium tabular-nums">{value}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// APIs and MCP: one line in front of the server, and what it lets in.
export function VerifyDemo({ mcp = false }: { mcp?: boolean }) {
  return (
    <div className="grid gap-4">
      <Code title={mcp ? "server.js · your MCP server" : "server.js · your API"}>
        <K>app</K>.use(<S>{mcp ? '"/mcp"' : '"/api"'}</S>, <K>agentIdMiddleware</K>({"{"}
        {"\n"}
        {"  "}audience: <S>{mcp ? '"https://mcp.acme.com"' : '"https://api.acme.com"'}</S>,{"\n"}
        {"  "}require: <S>"verified"</S>, <C>// a verified person or business</C>
        {"\n"}
        {"  "}online: <K>true</K>, <C>// a revoked agent fails at once</C>
        {"\n"}
        {"}"}));
      </Code>
      <div className="aid-card divide-y divide-[var(--border)] text-sm">
        <Verdict
          ok
          title="Booking Agent"
          line="Acting for a verified person · passport checked online"
          result="Let in"
        />
        <Verdict
          ok={false}
          title="An agent with no ID"
          line="No passport · 401"
          result="Kept out"
        />
        <Verdict ok={false} title="Scraper 7" line="Owner not verified · 403" result="Kept out" />
      </div>
    </div>
  );
}

// One ID in two apps: the same agent answers in Claude Code and in Codex.
export function SwitchDemo() {
  const apps = [
    { app: "claude-code", label: "Claude Code", model: "claude-opus-5-5" },
    { app: "codex", label: "Codex", model: "gpt-6" },
  ];
  return (
    <div className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        {apps.map((item) => (
          <div key={item.app} className="aid-card overflow-hidden">
            <div className="border-b border-[var(--border)] px-4 py-2.5">
              <AppChip app={item.app} label={item.label} model={item.model} />
            </div>
            <dl className="grid gap-2 p-4 text-xs">
              {(
                [
                  ["mail", "research@agents.timewarpdev.com"],
                  ["wallet", "$1,240.00"],
                  ["vm", "Its computer, running"],
                  ["vault", "6 sign-ins, sealed"],
                ] as [ArtKind, string][]
              ).map(([kind, value]) => (
                <div key={kind} className="flex min-w-0 items-center gap-2">
                  <ResourceArt kind={kind} size={20} />
                  <span className="truncate font-medium">{value}</span>
                </div>
              ))}
            </dl>
          </div>
        ))}
      </div>
      <Code title="Once, on your computer">
        <C># Pick Claude Code and Codex: both get the same Agent ID.</C>
        {"\n"}npx @timewarp/agent-id attach
      </Code>
    </div>
  );
}
