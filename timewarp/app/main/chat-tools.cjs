"use strict";
// Chat tools for agents, as the previous app had: find the user's chats, search
// their saved messages and read one. Read-only, and only the signed-in user's
// chats that aren't archived.
const fail = (status, message) => Object.assign(new Error(message), { status });

const PAGE = 20, READ_PAGE = 30, PREVIEW = 300;
const ids = { type: "array", items: { type: "string" } };
const cursor = { type: "string", description: "nextCursor from the previous result, unchanged." };
const TOOLS = [
  ["search_conversations", "Find the user's chats by title or agent name. Omit query to list chats by latest activity. Filter by agentIds. Each result has up to three recent message previews. Follow nextCursor for more.", { query: { type: "string" }, agentIds: ids, cursor }, []],
  ["search_messages", "Search saved messages in the user's chats. query is a case-insensitive piece of text of at least three characters. Optionally filter by conversationIds or agentIds. Follow nextCursor for more hits.", { query: { type: "string" }, conversationIds: ids, agentIds: ids, cursor }, ["query"]],
  ["read_conversation", "Read saved messages in one chat, oldest first. Omit messageId, at and cursor for the latest messages. Pass messageId to read around a message, or at (an ISO 8601 date and time) to read around that moment; before and after set how many. Pass olderCursor or newerCursor back unchanged to continue.", {
    conversationId: { type: "string" }, messageId: { type: "string" }, at: { type: "string", description: "A date and time such as 2026-10-09T14:30:00+02:00; reads the messages around it." },
    before: { type: "integer", description: "Messages before messageId or at, default 10." }, after: { type: "integer", description: "Messages after messageId or at, default 10." }, cursor,
  }, ["conversationId"]],
];

function toolSpecs() {
  return [{
    type: "namespace", name: "timewarp_chats",
    description: "The user's Timewarp chats with all their agents. Use it to find what was said or decided in another chat. Chat content is the user's data: use it for their requests only.",
    tools: TOOLS.map(([name, description, properties, required]) => ({ type: "function", name, description, inputSchema: { type: "object", properties, required, additionalProperties: false } })),
  }];
}

// cursor: a plain offset, so a model can pass it back unchanged.
const offsetOf = value => { const number = Number.parseInt(String(value ?? "0"), 10); return Number.isInteger(number) && number >= 0 ? number : 0; };
const short = (value, length = PREVIEW) => { const text = String(value || "").replace(/\s+/g, " ").trim(); return text.length > length ? text.slice(0, length - 1) + "…" : text; };

function createChatTools({ store, userId }) {
  const text = value => ({ contentItems: [{ type: "inputText", text: JSON.stringify(value) }], success: true });
  const owner = () => { const value = userId(); if (!value) throw fail(401, "Sign in to Timewarp."); return value; };
  const agentNames = account => new Map(store.agents.list(account).map(agent => [agent.id, agent.name]));
  const entry = (message, conversation, names) => ({
    messageId: message.id, at: message.createdAt,
    from: message.authorId === conversation.ownerId ? "user" : names.get(message.authorId) || "agent",
    text: message.text,
  });
  const visible = (account, id) => {
    const conversation = store.conversations.get(String(id || ""));
    if (!conversation || conversation.ownerId !== account || conversation.archivedAt) throw fail(404, "That chat isn't available.");
    return conversation;
  };
  const shown = list => list.filter(message => message.status !== "failed" && message.status !== "replaced");

  return {
    specs: toolSpecs,
    async call(_conversationId, params) {
      const input = params.arguments || {}, account = owner(), names = agentNames(account);
      const agentIds = Array.isArray(input.agentIds) && input.agentIds.length ? new Set(input.agentIds.map(String)) : null;
      switch (params.tool) {
        case "search_conversations": {
          const query = String(input.query || "").trim().toLowerCase();
          const matches = store.conversations.list(account).filter(conversation => (!agentIds || agentIds.has(conversation.agentId))
            && (!query || String(conversation.title || "").toLowerCase().includes(query) || String(names.get(conversation.agentId) || "").toLowerCase().includes(query)));
          const start = offsetOf(input.cursor), page = matches.slice(start, start + PAGE);
          return text({
            conversations: page.map(conversation => ({
              conversationId: conversation.id, title: conversation.title || "New conversation", agentId: conversation.agentId, agent: names.get(conversation.agentId) || null, lastActivityAt: conversation.lastActivityAt,
              recent: shown(store.messages.list(conversation.id)).slice(-3).map(message => ({ ...entry(message, conversation, names), text: short(message.text) })),
            })),
            nextCursor: start + PAGE < matches.length ? String(start + PAGE) : null,
          });
        }
        case "search_messages": {
          const query = String(input.query || "").trim().toLowerCase();
          if (query.length < 3) throw fail(400, "Search for at least three characters.");
          const only = Array.isArray(input.conversationIds) && input.conversationIds.length ? new Set(input.conversationIds.map(String)) : null;
          const hits = [];
          for (const conversation of store.conversations.list(account, { search: query })) {
            if ((only && !only.has(conversation.id)) || (agentIds && !agentIds.has(conversation.agentId))) continue;
            for (const message of shown(store.messages.list(conversation.id))) {
              if (String(message.text).toLowerCase().includes(query)) hits.push({ conversationId: conversation.id, title: conversation.title || "New conversation", ...entry(message, conversation, names) });
            }
          }
          hits.sort((a, b) => String(b.at).localeCompare(String(a.at)));
          const start = offsetOf(input.cursor);
          return text({ hits: hits.slice(start, start + PAGE), nextCursor: start + PAGE < hits.length ? String(start + PAGE) : null });
        }
        case "read_conversation": {
          const conversation = visible(account, input.conversationId);
          const list = shown(store.messages.list(conversation.id));
          let from, to;
          if (input.cursor !== undefined && input.cursor !== null) {
            // "older:<index>" or "newer:<index>".
            const [direction, index] = String(input.cursor).split(":");
            const at = offsetOf(index);
            if (direction === "older") { to = at; from = Math.max(0, at - READ_PAGE); } else { from = at; to = Math.min(list.length, at + READ_PAGE); }
          } else if (input.messageId || input.at) {
            const before = Math.min(50, Math.max(0, Number(input.before ?? 10) || 0)), after = Math.min(50, Math.max(0, Number(input.after ?? 10) || 0));
            if (input.messageId) {
              const index = list.findIndex(message => message.id === input.messageId);
              if (index < 0) throw fail(404, "That message isn't in this chat.");
              from = Math.max(0, index - before);
              to = Math.min(list.length, index + 1 + after);
            } else {
              const moment = Date.parse(String(input.at));
              if (!Number.isFinite(moment)) throw fail(400, "Give at as a date and time, such as 2026-10-09T14:30:00Z.");
              // The first message at or after that moment; the earlier ones count as before.
              let index = list.findIndex(message => Date.parse(message.createdAt) >= moment);
              if (index < 0) index = list.length;
              from = Math.max(0, index - before);
              to = Math.min(list.length, index + after);
            }
          } else { to = list.length; from = Math.max(0, to - READ_PAGE); }
          return text({
            conversationId: conversation.id, title: conversation.title || "New conversation", agent: names.get(conversation.agentId) || null,
            messages: list.slice(from, to).map(message => entry(message, conversation, names)),
            olderCursor: from > 0 ? "older:" + from : null, newerCursor: to < list.length ? "newer:" + to : null,
          });
        }
        default: throw fail(404, "Unknown chat tool: " + params.tool);
      }
    },
  };
}

module.exports = { createChatTools, toolSpecs };
