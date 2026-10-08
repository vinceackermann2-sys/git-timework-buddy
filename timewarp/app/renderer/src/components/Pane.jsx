import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Globe, Plus, RotateCw, X } from "lucide-react";
import { call, useEvent } from "../api.js";
import { Avatar, useToast } from "./common.jsx";

const host = url => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url || ""; } };

// The site's own icon, never a third-party favicon service; a letter otherwise.
function SiteIcon({ url }) {
  const [failed, setFailed] = useState(false);
  let origin = null;
  try { origin = new URL(url).origin; } catch {}
  if (failed || !origin) return <span className="tw-site-letter">{(host(url)[0] || "?").toUpperCase()}</span>;
  return <img src={origin + "/favicon.ico"} alt="" width="28" height="28" onError={() => setFailed(true)} />;
}

// Native browser views sit above the page, so they hide while a dialog or
// menu is open and come back when it closes.
function useOverlayOpen() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const check = () => setOpen(!!document.querySelector("dialog[open], .tw-menu, .timewarp-org-gate"));
    check();
    const observer = new MutationObserver(check);
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["open"] });
    return () => observer.disconnect();
  }, []);
  return open;
}

function Home({ conversation, agent, onOpen }) {
  const [recent, setRecent] = useState([]);
  const toast = useToast();
  useEffect(() => { call("browser.recent", { conversationId: conversation.id }).then(setRecent).catch(() => {}); }, [conversation.id]);
  return (
    <div className="tw-pane-home">
      <section>
        <h2>Tools</h2>
        <div className="tw-pane-cards">
          <button type="button" className="tw-pane-card" onClick={() => call("agents.openWorkspace", { id: agent.id }).catch(error => toast(error, "error"))}><Avatar agent={agent} /><span>Agent files</span></button>
          <button type="button" className="tw-pane-card" onClick={() => onOpen("https://duckduckgo.com/")}><Globe size={22} /><span>Search the web</span></button>
        </div>
      </section>
      {recent.length ? (
        <section>
          <h2>Recommended</h2>
          <div className="tw-pane-cards">
            {recent.map(site => (
              <button key={site.url} type="button" className="tw-pane-card" title={site.url} onClick={() => onOpen(site.url)}>
                <SiteIcon url={site.url} />
                <span>{site.title || host(site.url)}</span>
              </button>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

export function Pane({ conversation, agent, onClose }) {
  const [state, setState] = useState({ tabs: [], active: null });
  const [address, setAddress] = useState("");
  const [editing, setEditing] = useState(false);
  const content = useRef(null);
  const overlay = useOverlayOpen();
  const toast = useToast();
  const id = conversation.id;
  const active = state.tabs.find(tab => tab.id === state.active) || null;
  const run = useCallback((method, input = {}) => call(method, { conversationId: id, ...input }).then(value => { if (value?.tabs) setState(value); return value; }).catch(error => toast(error, "error")), [id, toast]);

  useEffect(() => {
    run("browser.show").then(value => { if (value && !value.tabs.length) void run("browser.newTab"); });
    return () => { void call("browser.bounds", { rect: null }); };
  }, [id]);
  useEvent("browser.state", value => { if (value.conversationId === id) setState(value); });
  useEffect(() => { if (!editing) setAddress(active?.kind === "web" ? active.url : ""); }, [active?.url, active?.kind, editing]);

  // Keep the native page view on top of the content area.
  useLayoutEffect(() => {
    const node = content.current;
    if (!node) return;
    const send = () => {
      const rect = node.getBoundingClientRect();
      void call("browser.bounds", { rect: { x: rect.left, y: rect.top, width: rect.width, height: rect.height, visible: active?.kind === "web" && !overlay } });
    };
    send();
    const observer = new ResizeObserver(send);
    observer.observe(node);
    window.addEventListener("resize", send);
    return () => { observer.disconnect(); window.removeEventListener("resize", send); };
  }, [active?.id, active?.kind, overlay]);

  const open = url => (active ? run("browser.navigate", { tabId: active.id, url }) : run("browser.newTab", { url }));
  return (
    <aside className="tw-pane" aria-label="Browser">
      <div className="tw-pane-tabs" role="tablist">
        {state.tabs.map(tab => (
          <div key={tab.id} role="tab" aria-selected={tab.id === state.active} className="tw-pane-tab" onClick={() => run("browser.activate", { tabId: tab.id })} title={tab.url || "New tab"}>
            {tab.favicon ? <img src={tab.favicon} alt="" width="14" height="14" /> : <Globe size={13} />}
            <span>{tab.kind === "home" ? "New tab" : tab.title || host(tab.url)}</span>
            <button type="button" aria-label="Close tab" onClick={event => { event.stopPropagation(); void run("browser.close", { tabId: tab.id }); }}><X size={12} /></button>
          </div>
        ))}
        <button type="button" className="tw-icon-button" style={{ width: 28, height: 28 }} aria-label="New tab" title="New tab" onClick={() => run("browser.newTab")}><Plus size={15} /></button>
        <span style={{ flex: 1 }} />
        <button type="button" className="tw-icon-button" style={{ width: 28, height: 28 }} aria-label="Close browser" title="Close browser" onClick={onClose}><X size={15} /></button>
      </div>
      <form className="tw-pane-toolbar" onSubmit={event => { event.preventDefault(); setEditing(false); if (address.trim()) void open(address.trim()); }}>
        <button type="button" className="tw-icon-button" aria-label="Back" disabled={!active?.canGoBack} onClick={() => run("browser.back", { tabId: active.id })}><ArrowLeft size={16} /></button>
        <button type="button" className="tw-icon-button" aria-label="Forward" disabled={!active?.canGoForward} onClick={() => run("browser.forward", { tabId: active.id })}><ArrowRight size={16} /></button>
        <button type="button" className="tw-icon-button" aria-label={active?.loading ? "Stop" : "Reload"} disabled={active?.kind !== "web"} onClick={() => run(active?.loading ? "browser.stop" : "browser.reload", { tabId: active.id })}>{active?.loading ? <X size={16} /> : <RotateCw size={15} />}</button>
        <input className="tw-input tw-address" value={address} placeholder="Search or enter an address" aria-label="Address"
          onFocus={event => { setEditing(true); event.target.select(); }} onBlur={() => setEditing(false)} onChange={event => setAddress(event.target.value)} />
        {active?.agent ? <span className="tw-pane-agent" title={active.agent.action}><Avatar agent={active.agent} size="small" />{active.agent.action}</span> : null}
      </form>
      <div className="tw-pane-content" ref={content}>
        {!active || active.kind === "home" ? <Home conversation={conversation} agent={agent} onOpen={open} /> : null}
      </div>
    </aside>
  );
}
