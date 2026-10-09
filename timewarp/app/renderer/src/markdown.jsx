import React, { useEffect, useMemo, useRef } from "react";
import MarkdownIt from "markdown-it";
import hljs from "highlight.js/lib/common";

// Raw HTML is disabled: agent text is rendered as markdown only.
const md = new MarkdownIt({
  html: false, linkify: true, breaks: false,
  highlight(code, language) {
    if (language && hljs.getLanguage(language)) {
      try { return `<pre><code class="hljs language-${language}">${hljs.highlight(code, { language, ignoreIllegals: true }).value}</code></pre>`; } catch {}
    }
    return `<pre><code class="hljs">${md.utils.escapeHtml(code)}</code></pre>`;
  },
});

// A link to one of the chat's browser tabs, as the agent writes it
// (timewarp://…; chats from the previous app use another scheme).
const TAB_LINK = /^(?!https?:)[a-z][a-z0-9+.-]*:\/\/conversation\/([^/]+)\/browser\/([^/?#]+)/i;
const GLOBE = '<svg class="tw-link-icon" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/></svg>';

const defaultLink = md.renderer.rules.link_open || ((tokens, index, options, env, self) => self.renderToken(tokens, index, options));
md.renderer.rules.link_open = (tokens, index, options, env, self) => {
  const token = tokens[index];
  token.attrSet("rel", "noreferrer");
  const href = token.attrGet("href") || "";
  // Links start with the site's own icon, or a globe for browser tabs.
  let icon = "";
  if (TAB_LINK.test(href)) icon = GLOBE;
  else if (/^https?:\/\//i.test(href)) { try { icon = `<img class="tw-favicon" src="${md.utils.escapeHtml(new URL(href).origin + "/favicon.ico")}" alt="" loading="lazy" referrerpolicy="no-referrer">`; } catch {} }
  return defaultLink(tokens, index, options, env, self) + icon;
};

function openLink(event) {
  const link = event.target.closest("a[href]");
  if (!link) return;
  event.preventDefault();
  const href = link.getAttribute("href");
  const tab = TAB_LINK.exec(href);
  if (tab) window.dispatchEvent(new CustomEvent("tw:open-tab", { detail: { conversationId: tab[1], tabId: tab[2] } }));
  // Web pages open in the chat's browser pane, as before (elsewhere, in the default browser).
  else if (/^https?:\/\//i.test(href)) window.dispatchEvent(new CustomEvent("tw:open-url", { detail: { url: href } }));
}

export function Markdown({ text, streaming = false }) {
  const html = useMemo(() => md.render(String(text || "")), [text]);
  const node = useRef(null);
  // A site without an icon gets the globe instead of a broken image.
  useEffect(() => {
    const root = node.current;
    if (!root) return;
    const failed = event => {
      if (!event.target.matches?.("img.tw-favicon")) return;
      const holder = document.createElement("span");
      holder.innerHTML = GLOBE;
      event.target.replaceWith(holder.firstChild);
    };
    root.addEventListener("error", failed, true);
    return () => root.removeEventListener("error", failed, true);
  }, []);
  return <div ref={node} className={"tw-markdown" + (streaming ? " tw-streaming" : "")} onClick={openLink} dangerouslySetInnerHTML={{ __html: html }} />;
}
