// Chat cards: the tags an agent writes in a message (see
// app/main/widget-instructions.cjs) taken out of the Markdown. The Markdown
// keeps a placeholder for each card, so cards can sit in a paragraph, a list
// item or a table cell. Pure functions: no DOM, no React. Nothing here is
// ever turned into HTML; the interface draws each card itself.

export const OPEN = "\uE000", CLOSE = "\uE001";
export const PLACEHOLDER = /\uE000(\d+)\uE001/g;

// The previous app's longer names for the same cards.
const ALIASES = { "widget-file": "file", "widget-connector": "connect-plugin", "widget-citation": "citation", "widget-assistants": "assistants", "widget-suggested-tasks": "suggested-tasks" };
// Cards that stand on their own line, and cards that sit in a sentence.
const BLOCK = new Set(["file", "connect-plugin", "widget-mcp-connection", "select", "conversation", "message", "message-input", "tabs", "widget-secret", "suggested-tasks", "assistants"]);
const INLINE = new Set(["button", "citation", "ref", "widget-interaction"]);
// Steps of the previous app's onboarding chat, which Timewarp does in its own
// screens: removed from old messages.
const HIDDEN = new Set(["browser-connection", "widget-browser-connection", "theme-picker", "widget-onboarding-theme", "connect-chatgpt", "widget-onboarding-chatgpt-connection", "onboarding-local-imports", "widget-onboarding-local-imports", "widget-trigger-event"]);
// Cards whose content is optional: without a closing tag they end at ">".
const VOID = new Set(["file", "connect-plugin", "widget-mcp-connection", "button", "citation", "ref", "widget-secret", "assistants"]);
const NAMES = [...Object.keys(ALIASES), ...BLOCK, ...INLINE, ...HIDDEN];
const MAX_CARDS = 200, MAX_OPTIONS = 20, MAX_TASKS = 10, MAX_TABS = 12;

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: "\u00a0" };
export function decode(value) {
  return String(value ?? "").replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]+);/gi, (whole, name) => {
    if (name[0] === "#") {
      const code = name[1] === "x" || name[1] === "X" ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[name.toLowerCase()] ?? whole;
  });
}

const PARTIAL = Symbol("partial");
const nameChar = character => /[A-Za-z0-9-]/.test(character);
const space = character => character === " " || character === "\t" || character === "\n" || character === "\r" || character === "\f";

// Reads the tag at text[at] ("<"). Returns { name, attrs, closing, selfClosing,
// end }, PARTIAL when the text ends inside the tag, or null.
export function readTag(text, at) {
  let index = at + 1;
  const closing = text[index] === "/";
  if (closing) index++;
  if (!/[A-Za-z]/.test(text[index] || "")) return index >= text.length ? PARTIAL : null;
  const start = index;
  while (index < text.length && nameChar(text[index])) index++;
  const name = text.slice(start, index).toLowerCase();
  const attrs = {};
  for (;;) {
    const before = index;
    while (index < text.length && space(text[index])) index++;
    if (index >= text.length) return PARTIAL;
    const character = text[index];
    if (character === ">") return { name, attrs, closing, selfClosing: false, end: index + 1 };
    if (character === "/") {
      if (index + 1 >= text.length) return PARTIAL;
      if (text[index + 1] === ">") return { name, attrs, closing, selfClosing: true, end: index + 2 };
      return null;
    }
    if (index === before || closing || character === "<" || character === '"' || character === "'" || character === "=") return null;
    const attrStart = index;
    while (index < text.length && !space(text[index]) && !"\"'<>/=".includes(text[index])) index++;
    if (index >= text.length) return PARTIAL;
    const attr = text.slice(attrStart, index).toLowerCase();
    let value = "";
    let look = index;
    while (look < text.length && space(text[look])) look++;
    if (text[look] === "=") {
      index = look + 1;
      while (index < text.length && space(text[index])) index++;
      if (index >= text.length) return PARTIAL;
      const quote = text[index];
      if (quote === '"' || quote === "'") {
        const close = text.indexOf(quote, index + 1);
        if (close < 0) return PARTIAL;
        value = text.slice(index + 1, close);
        index = close + 1;
      } else {
        const valueStart = index;
        while (index < text.length && !space(text[index]) && !"\"'<>=`".includes(text[index])) index++;
        if (index >= text.length) return PARTIAL;
        value = text.slice(valueStart, index);
        if (!value) return null;
      }
    } else value = "";
    if (!Object.hasOwn(attrs, attr)) attrs[attr] = decode(value);
  }
}

