import React, { useEffect, useMemo, useState } from "react";
import { call, request } from "../api.js";
import { AgentPicker, Composer, FundingBanner, ReconnectBanner, ToolsPicker } from "./Composer.jsx";
import { Dialog, useToast } from "./common.jsx";
import { ImportKnowledge } from "./Knowledge.jsx";

const HEADINGS = ["Let's knock something off your to-do list", "Today's forecast: things getting done", "Good to see you", "Push me to your limits",
  "Time to carpe the diem", "Whatever you're thinking, go bigger", "Ready when you are, boss", "Let's get started", "Tell me what you need done"];
// Home offers ChatGPT/Codex and Claude setups, as the previous app did; Cursor is offered during setup.
const SOURCES = { "codex-chatgpt": "ChatGPT/Codex", "claude-code": "Claude" };
const readDismissed = () => { try { return new Set(JSON.parse(localStorage.getItem("tw.dismissed") || "[]")); } catch { return new Set(); } };

function plural(count, word) { return `${count} ${word}${count === 1 ? "" : "s"}`; }

// ChatGPT and Claude glyphs take their brand tint; the browsers are drawn in colour.
const TINTS = { chatgpt: "var(--muted)", claude: "#d97757", cursor: "var(--muted)" };
const Icon = ({ name }) => TINTS[name]
  ? <span className="tw-glyph" style={{ "--glyph": `url(./onboarding-icons/${name}.svg)`, color: TINTS[name] }} aria-hidden="true" />
  : <img src={`./onboarding-icons/${name}.svg`} alt="" />;

export function Home({ agents, agentId, onAgent, models, onModel, funding, onStart, onNewAgent, onSettings }) {
  const heading = useMemo(() => HEADINGS[Math.floor(Math.random() * HEADINGS.length)], []);
  const [found, setFound] = useState(null);
  const [dismissed, setDismissed] = useState(readDismissed);
  const [importing, setImporting] = useState(null);
  const toast = useToast();
  useEffect(() => { call("knowledge.detect").then(value => setFound(value.items || [])).catch(() => setFound([])); }, []);
  const dismiss = id => setDismissed(current => {
    const next = new Set(current).add(id);
    try { localStorage.setItem("tw.dismissed", JSON.stringify([...next])); } catch {}
    return next;
  });
  const counts = source => {
    const items = (found || []).filter(item => item.source === source);
    const size = category => items.find(item => item.category === category)?.names.length || 0;
    const skills = size("skills"), memory = size("memory"), servers = size("mcp");
    return { total: skills + memory + servers, text: [skills ? plural(skills, "skill") : "", memory ? plural(memory, "memory file") : "", servers ? plural(servers, "MCP") : ""].filter(Boolean).join(", ") };
  };
  const suggestions = [];
  if (funding?.subscriptionAllowed && funding.source !== "chatgpt") suggestions.push({
    id: "connect-chatgpt", icon: <Icon name="chatgpt" />, title: "Connect ChatGPT to use Timewarp for free", action: "Connect",
    run: () => request("connectChatgpt").then(() => toast("Finish connecting ChatGPT in your browser.")).catch(error => toast(error, "error")),
  });
  for (const source of Object.keys(SOURCES)) {
    const count = counts(source);
    if (count.total) suggestions.push({ id: "import-" + source, icon: <Icon name={{ "claude-code": "claude", cursor: "cursor" }[source] || "chatgpt"} />, title: `Import your ${SOURCES[source]} setup`, meta: count.text, action: "Import", run: () => setImporting(source) });
  }
  suggestions.push({ id: "browser-profiles", icon: <span className="tw-icons"><Icon name="chrome-color" /><Icon name="edge-color" /></span>, title: "Browser profiles", meta: "Manage profiles on this device", action: "Manage", run: () => onSettings("browser") });
  const visible = suggestions.filter(item => !dismissed.has(item.id));
  const agent = agents.find(item => item.id === agentId) || agents[0];
  return (
    <div className="tw-home">
      <div className="tw-home-inner">
        <h1>{heading}</h1>
        <Composer variant="large" autoFocusKey="home" placeholder="Tell me what you want to get done..." disabled={!agent}
          models={models} onModel={onModel} onSend={message => onStart(agent.id, message)}
          banner={<><ReconnectBanner /><FundingBanner funding={funding} onOptions={() => onSettings("billing")} /></>}
          tools={agent ? <><ToolsPicker agentId={agent.id} onBrowse={() => onSettings("tools")} /><AgentPicker agents={agents} value={agent.id} onChange={onAgent} onNewAgent={onNewAgent} /></> : null} />
        {visible.length ? (
          <div className="tw-suggestions">
            {visible.map(item => (
              <div key={item.id} className="tw-suggestion" role="button" tabIndex={0} aria-label={item.action + ": " + item.title} onClick={item.run} onKeyDown={event => { if (event.key === "Enter") item.run(); }}>
                {item.icon}
                <strong>{item.title}</strong>
                {item.meta ? <span className="meta">{item.meta}</span> : null}
                <span className="grow" />
                <span className="actions" onClick={event => event.stopPropagation()}>
                  <button type="button" className="tw-btn ghost" onClick={() => dismiss(item.id)}>Not now</button>
                  <button type="button" className="tw-btn accent" onClick={item.run}>{item.action}</button>
                </span>
              </div>
            ))}
          </div>
        ) : null}
      </div>
      <Dialog open={!!importing} onClose={() => setImporting(null)} title={importing ? `Import your ${SOURCES[importing]} setup` : ""}
        description="Choose the skills, memory files and MCP servers to bring into Timewarp. The other app's files aren't changed.">
        {importing ? <ImportKnowledge source={importing} onImported={() => { setImporting(null); dismiss("import-" + importing); }} /> : null}
      </Dialog>
    </div>
  );
}
