// The product, working, the way the main Timewarp website shows it: Cosmo
// doing a real task in the app's frame, a cursor that clicks, steps that tick
// off, and the mascots holding what they made. Every moment is something
// Agent ID really does. People and companies in them are illustrative.
import { useEffect, useRef, useState } from "react";
import type { ReactNode, RefObject } from "react";

import { AppIcon } from "@/components/agent-id/AppIcons";
import { Icon, MASCOT, MASCOT_LIVE } from "./Site";

// --- Running a demo -------------------------------------------------------------

const STOP = Symbol("stop");
type Wait = (ms: number) => Promise<void>;

// Plays `run` over and over while the demo is on screen (it holds still when
// scrolled away). With reduced motion it shows the finished state instead.
function useDemo(
  ref: RefObject<HTMLElement | null>,
  run: (wait: Wait) => Promise<void>,
  finish: () => void,
) {
  const runRef = useRef(run);
  const finishRef = useRef(finish);
  runRef.current = run;
  finishRef.current = finish;
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      finishRef.current();
      return;
    }
    let alive = true;
    let visible = false;
    let timer: number | undefined;
    let held: (() => void) | null = null;
    const wait: Wait = (ms) =>
      new Promise((ok, stop) => {
        timer = window.setTimeout(() => {
          if (!alive) return stop(STOP);
          if (visible) ok();
          else held = ok;
        }, ms);
      });
    const watch = new IntersectionObserver(([entry]) => {
      visible = !!entry?.isIntersecting;
      if (visible && held) {
        const go = held;
        held = null;
        go();
      }
    });
    if (ref.current) watch.observe(ref.current);
    void (async () => {
      while (alive) {
        try {
          await runRef.current(wait);
        } catch (error) {
          if (error === STOP) return;
          throw error;
        }
      }
    })();
    return () => {
      alive = false;
      window.clearTimeout(timer);
      watch.disconnect();
    };
  }, [ref]);
}

// The owner's cursor: it moves to an element and clicks it.
function useCursor(frame: RefObject<HTMLElement | null>) {
  const cursor = useRef<HTMLDivElement>(null);
  const place = (x: number, y: number) => {
    if (cursor.current) cursor.current.style.transform = `translate(${x - 5}px, ${y - 4}px)`;
  };
  return {
    cursor,
    away() {
      const box = frame.current?.getBoundingClientRect();
      if (box) place(box.width + 40, box.height - 40);
    },
    async to(target: HTMLElement | null, wait: Wait) {
      const box = frame.current?.getBoundingClientRect();
      const at = target?.getBoundingClientRect();
      if (!box || !at) return;
      place(at.left - box.left + at.width * 0.5, at.top - box.top + at.height * 0.55);
      await wait(820);
    },
    async click(wait: Wait) {
      const el = cursor.current;
      if (!el) return;
      el.classList.add("press");
      await wait(140);
      el.classList.remove("press", "click");
      void el.offsetWidth;
      el.classList.add("click");
      await wait(180);
    },
  };
}

function Cursor({ refEl, who = "You" }: { refEl: RefObject<HTMLDivElement | null>; who?: string }) {
  return (
    <div
      className="cursor"
      ref={refEl}
      aria-hidden="true"
      style={{ transform: "translate(2000px, 0)" }}
    >
      <svg viewBox="0 0 24 24">
        <path d="M4 3l7 17 2.5-7L21 10.5z" />
      </svg>
      <span>{who}</span>
    </div>
  );
}

function Frame({
  where,
  frameRef,
  children,
}: {
  where: string;
  frameRef: RefObject<HTMLDivElement | null>;
  children: ReactNode;
}) {
  return (
    <div className="app hero-app" ref={frameRef} aria-hidden="true">
      <div className="app-top">
        <Icon name="panel" />
        <Icon name="left" />
        <Icon name="next" />
        <span className="where">{where}</span>
      </div>
      {children}
    </div>
  );
}

function Mark({ ok }: { ok: boolean }) {
  return (
    <span className={`mark ${ok ? "ok" : "no"}`}>
      <Icon name={ok ? "check" : "x"} />
    </span>
  );
}

