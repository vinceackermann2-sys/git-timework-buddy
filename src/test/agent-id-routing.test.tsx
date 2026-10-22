import { QueryClient } from "@tanstack/react-query";
import { createRouter, rootRouteId } from "@tanstack/react-router";
import { describe, expect, it } from "vitest";

import { routeTree } from "@/routeTree.gen";
import {
  AGENT_TABS,
  defaultTab,
  parseAgentTab,
  visibleTabs,
} from "@/components/agent-id/agent/tabs";

// Like app-routing.test.tsx: match without loading or rendering.
describe("Agent ID routing", () => {
  const router = createRouter({ routeTree, context: { queryClient: new QueryClient() } });
  const leaf = (path: string) => router.matchRoutes(path).at(-1)?.routeId;

  it.each([
    ["/agent-id", "/agent-id/"],
    ["/agent-id/", "/agent-id/"],
    ["/agent-id/sign-in", "/agent-id/sign-in"],
    ["/agent-id/claim", "/agent-id/claim/"],
    ["/agent-id/claim/abcdefghijklmnopqrstuvwx", "/agent-id/claim/$code"],
    ["/agent-id/dashboard", "/agent-id/_app/dashboard"],
    ["/agent-id/agents/agt_abcdefghijklmnopqrstuvwx", "/agent-id/_app/agents/$agentId"],
    ["/agent-id/approvals", "/agent-id/_app/approvals"],
    ["/agent-id/verify", "/agent-id/_app/verify"],
    ["/agent-id/developers", "/agent-id/_app/developers"],
    ["/agent-id/reviews", "/agent-id/_app/reviews"],
    ["/agent-id/settings", "/agent-id/_app/settings"],
  ])("matches %s", (path, routeId) => {
    expect(leaf(path)).toBe(routeId);
  });

  it("keeps the site's own pages", () => {
    expect(leaf("/")).not.toBe(rootRouteId);
    expect(leaf("/auth/google")).toBe("/auth/google");
  });

  it("puts every dashboard page behind the signed-in layout", () => {
    const ids = router
      .matchRoutes("/agent-id/agents/agt_abcdefghijklmnopqrstuvwx")
      .map((m) => m.routeId);
    expect(ids).toContain("/agent-id");
    expect(ids).toContain("/agent-id/_app");
  });

  it("keeps getting an Agent ID outside the signed-in layout", () => {
    for (const path of ["/agent-id/claim", "/agent-id/claim/abcdefghijklmnopqrstuvwx"]) {
      const ids = router.matchRoutes(path).map((m) => m.routeId);
      expect(ids).toContain("/agent-id");
      expect(ids).not.toContain("/agent-id/_app");
    }
  });

  it("reads the agent tab from the URL and ignores unknown ones", () => {
    expect(parseAgentTab("wallet")).toBe("wallet");
    expect(parseAgentTab("machine")).toBe("machine");
    expect(parseAgentTab("nope")).toBeUndefined();
    expect(parseAgentTab("connect")).toBeUndefined();
    expect(parseAgentTab(3)).toBeUndefined();
    expect(AGENT_TABS.map(([id]) => id)).toEqual([
      "mail",
      "phone",
      "wallet",
      "card",
      "machine",
      "vault",
      "activity",
      "settings",
    ]);
  });

  it("shows resource tabs once the agent has them, and the card application and vault always", () => {
    const ids = (resources: object, current?: Parameters<typeof visibleTabs>[1]) =>
      visibleTabs({ resources } as Parameters<typeof visibleTabs>[0], current).map(([id]) => id);
    expect(ids({})).toEqual(["card", "vault", "activity", "settings"]);
    expect(ids({ wallet: {}, vm: {} })).toEqual([
      "wallet",
      "card",
      "machine",
      "vault",
      "activity",
      "settings",
    ]);
    expect(ids({}, "mail")).toEqual(["mail", "card", "vault", "activity", "settings"]);
  });

  it("opens an agent on its first resource, else its activity", () => {
    const tab = (resources: object) =>
      defaultTab({ resources } as Parameters<typeof defaultTab>[0]);
    expect(tab({ phone: {}, wallet: {} })).toBe("phone");
    expect(tab({ vm: {} })).toBe("machine");
    expect(tab({})).toBe("activity");
  });
});

describe("the phone tab while numbers are applied for", () => {
  it("shows Phone without a number when phones are an application", () => {
    const ids = (waitlist: boolean) =>
      visibleTabs({ resources: { mail: {} } } as Parameters<typeof visibleTabs>[0], undefined, {
        phonesWaitlist: waitlist,
      }).map(([id]) => id);
    expect(ids(true)).toContain("phone");
    expect(ids(false)).not.toContain("phone");
  });
});
