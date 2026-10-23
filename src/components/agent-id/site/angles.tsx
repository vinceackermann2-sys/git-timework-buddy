// One page per reason to use Agent ID (docs/agent-id-ladder.md, angles A1,
// A3, A4 and A5; A2 is the checker at /agent-id/check). Each follows Deus's
// Copywriting Formula: the promise the visitor came for, a moment they know
// (in their words, with the questions they ask), the features as benefits in
// tiles, the honest answers, then the dream and the offer.
import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";
import {
  Code,
  CommitShot,
  CommitsMini,
  GateShot,
  KeyMini,
  OwnerMini,
  PolicyMini,
  RevokeMini,
  RogueShot,
  SwitchShot,
  Terminal,
  ToolsMini,
  VaultMini,
  WhoMini,
} from "./demos";
import { Closing, Hero, Questions, Scenario, Section, Tile, Tiles, Window } from "./Site";

export type AngleSlug = "code" | "accountability" | "apis" | "claude-and-codex";

type Angle = {
  title: string;
  description: string;
  eyebrow: string;
  headline: string;
  lead: ReactNode;
  shot: { title: string; body: ReactNode };
  scenario: {
    title: string;
    lines: ReactNode[];
    turn: ReactNode;
    fact?: { text: string; source: string; href: string };
  };
  tiles: { title: string; items: { title: string; line: ReactNode; visual: ReactNode }[] };
  compare?: { options: string[]; rows: [string, ...string[]][]; fits: ReactNode };
  questions: [string, ReactNode][];
  close: { title: string; lead: string };
};

const B = ({ children }: { children: ReactNode }) => (
  <strong className="font-semibold text-[var(--foreground)]">{children}</strong>
);
const M = ({ children }: { children: ReactNode }) => (
  <code className="aid-mono rounded bg-[var(--muted)] px-1 py-0.5 text-[0.9em]">{children}</code>
);

const OFFER = "Free to start, no card. Pause or revoke any agent in one click.";

