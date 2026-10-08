// In-app previews for PDFs, spreadsheets, CSV and Word documents. Each
// library loads only when such a file is opened.
import React, { useEffect, useRef, useState } from "react";

const bytes = base64 => Uint8Array.from(atob(base64), character => character.charCodeAt(0));

export function PdfPreview({ base64 }) {
  const host = useRef(null);
  const [state, setState] = useState({ pages: 0, error: "" });
  useEffect(() => {
    let cancelled = false, task = null;
    (async () => {
      const pdfjs = await import("pdfjs-dist/build/pdf.min.mjs");
      pdfjs.GlobalWorkerOptions.workerSrc = "./pdf.worker.min.mjs";
      task = pdfjs.getDocument({ data: bytes(base64), isEvalSupported: false });
      const pdf = await task.promise;
      if (cancelled) return;
      setState({ pages: pdf.numPages, error: "" });
      const width = Math.max(320, (host.current?.clientWidth || 640) - 24);
      for (let number = 1; number <= Math.min(pdf.numPages, 60) && !cancelled; number++) {
        const page = await pdf.getPage(number);
        const base = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: (width / base.width) * window.devicePixelRatio });
        const canvas = document.createElement("canvas");
        canvas.width = viewport.width; canvas.height = viewport.height;
        canvas.style.width = width + "px";
        canvas.className = "tw-pdf-page";
        host.current?.append(canvas);
        await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
      }
    })().catch(error => { if (!cancelled) setState({ pages: 0, error: error.message || "This PDF can't be shown." }); });
    return () => { cancelled = true; task?.destroy?.(); if (host.current) host.current.replaceChildren(); };
  }, [base64]);
  return (
    <div className="tw-preview-scroll">
      {state.error ? <p className="tw-alert">{state.error}</p> : null}
      {state.pages > 60 ? <p className="tw-hint">Showing the first 60 of {state.pages} pages.</p> : null}
      <div ref={host} className="tw-pdf" />
    </div>
  );
}

function Table({ rows }) {
  const width = Math.max(1, ...rows.map(row => row.length));
  return (
    <div className="tw-preview-scroll">
      <table className="tw-sheet">
        <tbody>{rows.slice(0, 1000).map((row, index) => <tr key={index}><th>{index + 1}</th>{Array.from({ length: width }, (_, cell) => <td key={cell}>{row[cell] ?? ""}</td>)}</tr>)}</tbody>
      </table>
      {rows.length > 1000 ? <p className="tw-hint">Showing the first 1,000 of {rows.length} rows.</p> : null}
    </div>
  );
}

export function parseCsv(text, delimiter = ",") {
  const rows = [];
  let row = [], field = "", quoted = false;
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') { field += '"'; index++; }
      else if (character === '"') quoted = false;
      else field += character;
    } else if (character === '"' && field === "") quoted = true;
    else if (character === delimiter) { row.push(field); field = ""; }
    else if (character === "\n" || character === "\r") {
      if (character === "\r" && text[index + 1] === "\n") index++;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += character;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

export function CsvPreview({ text, delimiter }) { return <Table rows={parseCsv(text, delimiter)} />; }

function cellText(value) {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toLocaleDateString();
  if (typeof value === "object") return value.text ?? value.result ?? (Array.isArray(value.richText) ? value.richText.map(part => part.text).join("") : value.hyperlink ?? "");
  return String(value);
}

export function SpreadsheetPreview({ base64 }) {
  const [sheets, setSheets] = useState(null);
  const [active, setActive] = useState(0);
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const module = await import("exceljs/dist/exceljs.min.js");
      const ExcelJS = module.default || module;
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(bytes(base64).buffer);
      const result = workbook.worksheets.map(sheet => {
        const rows = [];
        sheet.eachRow({ includeEmpty: true }, (row, number) => { if (number > 2000) return; rows[number - 1] = (row.values || []).slice(1).map(cellText); });
        return { name: sheet.name, rows: Array.from(rows, row => row || []) };
      });
      if (!cancelled) setSheets(result);
    })().catch(failure => { if (!cancelled) setError(failure.message || "This spreadsheet can't be shown."); });
    return () => { cancelled = true; };
  }, [base64]);
  if (error) return <p className="tw-alert">{error}</p>;
  if (!sheets) return <p className="tw-hint">Loading spreadsheet…</p>;
  return (
    <>
      {sheets.length > 1 ? <div className="tw-segmented" style={{ margin: "8px 12px" }}>{sheets.map((sheet, index) => <button key={sheet.name} type="button" aria-pressed={index === active} onClick={() => setActive(index)}>{sheet.name}</button>)}</div> : null}
      <Table rows={sheets[active]?.rows || []} />
    </>
  );
}

