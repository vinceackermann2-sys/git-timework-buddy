"use strict";
// Reply notifications come from the main process, as in the previous app: the
// agent's name and its reply as plain text. They show only while no Timewarp
// window is focused (so on macOS also after the window is closed), open the
// chat when clicked and are cleared once the chat is read.

const TITLE_LIMIT = 120, BODY_LIMIT = 240;

// Agent Markdown as one plain line: cards, code fences, link targets and
// emphasis marks go; the words stay.
function plainReply(text) {
  return String(text || "")
    .replace(/<([a-z][\w-]*)\b[^>]*\/>/gi, " ")
    .replace(/<([a-z][\w-]*)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}(#{1,6}\s+|>\s?|[-*+]\s+|\d+[.)]\s+)/gm, "")
    .replace(/[*_~`]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
const clip = (text, limit) => text.length > limit ? text.slice(0, limit - 3).trimEnd() + "..." : text;

function createReplyNotifications({ Notification, store, userId, enabled = () => true, focused = () => false, quiet = () => false, open = () => {}, setBadge = () => {}, log = () => {} }) {
  // Kept so a notification isn't garbage collected before it's clicked.
  const shown = new Map();

  function close(conversationId) {
    const notice = shown.get(conversationId);
    if (!notice) return;
    shown.delete(conversationId);
    try { notice.close(); } catch {}
  }
  // The unread count on the dock (macOS) or wherever the system shows one.
  function badge() {
    const owner = userId();
    try { setBadge(owner ? store.conversations.list(owner).filter(item => !item.read).length : 0); } catch {}
  }

  function observe(name, payload) {
    if (name !== "conversation.event" || payload?.method !== "turn/completed" || payload.params?.subAgent) return;
    badge();
    const conversation = store.conversations.get(payload.conversationId);
    const turnId = payload.params?.turn?.id;
    // A chat still marked read, or a scheduled run that had nothing to report,
    // doesn't notify.
    if (!conversation || conversation.read || conversation.ownerId !== userId() || (turnId && quiet(turnId))) return;
    if (focused() || !enabled() || !Notification.isSupported()) return;
    const reply = store.messages.list(conversation.id).filter(message => message.authorId === conversation.agentId && (!turnId || message.turnId === turnId)).at(-1);
    const body = clip(plainReply(reply?.text), BODY_LIMIT);
    if (!body) return;
    const agent = store.agents.get(conversation.agentId);
    close(conversation.id);
    try {
      const notice = new Notification({ title: clip(String(agent?.name || "").trim(), TITLE_LIMIT) || "Timewarp", body });
      notice.on("click", () => { close(conversation.id); open(conversation.id); });
      notice.on("failed", () => shown.delete(conversation.id));
      shown.set(conversation.id, notice);
      notice.show();
    } catch (error) { shown.delete(conversation.id); log("A reply notification couldn't be shown: " + error.message); }
  }

  return {
    observe, badge,
    // The chat was read: its notification goes.
    read(conversationId) { close(conversationId); badge(); },
    clear() { for (const id of [...shown.keys()]) close(id); },
  };
}

module.exports = { createReplyNotifications, plainReply };
