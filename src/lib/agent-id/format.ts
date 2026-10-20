// How Agent ID values read on the dashboard. Pure functions, unit tested.
import type {
  Account,
  AgentStatus,
  AuditEntry,
  Kind,
  Money,
  PublicConfig,
  Runtime,
  VerificationLevel,
  VerificationStatus,
} from "./types";

// --- Money (minor units) ------------------------------------------------------

const ISO_CURRENCY = /^[A-Z]{3}$/;

// 1234 + "USD" → "$12.34"; currencies that aren't ISO codes (USDC) keep their name.
export function formatCents(amount: number, currency: string | null | undefined = "USD"): string {
  const code = (currency || "USD").toUpperCase();
  const value = amount / 100;
  if (ISO_CURRENCY.test(code) && code !== "USDC") {
    try {
      return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: code,
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(value);
    } catch {
      // Unknown to this browser: fall through to the plain form.
    }
  }
  return `${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${code}`;
}

export function formatMoney(money: Money | null | undefined): string {
  if (!money) return "—";
  return formatCents(money.amount, money.currency);
}

// "12.50" (or "12,50", "$12.5") → 1250 cents; null when it isn't an amount.
// Zero is an amount only where asked for (a limit of 0 blocks everything).
export function parseAmount(input: string, { allowZero = false } = {}): number | null {
  const cleaned = input.trim().replace(/^\$/, "").replace(",", ".").replace(/\s/g, "");
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(cleaned)) return null;
  const [whole = "0", fraction = ""] = cleaned.split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return cents > 0 || (allowZero && cents === 0) ? cents : null;
}

// The decimal string the API takes as `value` ("12.50").
export function amountValue(input: string): string | null {
  const cents = parseAmount(input);
  return cents === null ? null : centsToInput(cents);
}

export function centsToInput(cents: number | null | undefined): string {
  if (cents === null || cents === undefined || !Number.isFinite(cents)) return "";
  return (cents / 100).toFixed(2);
}

// --- Time ---------------------------------------------------------------------