// Word documents: paragraphs, headings, lists, bold/italic runs and tables
// from the document XML, rendered as React elements (never as raw HTML).
const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
function runs(paragraph) {
  return [...paragraph.getElementsByTagNameNS(W, "r")].map((run, index) => {
    const text = [...run.childNodes].map(node => node.localName === "t" ? node.textContent : node.localName === "tab" ? "\t" : node.localName === "br" ? "\n" : "").join("");
    const props = run.getElementsByTagNameNS(W, "rPr")[0];
    const bold = !!props?.getElementsByTagNameNS(W, "b")[0], italic = !!props?.getElementsByTagNameNS(W, "i")[0];
    let node = text;
    if (bold) node = <strong>{node}</strong>;
    if (italic) node = <em>{node}</em>;
    return <React.Fragment key={index}>{node}</React.Fragment>;
  });
}
export function parseDocx(xml) {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const body = doc.getElementsByTagNameNS(W, "body")[0];
  const blocks = [];
  for (const child of body ? [...body.children] : []) {
    if (child.localName === "p") {
      const style = child.getElementsByTagNameNS(W, "pStyle")[0]?.getAttributeNS(W, "val") || child.getElementsByTagNameNS(W, "pStyle")[0]?.getAttribute("w:val") || "";
      const list = !!child.getElementsByTagNameNS(W, "numPr")[0];
      const heading = /^Heading(\d)$/i.exec(style)?.[1] || (/^Title$/i.test(style) ? "1" : null);
      blocks.push({ kind: heading ? "heading" : list ? "item" : "paragraph", level: heading ? Number(heading) : null, content: runs(child) });
    } else if (child.localName === "tbl") {
      blocks.push({ kind: "table", rows: [...child.getElementsByTagNameNS(W, "tr")].map(row => [...row.getElementsByTagNameNS(W, "tc")].map(cell => [...cell.getElementsByTagNameNS(W, "p")].map(p => p.textContent).join("\n"))) });
    }
  }
  return blocks;
}
export function DocumentPreview({ base64 }) {
  const [blocks, setBlocks] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const JSZip = (await import("jszip")).default;
      const zip = await JSZip.loadAsync(bytes(base64));
      const xml = await zip.file("word/document.xml")?.async("string");
      if (!xml) throw new Error("This document has no readable text.");
      if (!cancelled) setBlocks(parseDocx(xml));
    })().catch(failure => { if (!cancelled) setError(failure.message || "This document can't be shown."); });
    return () => { cancelled = true; };
  }, [base64]);
  if (error) return <p className="tw-alert">{error}</p>;
  if (!blocks) return <p className="tw-hint">Loading document…</p>;
  return (
    <div className="tw-preview-scroll"><article className="tw-docx tw-markdown">
      {blocks.map((block, index) => {
        if (block.kind === "heading") return React.createElement("h" + Math.min(4, block.level), { key: index }, block.content);
        if (block.kind === "item") return <ul key={index}><li>{block.content}</li></ul>;
        if (block.kind === "table") return <table key={index}><tbody>{block.rows.map((row, r) => <tr key={r}>{row.map((cell, c) => <td key={c}>{cell}</td>)}</tr>)}</tbody></table>;
        return <p key={index}>{block.content}</p>;
      })}
    </article></div>
  );
}
