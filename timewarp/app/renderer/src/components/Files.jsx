import React, { Suspense, lazy, useEffect, useRef, useState } from "react";
import { ChevronRight, ExternalLink, File, FileText, Folder, FolderOpen, Image, Search, Sheet, X } from "lucide-react";
import hljs from "highlight.js/lib/common";
import { call, useEvent } from "../api.js";
import { Markdown } from "../markdown.jsx";
import { useToast } from "./common.jsx";

const PdfPreview = lazy(() => import("../previews.jsx").then(module => ({ default: module.PdfPreview })));
const SpreadsheetPreview = lazy(() => import("../previews.jsx").then(module => ({ default: module.SpreadsheetPreview })));
const CsvPreview = lazy(() => import("../previews.jsx").then(module => ({ default: module.CsvPreview })));
const DocumentPreview = lazy(() => import("../previews.jsx").then(module => ({ default: module.DocumentPreview })));

const size = bytes => bytes === null || bytes === undefined ? "" : bytes < 1024 ? bytes + " B" : bytes < 1048576 ? (bytes / 1024).toFixed(1) + " KB" : (bytes / 1048576).toFixed(1) + " MB";
function iconFor(entry) {
  if (entry.type === "dir") return <Folder size={15} />;
  if (/\.(png|jpe?g|gif|webp|bmp|ico|svg)$/i.test(entry.name)) return <Image size={15} />;
  if (/\.(xlsx|xls|csv|tsv)$/i.test(entry.name)) return <Sheet size={15} />;
  if (/\.(md|txt|docx|pdf)$/i.test(entry.name)) return <FileText size={15} />;
  return <File size={15} />;
}

function Code({ text, language }) {
  let html;
  try { html = language && hljs.getLanguage(language) ? hljs.highlight(text, { language, ignoreIllegals: true }).value : hljs.highlightAuto(text.slice(0, 200000)).value; }
  catch { html = text.replace(/[&<>]/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[character]); }
  return <pre className="tw-code-view"><code className="hljs" dangerouslySetInnerHTML={{ __html: html }} /></pre>;
}

function Preview({ file }) {
  if (file.kind === "image") return <div className="tw-preview-scroll tw-image-view"><img src={file.dataUrl} alt={file.name} /></div>;
  if (file.kind === "markdown") return <div className="tw-preview-scroll"><article className="tw-docx"><Markdown text={file.text} /></article></div>;
  if (file.kind === "text") return <div className="tw-preview-scroll"><Code text={file.text} language={file.language} /></div>;
  if (file.kind === "pdf") return <PdfPreview base64={file.base64} />;
  if (file.kind === "spreadsheet") return <SpreadsheetPreview base64={file.base64} />;
  if (file.kind === "csv") return <CsvPreview text={file.text} delimiter={file.delimiter} />;
  if (file.kind === "document") return <DocumentPreview base64={file.base64} />;
  return <div className="tw-blank" style={{ marginTop: 60 }}><p>{file.kind === "large" ? "This file is too large to preview." : "There's no preview for this kind of file."}</p></div>;
}

const baseName = file => String(file || "").split(/[\\/]/).pop();
const readJson = (key, fallback) => { try { const value = JSON.parse(localStorage.getItem(key) || "null"); return value ?? fallback; } catch { return fallback; } };
const writeJson = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} };

// Files opened from an agent's workspace, newest first (at most ten), for the
// agent page's Recent files.
export const recentFiles = agentId => readJson("tw.recentFiles." + agentId, []).filter(item => item && typeof item.path === "string");
function rememberFile(agentId, file) {
  const next = [{ path: file, openedAt: new Date().toISOString() }, ...recentFiles(agentId).filter(item => item.path !== file)].slice(0, 10);
  writeJson("tw.recentFiles." + agentId, next);
  window.dispatchEvent(new CustomEvent("tw:recent-files", { detail: { agentId } }));
}

