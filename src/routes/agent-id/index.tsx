import { createFileRoute } from "@tanstack/react-router";

import { AppIcon } from "@/components/agent-id/AppIcons";
import { NeedList } from "@/components/agent-id/site/angles";
import { IdCardArt, TraceDemo } from "@/components/agent-id/site/demos";
import { Band, Offer, SitePage, StartRow } from "@/components/agent-id/site/Site";

export const Route = createFileRoute("/agent-id/")({
  head: () => ({
    meta: [{ title: "Timewarp Agent ID · Know which AI did it, and who answers for it" }],
  }),
  component: AgentIdHome,
});

// The front door (library layout "homepage", docs/agent-id-ladder.md): who
// it's for and the destination, the scenario, every need with its own page,
// how it works, and the offer. Every promise here works today.

const WORKS_WITH: [string, string][] = [
  ["claude-code", "Claude"],
  ["codex", "Codex"],
  ["cursor", "Cursor"],
  ["gemini", "Gemini"],
  ["grok", "Grok"],
  ["copilot", "Copilot"],
];

function AgentIdHome() {
  return (
    <SitePage>
      <section className="mx-auto grid w-full max-w-6xl grid-cols-[minmax(0,1fr)] items-center gap-14 px-4 pb-20 pt-10 sm:px-6 sm:pt-16 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div>
          <h1 className="text-5xl font-semibold leading-[1.04] tracking-tight sm:text-7xl">
            Know which AI did it, and who answers for it.
          </h1>
          <p className="mt-6 max-w-xl text-lg text-[var(--muted-foreground)]">
            Agent ID gives every AI agent and model{" "}
            <strong className="font-semibold text-[var(--foreground)]">
              its own ID, tied to a verified person or business
            </strong>
            . What it does, and what it makes, can be traced back.
          </p>
          <StartRow className="mt-8" />
        </div>
        <div className="relative isolate mx-auto w-full max-w-md lg:max-w-none">
          <div
            aria-hidden="true"
            className="absolute -inset-8 -z-10 rounded-[3rem] bg-[var(--aid-glow)] blur-3xl"
          />
          <IdCardArt />
        </div>
      </section>

      {/* The scenario every need shares. */}
      <section className="border-y border-[var(--border)] bg-[var(--card)]/60">
        <p className="mx-auto max-w-3xl px-4 py-16 text-center text-2xl font-medium leading-snug tracking-tight sm:px-6 sm:text-3xl">
          A commit nobody wrote. A voice you can't place. 3,000 emails nobody sent.{" "}
          <span className="text-[var(--muted-foreground)]">
            AI now acts with your keys and makes work under no name of its own.
          </span>
        </p>
      </section>

      <Band label="What do you need?">
        <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">What do you need?</h2>
        <div className="mt-8">
          <NeedList />
        </div>
      </Band>

      <Band tinted label="How it works">
        <div className="grid grid-cols-[minmax(0,1fr)] items-center gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-16">
          <div>
            <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
              One ID. One passport. One mark.
            </h2>
            <ol className="mt-8 grid gap-6">
              {[
                [
                  "An ID for every agent and model.",
                  "Tied to a verified person or business, with its own email, wallet, phone and computer. Agents, and language, image, voice, video, code and decision models.",
                ],
                [
                  "A passport for every request.",
                  "APIs, MCP servers and repositories check it in one line, and see who stands behind the agent.",
                ],
                [
                  "A mark on everything it makes.",
                  "Pictures, voices and text carry a hidden mark that leads back to the agent. Anyone can check it.",
                ],
              ].map(([title, line], index) => (
                <li key={title} className="flex gap-4">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[var(--aid-ink)] text-sm font-semibold text-[var(--background)]">
                    {index + 1}
                  </span>
                  <p className="pt-1">
                    <span className="font-semibold">{title}</span>{" "}
                    <span className="text-[var(--muted-foreground)]">{line}</span>
                  </p>
                </li>
              ))}
            </ol>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <span className="text-xs font-medium text-[var(--muted-foreground)]">Works with</span>
              {WORKS_WITH.map(([app, name]) => (
                <AppIcon key={app} app={app} label={name} size="md" />
              ))}
            </div>
          </div>
          <div className="mx-auto w-full max-w-md">
            <TraceDemo />
          </div>
        </div>
      </Band>

      <Band label="Start">
        <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-center">
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
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-[var(--border)] text-sm font-semibold">
                    {index + 1}
                  </span>
                  <p className="pt-1">
                    <span className="font-medium">{title}</span>{" "}
                    <span className="text-[var(--muted-foreground)]">{line}</span>
                  </p>
                </li>
              ))}
            </ol>
          </div>
          <Offer />
        </div>
      </Band>
    </SitePage>
  );
}
