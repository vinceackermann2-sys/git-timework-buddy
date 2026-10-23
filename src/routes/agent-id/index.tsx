import { createFileRoute } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import type { ReactNode } from "react";

import { NeedLink, type AngleSlug } from "@/components/agent-id/site/angles";
import {
  CommitsMini,
  GateMini,
  HomeShot,
  SwitchMini,
  Terminal,
  TracedMini,
  WhoMini,
} from "@/components/agent-id/site/demos";
import {
  Closing,
  Hero,
  Scenario,
  Section,
  SitePage,
  Tile,
  Tiles,
  Window,
  WorksIn,
} from "@/components/agent-id/site/Site";

export const Route = createFileRoute("/agent-id/")({
  head: () => ({
    meta: [{ title: "Timewarp Agent ID · Trust your AI agents with real work" }],
  }),
  component: AgentIdHome,
});

// The front door (Deus's homepage layout and Copywriting Formula; plan in
// docs/agent-id-ladder.md): who it's for and the destination, the moment
// everyone knows, every need as a tile to its own page, how to start, and
// the offer. Every promise here works today.

function More({ angle, children }: { angle: AngleSlug | "check"; children: ReactNode }) {
  return (
    <NeedLink
      angle={angle}
      className="group inline-flex items-center gap-1 font-medium text-[var(--aid-ink)]"
    >
      {children}
      <ArrowRight
        className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5"
        aria-hidden="true"
      />
    </NeedLink>
  );
}

function AgentIdHome() {
  return (
    <SitePage>
      <Hero
        title="Trust your AI agents with real work."
        lead={
          <>
            Give every agent{" "}
            <strong className="font-semibold text-[var(--foreground)]">
              its own ID, tied to you
            </strong>
            . Everything it does, and everything it makes, traces back to it.
          </>
        }
      >
        <Window title="timewarpdev.com/agent-id">
          <HomeShot />
        </Window>
      </Hero>

      <WorksIn />

      <Section title="Your agents already work for you." label="The moment">
        <Scenario
          lines={[
            "One answers the email. One pays the invoice.",
            "One pushes a fix at 3 a.m.",
            "Great, until one gets it wrong and nobody can say which one it was.",
          ]}
          turn="Agent ID gives each one a name, an owner and a trail."
        />
      </Section>

      <Section
        title="One ID keeps every agent accountable."
        lead="Pick what you need. It all comes with the same free ID."
        label="What it does"
      >
        <Tiles>
          <Tile
            span={3}
            title="Only your agents touch your code"
            line="Every commit is signed. Ones from agents you don't know are blocked."
            visual={<CommitsMini />}
            to={<More angle="code">For codebases</More>}
          />
          <Tile
            span={3}
            title="Tell AI from real"
            line="Pictures, voices and text carry a hidden mark. Anyone can check it."
            visual={<TracedMini />}
            to={<More angle="check">Check something</More>}
          />
          <Tile
            title="Know whose agent it was"
            line="Every action shows the person, the app and the computer."
            visual={<WhoMini />}
            to={<More angle="accountability">When an agent goes rogue</More>}
          />
          <Tile
            title="Let only verified agents in"
            line="One line keeps unknown agents off your API and MCP server."
            visual={<GateMini />}
            to={<More angle="apis">For APIs</More>}
          />
          <Tile
            title="One ID in Claude and Codex"
            line="Switch apps. Keep the email, wallet, computer and keys."
            visual={<SwitchMini />}
            to={<More angle="claude-and-codex">For Claude and Codex</More>}
          />
        </Tiles>
      </Section>

      <Section
        title="Ready in a minute."
        lead="Start with your email. Then paste one line, and every agent on your computer gets its ID."
        label="How to start"
        narrow
      >
        <Terminal
          command="npx @timewarp/agent-id attach"
          note="Finds Claude Code, Codex, Cursor and more"
        />
      </Section>

      <Closing
        title="Say yes to agents. Keep the last word."
        lead="Free to start: an ID, email, wallet and 5 hours of computer time. No card. Pause or revoke any agent in one click."
      />
    </SitePage>
  );
}