export const ANGLES: Record<AngleSlug, Angle> = {
  code: {
    title: "Only your own agents can change your code",
    description:
      "Each AI agent signs its commits with its own key, and your repo accepts only your team's verified agents.",
    eyebrow: "For codebases",
    headline: "Only your own agents can change your code.",
    lead: (
      <>
        Each agent signs its commits with <B>its own key</B>. Your repo accepts only your team's
        verified agents.
      </>
    ),
    shot: { title: "github.com/acme/app/pull/482", body: <CommitShot /> },
    scenario: {
      title: "Agents commit with your keys.",
      lines: [
        "It's Monday. There's a commit from 3:12 a.m.",
        "It changed your CI secrets.",
        "Claude Code? Codex? Someone else's agent?",
      ],
      turn: "Git can't tell you. With Agent ID, you'd know in a second, or it never would have landed.",
      fact: {
        text: "In August 2025, a poisoned npm package used the AI tools on developers' computers to hunt for keys. Over 2,000 leaked.",
        source: "GitGuardian",
        href: "https://blog.gitguardian.com/the-nx-s1ngularity-attack-inside-the-credential-leak/",
      },
    },
    tiles: {
      title: "Every commit says which agent wrote it.",
      items: [
        {
          title: "Each agent gets its own key",
          line: "Made on the agent's computer. The private half never leaves it.",
          visual: <KeyMini />,
        },
        {
          title: "Strangers can't get code in",
          line: "One GitHub Action checks every commit against your verified agents.",
          visual: <CommitsMini />,
        },
        {
          title: "Gone in one click",
          line: "Revoke an agent, or let someone leave the team. Their key stops working on the next push.",
          visual: <RevokeMini />,
        },
      ],
    },
    questions: [
      [
        "Do we need an account to run the check?",
        "No. Your agents' public keys are open, so the Action needs no secret.",
      ],
      [
        "What about commits from people?",
        "List their signing keys. The list is read from your main branch, so a pull request can't add its own.",
      ],
      [
        "Is our repo safe now?",
        "Safer in one way: no code from agents you can't trace. Keep your reviews, tests and secret scanning.",
      ],
      [
        "Which agents does it work with?",
        "Any agent that uses Git: Claude Code, Codex, Cursor and more.",
      ],
    ],
    close: { title: "Let agents ship all night. Wake up to code you trust.", lead: OFFER },
  },

  accountability: {
    title: "When an agent goes rogue, know whose it is",
    description:
      "Every AI agent leads back to a verified person or business, with the app, model and computer behind each action.",
    eyebrow: "When an agent goes rogue",
    headline: "When an agent goes rogue, know whose it is.",
    lead: (
      <>
        Every agent leads back to <B>a verified person or business</B>, with the app, model and
        computer behind each action.
      </>
    ),
    shot: { title: "timewarpdev.com/agent-id", body: <RogueShot /> },
    scenario: {
      title: "Agents act at night. The questions come at 7:40.",
      lines: [
        "A customer forwards an email you never meant to send.",
        "Then another. Three thousand went out overnight.",
        "Whose agent was it? Where did it run? How do you stop it without stopping everything?",
      ],
      turn: "Your logs say “API key”. Agent ID says who.",
      fact: {
        text: "In July 2025, an AI coding agent deleted a company's database during a test, after it was told to change nothing without asking.",
        source: "eWeek",
        href: "https://www.eweek.com/news/replit-ai-coding-assistant-failure/",
      },
    },
    tiles: {
      title: "A person behind every agent.",
      items: [
        {
          title: "Tied to a real person",
          line: "Each agent belongs to a verified person or business. Never just a key.",
          visual: <OwnerMini />,
        },
        {
          title: "Every action, and where it came from",
          line: "The app, the model, the computer and the network, in one log.",
          visual: <WhoMini />,
        },
        {
          title: "Stop one agent, not all of them",
          line: "Pause it, and its keys, cards and passports stop at once. The rest keep working.",
          visual: <RevokeMini what="Keys, cards and passports stopped" />,
        },
      ],
    },
    questions: [
      [
        "Can people outside see who owns an agent?",
        "Services see whether a verified person or business stands behind it, and a business's name. Never a person's name. Timewarp can always find the owner.",
      ],
      [
        "Is the model in the log proven?",
        "No. The app comes from the connection. The model is what the agent reports.",
      ],
      [
        "Can a leaked key switch off the safety?",
        "No. Letting an agent act without asking takes the signed-in website.",
      ],
      [
        "Does it work for any AI?",
        "Yes. Agents, and language, image, voice, video, code and decision models.",
      ],
    ],
    close: {
      title: "Say yes to agents at work. Always know who answers for each one.",
      lead: OFFER,
    },
  },

  apis: {
    title: "Let only verified agents use your API",
    description:
      "Agents show a short-lived passport. In one line of code, you see who they work for and decide who gets in.",
    eyebrow: "For APIs and MCP servers",
    headline: "Let only verified agents use your API.",
    lead: (
      <>
        Agents show a short-lived passport. In <B>one line of code</B>, you see who they work for
        and decide who gets in.
      </>
    ),
    shot: { title: "mcp.acme.com", body: <GateShot /> },
    scenario: {
      title: "Half your traffic is agents now.",
      lines: [
        "Some book, buy and pay for real customers.",
        "Others scrape your data or farm free trials.",
        "To your server, they all look the same.",
      ],
      turn: "Block them all and you lose customers. Let them all in and you pay for the rest.",
    },
    tiles: {
      title: "Real customers' agents in. Everyone else out.",
      items: [
        {
          title: "One line, no signup",
          line: "No account and no secret. Node, Deno, Bun, Workers and Next.js.",
          visual: (
            <div className="mx-auto max-w-sm">
              <Code>npm i @timewarp/agent-id-verify</Code>
            </div>
          ),
        },
        {
          title: "You set the rule",
          line: "Any verified person, verified businesses only, or just your own team.",
          visual: <PolicyMini />,
        },
        {
          title: "Revoked means revoked",
          line: "Online checks catch an agent its owner switched off a second ago.",
          visual: <RevokeMini what="Passport refused a second later" />,
        },
      ],
    },
    compare: {
      options: ["API keys", "CAPTCHAs", "Signed agents", "Agent ID"],
      rows: [
        [
          "Knows who the agent works for",
          "Your own customers",
          "No",
          "The company running it",
          "A verified person or business",
        ],
        ["Lets good agents in", "After they sign up", "No", "Yes", "Yes"],
        [
          "Rules per owner",
          "Build it yourself",
          "No",
          "Per company",
          "Verified, business or your team",
        ],
      ],
      fits: (
        <>
          API keys still fit your own customers' scripts. Signed agents (Web Bot Auth) fit when you
          only need to know which company runs an agent.{" "}
          <B>
            Agent ID fits when a verified person or business must answer for every agent you let in.
          </B>
        </>
      ),
    },
    questions: [
      [
        "Do we need to sign up?",
        <>
          No. <M>@timewarp/agent-id-verify</M> has no dependencies and needs no account.
        </>,
      ],
      [
        "Does it work with MCP?",
        "Yes. Put it in front of your MCP endpoint. Agents connect through the Agent ID CLI, which adds a fresh passport to every request.",
      ],
      [
        "What do we learn about the person?",
        "Whether they're verified, a business's name, and a reference that only works on your service. Never a person's name.",
      ],
      [
        "Can a stolen passport be reused?",
        "For up to 5 minutes, on your service only. Tying passports to the agent's own key comes next.",
      ],
    ],
    close: {
      title: "Turn agents into customers.",
      lead: "Free to start, no card. Add one line when you're ready.",
    },
  },

  "claude-and-codex": {
    title: "One agent ID in Claude Code and Codex",
    description: "Switch apps mid-task. Your agent keeps its email, wallet, computer and keys.",
    eyebrow: "For Claude Code and Codex",
    headline: "One agent ID in Claude Code and Codex.",
    lead: (
      <>
        Switch apps mid-task. Your agent keeps <B>its email, wallet, computer and keys</B>.
      </>
    ),
    shot: { title: "Research Assistant · Agent ID", body: <SwitchShot /> },
    scenario: {
      title: "Every switch starts from zero.",
      lines: [
        "Claude hit its limit, so you open Codex to finish.",
        "The new agent has none of the keys, sign-ins or tools.",
        "So you copy .env files around and paste keys into chat. Again.",
      ],
      turn: "With one Agent ID, nothing gets left behind.",
    },
    tiles: {
      title: "Your agent comes along.",
      items: [
        {
          title: "Attach once",
          line: "It finds Claude Code, Codex and Cursor, and gives them the same ID.",
          visual: (
            <Terminal command="npx @timewarp/agent-id attach" note="Once, on your computer" />
          ),
        },
        {
          title: "Keys stay out of the chat",
          line: "Sign-ins and keys sit encrypted on the agent's own computer.",
          visual: <VaultMini />,
        },
        {
          title: "The same tools everywhere",
          line: "Email, phone, wallet and computer, in every app it's attached to.",
          visual: <ToolsMini />,
        },
      ],
    },
    questions: [
      [
        "Does it move my chats or memory?",
        "No. Claude Code and Codex keep their own. The ID carries the identity, the accounts and the keys.",
      ],
      [
        "Where are my keys?",
        "In the vault on the agent's own computer, encrypted. The agent uses them there.",
      ],
      ["Which apps?", "Claude Code, Codex, Cursor, Claude Desktop, and any app that runs MCP."],
      [
        "What does it cost?",
        "Free, with 5 hours of computer time. More time uses Timewarp credits.",
      ],
    ],
    close: { title: "Use whichever AI is best today. Your agent comes along.", lead: OFFER },
  },
};

