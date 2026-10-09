import React, { useEffect, useMemo, useState } from "react";
import { call, request } from "../api.js";
import { AgentPicker, Composer, FundingBanner, ToolsPicker } from "./Composer.jsx";
import { Dialog, useToast } from "./common.jsx";
import { ImportKnowledge } from "./Knowledge.jsx";

const HEADINGS = ["Let's knock something off your to-do list", "Today's forecast: things getting done", "Good to see you"];
const SOURCES = { "codex-chatgpt": "ChatGPT/Codex", "claude-code": "Claude" };
const readDismissed = () => { try { return new Set(JSON.parse(localStorage.getItem("tw.dismissed") || "[]")); } catch { return new Set(); } };

function plural(count, word) { return `${count} ${word}${count === 1 ? "" : "s"}`; }

const Icon = ({ name }) => <img src={`./onboarding-icons/${name}.svg`} alt="" />;

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
    const skills = items.find(item => item.category === "skills")?.names.length || 0, memory = items.find(item => item.category === "memory")?.names.length || 0;
    return { total: skills + memory, text: [skills ? plural(skills, "skill") : "", memory ? plural(memory, "memory file") : ""].filter(Boolean).join(", ") };
  };
  const suggestions = [];
  if (funding?.subscriptionAllowed && funding.source !== "chatgpt") suggestions.push({
    id: "connect-chatgpt", icon: <Icon name="chatgpt" />, title: "Connect ChatGPT to use Timewarp for free", action: "Connect",
    run: () => request("connectChatgpt").then(() => toast("Finish connecting ChatGPT in your browser.")).catch(error => toast(error, "error")),
  });
  for (const source of Object.keys(SOURCES)) {
    const count = counts(source);
    if (count.total) suggestions.push({ id: "import-" + source, icon: <Icon name={source === "claude-code" ? "claude" : "chatgpt"} />, title: `Import your ${SOURCES[source]} setup`, meta: count.text, action: "Import", run: () => setImporting(source) });
  }
  suggestions.push({ id: "browser-profiles", icon: <span className="tw-icons"><Icon name="edge" /><Icon name="chrome" /></span>, title: "Browser profiles", meta: "Manage profiles on this device", action: "Manage", run: () => onSettings("browser") });
  const visible = suggestions.filter(item => !dismissed.has(item.id));
  const agent = agents.find(item => item.id === agentId) || agents[0];
  return (
    <div className="tw-home">
      <div className="tw-home-inner">
        <h1>{heading}</h1>
        <Composer variant="large" autoFocusKey="home" placeholder="Tell me what you want to get done..." disabled={!agent}
          models={models} onModel={onModel} onSend={message => onStart(agent.id, message)}
          banner={<FundingBanner funding={funding} onOptions={() => onSettings("billing")} />}
          tools={agent ? <><ToolsPicker agentId={agent.id} onBrowse={() => onSettings("tools")} /><AgentPicker agents={agents} value={agent.id} onChange={onAgent} onNewAgent={onNewAgent} /></> : null} />
        {visible.length ? (
          <div className="tw-suggestions">
            {visible.map(item => (
              <div key={item.id} className="tw-suggestion" role="button" tabIndex={0} onClick={item.run} onKeyDown={event => { if (event.key === "Enter") item.run(); }}>
                {item.icon}
                <strong>{item.title}</strong>
                {item.meta ? <span className="meta">{item.meta}</span> : null}
                <span className="grow" />
                <span className="actions" onClick={event => event.stopPropagation()}>
                  <button type="button" className="tw-btn ghost" onClick={() => dismiss(item.id)}>Not now</button>
                  <button type="button" className="tw-btn" onClick={item.run}>{item.action}</button>
                </span>
              </div>
            ))}
          </div>
        ) : null}
      </div>
      <Dialog open={!!importing} onClose={() => setImporting(null)} title={importing ? `Import your ${SOURCES[importing]} setup` : ""}
        description="Choose the skills and memory files to copy into Timewarp. The other app's files aren't changed.">
        {importing ? <ImportKnowledge source={importing} onImported={() => { setImporting(null); dismiss("import-" + importing); }} /> : null}
      </Dialog>
    </div>
  );
}
