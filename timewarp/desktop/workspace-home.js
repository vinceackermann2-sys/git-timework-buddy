"use strict";

function recentWebsite(entries, tab, now = Date.now()) {
  let url;
  try { url = new URL(tab.url); } catch { return entries; }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return entries;
  const title = tab.title && tab.title !== 'New tab' && tab.title !== tab.url ? tab.title : url.hostname;
  return [{ url: url.href, title: String(title).slice(0, 200), visitedAt: now },
    ...entries.filter(entry => entry.url !== url.href)].slice(0, 12);
}

function createUseRecentWebsites({ b, record = recentWebsite }) {
  return function useRecentWebsites(ownerId, profileId, tabs) {
    const key = 'timewarp.browser.recent.' + encodeURIComponent(ownerId) + '.' + encodeURIComponent(profileId || 'none');
    const read = storageKey => {
      try {
        const value = JSON.parse(localStorage.getItem(storageKey) || '[]');
        if (!Array.isArray(value)) return [];
        return value.filter(entry => {
          try { const url = new URL(entry.url); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && typeof entry.title === 'string'; }
          catch { return false; }
        }).slice(0, 12);
      } catch { return []; }
    };
    const [saved, setSaved] = b.useState(() => ({ key, entries: read(key) }));
    const seen = b.useRef({ key, tabs: new Map() });
    b.useEffect(() => {
      const changedProfile = seen.current.key !== key;
      if (changedProfile) seen.current = { key, tabs: new Map() };
      const changes = [];
      for (const tab of tabs) {
        if (tab.profileId && tab.profileId !== profileId) continue;
        if (tab.isLoading || !tab.url) continue;
        const signature = tab.url + '\n' + tab.title;
        if (seen.current.tabs.get(tab.id) === signature) continue;
        seen.current.tabs.set(tab.id, signature);
        changes.push(tab);
      }
      if (!changedProfile && !changes.length) return;
      setSaved(previous => {
        let entries = previous.key === key ? previous.entries : read(key);
        for (const tab of changes) entries = record(entries, tab);
        try { localStorage.setItem(key, JSON.stringify(entries)); } catch {}
        return { key, entries };
      });
    }, [key, profileId, tabs]);
    return saved.key === key ? saved.entries : read(key);
  };
}

function createWorkspaceHome({ h, AgentIcon, FilesIcon, SiteIcon }) {
  return function WorkspaceHome({ recents, onOpen, onTool, assistantIcon, showAssistant, profilePrompt, error }) {
    const siteLabel = url => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; } };
    const origins = new Set();
    const websites = recents.filter(site => {
      try { const origin = new URL(site.url).origin; if (origins.has(origin)) return false; origins.add(origin); return true; }
      catch { return false; }
    }).slice(0, 4);
    return h.jsx('div', { className: 'timewarp-workspace-home', 'data-workspace-home': true, children: h.jsxs('div', { className: 'timewarp-workspace-home-content', children: [
      h.jsxs('section', { className: 'timewarp-workspace-section', 'aria-labelledby': 'timewarp-workspace-tools', children: [
        h.jsx('h2', { id: 'timewarp-workspace-tools', children: 'Tools' }),
        h.jsxs('div', { className: 'timewarp-workspace-tools', children: [
          showAssistant && h.jsxs('button', { type: 'button', className: 'timewarp-workspace-tool-card', onClick: () => onTool('assistant'), children: [
            h.jsx('span', { className: 'timewarp-workspace-tool-icon', children: assistantIcon || h.jsx(AgentIcon, {}) }),
            h.jsx('span', { className: 'timewarp-workspace-tool-copy', children: h.jsx('strong', { children: 'Agent' }) })
          ] }),
          h.jsxs('button', { type: 'button', className: 'timewarp-workspace-tool-card', onClick: () => onTool('files'), children: [
            h.jsx('span', { className: 'timewarp-workspace-tool-icon', children: h.jsx(FilesIcon, {}) }),
            h.jsx('span', { className: 'timewarp-workspace-tool-copy', children: h.jsx('strong', { children: 'Files' }) })
          ] })
        ] })
      ] }),
      h.jsxs('section', { className: 'timewarp-workspace-section', 'aria-labelledby': 'timewarp-workspace-recommended', children: [
        h.jsx('h2', { id: 'timewarp-workspace-recommended', children: 'Recommended' }),
        websites.length ? h.jsx('div', { className: 'timewarp-workspace-sites', children: websites.map(site => h.jsxs('button', {
          type: 'button', className: 'timewarp-workspace-site', title: site.url, onClick: () => onOpen(site.url), children: [
            h.jsx('span', { className: 'timewarp-workspace-site-icon', 'aria-hidden': true, children: h.jsx(SiteIcon, { url: site.url }) }),
            h.jsx('span', { className: 'timewarp-workspace-site-copy', children: h.jsx('strong', { children: site.title || siteLabel(site.url) }) })
          ]
        }, site.url)) }) : h.jsxs('div', { className: 'timewarp-workspace-empty', children: [
          h.jsx('p', { children: 'Your recent websites will appear here.' })
        ] })
      ] }),
      error && h.jsx('p', { role: 'alert', className: 'timewarp-workspace-error', children: error }),
      profilePrompt
    ] }) });
  };
}

module.exports = { recentWebsite, createUseRecentWebsites, createWorkspaceHome };