// The closing tag matching an element opened just before `from`, allowing
// the same element nested inside it.
function findClose(text, from, name) {
  const pattern = new RegExp(`<(/?)${name.replace(/-/g, "\\-")}(?=[\\s/>])`, "gi");
  pattern.lastIndex = from;
  let depth = 1, match;
  while ((match = pattern.exec(text))) {
    const tag = readTag(text, match.index);
    if (!tag || tag === PARTIAL) continue;
    if (match[1]) { if (--depth === 0) return { start: match.index, end: tag.end }; }
    else if (!tag.selfClosing) depth++;
    pattern.lastIndex = tag.end;
  }
  return null;
}

// Elements named `names` inside a card's content, ignoring the text between them.
export function childElements(body, names) {
  const found = [];
  const pattern = new RegExp(`<(${names.map(name => name.replace(/-/g, "\\-")).join("|")})(?=[\\s/>])`, "gi");
  let match;
  while ((match = pattern.exec(body))) {
    const tag = readTag(body, match.index);
    if (!tag || tag === PARTIAL || tag.closing) continue;
    let content = "", end = tag.end;
    if (!tag.selfClosing) {
      const close = findClose(body, tag.end, tag.name);
      if (close) { content = body.slice(tag.end, close.start); end = close.end; }
    }
    found.push({ tag: tag.name, attrs: tag.attrs, body: content });
    pattern.lastIndex = end;
  }
  return found;
}

const plain = value => decode(String(value).replace(/<[^>]*>/g, "")).trim();
// "  Hello\n  there  " in a message keeps its line breaks but not the indentation of the tag.
function dedent(value) {
  const lines = String(value).replace(/\r\n?/g, "\n").replace(/^\n+|\s+$/g, "").split("\n");
  const indent = Math.min(...lines.filter(line => line.trim()).map(line => /^[ \t]*/.exec(line)[0].length));
  return decode(lines.map(line => line.slice(Number.isFinite(indent) ? indent : 0)).join("\n"));
}

function options(body) {
  const list = [], seen = new Set();
  for (const option of childElements(body, ["option"])) {
    const label = plain(option.body || option.attrs.label || "").slice(0, 200);
    const value = (option.attrs.value || label).trim().slice(0, 200);
    if (!label || !value || seen.has(value)) continue;
    seen.add(value);
    list.push({ label, value });
    if (list.length === MAX_OPTIONS) break;
  }
  return list;
}

