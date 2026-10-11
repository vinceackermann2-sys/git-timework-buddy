import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import MarkdownIt from "markdown-it";
import { Check, Copy, Maximize2 } from "lucide-react";
import { messageKey, OPEN, parseCards, PLACEHOLDER, readTag, stripCitations } from "./cards.mjs";
import { useHighlighter } from "./highlighter.js";
import { CardScope, ChatCard, MarkdownImage, MarkdownLink, useRouteConversation } from "./widgets.jsx";
import { Dialog } from "./components/common.jsx";

// Messages are Markdown drawn as React elements; nothing becomes HTML. Raw
// HTML in them is read as tags: a small GitHub-style set (line breaks,
// details, keys, sub- and superscript, images…) is drawn as elements and
// any other tag stays text, as before. Cards (cards.mjs) are taken out first
// and drawn by widgets.jsx.
const md = new MarkdownIt({ html: true, linkify: true, breaks: false }).use(footnotes);
// HTML that isn't drawn is read again without HTML, so it shows as text.
const plain = new MarkdownIt({ html: false, linkify: true, breaks: false });
// file: links are resolved by Timewarp (widgets.jsx), never loaded by the page.
const validateLink = md.validateLink.bind(md);
md.validateLink = plain.validateLink = url => /^file:/i.test(String(url).trim()) || validateLink(url);

// Footnotes ("as shown[^1]" and "[^1]: The source"), numbered in the order
// they're referred to and listed at the end of the message.
function footnotes(markdown) {
  markdown.block.ruler.before("reference", "tw_footnote", (state, startLine, endLine, silent) => {
    if (state.sCount[startLine] - state.blkIndent >= 4) return false;
    const start = state.bMarks[startLine] + state.tShift[startLine], max = state.eMarks[startLine];
    const head = /^\[\^([^\]\s]+)\]:[ \t]?/.exec(state.src.slice(start, max));
    if (!head) return false;
    if (silent) return true;
    const lines = [state.src.slice(start + head[0].length, max)];
    let next = startLine + 1;
    for (; next < endLine; next++) {
      const from = state.bMarks[next] + state.tShift[next], to = state.eMarks[next];
      if (from >= to) {
        // A blank line continues the note only when an indented line follows.
        if (next + 1 < endLine && state.sCount[next + 1] - state.blkIndent >= 4) { lines.push(""); continue; }
        break;
      }
      const line = state.src.slice(from, to);
      if (state.sCount[next] - state.blkIndent >= 4) { lines.push(line); continue; }
      if (lines.at(-1) === "" || /^\[\^[^\]\s]+\]:/.test(line)) break;
      lines.push(line);
    }
    state.env.footnotes ||= { labels: new Map(), order: [] };
    if (!state.env.footnotes.labels.has(head[1])) state.env.footnotes.labels.set(head[1], { label: head[1], text: lines.join("\n").trim(), number: 0 });
    state.line = next;
    return true;
  }, { alt: ["paragraph", "reference"] });
  markdown.inline.ruler.after("image", "tw_footnote_ref", (state, silent) => {
    const start = state.pos;
    if (state.src.charCodeAt(start) !== 0x5b || state.src.charCodeAt(start + 1) !== 0x5e) return false;
    const end = state.src.indexOf("]", start + 2);
    if (end < 0 || end >= state.posMax) return false;
    const label = state.src.slice(start + 2, end);
    const note = !label || /\s/.test(label) ? null : state.env.footnotes?.labels.get(label);
    if (!note) return false;
    if (!silent) {
      if (!note.number) { state.env.footnotes.order.push(note); note.number = state.env.footnotes.order.length; }
      state.push("footnote_ref", "", 0).meta = { label, number: note.number };
    }
    state.pos = end + 1;
    return true;
  });
}

