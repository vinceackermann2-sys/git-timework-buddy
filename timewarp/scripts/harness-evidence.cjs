"use strict";
function finalText(events, threadId) {
  return events.filter(event => event.method === 'item/completed' && event.params.threadId === threadId &&
    event.params.item?.type === 'agentMessage' && ['final', 'final_answer'].includes(event.params.item.phase))
    .map(event => event.params.item.text).join('\n');
}
function delegationChecks(events, threadId, workerIds, nonce) {
  const rootEnd = events.findIndex(event => event.method === 'turn/completed' && event.params.threadId === threadId && event.params.turn.status === 'completed');
  const calls = events.filter(event => event.method === 'rawResponseItem/completed' && event.params.item?.type === 'function_call').map(event => event.params.item.name);
  const final = finalText(events, threadId);
  return {
    subagentLifecycleObserved: workerIds.length === 1,
    parentFinishedAfterWorker: rootEnd >= 0 && workerIds.length > 0 && workerIds.every(id => {
      const end = events.findIndex(event => event.method === 'turn/completed' && event.params.threadId === id && event.params.turn.status === 'completed');
      return end >= 0 && end < rootEnd;
    }),
    waitsWithoutAgentPolling: calls.includes('wait_agent') && !calls.includes('list_agents'),
    parentReportsVerifiedEvidence: !!nonce && final.includes(nonce) && final.includes('VERIFIED'),
  };
}
module.exports = {finalText, delegationChecks};
