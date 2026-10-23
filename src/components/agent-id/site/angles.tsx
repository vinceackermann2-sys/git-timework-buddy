// One page per reason to use Agent ID (docs/agent-id-ladder.md, angles A1,
// A3, A4 and A5; A2 is the checker at /agent-id/check), built like the main
// Timewarp website: the promise and the product working, the moment in the
// visitor's own words, three cards, answers, and the composer to start.
// The copy follows Deus's Copywriting Formula.
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { CommitDemo, CommitsViz, GateDemo, RogueDemo, RogueViz, SwitchDemo } from "./demos";
import { Closing, Faq, Hero, Icon, MASCOT, Moment, StartButtons } from "./Site";

export type AngleSlug = "code" | "accountability" | "apis" | "claude-and-codex";

type Card = { title: string; line: ReactNode; viz: ReactNode };
type Angle = {
  title: string;
  description: string;
  kicker: string;
  headline: string;
  lede: ReactNode;
  demo: ReactNode;
  moment: {
    title: string;
    lines: ReactNode[];
    turn: ReactNode;
    source?: { text: string; name: string; href: string };
  };
  cards: { title: ReactNode; items: [Card, Card, Card] };
  compare?: { options: string[]; rows: [string, ...string[]][]; note: ReactNode };
  questions: [string, ReactNode][];
  close: string;
};

// --- Small product pictures for the cards ----------------------------------------

function Terminal({ command, note }: { command: string; note: string }) {
  return (
    <div className="composer" style={{ maxWidth: 400 }}>
      <p className="r-text quiet" style={{ fontSize: 12.5 }}>
        {note}
      </p>
      <p className="mono" style={{ marginTop: 6, fontSize: 13.5, color: "#172033" }}>
        <span style={{ color: "#9aa1af" }}>$ </span>
        {command}
      </p>
    </div>
  );
}

function AgentRow({
  img,
  title,
  line,
  end,
}: {
  img: string;
  title: string;
  line: string;
  end?: ReactNode;
}) {
  return (
    <div className="card">
      <div className="row">
        <img src={img} alt="" />
        <div>
          <b>{title}</b>
          <small>{line}</small>
        </div>
        {end}
      </div>
    </div>
  );
}

function Facts({ items }: { items: [string, string][] }) {
  return (
    <div className="card pad">
      {items.map(([term, value]) => (
        <div key={term} className="pay-line small">
          {term} <b>{value}</b>
        </div>
      ))}
    </div>
  );
}

function Choices({ items }: { items: [string, boolean][] }) {
  return (
    <div className="card">
      {items.map(([label, on]) => (
        <div key={label} className="row">
          <span
            className={`mark ${on ? "ok" : ""}`}
            style={on ? undefined : { border: "1.6px solid #d5d9e1" }}
          >
            {on && <Icon name="check" />}
          </span>
          <div>
            <b style={{ fontWeight: on ? 600 : 500 }}>{label}</b>
          </div>
        </div>
      ))}
    </div>
  );
}

function Things({ items }: { items: [string, string][] }) {
  return (
    <div className="card">
      {items.map(([title, line]) => (
        <div key={title} className="row">
          <span
            className="ask-icon"
            style={{ width: 30, height: 30, borderRadius: 9, fontSize: 13 }}
          >
            {title.slice(0, 1)}
          </span>
          <div>
            <b>{title}</b>
            <small>{line}</small>
          </div>
        </div>
      ))}
    </div>
  );
}

const OFFER_CLOSE = "Free to start, no card. Pause or revoke any agent in one click.";

