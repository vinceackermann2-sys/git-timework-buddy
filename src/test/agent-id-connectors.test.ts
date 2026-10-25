import { describe, expect, it } from "vitest";

import { AgentIdError } from "@/lib/agent-id/client";
import {
  auditActionLabel,
  automationsValue,
  connectorsChange,
  connectorsValue,
  formatNextRun,
} from "@/lib/agent-id/format";
import { isConnectorsUnavailable } from "@/lib/agent-id/queries";

// Some ICU versions put a narrow no-break space before AM/PM.
const plain = (text: string) => text.replace(/\s/g, " ");

describe("connected apps", () => {
  const gmail = { id: "ca_gmail", allowed: true };
  const slack = { id: "ca_slack", allowed: false };
  const notion = { id: "ca_notion", allowed: true };

  it("says in the side menu which ones the agent may use", () => {
    expect(connectorsValue({ all: true, connectors: [] })).toBe("All");
    expect(connectorsValue({ all: false, connectors: [gmail, slack, notion] })).toBe("2 allowed");
    expect(connectorsValue({ all: false, connectors: [slack] })).toBe("None");
    expect(connectorsValue({ all: false, connectors: [] })).toBe("None");
  });

  it("asks for the accounts it may use after one switch, and all of them as all, like Timewarp", () => {
    const data = { connectors: [gmail, slack, notion] };
    expect(connectorsChange(data, "ca_gmail", false)).toEqual({ connections: ["ca_notion"] });
    expect(connectorsChange(data, "ca_slack", true)).toEqual({ all: true });
    // With all on, switching one off keeps the others.
    const all = { connectors: [gmail, { ...slack, allowed: true }, notion] };
    expect(connectorsChange(all, "ca_slack", false)).toEqual({
      connections: ["ca_gmail", "ca_notion"],
    });
  });

  it("knows when the deployment has no connected apps", () => {
    expect(
      isConnectorsUnavailable(new AgentIdError(503, "connectors_unavailable", "Not available")),
    ).toBe(true);
    expect(isConnectorsUnavailable(new AgentIdError(503, "http_503", "Down"))).toBe(false);
    expect(isConnectorsUnavailable(new Error("x"))).toBe(false);
  });

  it("names the changes in the activity log", () => {
    expect(auditActionLabel("connectors.update")).toBe("Connected apps changed");
    expect(auditActionLabel("automation.run")).toBe("Asked Timewarp to run an automation");
  });
});

describe("automations", () => {
  it("counts them in the side menu", () => {
    expect(automationsValue({ automations: [] })).toBe("None");
    expect(automationsValue({ automations: [{}] })).toBe("1 automation");
    expect(automationsValue({ automations: [{}, {}, {}] })).toBe("3 automations");
  });

  it("says when one runs next", () => {
    // Saturday, Oct 24 2026, 9:00 in the local time zone.
    const now = new Date(2026, 9, 24, 9, 0).getTime();
    const at = (...parts: [number, number, number, number, number]) =>
      new Date(...parts).toISOString();
    expect(formatNextRun(null, now)).toBe("");
    expect(formatNextRun("soon", now)).toBe("");
    expect(formatNextRun(at(2026, 9, 24, 8, 0), now)).toBe("now");
    expect(formatNextRun(at(2026, 9, 24, 9, 25), now)).toBe("in 25 min");
    expect(formatNextRun(at(2026, 9, 24, 12, 0), now)).toBe("in 3 h");
    expect(plain(formatNextRun(at(2026, 9, 26, 8, 30), now))).toBe("Mon 8:30 AM");
    expect(plain(formatNextRun(at(2026, 10, 9, 8, 30), now))).toBe("Nov 9, 8:30 AM");
    expect(plain(formatNextRun(at(2027, 0, 4, 8, 30), now))).toBe("Jan 4, 2027, 8:30 AM");
  });
});