// Moves to a footnote, or back to where it's referred to, in the same message.
function jump(event, selector) {
  event.preventDefault();
  const target = event.currentTarget.closest(".tw-markdown")?.querySelector(selector);
  if (!target) return;
  target.scrollIntoView({ block: "nearest" });
  target.querySelector("button")?.focus({ preventScroll: true });
}
const cssLabel = label => String(label).replace(/["\\]/g, "\\$&");
function footnoteList(env, context) {
  const order = env.footnotes?.order || [];
  if (!order.length) return [];
  return [
    <section key="footnotes" className="tw-footnotes" aria-label="Footnotes">
      <ol>
        {[...order].map(note => (
          <li key={note.label} data-footnote={note.label}>
            {render(nest(expandHtml(md.parse(note.text, { footnotes: env.footnotes }))), context, "fn-" + note.number)}
            <button type="button" className="tw-footnote-back" aria-label={`Back to reference ${note.number}`} onClick={event => jump(event, `[data-footnote-ref="${cssLabel(note.label)}"]`)}>↩</button>
          </li>
        ))}
      </ol>
    </section>,
  ];
}

// ── Raw HTML ───────────────────────────────────────────────────────────────
const HTML_BLOCK = new Set(["details", "summary", "p", "div"]);
const HTML_INLINE = new Set(["kbd", "sub", "sup", "b", "strong", "i", "em", "u", "ins", "s", "del", "mark", "small", "code", "span", "a"]);
const HTML_VOID = new Set(["br", "hr", "img"]);
const INLINE_VOID = new Set(["br", "img"]);

// An HTML block's tags and the text between them; comments are left out.
function htmlParts(content) {
  const parts = [];
  let text = "";
  const flush = () => { if (text) parts.push({ text }); text = ""; };
  for (let index = 0; index < content.length;) {
    if (content.startsWith("<!--", index)) { flush(); const end = content.indexOf("-->", index + 4); index = end < 0 ? content.length : end + 3; continue; }
    const tag = content[index] === "<" ? readTag(content, index) : null;
    if (tag && typeof tag === "object") { flush(); parts.push({ ...tag, source: content.slice(index, tag.end) }); index = tag.end; continue; }
    text += content[index++];
  }
  flush();
  return parts;
}
// A tag as a token: undefined when it isn't on the list, null when it adds nothing.
function htmlToken(part, inline) {
  if (HTML_VOID.has(part.name)) {
    if (inline && !INLINE_VOID.has(part.name)) return undefined;
    return part.closing ? null : { type: "html_void", tag: part.name, attrs: part.attrs, nesting: 0 };
  }
  if (!HTML_INLINE.has(part.name) && (inline || !HTML_BLOCK.has(part.name))) return undefined;
  if (part.selfClosing) return null;
  return { type: part.closing ? "html_close" : "html_open", tag: part.name, attrs: part.attrs, source: part.source, nesting: part.closing ? -1 : 1 };
}

// HTML tags that open and close at the same level are drawn; one without
// its partner stays text.
function balanceHtml(tokens) {
  const stack = [], broken = new Set();
  tokens.forEach((token, index) => {
    if (token.type === "html_open") stack.push({ html: true, tag: token.tag, index });
    else if (token.type === "html_close") { if (stack.at(-1)?.html && stack.at(-1).tag === token.tag) stack.pop(); else broken.add(index); }
    else if (token.nesting === 1) stack.push({ html: false, index });
    else if (token.nesting === -1) { while (stack.at(-1)?.html) broken.add(stack.pop().index); stack.pop(); }
  });
  for (const entry of stack) if (entry.html) broken.add(entry.index);
  return broken.size ? tokens.map((token, index) => broken.has(index) ? { type: "text", content: token.source || "", nesting: 0 } : token) : tokens;
}

// Block HTML: drawn when every tag in it is on the list, otherwise read as
// Markdown without HTML.
function expandHtml(tokens) {
  if (!tokens.some(token => token.type === "html_block")) return tokens;
  return balanceHtml(tokens.flatMap(token => {
    if (token.type !== "html_block") return [token];
    const parts = htmlParts(token.content);
    const drawn = parts.map(part => part.text !== undefined ? (part.text.trim() ? { type: "html_text", content: part.text.trim(), nesting: 0 } : null) : htmlToken(part, false));
    return drawn.includes(undefined) ? plain.parse(token.content, {}) : drawn.filter(Boolean);
  }));
}
// Inline HTML: each tag on the list is drawn, any other stays text.
function inlineHtml(children) {
  if (!children?.some(child => child.type === "html_inline")) return children;
  return balanceHtml(children.flatMap(child => {
    if (child.type !== "html_inline") return [child];
    if (child.content.startsWith("<!--")) return [];
    const tag = readTag(child.content, 0);
    const token = tag && typeof tag === "object" ? htmlToken({ ...tag, source: child.content }, true) : undefined;
    return token === undefined ? [{ type: "text", content: child.content, nesting: 0 }] : token ? [token] : [];
  }));
}
const size = value => /^\d{1,4}$/.test(String(value ?? "").trim()) ? Number(value) : undefined;
function htmlElement(token, children, key) {
  const { tag, attrs } = token;
  const align = /^(left|center|right)$/i.exec(String(attrs.align || "").trim())?.[1]?.toLowerCase();
  switch (tag) {
    case "details": return <details key={key} className="tw-details" open={attrs.open !== undefined || undefined}>{children}</details>;
    case "summary": return <summary key={key}>{children}</summary>;
    // A paragraph of HTML can hold Markdown blocks, so it's drawn as a block.
    case "p": case "div": return <div key={key} className={tag === "p" ? "tw-html-p" : undefined} style={align ? { textAlign: align } : undefined}>{children}</div>;
    case "span": return <React.Fragment key={key}>{children}</React.Fragment>;
    case "a": return <MarkdownLink key={key} href={md.validateLink(String(attrs.href || "").trim()) ? String(attrs.href || "").trim() : ""} title={attrs.title || undefined}>{children}</MarkdownLink>;
    case "b": return <strong key={key}>{children}</strong>;
    case "i": return <em key={key}>{children}</em>;
    default: return React.createElement(tag, { key }, ...children);
  }
}

const MARKDOWN_BLOCKS = new Set(["markdown", "md", "mdx"]);
const TAGS = new Set(["p", "ul", "ol", "li", "blockquote", "h1", "h2", "h3", "h4", "h5", "h6", "thead", "tbody", "tr", "th", "td", "strong", "em", "s", "del", "sup", "sub", "code", "pre", "hr", "br"]);

const highlight = (hljs, name, text) => { try { return hljs?.getLanguage(name) ? hljs.highlight(text, { language: name, ignoreIllegals: true }).value : null; } catch { return null; } };
const escapeHtml = text => text.replace(/[&<>]/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[character]);
// How often a code block still arriving is highlighted again as its lines complete.
const ARRIVING_HIGHLIGHT_MS = 200;

// A code block with a copy button; ```md blocks show as Markdown, as before.
// One still arriving (`open`) stays highlighted up to its last complete line,
// highlighted again at most every 200 ms as lines complete; the lines since
// then show plain until the next time.
function CodeBlock({ language, code, open = false }) {
  const [copied, setCopied] = useState(false);
  const name = (language || "text").toLowerCase();
  const value = code.replace(/\n$/, "");
  const markdown = MARKDOWN_BLOCKS.has(name);
  const hljs = useHighlighter(!markdown);
  const html = useMemo(() => markdown || open ? null : highlight(hljs, name, value), [name, value, markdown, open, hljs]);
  const lines = open && !markdown ? code.slice(0, code.lastIndexOf("\n") + 1).replace(/\n$/, "") : "";
  const [arrived, setArrived] = useState({ name, text: "", html: null });
  const highlighted = useRef(0);
  useEffect(() => {
    if (!lines || !hljs || (arrived.name === name && arrived.text === lines)) return undefined;
    const timer = setTimeout(() => { highlighted.current = Date.now(); setArrived({ name, text: lines, html: highlight(hljs, name, lines) }); }, Math.max(0, highlighted.current + ARRIVING_HIGHLIGHT_MS - Date.now()));
    return () => clearTimeout(timer);
  }, [lines, hljs, name, arrived]);
  // The first complete lines are highlighted as they show, not a moment later.
  const first = useMemo(() => lines && arrived.html === null ? { name, text: lines, html: highlight(hljs, name, lines) } : null, [lines, arrived.html, hljs, name]);
  const latest = first || arrived;
  const shown = html ?? (open && latest.html !== null && latest.name === name && value.startsWith(latest.text) ? latest.html + escapeHtml(value.slice(latest.text.length)) : null);
  const copy = () => navigator.clipboard.writeText(value).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1200); }).catch(() => setCopied(false));
  return (
    <div className="tw-code" data-language={name}>
      <button type="button" className="tw-code-copy" aria-label={copied ? `Copied ${name} block` : `Copy ${name} block`} title={copied ? "Copied" : "Copy"} onClick={copy}>{copied ? <Check size={14} /> : <Copy size={14} />}</button>
      {markdown ? <div className="tw-code-markdown"><Blocks text={value} options={{ cards: false }} /></div>
        : shown !== null ? <pre><code className={"hljs language-" + name} dangerouslySetInnerHTML={{ __html: shown }} /></pre>
          : <pre><code className="hljs">{value}</code></pre>}
    </div>
  );
}

