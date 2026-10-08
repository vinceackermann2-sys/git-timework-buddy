import React, { useMemo } from "react";
import MarkdownIt from "markdown-it";
import hljs from "highlight.js/lib/common";
import { call } from "./api.js";

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
const defaultLink = md.renderer.rules.link_open || ((tokens, index, options, env, self) => self.renderToken(tokens, index, options));
md.renderer.rules.link_open = (tokens, index, options, env, self) => {
  tokens[index].attrSet("rel", "noreferrer");
  return defaultLink(tokens, index, options, env, self);
};

function openLink(event) {
  const link = event.target.closest("a[href]");
  if (!link) return;
  event.preventDefault();
  const href = link.getAttribute("href");
  if (/^https:\/\//i.test(href)) void call("links.open", { url: href }).catch(() => {});
}

export function Markdown({ text, streaming = false }) {
  const html = useMemo(() => md.render(String(text || "")), [text]);
  return <div className={"tw-markdown" + (streaming ? " tw-streaming" : "")} onClick={openLink} dangerouslySetInnerHTML={{ __html: html }} />;
}
