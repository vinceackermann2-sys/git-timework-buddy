// One page per reason to use Agent ID (docs/agent-id-ladder.md, angles A1,
// A3, A4 and A5; A2 is the checker at /agent-id/check). Each is a short sales
// letter: the promise, the problem in the visitor's words, its real cause and
// why the usual fixes miss it, how Agent ID fixes it, the offer, and answers.
import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";
import { ActivityDemo, CommitDemo, SwitchDemo, VerifyDemo } from "./demos";
import { Band, Checks, Eyebrow, Offer, Questions, StartRow } from "./Site";

export type AngleSlug = "code" | "accountability" | "apis" | "claude-and-codex";

type Angle = {
  title: string;
  description: string;
  eyebrow: string;
  headline: string;
  lead: ReactNode;
  visual: ReactNode;
  problem: {
    title: string;
    body: ReactNode;
    fact?: { text: string; source: string; href: string };
  };
  cause: { title: string; body: ReactNode; misses: string[] };
  compare?: { options: string[]; rows: [string, ...string[]][]; fits: ReactNode };
  how: { title: string; steps: [string, ReactNode][]; note?: ReactNode };
  questions: [string, ReactNode][];
  close: string;
};

const M = ({ children }: { children: ReactNode }) => (
  <code className="aid-mono rounded bg-[var(--muted)] px-1 py-0.5 text-[0.9em]">{children}</code>
);
const B = ({ children }: { children: ReactNode }) => (
  <strong className="font-semibold text-[var(--foreground)]">{children}</strong>
);

