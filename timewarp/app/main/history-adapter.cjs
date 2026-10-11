"use strict";
// Presents the engine store through the interface of Timewarp's chat history
// sync (desktop/local-history.cjs), so the cloud history format is unchanged.
function createHistoryAdapter({ store, createAgent, settings }) {
  const entryOf = message => ({
    id: message.id, kind: "message", authorId: message.authorId, createdAt: message.createdAt,
    parts: [{ type: "text", text: message.text }], suggestedReplies: [], replyToMessageId: null,
    forwardedFromMessageId: null, deliveryStatus: message.status === "failed" ? "failed" : null,
  });
  const valueOf = conversation => conversation && {
    conversation: {
      id: conversation.id, kind: "dm", createdByEntityId: conversation.ownerId, title: conversation.title,
      createdAt: conversation.createdAt, updatedAt: conversation.updatedAt, lastActivityAt: conversation.lastActivityAt,
      modelSettings: conversation.modelSettings,
    },
    members: [
      { entityId: conversation.ownerId, archivedAt: conversation.archivedAt, read: conversation.read },
      { entityId: conversation.agentId, archivedAt: null, read: true },
    ],
    entries: store.messages.list(conversation.id).filter(message => message.status !== "replaced").map(entryOf),
  };
  const agentOf = agent => agent && { id: agent.id, ownerUserId: agent.ownerId, displayName: agent.name, deletedAt: agent.archivedAt };
  // Restored metadata is written only where it changes the chat, so a chat
  // that is already up to date costs no write and no change event.
  const json = value => value === undefined || value === null ? null : JSON.stringify(value);
  const updateUnless = (id, patch, same) => {
    const current = store.conversations.get(id);
    if (!current || !same(current)) store.conversations.update(id, patch, { touch: false });
  };
  const conversations = {
    get: id => valueOf(store.conversations.get(id)),
    subscribe(listener) {
      const handler = change => { if (change.kind === "conversation" && !change.removed) listener({ conversation: { id: change.id } }); };
      store.on("change", handler);
      return () => store.off("change", handler);
    },
    create({ id, createdByEntityId, title, createdAt, modelSettings, members }) {
      const agent = members.find(member => member.entityId !== createdByEntityId);
      if (!agent) throw new Error("A restored chat needs an agent.");
      return store.conversations.create({ id, ownerId: createdByEntityId, agentId: agent.entityId, title, createdAt, modelSettings });
    },
    appendEntry(entry) {
      const text = (entry.parts || []).filter(part => part.type === "text").map(part => part.text).join("\n\n");
      store.messages.append({ id: entry.id, conversationId: entry.conversationId, authorId: entry.authorId, createdAt: entry.createdAt, text, status: "sent" });
    },
    setTitle: (id, title) => updateUnless(id, { title }, current => current.title === (title ?? null)),
    setModelSettings: (id, modelSettings) => updateUnless(id, { modelSettings }, current => json(current.modelSettings) === json(modelSettings)),
    // A chat already archived keeps the time it was archived.
    archive: id => updateUnless(id, { archivedAt: new Date().toISOString() }, current => !!current.archivedAt),
    unarchive: id => updateUnless(id, { archivedAt: null }, current => !current.archivedAt),
    setRead: (id, _account, read) => updateUnless(id, { read: !!read }, current => current.read === !!read),
    list: ({ memberId, includeArchived }) => store.conversations.list(memberId, { includeArchived, limit: 100000 }).map(conversation => ({ conversation: { id: conversation.id } })),
  };
  return {
    store: {
      conversations,
      agents: {
        get: async id => agentOf(store.agents.get(id)),
        listActiveByOwner: async owner => store.agents.list(owner).map(agentOf),
      },
      browserProfiles: { bootstrap: async () => store.browserProfiles.ensureDefault() },
      // What sync knew of each chat, kept between launches; a restored chat is
      // written in one commit.
      syncState: { ...store.historySync, transaction: fn => store.transaction(fn) },
    },
    workspace: {
      create: async ({ id, displayName, instructions, avatar, ownerUserId, modelSettings }) =>
        createAgent({ id, ownerId: ownerUserId, name: displayName, instructions, avatarType: avatar?.avatarType, avatarUrl: avatar?.avatarUrl, modelSettings }),
    },
    settings: { get: async () => ({ privacy: settings.get("privacy", { mode: "standard" }), modelSettings: settings.get("modelSettings") }) },
  };
}

module.exports = { createHistoryAdapter };
