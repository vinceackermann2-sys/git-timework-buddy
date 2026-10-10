// The composer's @ and $ suggestions, as before: "@" offers people, skills
// and the agent's workspace files, "$" offers skills. A chosen reference
// stays in the text as "@name" or "$name" (with a chip beside the box) and is
// sent as a <ref> the chat draws as a chip, or, for a skill, as "$name" with
// the skill attached for Codex. Also large pastes, which become a
// "Clipboard (N lines)" chip. Pure functions: no DOM, no React.
import { refMarkup } from "./cards.mjs";

const MAX_ITEMS = 8;

// "@rep" or "$pd" just before the caret, at the start or after a space.
export function mentionQuery(text, caret) {
  const before = String(text ?? "").slice(0, caret);
  const match = /(?:^|\s)([@$])([^\s@$]*)$/.exec(before);
  if (!match) return null;
  const query = match[2];
  return { trigger: match[1], query, from: before.length - query.length - 1, to: before.length };
}

export const mentionToken = reference => (reference.type === "skill" ? "$" : "@") + reference.name;

// A token counts where it stands as a word of its own.
function tokenAt(text, at, token) {
  if (!text.startsWith(token, at)) return false;
  const before = text[at - 1], after = text[at + token.length];
  return (!before || /[\s([{"'“‘]/.test(before)) && (!after || !/[\w:-]/.test(after));
}
const hasToken = (text, token) => { for (let at = text.indexOf(token); at >= 0; at = text.indexOf(token, at + 1)) if (tokenAt(text, at, token)) return true; return false; };

// The chosen reference in place of what was typed, followed by a space.
export function insertMention(text, range, reference) {
  const value = String(text ?? ""), token = mentionToken(reference);
  const after = value.slice(range.to);
  const space = after.startsWith(" ") ? "" : " ";
  return { text: value.slice(0, range.from) + token + space + after, caret: range.from + token.length + 1 };
}

const sameReference = (a, b) => a.type === b.type && (a.type === "person" ? a.userId === b.userId : a.path === b.path);
export const addMention = (mentions, reference) => mentions.some(item => sameReference(item, reference)) ? mentions : [...mentions, reference];

// The references whose tokens are still in the text.
export const presentMentions = (text, mentions) => (mentions || []).filter(reference => hasToken(String(text ?? ""), mentionToken(reference)));

// The text without a reference's token (its chip's remove button).
export function removeMention(text, reference) {
  const value = String(text ?? ""), token = mentionToken(reference);
  for (let at = value.indexOf(token); at >= 0; at = value.indexOf(token, at + 1)) {
    if (!tokenAt(value, at, token)) continue;
    const end = at + token.length + (value[at + token.length] === " " ? 1 : 0);
    return value.slice(0, at) + value.slice(end);
  }
  return value;
}

// Replaces each token with what `replace` returns for its reference.
function replaceTokens(text, references, replace) {
  const value = String(text ?? "");
  const sorted = [...references].sort((a, b) => mentionToken(b).length - mentionToken(a).length);
  let out = "";
  for (let index = 0; index < value.length;) {
    const hit = sorted.find(reference => tokenAt(value, index, mentionToken(reference)));
    if (hit) { out += replace(hit); index += mentionToken(hit).length; } else out += value[index++];
  }
  return out;
}

// What a message sends: files and people as <ref>s in its text, skills as
// "$name" in the text and attached for Codex, and pasted text after what was typed.
export function composeMessage(text, mentions = [], clips = []) {
  const present = presentMentions(text, mentions);
  const body = replaceTokens(text, present, reference => reference.type === "skill" ? mentionToken(reference) : refMarkup(reference)).trim();
  const skills = [];
  for (const reference of present) if (reference.type === "skill" && !skills.some(skill => skill.path === reference.path)) skills.push({ name: reference.name, path: reference.path });
  return { text: [body, ...clips.map(clip => clip.text)].filter(value => value.trim()).join("\n\n"), skills };
}

// A sent message's "$name" shown as its skill's chip.
export const skillChips = (text, skills = []) => skills.length ? replaceTokens(text, skills.map(skill => ({ type: "skill", ...skill })), refMarkup) : String(text ?? "");

// ── Suggestions ────────────────────────────────────────────────────────────
const TYPES = { pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml", txt: "text/plain", md: "text/markdown",
  csv: "text/csv", json: "application/json", html: "text/html", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation", zip: "application/zip", mp3: "audio/mpeg", mp4: "video/mp4" };
export const contentTypeOf = name => TYPES[(/\.([A-Za-z0-9]+)$/.exec(String(name || ""))?.[1] || "").toLowerCase()] || "application/octet-stream";

const matches = (needle, ...fields) => !needle || fields.some(field => String(field || "").toLowerCase().includes(needle));

// The suggestion menu's groups. "$" lists skills only; "@" lists people,
// skills and, once something is typed, matching files.
export function mentionGroups({ trigger, query = "", skills = [], files = [], members = [] }) {
  const needle = String(query).trim().toLowerCase();
  const skillItems = skills.filter(skill => skill.enabled !== false && matches(needle, skill.name, skill.title, skill.description)).slice(0, MAX_ITEMS)
    .map(skill => ({ key: "skill:" + skill.path, title: skill.name, subtitle: skill.description || undefined, reference: { type: "skill", name: skill.name, path: skill.path } }));
  if (trigger === "$") return [{ id: "skills", label: "Skills", items: skillItems }];
  const people = members.filter(member => member?.userId && member.email && matches(needle, member.name, member.email)).slice(0, MAX_ITEMS).map(member => {
    const name = String(member.name || "").trim() || member.email;
    return { key: "person:" + member.userId, title: name, subtitle: name === member.email ? undefined : member.email, reference: { type: "person", userId: member.userId, name, email: member.email, imageUrl: member.image || null } };
  });
  const fileItems = needle ? files.filter(file => file.type !== "dir" && matches(needle, file.name, file.path)).slice(0, MAX_ITEMS)
    .map(file => ({ key: "file:" + file.path, title: file.name, subtitle: file.path, reference: { type: "file", name: file.name, path: file.path, contentType: contentTypeOf(file.name) } })) : [];
  return [{ id: "people", label: "People", items: people }, { id: "skills", label: "Skills", items: skillItems }, { id: "files", label: "Files", items: fileItems }]
    .filter(group => group.items.length || group.id === "files");
}

// ── Large pastes ───────────────────────────────────────────────────────────
export function lineCount(text) {
  if (!text) return 0;
  const lines = String(text).split(/\r\n|\r|\n/);
  return lines.at(-1) === "" ? lines.length - 1 : lines.length;
}
// More than 10 lines or 1,000 characters, as before.
export const largePaste = text => lineCount(text) > 10 || String(text || "").length > 1000;
export const clipboardLabel = text => { const count = lineCount(text); return `Clipboard (${count} ${count === 1 ? "line" : "lines"})`; };