// --- Home: Cosmo books a venue with its own ID ------------------------------------

const BOOK_STEPS = [
  "Emailing the venue",
  "Showing its passport",
  "Paying the $250 deposit",
  "Saving the confirmation",
];
const LETTER = "Hi! We'd like Stockholm Hall for 40 people on 12 November. Is it free?";
type Book = {
  step: number;
  typed: number;
  sent: boolean;
  scene: "mail" | "site" | "pay";
  checking: boolean;
  ask: boolean;
  pressed: boolean;
  paid: boolean;
  file: boolean;
  status: "work" | "wait" | "done";
};
const BOOK_START: Book = {
  step: 0,
  typed: 0,
  sent: false,
  scene: "mail",
  checking: true,
  ask: false,
  pressed: false,
  paid: false,
  file: false,
  status: "work",
};
const BOOK_END: Book = {
  step: 4,
  typed: LETTER.length,
  sent: true,
  scene: "pay",
  checking: false,
  ask: false,
  pressed: false,
  paid: true,
  file: true,
  status: "done",
};

export function HeroDemo() {
  const frame = useRef<HTMLDivElement>(null);
  const approve = useRef<HTMLSpanElement>(null);
  const [s, setS] = useState<Book>(BOOK_START);
  const set = (patch: Partial<Book>) => setS((now) => ({ ...now, ...patch }));
  const pointer = useCursor(frame);
  useDemo(
    frame,
    async (wait) => {
      setS(BOOK_START);
      pointer.away();
      await wait(900);
      for (let i = 1; i <= LETTER.length; i++) {
        set({ typed: i });
        await wait(26);
      }
      await wait(450);
      set({ sent: true });
      await wait(1200);
      set({ step: 1, scene: "site", checking: true });
      await wait(1500);
      set({ checking: false });
      await wait(1700);
      set({ step: 2, scene: "pay" });
      await wait(900);
      set({ status: "wait", ask: true });
      await wait(1100);
      await pointer.to(approve.current, wait);
      set({ pressed: true });
      await pointer.click(wait);
      set({ pressed: false, ask: false, status: "work" });
      pointer.away();
      await wait(500);
      set({ paid: true });
      await wait(1300);
      set({ step: 3 });
      await wait(900);
      set({ file: true, step: 4, status: "done" });
      await wait(4500);
    },
    () => setS(BOOK_END),
  );
  const state = { work: ["", "Working"], wait: ["wait", "Needs you"], done: ["done", "Done"] }[
    s.status
  ];
  const url = {
    mail: "Mail · cosmo@agents.timewarpdev.com",
    site: "sthlmhall.se/book",
    pay: "sthlmhall.se/book/deposit",
  }[s.scene];
  return (
    <Frame where="Timewarp · Agent ID" frameRef={frame}>
      <div className="panel">
        <div className="chat">
          <div className="msg-user">
            Book Stockholm Hall for 40 people on 12 November, and pay the deposit.
          </div>
          <div className="msg-agent">
            <div className="who">
              <img src={MASCOT.cosmo} alt="" />
              Cosmo <span className="idtag">agt_7f3k</span>
              <span className={`state ${state[0]}`}>{state[1]}</span>
            </div>
            <ol className="tools">
              {BOOK_STEPS.map((label, i) => (
                <li key={label} className={i < s.step ? "done" : i === s.step ? "active" : ""}>
                  {label}
                </li>
              ))}
            </ol>
            <div className={`ask ${s.ask ? "" : "hide"}`}>
              <div className="ask-top">
                <span className="ask-icon">$</span>
                <div>
                  <b>Pay $250 to Stockholm Hall?</b>
                  <small>Above your $100 limit, so Cosmo asks you first.</small>
                </div>
              </div>
              <div className="ask-btns">
                <span className="ask-no">Decline</span>
                <span ref={approve} className={`ask-ok ${s.pressed ? "pressed" : ""}`}>
                  Approve
                </span>
              </div>
            </div>
            <div className={`file-card ${s.file ? "" : "hide"}`}>
              <span className="ft pdf" />
              <div>
                <b>Booking confirmation.pdf</b>
                <small>Traced to Cosmo · tr_9a41c07e</small>
              </div>
              <span className="open">Open</span>
            </div>
          </div>
        </div>
        <div className="world">
          <div className="w-bar">
            <Icon name="globe" />
            <span className="w-url">{url}</span>
            <Icon name="reload" />
          </div>
          <div className="w-view">
            <div className={`scene ${s.scene === "mail" ? "on" : ""}`}>
              <div className="mail">
                <div className="mail-row">
                  From <b>cosmo@agents.timewarpdev.com</b>
                  <span className="chip id" style={{ marginLeft: "auto" }}>
                    Agent ID
                  </span>
                </div>
                <div className="mail-row">
                  To <b>bookings@sthlmhall.se</b>
                </div>
                <div className="mail-row">
                  Subject <b>40 people on 12 November</b>
                </div>
                <div className={`mail-body ${s.sent ? "" : "caret"}`}>
                  {LETTER.slice(0, s.typed)}
                </div>
              </div>
              <div className={`chips ${s.sent ? "in" : "hide"}`}>
                <span className="chip ok">Sent</span>
                <span className="chip plain">Traced: tr_4f1c2e90</span>
              </div>
            </div>
            <div className={`scene ${s.scene === "site" ? "on" : ""}`}>
              <p className="site-name">Stockholm Hall</p>
              <p className="site-sub">Events and conferences · Book online</p>
              <div className="gate">
                <img src={MASCOT.cosmo} alt="" />
                <div>
                  <b>
                    {s.checking ? "Checking the agent's passport…" : "Cosmo, acting for Acme AB"}
                  </b>
                  <small>
                    {s.checking ? "Agent ID passport" : "Verified business · passport checked"}
                  </small>
                </div>
                {s.checking ? (
                  <span className="spin" />
                ) : (
                  <span className="chip ok in">Let in</span>
                )}
              </div>
            </div>
            <div className={`scene ${s.scene === "pay" ? "on" : ""}`}>
              <p className="site-name">Deposit</p>
              <p className="site-sub">Stockholm Hall · 12 November · 40 people</p>
              <div className="pay">
                <div className="pay-line">
                  Hall and catering <b>$2,500.00</b>
                </div>
                <div className="pay-line pay-total">
                  Deposit due today <b>$250.00</b>
                </div>
              </div>
              <div className="chips">
                {s.paid ? (
                  <span className="chip ok in">Paid from Cosmo's wallet</span>
                ) : (
                  <span className="chip plain">Waiting for the owner's OK</span>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
      <Cursor refEl={pointer.cursor} />
    </Frame>
  );
}

// --- Others against Agent ID ------------------------------------------------------

const LOOSE_A: [string, string][] = [
  ["t", "sk_live_••••4f2 · used 3,112 times"],
  ["p", "Who sent this email?"],
  ["t", "POST /v1/charges · key: prod-shared"],
  ["p", "Was that our agent?"],
  ["t", "commit c9e3b70 · author: you"],
  ["p", "Turn the key off? It breaks everything."],
  ["t", "bot@acme.com · 3,000 emails"],
  ["p", "Is this photo real?"],
  ["t", "api_key_7f9 · 81.2.3.4"],
  ["p", "Which app was it in?"],
];
const LOOSE_B: [string, string][] = [
  ["p", "Rotate every key, just in case"],
  ["t", "unknown-agent · scraping /prices"],
  ["p", "Can we trust this commit?"],
  ["t", "free trial #4,812 · throwaway mail"],
  ["p", "Who answers for this?"],
  ["t", "voice note · “from the CEO”"],
  ["p", "Check the logs again"],
  ["t", "token ghp_••••a91 · shared"],
  ["p", "Did a person write this?"],
  ["t", "agent-runner · no owner"],
];

export function Versus() {
  const column = (lines: [string, string][]) =>
    [...lines, ...lines].map(([kind, text], i) => (
      <span key={i} className={kind}>
        {text}
      </span>
    ));
  return (
    <div className="vs">
      <div className="vs-side">
        <h2 className="vs-title">Others</h2>
        <p className="vs-text">
          Agents use your keys and leave no name. When something goes wrong, nobody knows who did
          what.
        </p>
        <div className="threads" aria-hidden="true">
          <div className="thread-col">{column(LOOSE_A)}</div>
          <div className="thread-col slow">{column(LOOSE_B)}</div>
        </div>
      </div>
      <div className="vs-side">
        <h2 className="vs-title">Agent ID</h2>
        <p className="vs-text">
          Every agent has its own ID, a person who answers for it, and a trail of what it did and
          made.
        </p>
        <div className="crew" aria-hidden="true">
          <figure>
            <div className="fig">
              <img src={MASCOT_LIVE.cosmo} alt="" width={130} height={130} />
              <IdProp />
            </div>
            <figcaption>Its own ID</figcaption>
          </figure>
          <figure>
            <div className="fig">
              <img src={MASCOT_LIVE.nova} alt="" width={130} height={130} />
              <PassportProp />
            </div>
            <figcaption>A passport</figcaption>
          </figure>
          <figure>
            <div className="fig">
              <img src={MASCOT_LIVE.orbit} alt="" width={130} height={130} />
              <SignedProp />
            </div>
            <figcaption>Signed work</figcaption>
          </figure>
          <figure>
            <div className="fig">
              <img className="finn" src={MASCOT.cosmo} alt="" width={130} height={130} />
              <PictureProp />
            </div>
            <figcaption>Traced pictures</figcaption>
          </figure>
        </div>
      </div>
    </div>
  );
}

// What the mascots hold: Agent ID's own things, drawn in Timewarp's palette.
function IdProp() {
  return (
    <svg className="hold h-id" viewBox="0 0 84 56">
      <defs>
        <linearGradient id="tw-band" x1="0" x2="1">
          <stop offset="0" stopColor="#a855f7" />
          <stop offset="1" stopColor="#ec4899" />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="80" height="52" rx="6" fill="#fff" stroke="#dde0e7" />
      <path d="M2 8a6 6 0 0 1 6-6h68a6 6 0 0 1 6 6v6H2z" fill="url(#tw-band)" />
      <circle cx="18" cy="31" r="9" fill="#e9d2ff" />
      <circle cx="18" cy="28.5" r="3.4" fill="#8a5bb8" />
      <path d="M11.8 37.5a6.6 6.6 0 0 1 12.4 0" fill="#8a5bb8" />
      <rect x="33" y="22" width="30" height="4.5" rx="2" fill="#172033" />
      <rect x="33" y="30" width="40" height="3" rx="1.5" fill="#cdd2db" />
      <rect x="33" y="36" width="24" height="3" rx="1.5" fill="#cdd2db" />
      <rect x="8" y="45" width="56" height="3.5" rx="1.7" fill="#eef0f4" />
      <circle cx="72" cy="45" r="7" fill="#3f8f62" />
      <path
        d="m68.8 45 2.2 2.2 4-4.2"
        stroke="#fff"
        strokeWidth="1.8"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
function PassportProp() {
  return (
    <svg className="hold h-pass" viewBox="0 0 60 78">
      <rect x="3" y="3" width="54" height="72" rx="6" fill="#3b2a63" />
      <rect x="7" y="7" width="46" height="64" rx="4" fill="none" stroke="#8a5bb8" />
      <rect x="15" y="14" width="30" height="3" rx="1.5" fill="#e9d2ff" />
      <circle cx="30" cy="38" r="10" fill="none" stroke="#e9d2ff" strokeWidth="2" />
      <ellipse
        cx="30"
        cy="38"
        rx="17"
        ry="5"
        fill="none"
        stroke="#e8b5f4"
        strokeWidth="1.6"
        transform="rotate(-18 30 38)"
      />
      <circle cx="30" cy="38" r="3.6" fill="#e9d2ff" />
      <rect x="17" y="57" width="26" height="3" rx="1.5" fill="#e9d2ff" />
      <rect x="21" y="63" width="18" height="2.5" rx="1.2" fill="#8a5bb8" />
    </svg>
  );
}
function SignedProp() {
  return (
    <svg className="hold h-sign" viewBox="0 0 66 80">
      <path
        d="M5 3h40l16 16v54a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3z"
        fill="#fff"
        stroke="#dde0e7"
      />
      <path d="M45 3v13a3 3 0 0 0 3 3h13" fill="#eef0f4" stroke="#dde0e7" />
      <rect x="9" y="12" width="9" height="3" rx="1.5" fill="#8a5bb8" />
      <rect x="20" y="12" width="16" height="3" rx="1.5" fill="#cdd2db" />
      <rect x="13" y="20" width="14" height="3" rx="1.5" fill="#b7d6ff" />
      <rect x="29" y="20" width="12" height="3" rx="1.5" fill="#cdd2db" />
      <rect x="13" y="28" width="22" height="3" rx="1.5" fill="#e8b5f4" />
      <rect x="9" y="36" width="10" height="3" rx="1.5" fill="#8a5bb8" />
      <rect x="13" y="44" width="18" height="3" rx="1.5" fill="#cdd2db" />
      <path d="m38 66-3 11 6-3.5 3 4.5 1-11zM50 66l3 11-6-3.5-3 4.5-1-11z" fill="#c9a0f5" />
      <circle cx="44" cy="58" r="13" fill="#d9b8fb" />
      <circle
        cx="44"
        cy="58"
        r="9.5"
        fill="none"
        stroke="#8a5bb8"
        strokeWidth="1.4"
        strokeDasharray="2 2"
      />
      <path
        d="m39.5 58 3 3 6-6.5"
        stroke="#5e3c86"
        strokeWidth="2.2"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
function PictureProp() {
  return (
    <svg className="hold h-pic" viewBox="0 0 84 70">
      <defs>
        <linearGradient id="tw-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffd0b5" />
          <stop offset="1" stopColor="#e9d2ff" />
        </linearGradient>
      </defs>
      <rect x="4" y="4" width="66" height="54" rx="4" fill="#fff" stroke="#dde0e7" />
      <rect x="9" y="9" width="56" height="40" rx="2" fill="url(#tw-sky)" />
      <circle cx="50" cy="20" r="5" fill="#fff4cf" />
      <path d="M9 49l16-16 10 10 8-7 22 13z" fill="#8a5bb8" />
      <path d="M9 49l16-16 8 8-10 8z" fill="#5e3c86" />
      <circle cx="68" cy="54" r="12" fill="#172033" />
      <text
        x="68"
        y="58"
        textAnchor="middle"
        fontSize="10"
        fontWeight="700"
        fill="#e9d2ff"
        fontFamily="Segoe UI, sans-serif"
      >
        AI
      </text>
    </svg>
  );
}

// --- Card pictures ------------------------------------------------------------------

export function CommitsViz() {
  return (
    <div className="card">
      <div className="row">
        <div>
          <b>Agent ID commit check</b>
        </div>
        <span className="chip no">1 blocked</span>
      </div>
      {(
        [
          ["a41f9c2", "Research Assistant · your agent", true],
          ["7d02e11", "Ada L. · your key", true],
          ["c9e3b70", "Not signed by your agents", false],
        ] as const
      ).map(([sha, who, ok]) => (
        <div key={sha} className="row">
          <Mark ok={ok} />
          <div>
            <b className="mono">{sha}</b>
            <small>{who}</small>
          </div>
          <span className={`chip ${ok ? "ok" : "no"}`}>{ok ? "Passed" : "Blocked"}</span>
        </div>
      ))}
    </div>
  );
}

export function TracedViz() {
  return (
    <>
      <p className="greeting">Was this made by AI?</p>
      <div className="card">
        <div className="row">
          <svg viewBox="0 0 56 40" width={56} height={40} aria-hidden="true" className="thumb">
            <defs>
              <linearGradient id="tw-card-sky" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#ffd0b5" />
                <stop offset="1" stopColor="#e9d2ff" />
              </linearGradient>
            </defs>
            <rect width="56" height="40" fill="url(#tw-card-sky)" />
            <circle cx="40" cy="12" r="4" fill="#fff4cf" />
            <path d="M0 40l16-16 10 10 8-7 22 13z" fill="#8a5bb8" />
          </svg>
          <div>
            <b>Made by AI · Poster Studio</b>
            <small>Nordic Prints AB, verified · 21 Oct</small>
          </div>
          <span className="chip id">Traced</span>
        </div>
      </div>
    </>
  );
}

const ROGUE_FACTS: [string, string][] = [
  ["Answers for it", "Erik L., Acme AB ✓"],
  ["Ran in", "Codex · GPT-6"],
  ["Computer", "build-server-2 · 203.0.113.7"],
];

export function RogueViz() {
  return (
    <div className="card pad">
      <div className="who">
        <img src={MASCOT.cosmo} alt="" />
        Outreach Agent
        <span className="state stop">Paused</span>
      </div>
      <p className="r-text gap">Sent 3,000 emails overnight.</p>
      {ROGUE_FACTS.map(([term, value]) => (
        <div key={term} className="pay-line small">
          {term} <b>{value}</b>
        </div>
      ))}
    </div>
  );
}

export function GateViz() {
  return (
    <>
      <div className="code">
        <span className="k">app</span>.use(<span className="k">agentIdMiddleware</span>({"{ "}
        require: <span className="s">"verified"</span>
        {" }"}));
      </div>
      <div className="card">
        <div className="row">
          <img src={MASCOT.nova} alt="" />
          <div>
            <b>Booking Agent</b>
            <small>For a verified person</small>
          </div>
          <span className="chip ok">Let in</span>
        </div>
        <div className="row">
          <Mark ok={false} />
          <div>
            <b>No passport</b>
            <small>401</small>
          </div>
          <span className="chip no">Kept out</span>
        </div>
      </div>
    </>
  );
}

// --- One ID in Claude Code and Codex -----------------------------------------------

const APPS = [
  {
    app: "claude-code",
    label: "Claude Code",
    model: "Claude Opus 5.5",
    line: "Writing the launch email… Claude hit its limit.",
  },
  {
    app: "codex",
    label: "Codex",
    model: "GPT-6",
    line: "Picked up where Claude Code stopped. Same email, wallet and keys.",
  },
];

export function SwitchShot() {
  const ref = useRef<HTMLDivElement>(null);
  const [on, setOn] = useState(0);
  useDemo(
    ref,
    async (wait) => {
      await wait(2800);
      setOn((now) => (now + 1) % APPS.length);
    },
    () => setOn(1),
  );
  const current = APPS[on] ?? APPS[0]!;
  return (
    <div ref={ref} className="switch">
      <div className="sb-tabs">
        {APPS.map((item, i) => (
          <span key={item.app} className={`sb-tab ${i === on ? "on" : ""}`}>
            <AppIcon app={item.app} size="sm" tooltip={false} />
            {item.label}
          </span>
        ))}
      </div>
      <IdCardMini used={`${current.label} · ${current.model}`} />
      <div className="msg-agent switch-line">
        <div className="who">
          <img src={MASCOT.orbit} alt="" />
          Research Assistant
          <span className="state">{current.label}</span>
        </div>
        <p key={current.app} className="r-text in">
          {current.line}
        </p>
      </div>
    </div>
  );
}

export function IdCardMini({ used }: { used: string }) {
  return (
    <div className="idcard">
      <div className="idcard-band">
        <span>Agent ID</span>
        <span>Timewarp</span>
      </div>
      <div className="idcard-who">
        <img src={MASCOT_LIVE.orbit} alt="" />
        <div>
          <b>Research Assistant</b>
          <small>Acme AB, verified ✓</small>
          <small key={used} className="in">
            Used in {used}
          </small>
        </div>
      </div>
      <div className="idcard-has">
        <span>Email · research@agents.timewarpdev.com</span>
        <span>Wallet · $1,240.00</span>
        <span>Computer · running</span>
        <span>Vault · 6 keys, sealed</span>
      </div>
      <div className="mrz">
        AGT&lt;RESEARCH&lt;ASSISTANT&lt;&lt;VERIFIED&lt;&lt;&lt;&lt;&lt;&lt;
      </div>
    </div>
  );
}

// --- The reason pages' demos ---------------------------------------------------------

const COMMITS = [
  {
    sha: "a41f9c2",
    title: "Cache the build",
    who: "Research Assistant · Acme AB's agent",
    ok: true,
  },
  { sha: "7d02e11", title: "Fix the login copy", who: "Ada L. · a key you listed", ok: true },
  {
    sha: "c9e3b70",
    title: "Update CI secrets",
    who: "Not signed by any of your agents",
    ok: false,
  },
];

export function CommitDemo() {
  const frame = useRef<HTMLDivElement>(null);
  const [done, setDone] = useState(0);
  useDemo(
    frame,
    async (wait) => {
      setDone(0);
      await wait(900);
      for (let i = 1; i <= COMMITS.length; i++) {
        await wait(1000);
        setDone(i);
      }
      await wait(4200);
    },
    () => setDone(COMMITS.length),
  );
  return (
    <Frame where="github.com/acme/app/pull/482" frameRef={frame}>
      <div className="panel one">
        <div className="world tall">
          <div className="w-bar">
            <Icon name="globe" />
            <span className="w-url">github.com/acme/app/pull/482</span>
            <Icon name="reload" />
          </div>
          <div className="w-view narrow">
            <p className="site-name">Update CI cache #482</p>
            <p className="site-sub">3 commits · wants to merge into main</p>
            <div className="card wide">
              <div className="row">
                <div>
                  <b>Agent ID commit check</b>
                  <small>Only your organization's verified agents, and keys you list</small>
                </div>
              </div>
              {COMMITS.map((commit, i) => (
                <div key={commit.sha} className="row">
                  {i < done ? <Mark ok={commit.ok} /> : <span className="spin" />}
                  <div>
                    <b>
                      <span className="mono">{commit.sha}</span> · {commit.title}
                    </b>
                    <small>{i < done ? commit.who : "Checking the signature…"}</small>
                  </div>
                  {i < done && (
                    <span className={`chip in ${commit.ok ? "ok" : "no"}`}>
                      {commit.ok ? "Passed" : "Blocked"}
                    </span>
                  )}
                </div>
              ))}
            </div>
            <div className={`gate no ${done === COMMITS.length ? "in" : "hide"}`}>
              <Mark ok={false} />
              <div>
                <b>Merging is blocked</b>
                <small>c9e3b70 isn't signed by one of your agents.</small>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Frame>
  );
}

const ROGUE_WHO: [string, string][] = [
  ["Answers for it", "Erik L., verified ✓"],
  ["Organization", "Acme AB"],
  ["Ran in", "Codex · GPT-6"],
  ["Computer", "build-server-2"],
  ["Network", "203.0.113.7"],
];

export function RogueDemo() {
  const frame = useRef<HTMLDivElement>(null);
  const pause = useRef<HTMLSpanElement>(null);
  const [count, setCount] = useState(2961);
  const [paused, setPaused] = useState(false);
  const [pressed, setPressed] = useState(false);
  const pointer = useCursor(frame);
  useDemo(
    frame,
    async (wait) => {
      setPaused(false);
      setCount(2961);
      pointer.away();
      await wait(600);
      for (let n = 2962; n <= 3000; n++) {
        setCount(n);
        await wait(70);
      }
      await wait(600);
      await pointer.to(pause.current, wait);
      setPressed(true);
      await pointer.click(wait);
      setPressed(false);
      setPaused(true);
      pointer.away();
      await wait(4800);
    },
    () => {
      setCount(3000);
      setPaused(true);
    },
  );
  const rows = [0, 1, 2, 3].map((k) => count - k).filter((n) => n > 2960);
  return (
    <Frame where="Timewarp · Agent ID · Activity" frameRef={frame}>
      <div className="panel">
        <div className="chat">
          <div className="msg-agent">
            <div className="who">
              <img src={MASCOT.cosmo} alt="" />
              Outreach Agent <span className="idtag">agt_9x2k</span>
              <span className={`state ${paused ? "stop" : ""}`}>
                {paused ? "Paused" : "Working"}
              </span>
            </div>
            <div className="card pad wide">
              {ROGUE_WHO.map(([term, value]) => (
                <div key={term} className="pay-line small">
                  {term} <b>{value}</b>
                </div>
              ))}
            </div>
            <div className={`file-card ${paused ? "in" : "hide"}`}>
              <span className="mark no">
                <Icon name="pause" />
              </span>
              <div>
                <b>Stopped at once</b>
                <small>Keys, card and passports. Your other agents keep working.</small>
              </div>
            </div>
          </div>
        </div>
        <div className="world">
          <div className="w-bar">
            <span className="w-url">Activity · Outreach Agent</span>
            <span ref={pause} className={`btn btn-sm btn-ink tight ${pressed ? "pressed" : ""}`}>
              <Icon name="pause" /> {paused ? "Paused" : "Pause agent"}
            </span>
          </div>
          <div className="w-view">
            <p className="site-name">{count.toLocaleString("en-US")} emails sent</p>
            <p className="site-sub">Since 02:14 tonight</p>
            <div className="card wide">
              {rows.map((n) => (
                <div key={n} className={`row ${n === count && !paused ? "in" : ""}`}>
                  <img src={MASCOT.cosmo} alt="" />
                  <div>
                    <b>Email to customer #{n.toLocaleString("en-US")}</b>
                    <small>Codex · GPT-6 · on build-server-2</small>
                  </div>
                  <span className="chip plain">Sent</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
      <Cursor refEl={pointer.cursor} />
    </Frame>
  );
}

const CALLERS = [
  {
    name: "Booking Agent",
    why: "For a verified person · checked online",
    ok: true,
    img: MASCOT.nova,
  },
  { name: "An agent with no ID", why: "No passport · 401", ok: false, img: null },
  { name: "Travel Desk", why: "Acme AB, verified business", ok: true, img: MASCOT.orbit },
  { name: "Scraper 7", why: "Owner not verified · 403", ok: false, img: null },
  {
    name: "Booking Agent",
    why: "Revoked by its owner a second ago · 403",
    ok: false,
    img: MASCOT.nova,
  },
];

export function GateDemo() {
  const frame = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(0);
  useDemo(
    frame,
    async (wait) => {
      setShown(0);
      await wait(700);
      for (let i = 1; i <= CALLERS.length; i++) {
        setShown(i);
        await wait(1200);
      }
      await wait(3600);
    },
    () => setShown(CALLERS.length),
  );
  const ins = CALLERS.slice(0, shown).filter((caller) => caller.ok).length;
  return (
    <Frame where="mcp.acme.com" frameRef={frame}>
      <div className="panel">
        <div className="chat">
          <p className="r-text strong">server.js</p>
          <div className="code wide">
            <span className="k">app</span>.use(<span className="s">"/mcp"</span>,{"\n  "}
            <span className="k">agentIdMiddleware</span>({"{"}
            {"\n    "}audience: <span className="s">"https://mcp.acme.com"</span>,{"\n    "}require:{" "}
            <span className="s">"verified"</span>,{"\n    "}online: <span className="k">true</span>,
            {"\n  "}
            {"}"}));
          </div>
          <p className="r-text quiet">One line. No account, no secret.</p>
        </div>
        <div className="world">
          <div className="w-bar">
            <span className="w-url">Requests to mcp.acme.com</span>
            <span className="chip ok">{ins} let in</span>
          </div>
          <div className="w-view">
            <div className="card wide">
              {CALLERS.slice(0, shown).map((caller, i) => (
                <div key={i} className="row in">
                  {caller.img ? <img src={caller.img} alt="" /> : <Mark ok={false} />}
                  <div>
                    <b>{caller.name}</b>
                    <small>{caller.why}</small>
                  </div>
                  <span className={`chip ${caller.ok ? "ok" : "no"}`}>
                    {caller.ok ? "Let in" : "Kept out"}
                  </span>
                </div>
              ))}
              {shown === 0 && (
                <div className="row">
                  <span className="spin" />
                  <div>
                    <small>Waiting for agents…</small>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </Frame>
  );
}

export function SwitchDemo() {
  const frame = useRef<HTMLDivElement>(null);
  return (
    <Frame where="Research Assistant · Agent ID" frameRef={frame}>
      <div className="panel one">
        <div className="world tall center">
          <SwitchShot />
        </div>
      </div>
    </Frame>
  );
}