// One folder level of the tree; open folders show their contents below them.
function Tree({ dir, depth, listings, expanded, onToggle, onOpen, onExternal }) {
  const listing = listings[dir];
  if (!listing) return <p className="tw-hint tw-tree-note" style={{ paddingLeft: 12 + depth * 16 }}>Loading…</p>;
  if (!listing.entries.length && depth === 0) return <div className="tw-blank" style={{ marginTop: 50 }}><p>This folder is empty. Files your agent creates appear here.</p></div>;
  return listing.entries.map(entry => {
    const open = entry.type === "dir" && expanded.has(entry.path);
    return (
      <React.Fragment key={entry.path}>
        <button type="button" className="tw-file-row" style={{ paddingLeft: 10 + depth * 16 }} title={entry.path} aria-expanded={entry.type === "dir" ? open : undefined}
          onClick={() => entry.type === "dir" ? onToggle(entry.path) : onOpen(entry.path)} onDoubleClick={() => entry.type === "file" && onExternal("files.open", entry.path)}>
          {entry.type === "dir" ? <ChevronRight size={14} className={"tw-tree-chevron" + (open ? " open" : "")} /> : <span className="tw-tree-spacer" />}
          {entry.type === "dir" && open ? <FolderOpen size={15} /> : iconFor(entry)}
          <span className="tw-row-title">{entry.name}</span>
          <span className="tw-hint">{entry.type === "file" ? size(entry.size) : ""}</span>
        </button>
        {open ? <Tree dir={entry.path} depth={depth + 1} listings={listings} expanded={expanded} onToggle={onToggle} onOpen={onOpen} onExternal={onExternal} /> : null}
      </React.Fragment>
    );
  });
}