const WEB = /^https?:\/\/[^\s]+$/i;
export function suggestedTasks(body) {
  const tasks = [];
  for (const line of String(body).split(/\r?\n/)) {
    const value = line.trim().replace(/\\([`*_~[\]|])/g, "$1");
    if (!value) continue;
    let task;
    try { task = JSON.parse(value); } catch { continue; }
    if (!task || typeof task.title !== "string" || typeof task.description !== "string" || !task.title.trim() || !task.description.trim()) continue;
    const websites = Array.isArray(task.websites) ? task.websites.filter(site => typeof site === "string" && WEB.test(site)).slice(0, 3) : [];
    tasks.push({ title: task.title.trim().slice(0, 200), description: task.description.trim().slice(0, 4000), websites });
    if (tasks.length === MAX_TASKS) break;
  }
  return tasks;
}

// Sources of a citation: a JSON list of { url } (encoded or not, as the previous
// app stored them), or web addresses separated by commas or spaces.
export function citationSources(value) {
  const raw = String(value || "").trim();
  if (!raw) return [];
  let list = null;
  for (const candidate of [raw, (() => { try { return decodeURIComponent(raw); } catch { return raw; } })()]) {
    if (!/^\s*\[/.test(candidate)) continue;
    try { list = JSON.parse(candidate).map(item => typeof item === "string" ? item : item?.url); break; } catch {}
  }
  if (!list) list = raw.split(/[\s,]+/);
  const urls = [];
  for (const url of list) {
    if (typeof url !== "string" || !WEB.test(url.trim())) continue;
    if (!urls.includes(url.trim())) urls.push(url.trim());
  }
  return urls.slice(0, 20);
}

function card(name, attrs, body) {
  const value = { tag: name, attrs, body, block: BLOCK.has(name) };
  if (name === "select") value.options = options(body);
  if (name === "conversation") value.items = childElements(body, ["message", "message-input"]).map(item => ({ tag: item.tag, attrs: item.attrs, body: dedent(item.body) }));
  if (name === "message" || name === "message-input") value.text = dedent(body);
  if (name === "tabs") value.tabs = childElements(body, ["tab"]).slice(0, MAX_TABS).map((tab, index) => ({ label: plain(tab.attrs.label || "") || `Option ${index + 1}`, body: tab.body }));
  if (name === "suggested-tasks") value.tasks = suggestedTasks(body);
  if (name === "citation") value.sources = citationSources(attrs.sources);
  if ((name === "button" || name === "file") && !attrs.label && body.trim()) value.attrs = { ...attrs, label: plain(body).slice(0, 200) };
  return value;
}

// A tag still arriving at the end of a streaming message.
function startsCard(rest) {
  const match = /^<\/?([A-Za-z][A-Za-z0-9-]*)?/.exec(rest);
  if (!match) return false;
  const name = (match[1] || "").toLowerCase();
  if (!name) return true;
  if (rest.length > match[0].length) return NAMES.includes(name);
  return NAMES.some(known => known.startsWith(name));
}

// Models mark web citations with private-use characters ("\uE200cite\u2026\uE201",
// with \uE202 between the parts); the marks mean nothing to a reader. A mark
// still arriving at the end of a streaming message goes too.
const CITATION_MARK = /[ \t]?\uE200[^\uE200\uE201]*\uE201/g, CITATION_TAIL = /[ \t]?\uE200[^\uE201]*$/;
export const stripCitations = text => String(text ?? "").replace(CITATION_MARK, "").replace(CITATION_TAIL, "");

// Splits an agent message into Markdown with placeholders and the cards.
// While the message streams, a card that hasn't finished arriving is left
// out instead of showing its tags. `only` limits the cards to those names (a
// user's message shows its references and answers); other tags stay text.
export function parseCards(source, { streaming = false, only = null } = {}) {
  const text = stripCitations(source).replace(/[\uE000\uE001]/g, "");
  const cards = [];
  let out = "", index = 0, fence = null, lineStart = true;
  while (index < text.length) {
    if (lineStart) {
      const lineEnd = text.indexOf("\n", index);
      const line = text.slice(index, lineEnd < 0 ? text.length : lineEnd + 1);
      const marker = /^[ \t]*(`{3,}|~{3,})/.exec(line);
      if (fence) {
        if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length && !line.slice(marker[0].length).trim()) fence = null;
        out += line; index += line.length;
        continue;
      }
      if (marker) { fence = marker[1]; out += line; index += line.length; continue; }
    }
    const character = text[index];
    lineStart = false;
    if (character === "\n") { out += character; index++; lineStart = true; continue; }
    if (character === "\\" && index + 1 < text.length) { out += text.slice(index, index + 2); index += 2; continue; }
    if (character === "`") {
      let run = 1;
      while (text[index + run] === "`") run++;
      const ticks = "`".repeat(run);
      let close = index + run, end = -1;
      while ((close = text.indexOf(ticks, close)) >= 0) {
        if (text[close + run] !== "`" && text[close - 1] !== "`") { end = close + run; break; }
        while (text[close] === "`") close++;
      }
      // A code span ends within its paragraph.
      if (end > 0 && !/\n[ \t]*\n/.test(text.slice(index, end))) { out += text.slice(index, end); lineStart = text[end - 1] === "\n"; index = end; }
      else { out += ticks; index += run; }
      continue;
    }
    if (character === "<") {
      const tag = readTag(text, index);
      if (tag === PARTIAL) {
        if (streaming && startsCard(text.slice(index))) break;
        out += character; index++;
        continue;
      }
      const raw = tag && !tag.closing ? tag.name : null;
      const name = raw ? ALIASES[raw] || raw : null;
      if (!name || !(BLOCK.has(name) || INLINE.has(name) || HIDDEN.has(raw)) || (only && !only.has(name) && !HIDDEN.has(raw))) { out += character; index++; continue; }
      let body = "", end = tag.end;
      if (!tag.selfClosing) {
        const close = findClose(text, tag.end, raw);
        if (close) { body = text.slice(tag.end, close.start); end = close.end; }
        else if (!VOID.has(name) && !HIDDEN.has(raw)) {
          if (streaming) break;
          out += character; index++;
          continue;
        }
      }
      index = end;
      if (HIDDEN.has(raw) || cards.length >= MAX_CARDS) continue;
      cards.push(card(name, tag.attrs, body));
      out += OPEN + (cards.length - 1) + CLOSE;
      continue;
    }
    out += character; index++;
  }
  // Each card's number among the cards of its kind in the message, which
  // keeps its saved state (an answer, a sent draft) apart from the others.
  const counts = {};
  for (const item of cards) item.ordinal = counts[item.tag] = (counts[item.tag] ?? -1) + 1;
  return { markdown: out, cards };
}

