// The apps one Agent ID is used in (Claude Code, Codex, Cursor…) and the mark
// each one shows. Pure functions, unit tested; the marks themselves are in
// components/agent-id/AppIcons.tsx.
import { ORIGIN_LABELS } from "./format";
import type { AgentApp, AgentOrigin } from "./types";

// One mark per maker: Claude Code and Claude Desktop both show Claude's.
export type MarkId =
  | "claude"
  | "openai"
  | "cursor"
  | "grok"
  | "gemini"
  | "windsurf"
  | "copilot"
  | "timewarp"
  | "letter";

const MARKS: Record<string, MarkId> = {
  "claude-code": "claude",
  "claude-desktop": "claude",
  claude: "claude",
  codex: "openai",
  chatgpt: "openai",
  openai: "openai",
  cursor: "cursor",
  grok: "grok",
  xai: "grok",
  gemini: "gemini",
  windsurf: "windsurf",
  copilot: "copilot",
  "github-copilot": "copilot",
  timewarp: "timewarp",
};

export const markOf = (app: string): MarkId => MARKS[app] ?? "letter";

// Values that say nothing about where an agent runs.
const NO_APP = new Set(["", "custom", "any", "other"]);

// "some-new-client" → "Some New Client", as the API names apps it doesn't know.
export function appLabel(app: string, label?: string | null): string {
  if (label && label.trim()) return label.trim();
  const known = ORIGIN_LABELS[app];
  if (known) return known;
  return app.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// The apps an agent is used in: the API's list, or, from older deployments,
// the one app it was made for.
export function agentApps(agent: {
  apps?: AgentApp[] | null;
  origin?: Pick<AgentOrigin, "app" | "label"> | null;
  runtime?: string;
}): AgentApp[] {
  const seen = new Set<string>();
  const list: AgentApp[] = [];
  for (const item of agent.apps ?? []) {
    if (!item?.app || NO_APP.has(item.app) || seen.has(item.app)) continue;
    seen.add(item.app);
    list.push({ ...item, label: appLabel(item.app, item.label) });
  }
  if (list.length) return list;
  const app =
    agent.origin?.app ??
    (agent.runtime === "claude" ? "claude" : agent.runtime === "codex" ? "codex" : agent.runtime);
  if (!app || NO_APP.has(app)) return [];
  return [{ app, label: appLabel(app, agent.origin?.label) }];
}

export type AppGroup = {
  // The first app of the group (the most recent), for its mark and letter.
  app: string;
  mark: MarkId;
  label: string;
  labels: string[];
};

// Apps that show the same mark become one icon ("Codex and ChatGPT"), in the
// order they were last used.
export function groupApps(apps: Pick<AgentApp, "app" | "label">[]): AppGroup[] {
  const groups: AppGroup[] = [];
  const byMark = new Map<string, AppGroup>();
  for (const item of apps) {
    const mark = markOf(item.app);
    const key = mark === "letter" ? `letter:${item.app}` : mark;
    const label = appLabel(item.app, item.label);
    const group = byMark.get(key);
    if (group) {
      if (!group.labels.includes(label)) group.labels.push(label);
      group.label = listLabel(group.labels);
      continue;
    }
    const created: AppGroup = { app: item.app, mark, label, labels: [label] };
    byMark.set(key, created);
    groups.push(created);
  }
  return groups;
}

// ["A"] → "A"; ["A", "B"] → "A and B"; ["A", "B", "C"] → "A, B and C".
export function listLabel(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

// The apps a person can pick when they get an Agent ID on the website.
export const CLAIM_APPS = [
  "claude-code",
  "codex",
  "cursor",
  "claude-desktop",
  "chatgpt",
  "gemini",
  "windsurf",
  "copilot",
  "grok",
] as const;