// The agent's workspace as a tree, as before, with its open folders
// remembered. Opened files get closable tabs beside the tree's; `files` is
// { open: [paths], active: path | null } and onChange updates it.
// openPath: { path, at } opens that workspace file, for a file card in the chat.
export function Files({ agent, files = { open: [], active: null }, onChange, openPath = null }) {
  const expandedKey = "tw.files.expanded." + agent.id;
  const [expanded, setExpanded] = useState(() => new Set(readJson(expandedKey, [])));
  const [listings, setListings] = useState({});
  const [query, setQuery] = useState("");
  const [results, setResults] = useState(null);
  const [contents, setContents] = useState({});
  const toast = useToast();
  const latest = useRef(files);
  latest.current = files;
  const update = next => onChange?.({ open: next.open, active: next.active });
  const list = dir => call("files.list", { agentId: agent.id, path: dir }).then(value => setListings(current => ({ ...current, [dir]: value })))
    .catch(error => { if (dir) { setExpanded(current => { const next = new Set(current); next.delete(dir); writeJson(expandedKey, [...next]); return next; }); } else toast(error, "error"); });
  useEffect(() => { setListings({}); void list(""); for (const dir of expanded) void list(dir); }, [agent.id]);
  // Files the agent creates or changes show up without reopening the folder.
  const refresh = useRef(null);
  useEvent("conversation.event", ({ method, params }) => {
    const changed = method === "turn/completed" || (method === "item/completed" && ["fileChange", "commandExecution"].includes(params?.item?.type));
    if (!changed) return;
    clearTimeout(refresh.current);
    refresh.current = setTimeout(() => { void list(""); for (const dir of expanded) void list(dir); }, 400);
  });
  useEffect(() => () => clearTimeout(refresh.current), []);
  useEffect(() => {
    if (!query.trim()) { setResults(null); return; }
    const timer = setTimeout(() => call("files.search", { agentId: agent.id, query }).then(setResults).catch(() => {}), 200);
    return () => clearTimeout(timer);
  }, [agent.id, query]);
  const toggle = dir => setExpanded(current => {
    const next = new Set(current);
    if (next.has(dir)) next.delete(dir); else { next.add(dir); void list(dir); }
    writeJson(expandedKey, [...next]);
    return next;
  });
  const load = file => {
    setContents(current => ({ ...current, [file]: { loading: true, name: baseName(file), path: file } }));
    call("files.read", { agentId: agent.id, path: file }).then(value => setContents(current => ({ ...current, [file]: value })))
      .catch(error => { toast(error, "error"); setContents(current => { const next = { ...current }; delete next[file]; return next; }); close(file); });
  };
  const open = file => {
    const current = latest.current;
    update({ open: current.open.includes(file) ? current.open : [...current.open, file], active: file });
    rememberFile(agent.id, file);
    load(file);
  };
  const close = file => {
    const current = latest.current, index = current.open.indexOf(file);
    if (index < 0) return;
    const rest = current.open.filter(item => item !== file);
    update({ open: rest, active: current.active === file ? rest[Math.min(index, rest.length - 1)] ?? null : current.active });
  };
  const external = (method, file) => call(method, { agentId: agent.id, path: file }).catch(error => toast(error, "error"));
  useEffect(() => { if (openPath?.path) open(openPath.path); }, [openPath?.at]);
  // An open file whose contents aren't loaded yet (after reopening the chat) loads when shown.
  useEffect(() => { if (files.active && !contents[files.active]) load(files.active); }, [files.active]);
  const file = files.active ? contents[files.active] : null;
  return (
    <div className="tw-files">
      {files.open.length ? (
        <div className="tw-file-tabs" role="tablist" aria-label="Open files">
          <button type="button" role="tab" className="tw-file-tab" aria-selected={!files.active} onClick={() => update({ open: files.open, active: null })}><Folder size={13} /><span>Files</span></button>
          {files.open.map(path => (
            <div key={path} role="tab" tabIndex={0} className="tw-file-tab" aria-selected={files.active === path} title={path}
              onClick={() => update({ open: files.open, active: path })} onKeyDown={event => { if (event.key === "Enter") update({ open: files.open, active: path }); }}
              onAuxClick={event => { if (event.button === 1) close(path); }}>
              {iconFor({ type: "file", name: baseName(path) })}<span>{baseName(path)}</span>
              <button type="button" aria-label={"Close " + baseName(path)} onClick={event => { event.stopPropagation(); close(path); }}><X size={12} /></button>
            </div>
          ))}
        </div>
      ) : null}
      {files.active ? (
        <>
          <div className="tw-files-bar">
            <strong className="tw-files-title" title={files.active}>{files.active}</strong>
            <span className="tw-hint">{size(file?.size)}</span>
            <button type="button" className="tw-icon-button" title="Open in its app" aria-label="Open in its app" onClick={() => external("files.open", files.active)}><ExternalLink size={15} /></button>
            <button type="button" className="tw-icon-button" title="Show in folder" aria-label="Show in folder" onClick={() => external("files.reveal", files.active)}><FolderOpen size={15} /></button>
          </div>
          {!file || file.loading ? <p className="tw-hint" style={{ padding: 16 }}>Opening…</p> : <Suspense fallback={<p className="tw-hint" style={{ padding: 16 }}>Loading preview…</p>}><Preview file={file} /></Suspense>}
        </>
      ) : (
        <>
          <div className="tw-files-bar">
            <label className="tw-search tw-files-search"><Search size={14} /><input className="tw-input" type="search" placeholder="Search files..." value={query} onChange={event => setQuery(event.target.value)} aria-label="Search files" /></label>
          </div>
          <div className="tw-preview-scroll">
            {results ? (
              results.length ? (
                <div className="tw-file-list">
                  {results.map(entry => (
                    <button key={entry.path} type="button" className="tw-file-row" title={entry.path} onClick={() => {
                      if (entry.type === "file") { open(entry.path); return; }
                      // A folder found by search opens in the tree, with the folders above it.
                      const parts = entry.path.split("/");
                      setExpanded(current => { const next = new Set(current); parts.forEach((_, index) => { const dir = parts.slice(0, index + 1).join("/"); next.add(dir); void list(dir); }); writeJson(expandedKey, [...next]); return next; });
                      setQuery("");
                    }}>
                      {iconFor(entry)}<span className="tw-row-title">{entry.path}</span>
                    </button>
                  ))}
                </div>
              ) : <div className="tw-blank" style={{ marginTop: 50 }}><p>No files match.</p></div>
            ) : <div className="tw-file-list tw-tree"><Tree dir="" depth={0} listings={listings} expanded={expanded} onToggle={toggle} onOpen={open} onExternal={external} /></div>}
          </div>
        </>
      )}
    </div>
  );
}
