"use strict";

// A late lookup must not put a previous agent's mascot on a new browser turn.
async function resolveCursorAgent({ readSnapshot, resolveAgent, getUserId }, input) {
  if (!input || typeof input.threadId !== 'string' || typeof input.turnId !== 'string') return null;
  const userId = getUserId();
  const matches = () => {
    const state = readSnapshot();
    return userId && getUserId() === userId && state.threadId === input.threadId && state.activeTurnId === input.turnId;
  };
  if (!matches()) return null;
  const agent = await resolveAgent(input);
  if (!matches() || !agent || agent.ownerUserId !== userId) return null;
  return {
    id: agent.id,
    displayName: String(agent.displayName || 'Agent').slice(0, 120),
    avatar: agent.avatarUrl ? { type: agent.avatarType === 'native' ? 'native' : 'upload', url: agent.avatarUrl } : null,
  };
}

module.exports = { resolveCursorAgent };
