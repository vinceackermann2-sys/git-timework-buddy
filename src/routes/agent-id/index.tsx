import { createFileRoute } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { ReasonLink, type AngleSlug } from "@/components/agent-id/site/angles";
import {
  CommitsViz,
  GateViz,
  HeroDemo,
  RogueViz,
  SwitchShot,
  TracedViz,
  Versus,
} from "@/components/agent-id/site/demos";
import { Closing, Hero, SitePage } from "@/components/agent-id/site/Site";

export const Route = createFileRoute("/agent-id/")({
  head: () => ({
    meta: [{ title: "Timewarp Agent ID · Trust your AI agents with real work" }],
  }),
  component: AgentIdHome,
});

// The front door, built like timewarpdev.com (Deus's homepage layout and
// Copywriting Formula; plan in docs/agent-id-ladder.md): the promise with
// Cosmo doing a real task under its own ID, others against Agent ID, every
// reason as a card to its own page, one ID across apps, and the start.

function ReasonCard({
  angle,
  title,
  line,
  viz,
}: {
  angle: AngleSlug | "check";
  title: string;
  line: string;
  viz: ReactNode;
}) {
  return (
    <ReasonLink angle={angle} className="q-card">
      <div className="q-viz">{viz}</div>
      <h3>{title}</h3>
      <p>{line}</p>
      <span className="more">See how →</span>
    </ReasonLink>
  );
}

function AgentIdHome() {
  return (
    <SitePage>
      <Hero
        title="Trust your AI agents with real work."
        lede={
          <>
            Give every agent <b>its own ID, tied to you</b>. Everything it does, and everything it
            makes, traces back to it.
          </>
        }
      >
        <HeroDemo />
      </Hero>

      <section className="section wrap" id="why" aria-label="Others compared with Agent ID">
        <Versus />
      </section>

      <section className="section wrap" aria-labelledby="reasons-title">
        <h2 id="reasons-title">
          One ID for every agent.
          <br />
          Every move accounted for.
        </h2>
        <div className="quad">
          <ReasonCard
            angle="code"
            title="Only your agents touch your code"
            line="Every commit is signed. Ones from agents you don't know are blocked."
            viz={<CommitsViz />}
          />
          <ReasonCard
            angle="check"
            title="Tell AI from real"
            line="Pictures, voices and text carry a hidden mark. Anyone can check it."
            viz={<TracedViz />}
          />
          <ReasonCard
            angle="accountability"
            title="Know whose agent it was"
            line="Every action shows the person, the app and the computer."
            viz={<RogueViz />}
          />
          <ReasonCard
            angle="apis"
            title="Let only verified agents in"
            line="One line keeps unknown agents off your API and MCP server."
            viz={<GateViz />}
          />
        </div>
      </section>

      <section className="section wrap" aria-labelledby="switch-title">
        <h2 id="switch-title">Switch apps. Keep your agent.</h2>
        <div className="team-card">
          <div className="team-copy">
            <h3>One agent ID in Claude Code and Codex</h3>
            <p>
              Its email, wallet, computer and keys come along. Your agent picks up where it left
              off.
            </p>
            <ReasonLink angle="claude-and-codex" className="more">
              See how →
            </ReasonLink>
          </div>
          <div className="team-shot">
            <SwitchShot />
          </div>
        </div>
      </section>

      <Closing
        title="Give your agents their ID."
        lede="An ID, email, wallet and 5 hours of computer time, free. Pause or revoke any agent in one click."
      />
    </SitePage>
  );
}