export const ANGLES: Record<AngleSlug, Angle> = {
  code: {
    title: "Only your own agents can change your code",
    description:
      "Each AI agent signs its commits with its own key, and your repo accepts only your team's verified agents.",
    kicker: "For codebases",
    headline: "Only your own agents can change your code.",
    lede: (
      <>
        Each agent signs its commits with <b>its own key</b>. Your repo accepts only your team's
        verified agents.
      </>
    ),
    demo: <CommitDemo />,
    moment: {
      title: "Agents commit with your keys.",
      lines: [
        "It's Monday. There's a commit from 3:12 a.m.",
        "It changed your CI secrets.",
        "Claude Code? Codex? Someone else's agent?",
      ],
      turn: "Git can't tell you. Agent ID can, before it ever lands.",
      source: {
        text: "In August 2025, a poisoned npm package used the AI tools on developers' computers to hunt for keys. Over 2,000 leaked.",
        name: "GitGuardian",
        href: "https://blog.gitguardian.com/the-nx-s1ngularity-attack-inside-the-credential-leak/",
      },
    },
    cards: {
      title: "Every commit says which agent wrote it.",
      items: [
        {
          title: "Each agent gets its own key",
          line: "Made on the agent's computer. The private half never leaves it.",
          viz: <Terminal command="timewarp-id git setup" note="On the agent's computer" />,
        },
        {
          title: "Strangers can't get code in",
          line: "One GitHub Action checks every commit against your verified agents.",
          viz: <CommitsViz />,
        },
        {
          title: "Gone in one click",
          line: "Revoke an agent, or let someone leave. Their key stops on the next push.",
          viz: (
            <AgentRow
              img={MASCOT.nova}
              title="Sales Agent"
              line="Key removed from your signers"
              end={<span className="chip no">Revoked</span>}
            />
          ),
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
        "List their signing keys. The list is read from main, so a pull request can't add its own.",
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
    close: "Let agents ship all night. Wake up to code you trust.",
  },

  accountability: {
    title: "When an agent goes rogue, know whose it is",
    description:
      "Every AI agent leads back to a verified person or business, with the app, model and computer behind each action.",
    kicker: "When an agent goes rogue",
    headline: "When an agent goes rogue, know whose it is.",
    lede: (
      <>
        Every agent leads back to <b>a verified person or business</b>, with the app, model and
        computer behind each action.
      </>
    ),
    demo: <RogueDemo />,
    moment: {
      title: "Agents act at night. Questions come at 7:40.",
      lines: [
        "A customer forwards an email you never meant to send.",
        "Then another. Three thousand went out overnight.",
        "Whose agent was it? Where did it run? How do you stop it without stopping everything?",
      ],
      turn: "Your logs say “API key”. Agent ID says who.",
      source: {
        text: "In July 2025, an AI coding agent deleted a company's database during a test, after it was told to change nothing without asking.",
        name: "eWeek",
        href: "https://www.eweek.com/news/replit-ai-coding-assistant-failure/",
      },
    },
    cards: {
      title: "A person behind every agent.",
      items: [
        {
          title: "Tied to a real person",
          line: "Each agent belongs to a verified person or business. Never just a key.",
          viz: (
            <AgentRow
              img={MASCOT.cosmo}
              title="Outreach Agent"
              line="Erik L., verified person · Acme AB"
              end={<span className="chip ok">Verified</span>}
            />
          ),
        },
        {
          title: "Every action, and where it came from",
          line: "The app, the model, the computer and the network, in one log.",
          viz: <RogueViz />,
        },
        {
          title: "Stop one agent, not all of them",
          line: "Pause it, and its keys, cards and passports stop at once.",
          viz: (
            <Facts
              items={[
                ["Keys", "Stopped"],
                ["Card", "Stopped"],
                ["Passports", "Stopped"],
                ["Other agents", "Still working"],
              ]}
            />
          ),
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
    close: "Say yes to agents at work. Always know who answers for each one.",
  },

  apis: {
    title: "Let only verified agents use your API",
    description:
      "Agents show a short-lived passport. In one line of code, you see who they work for and decide who gets in.",
    kicker: "For APIs and MCP servers",
    headline: "Let only verified agents use your API.",
    lede: (
      <>
        Agents show a short-lived passport. In <b>one line of code</b>, you see who they work for
        and decide who gets in.
      </>
    ),
    demo: <GateDemo />,
    moment: {
      title: "Half your traffic is agents now.",
      lines: [
        "Some book, buy and pay for real customers.",
        "Others scrape your data or farm free trials.",
        "To your server, they all look the same.",
      ],
      turn: "Block them all and you lose customers. Agent ID tells them apart.",
    },
    cards: {
      title: "Real customers' agents in. Everyone else out.",
      items: [
        {
          title: "One line, no signup",
          line: "No account and no secret. Node, Deno, Bun, Workers and Next.js.",
          viz: (
            <Terminal command="npm i @timewarp/agent-id-verify" note="In your API or MCP server" />
          ),
        },
        {
          title: "You set the rule",
          line: "Any verified person, verified businesses only, or just your own team.",
          viz: (
            <Choices
              items={[
                ["Any verified person", true],
                ["Verified businesses only", false],
                ["Only our own team's agents", false],
              ]}
            />
          ),
        },
        {
          title: "Revoked means revoked",
          line: "Online checks catch an agent its owner switched off a second ago.",
          viz: (
            <AgentRow
              img={MASCOT.nova}
              title="Booking Agent"
              line="Revoked a second ago · 403"
              end={<span className="chip no">Kept out</span>}
            />
          ),
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
      note: (
        <>
          API keys still fit your own customers' scripts. Signed agents (Web Bot Auth) fit when you
          only need to know which company runs an agent. Agent ID fits when a verified person or
          business must answer for every agent you let in.
        </>
      ),
    },
    questions: [
      [
        "Do we need to sign up?",
        "No. The verify package has no dependencies and needs no account.",
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
    close: "Turn agents into customers.",
  },

  "claude-and-codex": {
    title: "One agent ID in Claude Code and Codex",
    description: "Switch apps mid-task. Your agent keeps its email, wallet, computer and keys.",
    kicker: "For Claude Code and Codex",
    headline: "One agent ID in Claude Code and Codex.",
    lede: (
      <>
        Switch apps mid-task. Your agent keeps <b>its email, wallet, computer and keys</b>.
      </>
    ),
    demo: <SwitchDemo />,
    moment: {
      title: "Every switch starts from zero.",
      lines: [
        "Claude hit its limit, so you open Codex to finish.",
        "The new agent has none of the keys, sign-ins or tools.",
        "So you copy .env files around and paste keys into chat. Again.",
      ],
      turn: "With one Agent ID, nothing gets left behind.",
    },
    cards: {
      title: "Your agent comes along.",
      items: [
        {
          title: "Attach once",
          line: "It finds Claude Code, Codex and Cursor, and gives them the same ID.",
          viz: <Terminal command="npx @timewarp/agent-id attach" note="Once, on your computer" />,
        },
        {
          title: "Keys stay out of the chat",
          line: "Sign-ins and keys sit encrypted on the agent's own computer.",
          viz: (
            <Things
              items={[
                ["Resend API", "Key · sent only to api.resend.com"],
                ["GitHub", "Sign-in · sealed"],
                ["Stripe (test)", "Key · sent only to api.stripe.com"],
              ]}
            />
          ),
        },
        {
          title: "The same tools everywhere",
          line: "Email, phone, wallet and computer, in every app it's attached to.",
          viz: (
            <Things
              items={[
                ["Email", "research@agents.timewarpdev.com"],
                ["Wallet", "$1,240.00"],
                ["Computer", "Running · files kept"],
              ]}
            />
          ),
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
    close: "Use whichever AI is best today. Your agent comes along.",
  },
};

export const isAngle = (slug: string): slug is AngleSlug => slug in ANGLES;

// The other reasons, each with its mascot.
const REASONS: { angle: AngleSlug | "check"; label: string; img: string }[] = [
  { angle: "code", label: "Protect your code", img: MASCOT.orbit },
  { angle: "check", label: "Check AI or real", img: MASCOT.nova },
  { angle: "accountability", label: "When an agent goes rogue", img: MASCOT.cosmo },
  { angle: "apis", label: "Verified agents on your API", img: MASCOT.nova },
  { angle: "claude-and-codex", label: "One ID in Claude and Codex", img: MASCOT.orbit },
];

export function ReasonLink({
  angle,
  className,
  children,
}: {
  angle: AngleSlug | "check";
  className?: string;
  children: ReactNode;
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

export function Reasons({ current }: { current?: AngleSlug | "check" }) {
  return (
    <nav className="wrap reasons" aria-label="Also with Agent ID">
      {REASONS.filter((reason) => reason.angle !== current).map((reason) => (
        <ReasonLink key={reason.angle} angle={reason.angle}>
          <img src={reason.img} alt="" />
          {reason.label}
        </ReasonLink>
      ))}
    </nav>
  );
}

export function AnglePage({ slug }: { slug: AngleSlug }) {
  const angle = ANGLES[slug];
  return (
    <>
      <Hero
        kicker={angle.kicker}
        title={angle.headline}
        lede={angle.lede}
        actions={<StartButtons />}
      >
        {angle.demo}
      </Hero>

      <Moment
        title={angle.moment.title}
        lines={angle.moment.lines}
        turn={angle.moment.turn}
        source={angle.moment.source}
      />

      <section className="section wrap" aria-label="What changes">
        <h2>{angle.cards.title}</h2>
        <div className="quad three">
          {angle.cards.items.map((card) => (
            <article key={card.title} className="q-card">
              <div className="q-viz">{card.viz}</div>
              <h3>{card.title}</h3>
              <p>{card.line}</p>
            </article>
          ))}
        </div>
      </section>

      {angle.compare && (
        <section className="section wrap" aria-label="How it compares">
          <h2>How it compares.</h2>
          <p className="sub">{angle.compare.note}</p>
          <div className="compare">
            <table>
              <thead>
                <tr>
                  <th />
                  {angle.compare.options.map((option, i) => (
                    <th
                      key={option}
                      className={i === angle.compare!.options.length - 1 ? "us" : undefined}
                    >
                      {option}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {angle.compare.rows.map(([criterion, ...values]) => (
                  <tr key={criterion}>
                    <th scope="row">{criterion}</th>
                    {values.map((value, i) => (
                      <td key={i} className={i === values.length - 1 ? "us" : undefined}>
                        {value}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <Faq items={angle.questions} />
      <Closing title={angle.close} lede={OFFER_CLOSE} />
      <Reasons current={slug} />
    </>
  );
}