export function formatRelativeTime(
  iso: string | null | undefined,
  now: number = Date.now(),
): string {
  if (!iso) return "Never";
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return "—";
  const seconds = Math.round((now - at) / 1000);
  if (seconds < 0) return formatDate(iso);
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return days === 1 ? "yesterday" : `${days} days ago`;
  return formatDate(iso);
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

// --- Labels -------------------------------------------------------------------

export const RUNTIME_LABELS: Record<Runtime, string> = {
  codex: "Codex",
  claude: "Claude",
  timewarp: "Timewarp",
  other: "Other",
  any: "Any runtime",
};
export const runtimeLabel = (runtime: string): string =>
  RUNTIME_LABELS[runtime as Runtime] ?? runtime;

export const KIND_LABELS: Record<Kind, string> = {
  mail: "Mail",
  phone: "Phone",
  wallet: "Wallet",
  card: "Card",
  vm: "Machine",
};
export const KIND_NOUNS: Record<Kind, string> = {
  mail: "a mail inbox",
  phone: "a phone number",
  wallet: "a wallet",
  card: "a virtual card",
  vm: "a virtual machine",
};

export const STATUS_LABELS: Record<AgentStatus, string> = {
  active: "Active",
  suspended: "Paused",
  revoked: "Revoked",
};
export const statusLabel = (status: string): string =>
  STATUS_LABELS[status as AgentStatus] ?? status;

export const VERIFICATION_LEVEL_LABELS: Record<VerificationLevel, string> = {
  kyb: "Verified business (KYB)",
  kyc: "Verified person (KYC)",
  none: "Not verified",
};

export const VERIFICATION_STATUS_LABELS: Record<VerificationStatus, string> = {
  unverified: "Not verified",
  pending: "Checking",
  verified: "Verified",
  rejected: "Not approved",
};
export const verificationStatusLabel = (status: string): string =>
  VERIFICATION_STATUS_LABELS[status as VerificationStatus] ?? status;

const DECLINE_REASONS: Record<string, string> = {
  over_transaction_limit: "Over the per-payment limit",
  over_daily_limit: "Over the daily limit",
  over_monthly_limit: "Over the monthly limit",
  blocked_category: "Merchant category is blocked",
  category_not_allowed: "Merchant category isn't on the allowed list",
  card_inactive: "Card is frozen or the agent is paused",
  currency: "Wrong currency for this card",
  invalid_amount: "Invalid amount",
  unknown_card: "Unknown card",
};
export function declineReason(reason: unknown): string {
  if (typeof reason !== "string" || !reason) return "Declined";
  return DECLINE_REASONS[reason] ?? reason.replace(/_/g, " ");
}

const EVENT_STATUS_LABELS: Record<string, string> = {
  delivered: "Delivered",
  simulated: "Not delivered",
  received: "Received",
  sent: "Sent",
  completed: "Completed",
  pending: "Processing",
  failed: "Failed",
  approved: "Approved",
  declined: "Declined",
  voicemail: "Voicemail",
  exited: "Exited with an error",
  queued: "Queued",
  "no-answer": "No answer",
  busy: "Busy",
};
export const eventStatusLabel = (status: string): string => {
  const label = EVENT_STATUS_LABELS[status];
  if (label) return label;
  const words = status.replace(/[_-]/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
};

export type Tone = "neutral" | "ink" | "success" | "warning" | "danger" | "test";

// One colour per outcome, wherever an event's status is shown.
const EVENT_STATUS_TONES: Record<string, Tone> = {
  delivered: "success",
  received: "success",
  sent: "success",
  completed: "success",
  approved: "success",
  pending: "warning",
  queued: "warning",
  ringing: "warning",
  simulated: "neutral",
  voicemail: "ink",
  failed: "danger",
  declined: "danger",
  denied: "danger",
  exited: "danger",
  undelivered: "danger",
  busy: "danger",
  "no-answer": "danger",
  canceled: "danger",
};
export const eventStatusTone = (status: string): Tone => EVENT_STATUS_TONES[status] ?? "neutral";

const AUDIT_ACTIONS: Record<string, string> = {
  "agent.create": "Agent created",
  "agent.update": "Agent settings changed",
  "agent.revoke": "Agent revoked",
  "agent_key.create": "Agent key created",
  "agent_key.revoke": "Agent key revoked",
  "owner_key.create": "Owner key created",
  "owner_key.revoke": "Owner key revoked",
  "resource.provision": "Resource added",
  "resource.update": "Resource changed",
  "resource.release": "Resource removed",
  "wallet.test_funds": "Test money added",
  "wallet.send": "Money sent",
  "wallet.approval_requested": "Transfer waiting for approval",
  "approval.approve": "Transfer approved",
  "approval.deny": "Transfer denied",
  "mail.send": "Email sent",
  "sms.send": "Text sent",
  "call.place": "Call placed",
  "card.reveal": "Card details revealed",
  "vm.start": "Machine started",
  "vm.stop": "Machine stopped",
  "vm.exec": "Command run",
  "passport.issue": "Passport issued",
  "passport.checked": "Passport checked by a company",
  "signing_key.add": "Signing key added",
  "signing_key.remove": "Signing key removed",
  "relying_party.create": "Company registered",
  "relying_party.update": "Company changed",
  "relying_party.revoke": "Company revoked",
  "verification.person.start": "Identity check started",
  "verification.person.submit": "Identity submitted for review",
  "verification.person.verified": "Identity verified",
  "verification.person.rejected": "Identity rejected",
  "verification.person.failed": "Identity check failed",
  "verification.business.submit": "Business submitted for review",
  "verification.business.verified": "Business verified",
  "verification.business.rejected": "Business rejected",
};
export function auditActionLabel(action: string): string {
  const known = AUDIT_ACTIONS[action];
  if (known) return known;
  const words = action.replace(/[._]/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

// A short line of the details that matter, never secrets.
export function auditDetail(entry: Pick<AuditEntry, "action" | "detail">): string {
  const d = entry.detail || {};
  const parts: string[] = [];
  const kind = d["kind"];
  if (typeof kind === "string") parts.push(KIND_LABELS[kind as Kind] ?? kind);
  const mode = d["mode"];
  if (typeof mode === "string") parts.push(mode === "live" ? "Live" : "Test");
  const amount = d["amount"];
  if (typeof amount === "number") {
    const currency = typeof d["currency"] === "string" ? d["currency"] : "USD";
    parts.push(formatCents(amount, currency));
  }
  const to = d["to"];
  if (typeof to === "string") parts.push(`to ${counterpartyLabel(to)}`);
  else if (typeof to === "number" && entry.action === "mail.send")
    parts.push(`${to} recipient${to === 1 ? "" : "s"}`);
  const company = d["company"];
  if (typeof company === "string") parts.push(company);
  const audience = d["audience"];
  if (typeof audience === "string") parts.push(audience);
  const allowed = d["allowed"];
  if (typeof allowed === "boolean") parts.push(allowed ? "allowed" : "not allowed");
  const status = d["status"];
  if (typeof status === "string") parts.push(status === "suspended" ? "paused" : status);
  const name = d["name"];
  if (typeof name === "string" && entry.action === "agent.create") parts.push(name);
  const exitCode = d["exitCode"];
  if (typeof exitCode === "number") parts.push(`exit ${exitCode}`);
  const prefix = d["prefix"];
  if (typeof prefix === "string") parts.push(`${prefix}…`);
  return parts.join(" · ");
}

export const ACTOR_LABELS: Record<AuditEntry["actor"], string> = {
  owner: "You",
  agent: "Agent",
  system: "Agent ID",
  provider: "Provider",
  relying_party: "Company",
};

// --- Live resources -----------------------------------------------------------

export type LiveAvailability = {
  // Whether a live one can be asked for at all on this deployment.
  available: boolean;
  // Why it can't (shown on a disabled Live choice), or what it needs.
  reason: string | null;
  requirements: { label: string; met: boolean }[];
  ready: boolean;
};

// What a live resource of this kind needs, from /v1/config and the account.
export function liveAvailability(
  kind: Kind,
  config: PublicConfig | undefined,
  context: { plan?: string | undefined; verified?: boolean | undefined },
): LiveAvailability {
  const entry = config?.resources?.[kind];
  const requirements: { label: string; met: boolean }[] = [];
  if (entry?.verificationRequired)
    requirements.push({
      label: "a verified owner",
      met: !!context.verified,
    });
  if (entry?.paidPlanRequired)
    requirements.push({
      label: "a paid Timewarp plan",
      met: !!context.plan && context.plan !== "free",
    });
  if (!entry?.live) {
    return {
      available: false,
      reason:
        entry?.unavailable === "not_configured"
          ? `Live ${kind === "vm" ? "machines aren't" : `${KIND_LABELS[kind].toLowerCase()} isn't`} set up on this deployment.`
          : `Live ${kind === "vm" ? "machines aren't" : `${KIND_LABELS[kind].toLowerCase()} isn't`} available yet.`,
      requirements,
      ready: false,
    };
  }
  const missing = requirements.filter((r) => !r.met);
  return {
    available: true,
    reason: missing.length ? `Live needs ${missing.map((r) => r.label).join(" and ")}.` : null,
    requirements,
    ready: missing.length === 0,
  };
}

export function planLabel(plan: string | undefined): string {
  if (!plan) return "—";
  return plan.charAt(0).toUpperCase() + plan.slice(1);
}

export function isOrgAdmin(account: Pick<Account, "organizations"> | undefined, orgId: string) {
  const role = account?.organizations.find((o) => o.id === orgId)?.role;
  return role === "owner" || role === "admin";
}

// Comma or newline separated list → clean lowercase entries.
export function parseList(input: string): string[] {
  return [
    ...new Set(
      input
        .split(/[,\n]/)
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean),
    ),
  ];
}

// Only pages inside Agent ID may be returned to after signing in.
export function safeRedirect(value: unknown): string {
  if (typeof value !== "string") return "/agent-id/dashboard";
  if (!/^\/agent-id(\/|\?|$)/.test(value) || value.includes("//") || value.includes("\\"))
    return "/agent-id/dashboard";
  return value;
}

// "Courier Beta (agt_…)" as the API labels another agent → "Courier Beta".
export function counterpartyLabel(value: string | null | undefined): string {
  if (!value) return "—";
  const agent = /^(.+) \((agt_[a-z0-9]+)\)$/.exec(value);
  return agent?.[1] ?? value;
}

// --- Where an agent runs ---------------------------------------------------------

export const ORIGIN_LABELS: Record<string, string> = {
  "claude-code": "Claude Code",
  "claude-desktop": "Claude Desktop",
  claude: "Claude",
  codex: "Codex",
  chatgpt: "ChatGPT",
  cursor: "Cursor",
  windsurf: "Windsurf",
  cline: "Cline",
  roo: "Roo Code",
  continue: "Continue",
  gemini: "Gemini",
  kiro: "Kiro",
  qwen: "Qwen Code",
  copilot: "Copilot",
  factory: "Factory",
  openclaw: "OpenClaw",
  grok: "Grok",
  hermes: "Hermes",
  moltbot: "Moltbot",
  timewarp: "Timewarp",
  energy: "Energy",
  strawberry: "Strawberry",
  custom: "Other",
};

// The apps offered when someone picks where an agent runs, most common first.
export const ORIGIN_CHOICES = [
  "claude-code",
  "codex",
  "cursor",
  "claude-desktop",
  "chatgpt",
  "gemini",
  "windsurf",
  "copilot",
  "grok",
  "timewarp",
  "energy",
  "strawberry",
  "custom",
] as const;

// The agent's origin, or a best guess from its older `runtime` field.
export function originOf(agent: {
  origin?: { app: string; label?: string; detail?: string | null } | null;
  runtime?: string;
}): { app: string; label: string; detail: string | null } {
  if (agent.origin?.app) {
    return {
      app: agent.origin.app,
      label: agent.origin.label || ORIGIN_LABELS[agent.origin.app] || agent.origin.app,
      detail: agent.origin.detail ?? null,
    };
  }
  const app =
    agent.runtime === "codex"
      ? "codex"
      : agent.runtime === "claude"
        ? "claude"
        : agent.runtime === "timewarp"
          ? "timewarp"
          : "custom";
  return { app, label: ORIGIN_LABELS[app] ?? "Other", detail: null };
}

// The older runtime field for an origin, so both stay meaningful.
export function runtimeForOrigin(app: string): "codex" | "claude" | "timewarp" | "other" {
  if (app === "codex" || app === "chatgpt") return "codex";
  if (app.startsWith("claude")) return "claude";
  if (app === "timewarp" || app === "energy") return "timewarp";
  return "other";
}

export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters = words.length > 1 ? words[0]!.charAt(0) + words[1]!.charAt(0) : name.slice(0, 2);
  return letters.toUpperCase() || "?";
}

// --- Money in US dollars (wallets hold USDC and USDT, 1:1) -----------------------------

export function formatUsd(cents: number | null | undefined): string {
  if (cents === null || cents === undefined || !Number.isFinite(cents)) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}

// --- Times, sizes, durations ------------------------------------------------------------

// Like a mail app: the time today, the date this year, else the full date.
export function formatListTime(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const today = new Date(now);
  if (date.toDateString() === today.toDateString())
    return date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  if (date.getFullYear() === today.getFullYear())
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return date.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes)) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 102.4) / 10} KB`;
  return `${Math.round(bytes / 104857.6) / 10} MB`;
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "";
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return m ? `${m}:${String(s).padStart(2, "0")}` : `${s}s`;
}

// --- Phone ------------------------------------------------------------------------------

export type CallKind = "missed" | "voicemail" | "incoming" | "outgoing";

export function callKind(event: { direction: string; status: string }): CallKind {
  if (event.status === "voicemail") return "voicemail";
  if (event.status === "missed" || event.status === "no-answer" || event.status === "busy")
    return event.direction === "in" ? "missed" : "outgoing";
  return event.direction === "in" ? "incoming" : "outgoing";
}

export type Conversation<E> = {
  number: string;
  name: string | null;
  messages: E[];
  last: E;
};

// Texts grouped by the other number, oldest first inside, newest conversation first.
export function conversations<
  E extends { counterparty: string | null; at: string; direction: string },
>(events: E[], contacts: { name: string; phone: string | null }[] = []): Conversation<E>[] {
  const names = new Map(contacts.filter((c) => c.phone).map((c) => [c.phone!, c.name]));
  const groups = new Map<string, E[]>();
  for (const event of events) {
    const number = event.counterparty || "Unknown";
    const list = groups.get(number) ?? [];
    list.push(event);
    groups.set(number, list);
  }
  return [...groups.entries()]
    .map(([number, list]) => {
      const messages = [...list].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
      return { number, name: names.get(number) ?? null, messages, last: messages.at(-1)! };
    })
    .sort((a, b) => Date.parse(b.last.at) - Date.parse(a.last.at));
}

// --- Familiar formats ------------------------------------------------------------------

// Two-digit country codes (ITU); the rest of +2…+9 are three digits, +1 and +7 one.
const TWO_DIGIT_CODES = new Set([
  "20",
  "27",
  "30",
  "31",
  "32",
  "33",
  "34",
  "36",
  "39",
  "40",
  "41",
  "43",
  "44",
  "45",
  "46",
  "47",
  "48",
  "49",
  "51",
  "52",
  "53",
  "54",
  "55",
  "56",
  "57",
  "58",
  "60",
  "61",
  "62",
  "63",
  "64",
  "65",
  "66",
  "81",
  "82",
  "84",
  "86",
  "90",
  "91",
  "92",
  "93",
  "94",
  "95",
  "98",
]);

// +14155550100 → "+1 (415) 555-0100"; +46701234567 → "+46 701 234 567".
export function formatPhone(value: string | null | undefined): string {
  if (!value) return "";
  const nanp = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(value);
  if (nanp) return `+1 (${nanp[1]}) ${nanp[2]}-${nanp[3]}`;
  if (!/^\+\d{8,15}$/.test(value)) return value;
  const digits = value.slice(1);
  const codeLength = /^[17]/.test(digits) ? 1 : TWO_DIGIT_CODES.has(digits.slice(0, 2)) ? 2 : 3;
  const rest = digits.slice(codeLength);
  // Groups of three, with a group of four (or two) where threes would leave one digit.
  const groups: string[] = [];
  let i = 0;
  while (rest.length - i > 4) {
    const left = rest.length - i;
    const size = left === 8 ? 4 : left === 5 ? 2 : 3;
    groups.push(rest.slice(i, i + size));
    i += size;
  }
  groups.push(rest.slice(i));
  return `+${digits.slice(0, codeLength)} ${groups.join(" ")}`;
}

// "Today", "Yesterday", "Oct 18", or "Oct 18, 2025" for other years.
export function dayLabel(iso: string, now: number = Date.now()): string {
  const date = new Date(iso);
  const today = new Date(now);
  const yesterday = new Date(now - 86_400_000);
  if (date.toDateString() === today.toDateString()) return "Today";
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
  return date.toLocaleDateString(
    "en-US",
    date.getFullYear() === today.getFullYear()
      ? { month: "short", day: "numeric" }
      : { year: "numeric", month: "short", day: "numeric" },
  );
}

// Items (newest first) grouped under day labels, keeping their order.
export function groupByDay<T extends { at: string }>(
  items: T[],
  now: number = Date.now(),
): { day: string; items: T[] }[] {
  const groups: { day: string; items: T[] }[] = [];
  for (const item of items) {
    const day = dayLabel(item.at, now);
    const last = groups.at(-1);
    if (last && last.day === day) last.items.push(item);
    else groups.push({ day, items: [item] });
  }
  return groups;
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

// A soft colour per name, the same every time, for avatars.
const AVATAR_COLORS = [
  ["#e9d2ff", "#3b1a5c"],
  ["#d6e8ff", "#163a63"],
  ["#d5f2e3", "#14492f"],
  ["#ffe1c7", "#5c3010"],
  ["#ffd6e0", "#5c1a2b"],
  ["#fff1b8", "#4d3b00"],
  ["#d9f3f7", "#0f4550"],
  ["#e6e3ff", "#2c2566"],
] as const;
export function avatarColors(name: string): { background: string; color: string } {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  const [background, color] = AVATAR_COLORS[hash % AVATAR_COLORS.length]!;
  return { background, color };
}

// What a resource is called when it isn't live yet, said honestly.
export const NOT_LIVE_YET: Record<Kind, string> = {
  mail: "Mail is being set up",
  phone: "Phone numbers are coming soon",
  wallet: "Wallets are being set up",
  card: "Cards are coming soon",
  vm: "Machines are being set up",
};
