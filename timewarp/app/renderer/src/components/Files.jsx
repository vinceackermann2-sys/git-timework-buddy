import React, { Suspense, lazy, useEffect, useRef, useState } from "react";
import { ArrowLeft, ExternalLink, File, FileText, Folder, FolderOpen, Image, Search, Sheet } from "lucide-react";
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

export function Files({ agent }) {
  const [dir, setDir] = useState("");
  const [listing, setListing] = useState(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState(null);
  const [file, setFile] = useState(null);
  const toast = useToast();
  useEffect(() => { setListing(null); call("files.list", { agentId: agent.id, path: dir }).then(setListing).catch(error => toast(error, "error")); }, [agent.id, dir]);
  // Files the agent creates or changes show up without reopening the folder.
  const refresh = useRef(null);
  useEvent("conversation.event", ({ method, params }) => {
    const changed = method === "turn/completed" || (method === "item/completed" && ["fileChange", "commandExecution"].includes(params?.item?.type));
    if (!changed) return;
    clearTimeout(refresh.current);
    refresh.current = setTimeout(() => call("files.list", { agentId: agent.id, path: dir }).then(setListing).catch(() => {}), 400);
  });
  useEffect(() => () => clearTimeout(refresh.current), []);
  useEffect(() => {
    if (!query.trim()) { setResults(null); return; }
    const timer = setTimeout(() => call("files.search", { agentId: agent.id, query }).then(setResults).catch(() => {}), 200);
    return () => clearTimeout(timer);
  }, [agent.id, query]);
  const open = entry => {
    if (entry.type === "dir") { setDir(entry.path); setQuery(""); return; }
    setFile({ loading: true, name: entry.name, path: entry.path });
    call("files.read", { agentId: agent.id, path: entry.path }).then(setFile).catch(error => { toast(error, "error"); setFile(null); });
  };
  const external = (method, path) => call(method, { agentId: agent.id, path }).catch(error => toast(error, "error"));

  if (file) {
    return (
      <div className="tw-files">
        <div className="tw-files-bar">
          <button type="button" className="tw-icon-button" aria-label="Back to files" onClick={() => setFile(null)}><ArrowLeft size={16} /></button>
          <strong className="tw-files-title" title={file.path}>{file.name}</strong>
          <span className="tw-hint">{size(file.size)}</span>
          <button type="button" className="tw-icon-button" title="Open in its app" aria-label="Open in its app" onClick={() => external("files.open", file.path)}><ExternalLink size={15} /></button>
          <button type="button" className="tw-icon-button" title="Show in folder" aria-label="Show in folder" onClick={() => external("files.reveal", file.path)}><FolderOpen size={15} /></button>
        </div>
        {file.loading ? <p className="tw-hint" style={{ padding: 16 }}>Opening…</p> : <Suspense fallback={<p className="tw-hint" style={{ padding: 16 }}>Loading preview…</p>}><Preview file={file} /></Suspense>}
      </div>
    );
  }
  const crumbs = dir ? dir.split("/") : [];
  const entries = results || listing?.entries || [];
  return (
    <div className="tw-files">
      <div className="tw-files-bar">
        <nav className="tw-crumbs" aria-label="Folder">
          <button type="button" onClick={() => setDir("")}>{agent.name}</button>
          {crumbs.map((part, index) => <React.Fragment key={index}><span>/</span><button type="button" onClick={() => setDir(crumbs.slice(0, index + 1).join("/"))}>{part}</button></React.Fragment>)}
        </nav>
        <label className="tw-search" style={{ width: 180 }}><Search size={14} /><input className="tw-input" type="search" placeholder="Find files" value={query} onChange={event => setQuery(event.target.value)} aria-label="Find files" /></label>
      </div>
      <div className="tw-preview-scroll">
        {listing === null && !results ? <p className="tw-hint" style={{ padding: 16 }}>Loading…</p> : null}
        {listing && !entries.length ? <div className="tw-blank" style={{ marginTop: 50 }}><p>{results ? "No files match." : "This folder is empty. Files your agent creates appear here."}</p></div> : null}
        <div className="tw-file-list">
          {entries.map(entry => (
            <button key={entry.path} type="button" className="tw-file-row" onClick={() => open(entry)} onDoubleClick={() => entry.type === "file" && external("files.open", entry.path)} title={entry.path}>
              {iconFor(entry)}
              <span className="tw-row-title">{results ? entry.path : entry.name}</span>
              <span className="tw-hint">{entry.type === "file" ? size(entry.size) : ""}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