// Tables can be copied (as tab-separated text) and opened larger.
const tableText = table => [...table.rows].map(row => [...row.cells].map(cell => cell.innerText.trim()).join("\t")).join("\n");
function MarkdownTable({ children }) {
  const table = useRef(null);
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const copy = () => { if (table.current) navigator.clipboard.writeText(tableText(table.current)).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1200); }).catch(() => {}); };
  return (
    <div className="tw-table">
      <div className="tw-table-tools">
        <button type="button" aria-label={copied ? "Copied table" : "Copy table"} title={copied ? "Copied table" : "Copy table"} onClick={copy}>{copied ? <Check size={14} /> : <Copy size={14} />}</button>
        <button type="button" aria-label="Expand table" title="Expand table" onClick={() => setExpanded(true)}><Maximize2 size={14} /></button>
      </div>
      <div className="tw-table-scroll"><table ref={table}>{children}</table></div>
      {expanded ? createPortal(
        <Dialog open onClose={() => setExpanded(false)} wide label="Expanded table" className="tw-table-dialog">
          <div className="tw-table-expanded tw-markdown"><table>{children}</table></div>
        </Dialog>, document.body) : null}
    </div>
  );
}

// markdown-it's flat token list as a tree of open/close pairs.
function nest(tokens) {
  const root = { children: [] }, stack = [root];
  for (const token of tokens || []) {
    if (token.nesting === 1) { const node = { token, children: [] }; stack[stack.length - 1].children.push(node); stack.push(node); }
    else if (token.nesting === -1) { if (stack.length > 1) stack.pop(); }
    else stack[stack.length - 1].children.push({ token, children: null });
  }
  return root.children;
}

