import React, { useEffect, useState } from "react";
import { call } from "../api.js";
import { Avatar, useToast } from "./common.jsx";

// Which agents may use which connected accounts. An agent without a list
// may use every connected account.
export function AppAccess({ agents, connected }) {
  const [access, setAccess] = useState({});
  const toast = useToast();
  const accounts = connected.flatMap(app => app.accounts.map(account => ({ integrationId: app.id, accountId: account.id, label: `${app.displayName} · ${account.displayName}` })));
  useEffect(() => {
    let cancelled = false;
    Promise.all(agents.map(agent => call("integrations.getAccess", { agentId: agent.id }).then(value => [agent.id, value.items]).catch(() => [agent.id, null])))
      .then(entries => { if (!cancelled) setAccess(Object.fromEntries(entries)); });
    return () => { cancelled = true; };
  }, [agents.map(agent => agent.id).join(), accounts.length]);
  const allowed = (agentId, account) => access[agentId] === null || access[agentId] === undefined || access[agentId].some(item => item.integrationId === account.integrationId && item.accountId === account.accountId);
  async function toggle(agentId, account, value) {
    const current = accounts.filter(item => allowed(agentId, item));
    const next = value ? [...current, account] : current.filter(item => item.integrationId !== account.integrationId || item.accountId !== account.accountId);
    // Every account allowed again means no restriction.
    const items = next.length === accounts.length ? null : next.map(item => ({ kind: "integration", owner: "user", integrationId: item.integrationId, accountId: item.accountId }));
    const previous = access[agentId];
    setAccess(state => ({ ...state, [agentId]: items }));
    try { await call("integrations.setAccess", { agentId, items }); }
    catch (error) { setAccess(state => ({ ...state, [agentId]: previous })); toast(error, "error"); }
  }
  if (!accounts.length || !agents.length) return null;
  return (
    <div className="tw-card">
      <h3>Agent access</h3>
      <span className="tw-hint">Choose which connected accounts each agent can use.</span>
      <div className="tw-rows">
        {agents.map(agent => (
          <div key={agent.id} className="tw-rows-item" style={{ alignItems: "flex-start" }}>
            <Avatar agent={agent} />
            <div style={{ flex: 1, minWidth: 0, display: "grid", gap: 6 }}>
              <strong>{agent.name}</strong>
              {accounts.map(account => (
                <label key={account.integrationId + account.accountId} className="tw-check">
                  <input type="checkbox" checked={allowed(agent.id, account)} onChange={event => void toggle(agent.id, account, event.target.checked)} />
                  <span>{account.label}</span>
                </label>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
