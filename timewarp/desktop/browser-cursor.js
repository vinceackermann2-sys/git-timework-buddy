"use strict";

function createUseBrowserCursorAgent({ b, request }) {
  return function useBrowserCursorAgent(threadId, turnId) {
    const key = threadId && turnId ? JSON.stringify([threadId, turnId]) : null;
    const [resolved, setResolved] = b.useState(null);
    b.useEffect(() => {
      let current = true;
      if (key) Promise.resolve().then(() => request({ threadId, turnId })).then(agent => {
        if (current) setResolved({ key, agent });
      }).catch(() => { if (current) setResolved({ key, agent: null }); });
      return () => { current = false; };
    }, [key]);
    return key && resolved?.key === key ? resolved.agent : null;
  };
}

module.exports = { createUseBrowserCursorAgent };
