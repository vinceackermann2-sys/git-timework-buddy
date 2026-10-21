// The tabs on an agent's page; the id is the `tab` search param. Mail, Phone,
// Wallet and Machine show once the agent has them; Card is always there (it is
// the early-access application), and so is Phone while numbers are applied for.
import type { Agent, Kind } from "@/lib/agent-id/types";

export const AGENT_TABS = [
  ["mail", "Mail"],
  ["phone", "Phone"],
  ["wallet", "Wallet"],
  ["card", "Card"],
  ["machine", "Computer"],
  ["activity", "Activity"],
  ["settings", "Settings"],
] as const;

export type AgentTab = (typeof AGENT_TABS)[number][0];

const TAB_IDS: readonly string[] = AGENT_TABS.map(([id]) => id);

export function parseAgentTab(value: unknown): AgentTab | undefined {
  return typeof value === "string" && TAB_IDS.includes(value) ? (value as AgentTab) : undefined;
}

// The tab that shows a resource kind.
export const KIND_TABS = {
  mail: "mail",
  phone: "phone",
  wallet: "wallet",
  card: "card",
  vm: "machine",
} as const satisfies Record<Kind, AgentTab>;

const NEEDS: Partial<Record<AgentTab, Kind>> = {
  mail: "mail",
  phone: "phone",
  wallet: "wallet",
  machine: "vm",
};

// The tabs this agent shows, keeping the one being looked at so a link to a
// removed resource still lands.
export function visibleTabs(
  agent: Pick<Agent, "resources">,
  current?: AgentTab,
  options: { phonesWaitlist?: boolean } = {},
) {
  return AGENT_TABS.filter(([id]) => {
    const kind = NEEDS[id];
    return (
      !kind ||
      !!agent.resources[kind] ||
      id === current ||
      (id === "phone" && !!options.phonesWaitlist)
    );
  });
}

// Where an agent's page opens: its first resource, else its activity.
export function defaultTab(agent: Pick<Agent, "resources">): AgentTab {
  const first = visibleTabs(agent).find(([id]) => NEEDS[id]);
  return first ? first[0] : "activity";
}
