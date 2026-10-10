import React, { useEffect, useState } from "react";
import {
  ArrowLeft, Bot, Camera, Clock, Compass, Download, Eye, FileImage, FilePenLine, FileText, FolderSearch, GitBranch, Globe, Keyboard, List,
  MessageSquareText, Mouse, MousePointer2, MousePointerClick, Move, RefreshCcw, Scroll, Search, SquareTerminal, Timer, Type, Upload, Wrench, X,
} from "lucide-react";
import { call, useEvent } from "../api.js";
import { titleCase } from "../turns.mjs";

// The previous app's tool icons, by the names toolRow() uses.
const ICONS = {
  arrowLeft: ArrowLeft, bot: Bot, camera: Camera, clock: Clock, compass: Compass, download: Download, eye: Eye, fileImage: FileImage,
  filePenLine: FilePenLine, fileText: FileText, folderSearch: FolderSearch, gitBranch: GitBranch, globe: Globe, keyboard: Keyboard, list: List,
  messageSquareText: MessageSquareText, mouse: Mouse, mousePointer2: MousePointer2, mousePointerClick: MousePointerClick, move: Move,
  refreshCcw: RefreshCcw, scroll: Scroll, search: Search, squareTerminal: SquareTerminal, timer: Timer, type: Type, upload: Upload, wrench: Wrench, x: X,
};

// Connected apps' logos and names (Composio), loaded once and kept fresh.
let apps = null, loading = null;
function useApps() {
  const [value, setValue] = useState(apps);
  const load = () => {
    loading = call("integrations.list", {}).then(result => {
      apps = new Map((result?.items || []).map(item => [String(item.id).replace(/^composio-/, ""), { name: item.displayName, icon: /^https:\/\//.test(item.iconUrl || "") ? item.iconUrl : null }]));
      return apps;
    }).catch(() => apps || new Map());
    return loading;
  };
  useEffect(() => { let live = true; void (loading || load()).then(map => { if (live) setValue(map); }); return () => { live = false; }; }, []);
  useEvent("integrations.changed", () => void load().then(setValue));
  return value || new Map();
}

// The site's own icon, never a third-party favicon service.
function PageIcon({ url, fallback: Fallback }) {
  const [failed, setFailed] = useState(false);
  let origin = null;
  try { origin = new URL(url).origin; } catch {}
  if (!origin || failed) return <Fallback className="tw-tool-icon" size={14} aria-hidden="true" />;
  return <img className="tw-tool-icon" src={origin + "/favicon.ico"} alt="" referrerPolicy="no-referrer" onError={() => setFailed(true)} />;
}

// One tool on one line: icon, title and a detail badge, as in the previous
// app's agent thread. No outputs or diffs.
export function ToolRow({ tool, apps = new Map() }) {
  const app = tool.app ? apps.get(tool.app) : null;
  // A connected app without a known logo reads "Used Gmail", with the action as the badge.
  const unnamed = tool.app && !app?.icon;
  const title = unnamed ? `Used ${app?.name || titleCase(tool.app)}` : tool.title;
  const detail = unnamed ? tool.title : tool.detail;
  const Icon = ICONS[tool.icon] || Wrench;
  return (
    <div className="tw-tool-row">
      {app?.icon ? <img className="tw-tool-icon" src={app.icon} alt="" /> : tool.pageUrl ? <PageIcon url={tool.pageUrl} fallback={Icon} /> : <Icon className="tw-tool-icon" size={14} aria-hidden="true" />}
      <span className="tw-tool-text">
        {title ? <span className={detail ? "tw-tool-title" : "tw-tool-title grow"}>{title}</span> : null}
        {detail ? <span className="tw-badge" title={detail}><span>{detail}</span></span> : null}
      </span>
    </div>
  );
}

// A run of consecutive tools.
export function ToolGroup({ entries }) {
  const apps = useApps();
  return <div className="tw-tool-group">{entries.map(entry => <ToolRow key={entry.id} tool={entry.tool} apps={apps} />)}</div>;
}