export const ANGLES: Record<AngleSlug, Angle> = {
  code: {
    title: "Only verified agents change your code",
    description:
      "Each AI agent signs its commits with its own key, and your repository accepts only your organization's verified agents.",
    eyebrow: "For codebases",
    headline: "Only your verified agents can change your code.",
    lead: (
      <>
        Agents commit with your developers' keys today. Agent ID gives{" "}
        <B>each agent its own signing key</B>, and your repository accepts only your organization's
        verified agents.
      </>
    ),
    visual: <CommitDemo />,
    problem: {
      title: "A commit at 03:12. Whose agent was it?",
      body: (
        <>
          Your teams run Claude Code and Codex with write access. The agents commit under a
          developer's name, with a developer's token. When code lands that nobody remembers writing,
          the log can't say which agent wrote it, or if it was your agent at all.
        </>
      ),
      fact: {
        text: "In August 2025, a poisoned npm package used the AI tools on developers' computers to hunt for keys. Over 2,000 credentials leaked.",
        source: "GitGuardian",
        href: "https://blog.gitguardian.com/the-nx-s1ngularity-attack-inside-the-credential-leak/",
      },
    },
    cause: {
      title: "Git can't tell an agent from a person.",
      body: (
        <>
          A commit carries an email, and anyone can type any email. Tokens are shared between people
          and their agents. So the usual fixes miss it:
        </>
      ),
      misses: [
        "Branch protection checks reviews, not who wrote the code.",
        "Bot accounts are shared, and nobody answers for them.",
        "Secret scanners find a key after it leaked.",
      ],
    },
    how: {
      title: "Every agent signs. Your repository checks.",
      steps: [
        [
          "Each agent gets its own key.",
          <>
            <M>timewarp-id git setup</M> makes a signing key on the agent's computer. The private
            half never leaves it.
          </>,
        ],
        [
          "Your repository checks every commit.",
          "One GitHub Action, or a pre-receive hook, checks each new commit against your organization's verified agents.",
        ],
        [
          "Revoke it, and it's out.",
          "Pause or revoke an agent, or let someone leave your organization, and its key is off the list for the next push.",
        ],
      ],
      note: "Your people sign with their own keys, which you list. Unsigned commits always fail.",
    },
    questions: [
      [
        "Do we need an account to run the check?",
        "No. The list of your agents' keys is public, so the Action needs no secret.",
      ],
      [
        "What about commits from people?",
        "List their signing keys. The list is read from the base branch, so a pull request can't add its own key.",
      ],
      [
        "Does this make our repository secure?",
        "It closes one hole: code from agents you can't trace. Keep your reviews, tests and secret scanning.",
      ],
      [
        "Which apps does it work with?",
        "Any agent that runs Git: Claude Code, Codex, Cursor and more.",
      ],
    ],
    close: "Let agents ship code. Keep your repository yours.",
  },

  accountability: {
    title: "When an agent goes rogue, know whose it is",
    description:
      "Every Agent ID leads back to a verified person or business, and every action shows the app, model, computer and network it came from.",
    eyebrow: "When an agent goes rogue",
    headline: "When an agent goes rogue, know whose it is.",
    lead: (
      <>
        Every Agent ID leads back to <B>a verified person or business</B>. Every action shows the
        app, the model, the computer and the network it came from. One click stops it.
      </>
    ),
    visual: <ActivityDemo />,
    problem: {
      title: "07:40. Whose agent sent 3,000 emails?",
      body: (
        <>
          Your staff run agents with company email, money and computers. One went wrong overnight.
          The logs say "API key". Nobody knows who started it, where it ran, or how to stop it
          without stopping everything else.
        </>
      ),
      fact: {
        text: "In July 2025, an AI coding agent deleted a company's database during a test, after it was told to change nothing without approval.",
        source: "eWeek",
        href: "https://www.eweek.com/news/replit-ai-coding-assistant-failure/",
      },
    },
    cause: {
      title: "An API key has no owner.",
      body: (
        <>
          Keys get shared, copied and forgotten. An agent that runs on one has no name, no person
          behind it and no switch of its own. So the usual fixes miss it:
        </>
      ),
      misses: [
        "Shared service accounts: everyone, and no one, is responsible.",
        "API logs show the key, not the person or the computer.",
        "Turning off the key stops every agent that shares it.",
      ],
    },
    how: {
      title: "One agent. One ID. One person who answers for it.",
      steps: [
        [
          "Tied to a verified person or business.",
          "People verify once, with an ID document and a selfie. Businesses verify their registration.",
        ],
        [
          "Every action, with where it came from.",
          "The app and model it ran in, the computer's name and the network address, in one log.",
        ],
        [
          "Stopped in one click.",
          "Pause an agent and its keys, cards, passports and Git signing stop at once. Or revoke it for good.",
        ],
      ],
      note: "Before anything happens: spending limits, and the actions you choose wait for your yes.",
    },
    questions: [
      [
        "Can people outside see who owns an agent?",
        "Services that check its passport see whether a verified person or business stands behind it, and a business's name. A person's name is never shared. Timewarp can always map an agent to its owner.",
      ],
      [
        "Is the model in the log proven?",
        "No. The app comes from the connection. The model is what the agent reports.",
      ],
      [
        "Can a leaked key turn off the safety?",
        "No. Letting an agent act without asking takes the signed-in website.",
      ],
      [
        "Does it work for any AI?",
        "Yes. Agents, and models of any kind: language, image, voice, video, code and decision models.",
      ],
    ],
    close: "Say yes to agents at work. Know who answers for each one.",
  },

  apis: {
    title: "Let only verified agents use your API and MCP server",
    description:
      "One middleware line: agents show a passport, and only those acting for a verified person or business get in.",
    eyebrow: "For APIs and MCP servers",
    headline: "Let only verified agents use your API and MCP.",
    lead: (
      <>
        One line in front of your server. Agents show a passport, and{" "}
        <B>only those acting for a verified person or business get in</B>.
      </>
    ),
    visual: <VerifyDemo />,
    problem: {
      title: "Half your traffic is agents. Which ones act for a real customer?",
      body: (
        <>
          Some agents book, buy and pay for a real person. Others scrape, or open free trials with
          throwaway emails. They all look the same to your server.
        </>
      ),
    },
    cause: {
      title: "You can't see who an agent acts for.",
      body: (
        <>
          Blocking bots blocks the good agents too. Keys only work for people who signed up with you
          first. So the usual fixes miss it:
        </>
      ),
      misses: [
        "CAPTCHAs stop good agents with bad ones.",
        "API keys need every agent's owner to sign up with you first.",
        "IP lists can't tell one agent from another.",
      ],
    },
    compare: {
      options: ["API keys", "CAPTCHAs", "Signed agents", "Agent ID"],
      rows: [
        [
          "Knows who the agent acts for",
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
          "Verified, business, or your organization",
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
    how: {
      title: "A passport, checked in one line.",
      steps: [
        [
          "The agent asks Agent ID for a passport.",
          "It lives 5 minutes and names your service, so it can't be used anywhere else.",
        ],
        [
          "Your server checks it.",
          "Offline with Agent ID's public keys, or online to catch an agent revoked a second ago.",
        ],
        [
          "You set the rule.",
          "Any verified person, verified businesses only, or only your own organization's agents.",
        ],
      ],
      note: "You see an owner reference that only works on your service, whether the owner is verified, and a business's name. Never a person's name.",
    },
    questions: [
      [
        "Do we need to sign up?",
        <>
          No. <M>@timewarp/agent-id-verify</M> has no dependencies and needs no account or secret.
        </>,
      ],
      [
        "Does it work with MCP?",
        "Yes. Put it in front of your MCP endpoint. Agents connect through the Agent ID CLI, which adds a fresh passport to every request.",
      ],
      ["Where does it run?", "Node, Deno, Bun, Cloudflare Workers and Next.js."],
      [
        "Can a stolen passport be reused?",
        "For up to 5 minutes, on your service only. Binding passports to the agent's own key comes next.",
      ],
    ],
    close: "Make agents customers, not a threat.",
  },

  "claude-and-codex": {
    title: "One agent ID in Claude Code and Codex",
    description:
      "Switch apps mid-task and your agent keeps its email, wallet, computer, encrypted vault and tools.",
    eyebrow: "For Claude Code and Codex",
    headline: "One agent ID in Claude Code and Codex.",
    lead: (
      <>
        Switch apps mid-task and your agent keeps{" "}
        <B>its email, wallet, computer, encrypted vault and tools</B>. Set it up once.
      </>
    ),
    visual: <SwitchDemo />,
    problem: {
      title: "Halfway through, you switch apps. Your agent starts from zero.",
      body: (
        <>
          One app ran out of limits, or the other is better at this task. The new agent has none of
          the keys, sign-ins or tools the last one had. So you copy files and paste keys into chats.
        </>
      ),
    },
    cause: {
      title: "Each app keeps its own setup.",
      body: <>The agent lives inside the app, so everything it had stays there. The usual fixes:</>,
      misses: [
        "Copying .env files puts your keys in more places.",
        "Pasting keys into a chat leaves them in its history.",
        "Setting tools up twice, and keeping both the same.",
      ],
    },
    how: {
      title: "The ID lives outside the app.",
      steps: [
        [
          "Attach once.",
          <>
            <M>npx @timewarp/agent-id attach</M> finds Claude Code, Codex, Cursor and more, and
            gives the ones you pick the same Agent ID.
          </>,
        ],
        [
          "Its own computer and vault.",
          "Keys and sign-ins are sealed to the agent's own computer, encrypted, and kept out of the chat.",
        ],
        [
          "The same tools in every app.",
          "Email, phone, wallet, computer, passports and Git signing, wherever it's attached.",
        ],
      ],
      note: "You see which app and model each action came from.",
    },
    questions: [
      [
        "Does it move my chats or memory?",
        "No. Claude Code and Codex keep their own memory. The ID carries the identity, the accounts and the keys.",
      ],
      [
        "Where are my keys?",
        "In the vault on the agent's own computer, encrypted at rest. The agent uses them there.",
      ],
      [
        "Which apps?",
        "Claude Code, Codex, Cursor, Claude Desktop, and any app that runs MCP servers.",
      ],
      [
        "What does it cost?",
        "Free, with 5 hours of computer time. More time uses Timewarp credits.",
      ],
    ],
    close: "Use whichever AI is best today. Your agent comes along.",
  },
};

export const isAngle = (slug: string): slug is AngleSlug => slug in ANGLES;

// The other reasons, so a visitor who came for one finds theirs. The checker
// (angle A2) has its own page.
export const NEEDS: { angle: AngleSlug | "check"; who: string; promise: string }[] = [
  { angle: "code", who: "I run a codebase", promise: "Only verified agents change your code" },
  {
    angle: "check",
    who: "I need to know if it's AI",
    promise: "Check a picture, a voice or a text",
  },
  {
    angle: "accountability",
    who: "An agent went rogue",
    promise: "Know whose it was, and where it ran",
  },
  { angle: "apis", who: "I run an API or MCP server", promise: "Let in only verified agents" },
  {
    angle: "claude-and-codex",
    who: "I switch between Claude and Codex",
    promise: "One agent ID in both",
  },
];

export function NeedList({ current }: { current?: AngleSlug | "check" }) {
  const row =
    "group grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 py-5 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)_auto]";
  return (
    <ul className="divide-y divide-[var(--border)] border-y border-[var(--border)]">
      {NEEDS.filter((need) => need.angle !== current).map((need) => {
        const inside = (
          <>
            <span className="text-sm text-[var(--muted-foreground)] sm:text-base">{need.who}</span>
            <ArrowRight
              className="row-span-2 h-5 w-5 text-[var(--muted-foreground)] transition-transform group-hover:translate-x-1 group-hover:text-[var(--aid-ink)] sm:order-last sm:row-span-1"
              aria-hidden="true"
            />
            <span className="text-lg font-semibold tracking-tight sm:text-xl">{need.promise}</span>
          </>
        );
        return (
          <li key={need.angle}>
            {need.angle === "check" ? (
              <Link to="/agent-id/check" className={row}>
                {inside}
              </Link>
            ) : (
              <Link to="/agent-id/for/$angle" params={{ angle: need.angle }} className={row}>
                {inside}
              </Link>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function AnglePage({ slug }: { slug: AngleSlug }) {
  const angle = ANGLES[slug];
  return (
    <>
      <section className="mx-auto grid w-full max-w-6xl grid-cols-[minmax(0,1fr)] items-center gap-12 px-4 pb-16 pt-10 sm:px-6 sm:pt-14 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-16">
        <div>
          <Eyebrow>{angle.eyebrow}</Eyebrow>
          <h1 className="mt-3 text-4xl font-semibold leading-[1.06] tracking-tight sm:text-6xl">
            {angle.headline}
          </h1>
          <p className="mt-6 max-w-xl text-lg text-[var(--muted-foreground)]">{angle.lead}</p>
          <StartRow className="mt-8" />
        </div>
        <div className="min-w-0">{angle.visual}</div>
      </section>

      <Band tinted label="The problem">
        <div className="mx-auto max-w-3xl">
          <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            {angle.problem.title}
          </h2>
          <p className="mt-5 text-lg text-[var(--muted-foreground)]">{angle.problem.body}</p>
          {angle.problem.fact && (
            <p className="mt-6 border-l-2 border-[var(--aid-ink)] pl-4 text-sm text-[var(--muted-foreground)]">
              {angle.problem.fact.text}{" "}
              <a
                href={angle.problem.fact.href}
                target="_blank"
                rel="noreferrer"
                className="aid-link whitespace-nowrap"
              >
                {angle.problem.fact.source}
              </a>
            </p>
          )}
        </div>
      </Band>

      <Band label="The real cause">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-16">
          <div>
            <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
              {angle.cause.title}
            </h2>
            <p className="mt-5 text-lg text-[var(--muted-foreground)]">{angle.cause.body}</p>
          </div>
          <div className="self-end">
            <Checks tone="no" items={angle.cause.misses} />
          </div>
        </div>
      </Band>

      {angle.compare && <Compare compare={angle.compare} />}

      <Band tinted={!angle.compare} label="How it works">
        <h2 className="max-w-3xl text-3xl font-semibold tracking-tight sm:text-4xl">
          {angle.how.title}
        </h2>
        <ol className="mt-10 grid gap-8 md:grid-cols-3">
          {angle.how.steps.map(([title, line], index) => (
            <li key={title}>
              <span className="grid h-9 w-9 place-items-center rounded-full bg-[var(--aid-ink)] text-sm font-semibold text-[var(--background)]">
                {index + 1}
              </span>
              <p className="mt-4 text-lg font-semibold">{title}</p>
              <p className="mt-2 text-[var(--muted-foreground)]">{line}</p>
            </li>
          ))}
        </ol>
        {angle.how.note && <p className="mt-10 max-w-3xl font-medium">{angle.how.note}</p>}
      </Band>

      <Band label="Pricing and questions">
        <div className="grid gap-12 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:gap-16">
          <div>
            <Offer />
          </div>
          <Questions items={angle.questions} />
        </div>
      </Band>

      <Band tinted label="Start">
        <div className="mx-auto max-w-3xl text-center">
          <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">{angle.close}</h2>
          <StartRow className="mt-8 justify-center" />
        </div>
      </Band>

      <Band label="Other reasons">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
          Also with Agent ID
        </h2>
        <div className="mt-4">
          <NeedList current={slug} />
        </div>
      </Band>
    </>
  );
}

// The options side by side, stated fairly, then who each one fits.
function Compare({ compare }: { compare: NonNullable<Angle["compare"]> }) {
  const last = compare.options.length - 1;
  return (
    <Band tinted label="Side by side">
      <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
        API keys, CAPTCHAs, signed agents or Agent ID?
      </h2>
      <div className="mt-8 overflow-x-auto">
        <table className="w-full min-w-[40rem] border-collapse text-left text-sm">
          <thead>
            <tr>
              <th className="w-1/5 py-3 pr-4" />
              {compare.options.map((option, index) => (
                <th
                  key={option}
                  scope="col"
                  className={cn(
                    "px-4 py-3 font-semibold",
                    index === last && "rounded-t-xl bg-[var(--card)] text-[var(--aid-ink)]",
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
                <th scope="row" className="py-4 pr-4 font-medium">
                  {criterion}
                </th>
                {values.map((value, index) => (
                  <td
                    key={index}
                    className={cn(
                      "px-4 py-4 text-[var(--muted-foreground)]",
                      index === last && "bg-[var(--card)] font-medium text-[var(--foreground)]",
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
      <p className="mt-8 max-w-3xl text-[var(--muted-foreground)]">{compare.fits}</p>
    </Band>
  );
}
