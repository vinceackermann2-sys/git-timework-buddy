import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { CalendarClock, Check, FileSpreadsheet, Gauge, Globe, LoaderCircle, Sparkles, TriangleAlert } from "lucide-react";
import { call, errorText, request } from "../api.js";
import { Avatar } from "./common.jsx";

// First steps: after setup, the agent shows the new user around the home
// screen. Each step dims the window around what it explains (the message box,
// the agent, Tools, the task list). The browser step opens the real built-in
// browser beside the card, where the agent looks something up with its own
// browser tools. The last offers a first task, which goes into the message box
// to change or send. Skip tour (on the last step, "I'll write my own") or
// Escape ends it.

// targets: what a step points at, as one area. fallback: what it points at
// when those aren't on screen (the sidebar's button while the sidebar is
// hidden). A step with neither, or whose card doesn't fit beside them, is
// drawn in the middle of the dimmed window. title can name the agent. browser:
// the step shows the browser pane (Shell.jsx) and runs RUN in it.
const STEPS = [
  {
    id: "ask", targets: [".tw-home .tw-composer-box"], side: "below", radius: 30,
    title: "Tell me what to get done",
    body: "Type a task the way you'd ask a colleague, or attach files with +. I do the work on this computer: I search the web, make and edit files, and use your apps.",
  },
  {
    id: "agent", targets: [".tw-home .tw-pill.agent"], side: "below", radius: 999,
    title: name => `I'm ${name}, your agent`,
    body: "I remember what you tell me, follow the instructions you give me, and use skills for jobs you repeat. Switch agents here, or add one for another role, like research or your inbox.",
  },
  {
    id: "browser", targets: [".tw-pane"], side: "left", radius: 12, browser: true,
    title: "I browse at the speed of light",
    body: "This is Timewarp's built-in browser, beside every chat. I read each page in an instant and click, type and fill in forms directly, while you watch or take over. For bigger jobs, helpers browse alongside me in their own tabs.",
  },
  {
    id: "tools", targets: [".tw-home .tw-pill[aria-label='Tools']"], side: "below", radius: 999,
    title: "Connect your apps",
    body: "Connect your email, calendar, Slack and more here. With an app connected I work in it directly, which is faster and more reliable than going through its website.",
  },
  {
    id: "tasks", targets: [".tw-sidebar .tw-new-task", ".tw-sidebar .tw-add-agent"], fallback: [".tw-topbar button:first-child"], side: "right", radius: 16,
    title: "Follow along, or let me run",
    body: "Each task gets its own chat in the sidebar, and I keep working while you do something else. I check with you before buying anything or doing something you didn't ask for.",
  },
  {
    id: "try", targets: [".tw-home .tw-composer-box"], side: "below", radius: 30, wide: true,
    title: "Try your first task",
    body: "Pick one to start. It goes into the message box, so you can change it before you send it.",
  },
];
// First tasks to try: research in the browser, a file, an automation, and memory.
const PROMPTS = [
  { icon: Globe, label: "Research", text: "Compare the 3 best-reviewed noise-cancelling headphones under $300." },
  { icon: FileSpreadsheet, label: "Make a file", text: "Make me a monthly budget spreadsheet I can fill in." },
  { icon: CalendarClock, label: "On a schedule", text: "Every Friday at 4 pm, remind me to plan next week." },
  { icon: Sparkles, label: "Get to know me", text: "Ask me about my work, then suggest 5 tasks you could take on." },
];

// The browser step's run in the real browser beside the card (methods.cjs,
// firstSteps.browser): each part as the agent does it, timed. mine: the
// agent's own work; the other parts are mostly the website loading.
const RUN = [
  { step: "open", label: "Opening wikipedia.org" },
  { step: "type", label: "Reading the page, typing “Albert Einstein”", mine: true },
  { step: "search", label: "Searching (the article loads)" },
  { step: "read", label: "Reading the article", mine: true },
];
const seconds = ms => (ms / 1000).toFixed(1) + " s";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