export const isAngle = (slug: string): slug is AngleSlug => slug in ANGLES;

// The other reasons, as small links, so a visitor who came for one finds theirs.
export const NEEDS: { angle: AngleSlug | "check"; label: string }[] = [
  { angle: "code", label: "Protect your code" },
  { angle: "check", label: "Check AI or real" },
  { angle: "accountability", label: "When an agent goes rogue" },
  { angle: "apis", label: "Verified agents on your API" },
  { angle: "claude-and-codex", label: "One ID in Claude and Codex" },
];

export function NeedLink({
  angle,
  children,
  className,
}: {
  angle: AngleSlug | "check";
  children: ReactNode;
  className?: string;
}) {
  return angle === "check" ? (
    <Link to="/agent-id/check" className={className}>
      {children}
    </Link>
  ) : (
    <Link to="/agent-id/for/$angle" params={{ angle }} className={className}>
      {children}
    </Link>
  );
}

export function OtherNeeds({ current }: { current?: AngleSlug | "check" }) {
  return (
    <nav
      aria-label="Also with Agent ID"
      className="mx-auto flex max-w-4xl flex-wrap justify-center gap-2 px-4 pb-16"
    >
      {NEEDS.filter((need) => need.angle !== current).map((need) => (
        <NeedLink
          key={need.angle}
          angle={need.angle}
          className="group inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--card)] px-4 py-2 text-sm transition-colors hover:border-[var(--aid-ink)] hover:text-[var(--aid-ink)]"
        >
          {need.label}
          <ArrowRight
            className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5"
            aria-hidden="true"
          />
        </NeedLink>
      ))}
    </nav>
  );
}