// The text of a user message from the previous app: a card's answer
// (<widget-interaction summary="…">…</widget-interaction>) reads as its
// summary, as it was shown there.
export function userMessageText(source) {
  return String(source ?? "")
    .replace(/<widget-interaction\b[^>]*>[\s\S]*?<\/widget-interaction>/g, whole => { const tag = readTag(whole, 0); return tag && tag !== PARTIAL ? tag.attrs.summary || "" : whole; })
    .replace(/<widget-trigger-event\b[^>]*>([\s\S]*?)<\/widget-trigger-event>/g, (whole, body) => decode(body).trim())
    .trim();
}

// An agent message as copied: the text without its cards, as before. A
// reference keeps its name and an answer its summary; the rest goes.
export function copyText(source) {
  const { markdown, cards } = parseCards(source);
  return markdown.replace(PLACEHOLDER, (_whole, index) => {
    const card = cards[Number(index)];
    if (card?.tag === "ref") return refName(card.attrs);
    if (card?.tag === "widget-interaction") return card.attrs.summary || "";
    return "";
  }).replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

// The name a reference shows: a skill without its plugin, a person's name.
export function refName(attrs = {}) {
  const name = String(attrs.name || attrs.title || attrs.email || "").replace(/^user-content-/, "");
  return attrs.type === "skill" && name.includes(":") ? name.slice(name.indexOf(":") + 1) : name;
}

// A reference as a message carries it, for the agent and for the chips the
// chat draws (RefChip in widgets.jsx): <ref type="file" name="…" path="…"></ref>.
const escapeAttr = value => String(value).replace(/[&"<>]/g, character => ({ "&": "&amp;", '"': "&quot;", "<": "&lt;", ">": "&gt;" })[character]);
export function refMarkup(reference) {
  const fields = reference.type === "person" ? [["type", "person"], ["user-id", reference.userId], ["name", reference.name], ["email", reference.email], ["image-url", reference.imageUrl]]
    : reference.type === "skill" ? [["type", "skill"], ["name", reference.name], ["path", reference.path]]
      : [["type", "file"], ["name", reference.name], ["path", reference.path], ["content-type", reference.contentType]];
  return `<ref ${fields.filter(([, value]) => value).map(([key, value]) => `${key}="${escapeAttr(value)}"`).join(" ")}></ref>`;
}

// A short stable key for a message's text (FNV-1a), naming its cards' state.
export function messageKey(text) {
  let hash = 0x811c9dc5;
  const value = String(text ?? "");
  for (let index = 0; index < value.length; index++) { hash ^= value.charCodeAt(index); hash = Math.imul(hash, 0x01000193) >>> 0; }
  return hash.toString(36) + value.length.toString(36);
}

// Links as agents write them: web pages, files, browser tabs, workers and
// app pages. timewarp:// is Timewarp's scheme; chats from the previous app
// use another scheme for the same pages, recognized by the page names.
const APP_PAGES = new Set(["subagents", "conversation", "c", "customize", "settings"]);
export function resolveLink(href) {
  let value = String(href ?? "").trim();
  if (!value || value.startsWith("#")) return { type: "none" };
  if (value.startsWith("//")) return { type: "url", url: "https:" + value };
  const decoded = text => { try { return decodeURIComponent(text); } catch { return text; } };
  const cleanPath = text => decoded(text).replace(/[?#].*$/, "").replace(/:\d+(?::\d+)?$/, "");
  // Files on other computers (\\server\share) aren't links: looking one up
  // would connect to that computer with the user's Windows sign-in.
  const fileLink = file => file && !/^[\\/]{2}/.test(file) ? { type: "file", path: file } : { type: "none" };
  if (/^file:/i.test(value)) {
    let file;
    try {
      const url = new URL(value);
      if (url.host && url.hostname.toLowerCase() !== "localhost") return { type: "none" };
      const pathname = decoded(url.pathname);
      file = /^\/[A-Za-z]:\//.test(pathname) ? pathname.slice(1).replace(/\//g, "\\") : pathname;
    } catch { return { type: "none" }; }
    return fileLink(file.replace(/:\d+(?::\d+)?$/, ""));
  }
  if (/^[A-Za-z]:[\\/]/.test(value) || /^\\\\/.test(value)) return fileLink(cleanPath(value));
  const scheme = /^([A-Za-z][A-Za-z0-9+.-]*):/.exec(value)?.[1]?.toLowerCase();
  const appPage = scheme && scheme !== "http" && scheme !== "https" && /^[A-Za-z][A-Za-z0-9+.-]*:\/\/([^/?#]+)/.exec(value)?.[1]?.toLowerCase();
  if (scheme === "timewarp" || (appPage && APP_PAGES.has(appPage))) {
    let url;
    try { url = new URL(value); } catch { return { type: "none" }; }
    const route = decoded(`/${url.hostname}${url.pathname}`).replace(/\/+$/, "");
    if (url.hostname === "subagents" && url.pathname.length > 1) return { type: "subagent", threadId: decoded(url.pathname.slice(1)).replace(/\/+$/, "") };
    const tab = /^\/conversation\/([^/]+)\/browser\/([^/]+)$/.exec(route);
    if (tab) return { type: "tab", conversationId: tab[1], tabId: tab[2] };
    const chat = /^\/conversation\/([^/]+)$/.exec(route);
    if (chat) return { type: "conversation", conversationId: chat[1] };
    return { type: "app", route: route + url.search + url.hash };
  }
  if (scheme === "http" || scheme === "https") return { type: "url", url: value };
  if (scheme && scheme.length > 1) return { type: "none" };
  return fileLink(cleanPath(value));
}

// "report.final.docx" → "docx".
export const extensionOf = file => (/\.([A-Za-z0-9]{1,10})$/.exec(String(file || "").split(/[\\/]/).pop() || "")?.[1] || "").toLowerCase();
export const baseName = file => String(file || "").replace(/[\\/]+$/, "").split(/[\\/]/).pop() || String(file || "");

// What a file card says about the kind of file, as the previous app did.
export function fileKind(file) {
  const extension = extensionOf(file);
  if (!extension) return "File";
  if (["doc", "docx", "docm", "odt", "rtf"].includes(extension)) return "Word document";
  if (["ppt", "pptx", "pptm", "odp", "key"].includes(extension)) return "Presentation";
  if (["xls", "xlsx", "xlsm", "ods", "csv", "tsv"].includes(extension)) return "Spreadsheet";
  if (extension === "pdf") return "PDF document";
  if (extension === "md" || extension === "markdown") return "Document";
  if (["aac", "aif", "aifc", "aiff", "flac", "m4a", "mp3", "oga", "ogg", "opus", "wav", "weba"].includes(extension)) return "Audio file";
  if (["avi", "m4v", "mkv", "mov", "mp4", "mpeg", "mpg", "ogv", "webm"].includes(extension)) return "Video file";
  return extension.toUpperCase() + " file";
}

// The message a card sends for the user, which is also what the agent reads.
export function selectAnswer(options, answer) {
  if (answer?.skipped) return "Skipped";
  const labels = (answer?.selections || []).map(value => options.find(option => option.value === value)?.label ?? value);
  return [...labels, ...(answer?.customAnswer?.trim() ? [answer.customAnswer.trim()] : [])].join(", ");
}
export const splitAddresses = value => [...new Set(String(value || "").split(/[,;]/).map(item => item.trim()).filter(Boolean))];
export function draftMessage({ mode = "chat", title = "", url = "", from = "", to = "", cc = "", bcc = "", body = "" }) {
  if (mode === "email") {
    const lines = ["Send this email:"];
    if (from.trim()) lines.push("From: " + from.trim());
    lines.push("To: " + splitAddresses(to).join(", "));
    if (splitAddresses(cc).length) lines.push("Cc: " + splitAddresses(cc).join(", "));
    if (splitAddresses(bcc).length) lines.push("Bcc: " + splitAddresses(bcc).join(", "));
    if (title.trim()) lines.push("Subject: " + title.trim());
    if (url.trim()) lines.push("Thread: " + url.trim());
    return lines.join("\n") + "\n\n" + body.trim();
  }
  const where = [title.trim(), url.trim() ? `(${url.trim()})` : ""].filter(Boolean).join(" ");
  return "Send this message:" + (where ? "\nConversation: " + where : "") + "\n\n" + body.trim();
}