const PAD = 8, GAP = 14, MARGIN = 16;
// The area a step points at, in window coordinates, or null when it isn't on screen.
function areaOf(targets) {
  const rects = targets.map(selector => document.querySelector(selector)?.getBoundingClientRect())
    .filter(rect => rect && rect.width && rect.height && rect.right > 0 && rect.bottom > 0 && rect.left < window.innerWidth && rect.top < window.innerHeight);
  if (!rects.length) return null;
  const left = Math.min(...rects.map(rect => rect.left)), top = Math.min(...rects.map(rect => rect.top));
  return { left, top, width: Math.max(...rects.map(rect => rect.right)) - left, height: Math.max(...rects.map(rect => rect.bottom)) - top };
}
const sameArea = (a, b) => a === b || (!!a && !!b && ["left", "top", "width", "height"].every(key => Math.abs(a[key] - b[key]) < 0.5));
// Where the card goes: on the step's side of its area if it fits there, else
// the other sides, else the middle of the window (centered, over the area).
function placeCard(area, side, card) {
  const width = window.innerWidth, height = window.innerHeight;
  const middle = { left: (width - card.width) / 2, top: (height - card.height) / 2, centered: true };
  if (!area) return middle;
  const room = {
    below: area.top + area.height + PAD + GAP + card.height <= height - MARGIN,
    above: area.top - PAD - GAP - card.height >= MARGIN,
    right: area.left + area.width + PAD + GAP + card.width <= width - MARGIN,
    left: area.left - PAD - GAP - card.width >= MARGIN,
  };
  const chosen = [side, ...["below", "above", "right", "left"].filter(item => item !== side)].find(item => room[item]);
  if (!chosen) return middle;
  const at = chosen === "right" ? { left: area.left + area.width + PAD + GAP, top: area.top - PAD }
    : chosen === "left" ? { left: area.left - PAD - GAP - card.width, top: area.top + area.height / 2 - card.height / 2 }
      : { left: area.left + area.width / 2 - card.width / 2, top: chosen === "below" ? area.top + area.height + PAD + GAP : area.top - PAD - GAP - card.height };
  return {
    left: Math.max(MARGIN, Math.min(at.left, width - card.width - MARGIN)),
    top: Math.max(MARGIN, Math.min(at.top, height - card.height - MARGIN)),
    centered: false,
  };
}