const blank = child => typeof child === "string" ? !child.trim() : child === null || child === undefined || child === false;
function trimEdges(list) {
  let start = 0, end = list.length;
  while (start < end && blank(list[start])) start++;
  while (end > start && blank(list[end - 1])) end--;
  return list.slice(start, end);
}

// `first` numbers nodes that follow others drawn before them (a streaming
// message's finished parts), so each keeps the key it has in the whole message.
function render(nodes, context, prefix, first = 0) {
  const out = [];
  nodes.forEach((node, index) => {
    const key = prefix + "." + (first + index);
    const value = node.children ? renderNode(node, context, key) : renderLeaf(node.token, context, key);
    if (Array.isArray(value)) out.push(...value);
    else if (value !== null && value !== undefined && value !== false && value !== "") out.push(value);
  });
  return out;
}

// Text with card placeholders: block cards are remembered, so a paragraph
// around them can be split.
function textWithCards(text, context, key) {
  if (!context.cards.length || !text.includes("\uE000")) return text;
  const out = [];
  let last = 0;
  for (const match of text.matchAll(PLACEHOLDER)) {
    if (match.index > last) out.push(text.slice(last, match.index));
    const card = context.cards[Number(match[1])];
    if (card) {
      const element = <ChatCard key={key + "-c" + match[1]} card={card} />;
      if (card.block) context.blocks.add(element);
      out.push(element);
    }
    last = match.index + match[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function paragraph(children, hidden, context, key) {
  if (!children.some(child => context.blocks.has(child))) return hidden ? children : <p key={key}>{children}</p>;
  const out = [];
  let run = [];
  const flush = () => { const value = trimEdges(run); if (value.length) out.push(hidden ? <React.Fragment key={key + "-" + out.length}>{value}</React.Fragment> : <p key={key + "-" + out.length}>{value}</p>); run = []; };
  for (const child of children) {
    if (context.blocks.has(child)) { flush(); out.push(child); } else run.push(child);
  }
  flush();
  return out;
}

// "- [ ] item" and "- [x] item" are task list items, shown with a checkbox.
function takeTask(node) {
  const first = node.children[0]?.children?.[0]?.token;
  const text = first?.type === "inline" ? first.children?.[0] : null;
  const match = text?.type === "text" ? /^\[([ xX])\]\s+/.exec(text.content) : null;
  if (!match) return null;
  text.content = text.content.slice(match[0].length);
  return { checked: match[1] !== " " };
}

function renderNode(node, context, key) {
  const token = node.token;
  const task = token.type === "list_item_open" ? takeTask(node) : null;
  const children = render(node.children, context, key);
  if (task) {
    return (
      <li key={key} className="tw-task-item">
        <span className="tw-task-box" role="checkbox" aria-checked={task.checked} aria-disabled="true" data-checked={task.checked}>{task.checked ? <Check size={11} strokeWidth={3} /> : null}</span>
        {children}
      </li>
    );
  }
  switch (token.type) {
    case "html_open": return htmlElement(token, children, key);
    case "paragraph_open": return paragraph(children, token.hidden, context, key);
    case "link_open": return <MarkdownLink key={key} href={token.attrGet("href") || ""} title={token.attrGet("title") || undefined}>{children}</MarkdownLink>;
    case "ordered_list_open": {
      const start = token.attrGet("start") === null ? 1 : Number(token.attrGet("start"));
      return <ol key={key} start={Number.isInteger(start) && start !== 1 ? start : undefined}>{children}</ol>;
    }
    case "table_open": return <MarkdownTable key={key}>{children}</MarkdownTable>;
    case "th_open": case "td_open": {
      const align = /text-align:\s*(left|right|center)/.exec(token.attrGet("style") || "")?.[1];
      return React.createElement(token.tag, { key, style: align ? { textAlign: align } : undefined }, ...children);
    }
    default:
      return TAGS.has(token.tag) ? React.createElement(token.tag, { key }, ...children) : <React.Fragment key={key}>{children}</React.Fragment>;
  }
}

function renderLeaf(token, context, key) {
  switch (token.type) {
    case "inline": return render(nest(inlineHtml(token.children)), context, key);
    case "html_text": return render(nest(plain.parseInline(token.content, {})[0]?.children || []), context, key);
    case "html_void":
      if (token.tag === "br") return <br key={key} />;
      if (token.tag === "hr") return <hr key={key} />;
      return <MarkdownImage key={key} src={String(token.attrs.src || "").trim()} alt={token.attrs.alt || ""} title={token.attrs.title || undefined} width={size(token.attrs.width)} height={size(token.attrs.height)} />;
    case "footnote_ref": return (
      <sup key={key} className="tw-footnote-ref" data-footnote-ref={token.meta.label}>
        <button type="button" aria-label={`Footnote ${token.meta.number}`} onClick={event => jump(event, `[data-footnote="${cssLabel(token.meta.label)}"]`)}>{token.meta.number}</button>
      </sup>
    );
    case "text": return textWithCards(token.content, context, key);
    case "softbreak": return "\n";
    case "hardbreak": return <br key={key} />;
    case "code_inline": return <code key={key}>{token.content}</code>;
    case "fence": return <CodeBlock key={key} language={(token.info || "").trim().split(/\s+/)[0]} code={token.content} open={token === context.open} />;
    case "code_block": return <CodeBlock key={key} language="" code={token.content} open={token === context.open} />;
    case "image": return <MarkdownImage key={key} src={token.attrGet("src") || ""} alt={md.renderer.renderInlineAsText(token.children || [], md.options, {})} title={token.attrGet("title") || undefined} />;
    case "hr": return <hr key={key} />;
    default: return token.content || null;
  }
}

// Text as React elements: its cards (all, or `only` those named), its
// Markdown, then its footnotes.
const cardsOf = (text, { cards, streaming, only }) => cards ? parseCards(text, { streaming, only }) : { markdown: stripCitations(text), cards: [] };
// The code block a streaming message ends with may still be arriving.
const openCode = tokens => { const last = tokens.findLast(token => token.nesting !== -1); return last?.type === "fence" || last?.type === "code_block" ? last : null; };
function drawMarkdown(parsed, { arriving = false } = {}) {
  const env = {}, context = { cards: parsed.cards, blocks: new Set(), open: null };
  const tokens = md.parse(parsed.markdown, env);
  if (arriving) context.open = openCode(tokens);
  const content = render(nest(expandHtml(tokens)), context, "m");
  return [...content, ...footnoteList(env, context)];
}
const draw = (text, options) => drawMarkdown(cardsOf(text, options));

// A streaming message is drawn in parts: blocks that are finished are parsed
// and drawn once, and only the rest is parsed again as text arrives. That
// draws the same as the whole text: a top-level block is finished once the
// next one has started and that one's first two lines are complete (a table
// needs both to be one). Link references and footnotes resolve over the
// whole message, and HTML blocks pair up across blocks, so messages with
// them are drawn whole each time, as before.
const DEFINITION = /\[[^\]\n]*\]:/, HTML_LINE = /^ {0,3}<[A-Za-z/!?]/m;
// The cards a part shows, to tell when one of them changed.
const cardsIn = (text, cards) => text.includes(OPEN) ? JSON.stringify([...text.matchAll(PLACEHOLDER)].map(match => cards[Number(match[1])] || null)) : "";
// Where line `line` of the text starts, or -1.
function lineOffset(text, line) {
  let at = 0;
  for (let index = 0; index < line; index++) { at = text.indexOf("\n", at); if (at < 0) return -1; at++; }
  return at;
}
function drawStreaming(previous, text, options) {
  const parsed = cardsOf(text, { ...options, streaming: true });
  // As markdown-it reads it, so lines are counted the same.
  const source = parsed.markdown.replace(/\r\n?/g, "\n").replace(/\0/g, "\uFFFD");
  if (DEFINITION.test(source) || HTML_LINE.test(source)) return { parts: [], content: drawMarkdown(parsed, { arriving: true }) };
  // Parts drawn before stay while their text, and the cards in it, are the same.
  const parts = [];
  let offset = 0, count = 0;
  for (const part of previous || []) {
    if (!source.startsWith(part.text, offset) || cardsIn(part.text, parsed.cards) !== part.cards) break;
    parts.push(part); offset += part.text.length; count += part.count;
  }
  const rest = source.slice(offset);
  const tokens = md.parse(rest, {});
  const context = { cards: parsed.cards, blocks: new Set(), open: openCode(tokens) };
  const nodes = nest(expandHtml(tokens));
  const settled = line => { const start = lineOffset(rest, line), end = start < 0 ? -1 : rest.indexOf("\n", start); return end >= 0 && rest.includes("\n", end + 1); };
  let finished = nodes.length - 1;
  while (finished > 0 && !(nodes[finished].token.map && settled(nodes[finished].token.map[0]))) finished--;
  if (finished > 0 && nodes.slice(0, finished).every(node => node.token.map)) {
    const value = rest.slice(0, lineOffset(rest, nodes[finished].token.map[0]));
    parts.push({ text: value, count: finished, cards: cardsIn(value, parsed.cards), content: render(nodes.slice(0, finished), context, "m", count) });
    return { parts, content: [...parts.flatMap(part => part.content), ...render(nodes.slice(finished), context, "m", count + finished)] };
  }
  return { parts, content: [...parts.flatMap(part => part.content), ...render(nodes, context, "m", count)] };
}

// Markdown (and its cards) as React elements, within the surrounding scope.
// `part` names nested Markdown (a tab) so its cards keep their own state.
function Blocks({ text, options = {} }) {
  const parent = React.useContext(CardScope);
  const cards = options.cards ?? !!parent?.cards;
  const streaming = !!parent?.streaming, only = parent?.only || null;
  const scope = useMemo(() => parent ? { ...parent, cards, messageKey: options.part ? parent.messageKey + "/" + options.part : parent.messageKey } : null, [parent, cards, options.part]);
  const content = useMemo(() => draw(String(text || ""), { cards, streaming, only }), [text, cards, streaming, only]);
  return <CardScope.Provider value={scope}>{content}</CardScope.Provider>;
}
const renderMarkdown = (text, options = {}) => <Blocks text={text} options={options} />;

// An agent message, file preview or instructions in Markdown. In a chat's
// messages (a reply bubble, or the agent's thread) the agent's cards are
// drawn; elsewhere their tags stay text. `cards` overrides that: false, or
// true / { conversationId, only } for a chat (only: the card names drawn,
// such as a user's references and answers).
const CHAT_MESSAGES = ".tw-bubble, .tw-worker-thread, .tw-thread-output, .tw-thread-note";
export function Markdown({ text, streaming = false, cards }) {
  const node = useRef(null);
  const [inChat, setInChat] = useState(null);
  useLayoutEffect(() => { if (cards === undefined && node.current) setInChat(!!node.current.closest(CHAT_MESSAGES)); }, [cards]);
  const route = useRouteConversation();
  const enabled = cards === undefined ? inChat !== false : !!cards;
  const conversationId = (cards && typeof cards === "object" && cards.conversationId) || route;
  const names = cards && typeof cards === "object" && Array.isArray(cards.only) ? cards.only.join(" ") : "";
  const only = useMemo(() => names ? new Set(names.split(" ")) : null, [names]);
  const value = String(text || "");
  const key = useMemo(() => messageKey(value), [value]);
  const scope = useMemo(() => ({ conversationId, cards: enabled, streaming, only, messageKey: key, renderMarkdown }), [conversationId, enabled, streaming, only, key]);
  // A streaming message's finished parts, kept from one update to the next.
  const parts = useRef(null);
  const content = useMemo(() => {
    if (!streaming) { parts.current = null; return draw(value, { cards: enabled, streaming, only }); }
    const drawn = drawStreaming(parts.current, value, { cards: enabled, only });
    parts.current = drawn.parts;
    return drawn.content;
  }, [value, enabled, streaming, only]);
  return (
    <div ref={node} className={"tw-markdown" + (streaming ? " tw-streaming" : "")}>
      <CardScope.Provider value={scope}>{content}</CardScope.Provider>
    </div>
  );
}