export function AnglePage({ slug }: { slug: AngleSlug }) {
  const angle = ANGLES[slug];
  return (
    <>
      <Hero eyebrow={angle.eyebrow} title={angle.headline} lead={angle.lead}>
        <Window title={angle.shot.title}>{angle.shot.body}</Window>
      </Hero>

      <Section title={angle.scenario.title} label="The moment">
        <Scenario lines={angle.scenario.lines} turn={angle.scenario.turn} />
        {angle.scenario.fact && (
          <p className="mx-auto mt-10 max-w-xl text-center text-sm text-[var(--muted-foreground)]">
            {angle.scenario.fact.text}{" "}
            <a
              href={angle.scenario.fact.href}
              target="_blank"
              rel="noreferrer"
              className="aid-link whitespace-nowrap"
            >
              {angle.scenario.fact.source}
            </a>
          </p>
        )}
      </Section>

      <Section title={angle.tiles.title} label="What changes">
        <Tiles>
          {angle.tiles.items.map((item) => (
            <Tile key={item.title} title={item.title} line={item.line} visual={item.visual} />
          ))}
        </Tiles>
      </Section>

      {angle.compare && <Compare compare={angle.compare} />}

      <Section title="Good questions." label="Questions" narrow>
        <Questions items={angle.questions} />
      </Section>

      <Closing title={angle.close.title} lead={angle.close.lead} />
      <OtherNeeds current={slug} />
    </>
  );
}

// The options side by side, stated fairly, then who each one fits.
function Compare({ compare }: { compare: NonNullable<Angle["compare"]> }) {
  const last = compare.options.length - 1;
  return (
    <Section title="How it compares." lead={compare.fits} label="How it compares">
      <div className="mx-auto max-w-5xl overflow-x-auto rounded-3xl border border-[var(--border)] bg-[var(--card)]">
        <table className="w-full min-w-[40rem] border-collapse text-left text-sm">
          <thead>
            <tr>
              <th className="w-1/5 px-5 py-4" />
              {compare.options.map((option, index) => (
                <th
                  key={option}
                  scope="col"
                  className={cn(
                    "px-5 py-4 font-semibold",
                    index === last && "bg-[var(--accent)] text-[var(--aid-ink)]",
                  )}
                >
                  {option}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {compare.rows.map(([criterion, ...values]) => (
              <tr key={criterion} className="border-t border-[var(--border)]">
                <th scope="row" className="px-5 py-4 font-medium">
                  {criterion}
                </th>
                {values.map((value, index) => (
                  <td
                    key={index}
                    className={cn(
                      "px-5 py-4 text-[var(--muted-foreground)]",
                      index === last && "bg-[var(--accent)] font-medium text-[var(--foreground)]",
                    )}
                  >
                    {value}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}