// agent: the agent of the home screen. onTry(text) puts a first task in the
// message box; onBilling opens Billing; both end the guide, as onEnd does.
// onBrowser(shown) asks for the browser pane beside Home.
export function FirstSteps({ agent, userName, funding, onEnd, onTry, onBilling, onBrowser }) {
  const [index, setIndex] = useState(0);
  const [area, setArea] = useState(null);
  const [position, setPosition] = useState(null);
  const [connecting, setConnecting] = useState("");
  // The browser run: each part's state ("running", "done", "failed") and time, the total, or what went wrong.
  const [run, setRun] = useState(null);
  const runs = useRef(0);
  const dialog = useRef(null);
  const card = useRef(null);
  const primary = useRef(null);
  const step = STEPS[index], last = index === STEPS.length - 1;

  useEffect(() => { onBrowser?.(!!step.browser); }, [step]);
  // The browser gets ready from the start, so its step doesn't wait on a first connection.
  useEffect(() => { void call("firstSteps.browser", { step: "warm" }).catch(() => {}); }, []);
  // The agent's run in the browser, once the pane shows its first tab (the
  // page opens in that tab). Leaving the step lets it finish out of sight.
  async function watch(again = false) {
    const id = ++runs.current, started = performance.now();
    const mark = (part, value) => setRun(current => ({ ...current, parts: { ...current.parts, [part]: value } }));
    setRun({ parts: {}, total: null, error: null });
    for (const deadline = Date.now() + 4000; !document.querySelector(".tw-pane .tw-pane-tab") && Date.now() < deadline;) await pause(100);
    for (const { step: part } of RUN) {
      if (id !== runs.current) return;
      const at = performance.now();
      mark(part, { state: "running" });
      try { await call("firstSteps.browser", { step: part, agentId: agent.id, again }); }
      catch (error) {
        if (id !== runs.current) return;
        mark(part, { state: "failed" });
        setRun(current => ({ ...current, error: errorText(error) }));
        return;
      }
      if (id !== runs.current) return;
      mark(part, { state: "done", ms: performance.now() - at });
    }
    if (id === runs.current) setRun(current => ({ ...current, total: performance.now() - started }));
  }
  useEffect(() => { if (step.browser && !run && agent) void watch(); }, [step]);
  useEffect(() => () => { runs.current++; }, []);

  useEffect(() => {
    const node = dialog.current;
    if (node && !node.open) node.showModal();
    return () => { if (node?.open) node.close(); };
  }, []);
  // The area follows the page as it loads and the window changes size.
  useEffect(() => {
    let frame = 0, latest;
    const follow = () => {
      const next = areaOf(step.targets) || (step.fallback ? areaOf(step.fallback) : null);
      if (!sameArea(next, latest)) { latest = next; setArea(next); }
      frame = requestAnimationFrame(follow);
    };
    follow();
    return () => cancelAnimationFrame(frame);
  }, [step]);
  // A card meant for the left of its area narrows to fit there (down to 260px).
  // Without that room, the browser step's card docks at the bottom and the
  // browser's page ends above it (--first-steps-dock, app.css).
  const room = step.side === "left" && area ? Math.floor(area.left - PAD - GAP - MARGIN) : null;
  const narrowBy = room !== null && room < 360 && room >= 260 ? room : null;
  const dock = !!step.browser && room !== null && room < 260;
  // The card is placed once its size is known, and again when either changes.
  useLayoutEffect(() => {
    const node = card.current;
    if (!node) return undefined;
    const place = () => setPosition(current => {
      const size = { width: node.offsetWidth, height: node.offsetHeight };
      const next = dock ? { left: (window.innerWidth - size.width) / 2, top: window.innerHeight - size.height - MARGIN, centered: false } : placeCard(area, step.side, size);
      return current && current.centered === next.centered && Math.abs(current.left - next.left) < 0.5 && Math.abs(current.top - next.top) < 0.5 ? current : next;
    });
    place();
    const sized = new ResizeObserver(place);
    sized.observe(node);
    window.addEventListener("resize", place);
    return () => { sized.disconnect(); window.removeEventListener("resize", place); };
  }, [area, step, dock]);
  useLayoutEffect(() => {
    const node = card.current, root = document.documentElement.style;
    if (!dock || !node) return undefined;
    const reserve = () => root.setProperty("--first-steps-dock", node.offsetHeight + MARGIN * 2 + "px");
    reserve();
    const sized = new ResizeObserver(reserve);
    sized.observe(node);
    return () => { sized.disconnect(); root.removeProperty("--first-steps-dock"); };
  }, [dock]);
  // Focus goes to the step's main button once the card is placed (it's hidden until then).
  const placed = !!position, spot = position && !position.centered ? area : null;
  useEffect(() => { if (placed) primary.current?.focus(); }, [index, placed]);

  const connect = () => {
    setConnecting("Opening ChatGPT…");
    request("connectChatgpt").then(() => setConnecting("Finish connecting ChatGPT in the window that opened, then pick a task."))
      .catch(error => setConnecting(error?.message || "ChatGPT couldn't be opened. Try again in Billing."));
  };
  const unfunded = funding?.canFundUsage === false;
  // With the card beside or under the browser's page, the page stays on screen
  // (Pane.jsx hides it under dialogs); with the card over it, it hides as for any dialog.
  const besideBrowser = !!step.browser && !!spot;
  const finished = run && (run.total != null || run.error);
  return (
    <dialog ref={dialog} className="tw-first-steps" aria-labelledby="tw-first-steps-title" aria-describedby="tw-first-steps-body"
      data-beside-browser={besideBrowser ? "" : undefined} onCancel={event => { event.preventDefault(); onEnd(); }}>
      {spot
        ? <div className="tw-first-steps-spot" aria-hidden="true" style={{ left: spot.left - PAD, top: spot.top - PAD, width: spot.width + PAD * 2, height: spot.height + PAD * 2, borderRadius: step.radius }} />
        : <div className="tw-first-steps-dim" aria-hidden="true" />}
      <section ref={card} className={"tw-first-steps-card" + (step.wide ? " wide" : "")} data-step={step.id} data-placed={placed ? "true" : "false"}
        style={{ ...(position ? { left: position.left, top: position.top } : {}), ...(narrowBy ? { width: narrowBy } : {}) }}>
        <header className="tw-first-steps-head">
          {agent ? <Avatar agent={agent} size="small" /> : null}
          <span className="grow">{agent?.name || "Your agent"}</span>
          <span>{index + 1} of {STEPS.length}</span>
        </header>
        {/* The step's words are announced as they change; the inner part is
            drawn afresh for each step, which plays its entrance. */}
        <div className="tw-first-steps-text" aria-live="polite">
          <div key={step.id} className="tw-first-steps-swap">
            {index === 0 ? <p className="tw-first-steps-kicker">Welcome to your workspace{userName ? `, ${userName}` : ""}.</p> : null}
            <h2 id="tw-first-steps-title">{typeof step.title === "function" ? step.title(agent?.name || "your agent") : step.title}</h2>
            <p id="tw-first-steps-body">{step.body}</p>
          </div>
        </div>
        {step.browser ? (
          <ol className="tw-first-steps-run" aria-label={`What ${agent?.name || "your agent"} is doing in the browser`}>
            {RUN.map(({ step: part, label }) => {
              const { state = "waiting", ms = null } = run?.parts[part] || {};
              return (
                <li key={part} data-state={state}>
                  {state === "done" ? <Check size={14} aria-hidden="true" /> : state === "running" ? <LoaderCircle size={14} className="tw-spin" aria-hidden="true" /> : state === "failed" ? <TriangleAlert size={14} aria-hidden="true" /> : <i aria-hidden="true" />}
                  <span className="grow">{label}</span>
                  {ms != null ? <small>{seconds(ms)}</small> : null}
                </li>
              );
            })}
          </ol>
        ) : null}
        {step.browser && finished ? (
          <p className={"tw-first-steps-result" + (run.error ? " failed" : "")} role="status">
            {run.error ? "The page didn't load just now. Check your internet connection, then watch again."
              : `My part took ${seconds(RUN.filter(item => item.mine).reduce((sum, item) => sum + (run.parts[item.step]?.ms || 0), 0))}. The rest was wikipedia.org loading.`}
          </p>
        ) : null}
        {last && unfunded ? (
          <div className="tw-first-steps-note">
            <Gauge size={15} aria-hidden="true" />
            <span className="grow" role="status">{connecting || (funding.subscriptionAllowed ? "Connect your ChatGPT plan so I can run tasks." : "Add credits or change your plan so I can run tasks.")}</span>
            {funding.subscriptionAllowed
              ? <button type="button" className="tw-btn" onClick={connect}>Connect ChatGPT</button>
              : <button type="button" className="tw-btn" onClick={onBilling}>Add credits</button>}
          </div>
        ) : null}
        {last ? (
          <div className="tw-first-steps-prompts" role="group" aria-label="Tasks to try">
            {PROMPTS.map(({ icon: Icon, label, text }, at) => (
              <button key={label} ref={at === 0 ? primary : undefined} type="button" className="tw-first-steps-prompt" onClick={() => onTry(text)}>
                <strong><Icon size={14} aria-hidden="true" />{label}</strong>
                <span>{text}</span>
              </button>
            ))}
          </div>
        ) : null}
        <footer className="tw-first-steps-actions">
          {last ? null : <button type="button" className="tw-btn ghost" onClick={onEnd}>Skip tour</button>}
          <span className="grow" />
          {step.browser && finished ? <button type="button" className="tw-btn ghost" onClick={() => void watch(true)}>Watch again</button> : null}
          {index > 0 ? <button type="button" className="tw-btn ghost" onClick={() => setIndex(index - 1)}>Back</button> : null}
          {last
            ? <button type="button" className="tw-btn" onClick={onEnd}>I'll write my own</button>
            : <button ref={primary} type="button" className="tw-btn primary" onClick={() => setIndex(index + 1)}>Next</button>}
        </footer>
      </section>
    </dialog>
  );
}
