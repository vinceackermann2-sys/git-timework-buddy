// The window's keyboard shortcuts and agent reordering, kept apart from the
// interface so they can be tested.

const TYPING = new Set(["INPUT", "SELECT", "TEXTAREA"]);
export const typingIn = target => !!target && (TYPING.has(target.tagName) || !!target.isContentEditable);

// The previous app's shortcuts, Cmd on macOS and Ctrl elsewhere: K search,
// N or T new task, [ and ] (or arrows) back and forward, B sidebar, J pane,
// L the pane's address bar, comma settings. Alt+arrows also go back and
// forward. Back and forward leave text fields alone, where those keys move
// the cursor. Returns the action's name, or null.
export function shortcutFor(event, mac = false) {
  const key = String(event.key || "").toLowerCase();
  const mod = mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
  const typing = typingIn(event.target);
  if (event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
    if (typing) return null;
    return key === "arrowleft" ? "back" : key === "arrowright" ? "forward" : null;
  }
  // Ctrl/⌘+Alt+F: Send feedback. AltGr characters arrive as other keys.
  if (mod && event.altKey && !event.shiftKey) return key === "f" ? "feedback" : null;
  if (!mod || event.altKey || event.shiftKey) return null;
  switch (key) {
    case "k": return "search";
    case "n": case "t": return "newTask";
    case "b": return "sidebar";
    case "j": return "pane";
    case "l": return "address";
    case ",": return "settings";
    case "[": case "arrowleft": return typing ? null : "back";
    case "]": case "arrowright": return typing ? null : "forward";
    default: return null;
  }
}

// Where a dragged agent lands on another: after it when dragged down, so it
// can move one place down or to the bottom, before it when dragged up.
export function dropSide(ids, moving, target) {
  const from = ids.indexOf(moving), to = ids.indexOf(target);
  return from >= 0 && to >= 0 && from < to ? "after" : "before";
}
export function moveId(ids, moving, target) {
  if (moving === target || !ids.includes(moving) || !ids.includes(target)) return ids;
  const side = dropSide(ids, moving, target);
  const rest = ids.filter(id => id !== moving);
  rest.splice(rest.indexOf(target) + (side === "after" ? 1 : 0), 0, moving);
  return rest;
}

const time = iso => { const value = Date.parse(iso || ""); return Number.isFinite(value) ? value : -Infinity; };
// Newest first; ties keep a stable order.
export const byActivity = (a, b) => time(b.lastActivityAt) - time(a.lastActivityAt) || String(a.id).localeCompare(String(b.id));

// The activity feed's day for a chat: Today, Yesterday, a weekday within the
// week, then the date (with the year when it isn't this year); Older without one.
export function dayLabel(iso, now = new Date()) {
  const at = new Date(time(iso));
  if (!Number.isFinite(at.getTime())) return "Older";
  const day = date => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const days = Math.round((day(now) - day(at)) / 86400000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days > 1 && days < 7) return at.toLocaleDateString(undefined, { weekday: "long" });
  return at.toLocaleDateString(undefined, { month: "long", day: "numeric", ...(at.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}) });
}

// The activity feed, as before: unread and working chats first under
// Priority, then the rest by day, newest first.
export function activityGroups(conversations, { running = new Set(), now = new Date() } = {}) {
  const priority = [], days = [];
  for (const conversation of [...conversations].sort(byActivity)) {
    if (running.has(conversation.id) || !conversation.read) { priority.push(conversation); continue; }
    const label = dayLabel(conversation.lastActivityAt, now), last = days.at(-1);
    if (last?.label === label) last.items.push(conversation); else days.push({ label, items: [conversation] });
  }
  return priority.length ? [{ label: "Priority", items: priority }, ...days] : days;
}

// How many of an agent's chats show: five more per "Show more", and always
// enough to include the open chat.
export const PAGE = 5;
export function shownCount(ids, selectedId, count = PAGE) {
  const index = selectedId ? ids.indexOf(selectedId) : -1;
  return index >= count ? Math.ceil((index + 1) / PAGE) * PAGE : count;
}

// "2h 5m" until (or since) a time, in at most two units, as before; "now" within a minute.
const UNITS = [["mo", 2592000], ["w", 604800], ["d", 86400], ["h", 3600], ["m", 60]];
export function durationText(iso, now = Date.now(), units = 2) {
  const at = time(iso);
  if (!Number.isFinite(at)) return "";
  let seconds = Math.max(0, Math.floor(Math.abs(at - now) / 1000));
  const parts = [];
  for (const [unit, size] of UNITS) {
    if (parts.length >= units) break;
    const count = Math.floor(seconds / size);
    if (count) { parts.push(count + unit); seconds %= size; }
  }
  return parts.join(" ") || "now";
}

// The home screen's Upcoming: the next five enabled automations whose chat is still there.
export function upcomingAutomations(automations, conversations, now = Date.now()) {
  const chats = new Set(conversations.map(item => item.id));
  return automations.filter(item => item.enabled && chats.has(item.conversationId) && time(item.nextRunAt) > now)
    .sort((a, b) => time(a.nextRunAt) - time(b.nextRunAt)).slice(0, 5);
}

// Invitations: several addresses separated by commas or new lines.
export const splitEmails = text => String(text || "").split(/[,\n]/).map(item => item.trim()).filter(Boolean);

// The sidebar is 220–360px wide (288 by default); dragged below half the
// least width, it closes, as before.
export const SIDEBAR = { min: 220, max: 360, initial: 288 };
export const sidebarWidth = value => Math.min(SIDEBAR.max, Math.max(SIDEBAR.min, Number.isFinite(Number(value)) && value !== null && value !== "" ? Number(value) : SIDEBAR.initial));
export const sidebarCollapses = x => x <= SIDEBAR.min / 2;
