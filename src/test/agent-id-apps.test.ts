import { describe, expect, it, vi } from "vitest";

import { agentApps, appLabel, groupApps, listLabel, markOf } from "@/lib/agent-id/apps";
import { createAgentIdClient } from "@/lib/agent-id/client";
import {
  documentProblem,
  isWalletAddress,
  shortAddress,
  vatCheckLabel,
} from "@/lib/agent-id/format";

describe("app marks", () => {
  it("gives each maker one mark", () => {
    expect(markOf("claude-code")).toBe("claude");
    expect(markOf("claude-desktop")).toBe("claude");
    expect(markOf("codex")).toBe("openai");
    expect(markOf("chatgpt")).toBe("openai");
    expect(markOf("cursor")).toBe("cursor");
    expect(markOf("grok")).toBe("grok");
    expect(markOf("gemini")).toBe("gemini");
    expect(markOf("windsurf")).toBe("windsurf");
    expect(markOf("copilot")).toBe("copilot");
    expect(markOf("timewarp")).toBe("timewarp");
    expect(markOf("some-new-client")).toBe("letter");
  });

  it("names apps it doesn't know from their slug", () => {
    expect(appLabel("some-new-client")).toBe("Some New Client");
    expect(appLabel("cursor")).toBe("Cursor");
    expect(appLabel("copilot", "GitHub Copilot")).toBe("GitHub Copilot");
  });

  it("lists names the way a person says them", () => {
    expect(listLabel([])).toBe("");
    expect(listLabel(["Codex"])).toBe("Codex");
    expect(listLabel(["Codex", "ChatGPT"])).toBe("Codex and ChatGPT");
    expect(listLabel(["A", "B", "C"])).toBe("A, B and C");
  });
});

describe("the apps an agent is used in", () => {
  it("uses the API's list, most recent first, without duplicates or placeholders", () => {
    const apps = agentApps({
      apps: [
        { app: "cursor", label: "Cursor" },
        { app: "codex", label: "Codex" },
        { app: "cursor", label: "Cursor" },
        { app: "custom", label: "Custom agent" },
        { app: "claude-code", label: "" },
      ],
    });
    expect(apps.map((a) => [a.app, a.label])).toEqual([
      ["cursor", "Cursor"],
      ["codex", "Codex"],
      ["claude-code", "Claude Code"],
    ]);
  });

  it("falls back to the app it was made for", () => {
    expect(agentApps({ apps: [], origin: { app: "grok", label: "Grok" } })).toEqual([
      { app: "grok", label: "Grok" },
    ]);
    expect(agentApps({ runtime: "codex" })).toEqual([{ app: "codex", label: "Codex" }]);
    expect(agentApps({ origin: { app: "custom", label: "Custom agent" } })).toEqual([]);
    expect(agentApps({ runtime: "any" })).toEqual([]);
  });

  it("shows one icon per mark, naming every app behind it", () => {
    const groups = groupApps([
      { app: "chatgpt", label: "ChatGPT" },
      { app: "cursor", label: "Cursor" },
      { app: "codex", label: "Codex" },
      { app: "hermes", label: "Hermes" },
      { app: "moltbot", label: "Moltbot" },
    ]);
    expect(groups.map((g) => [g.app, g.mark, g.label])).toEqual([
      ["chatgpt", "openai", "ChatGPT and Codex"],
      ["cursor", "cursor", "Cursor"],
      ["hermes", "letter", "Hermes"],
      ["moltbot", "letter", "Moltbot"],
    ]);
  });
});

describe("wallet and verification helpers", () => {
  it("knows a wallet address on Base", () => {
    expect(isWalletAddress("0x" + "a".repeat(40))).toBe(true);
    expect(isWalletAddress(" 0x" + "A1".repeat(20) + " ")).toBe(true);
    expect(isWalletAddress("0x" + "a".repeat(39))).toBe(false);
    expect(isWalletAddress("research-assistant-x1")).toBe(false);
    expect(shortAddress("0x1234567890abcdef1234567890abcdef12345678")).toBe("0x1234…5678");
    expect(shortAddress("0x12")).toBe("0x12");
  });

  it("says what the VAT register answered", () => {
    expect(vatCheckLabel({ status: "valid" })).toEqual({
      label: "VAT number valid",
      tone: "success",
    });
    expect(vatCheckLabel({ status: "invalid" })?.tone).toBe("danger");
    expect(vatCheckLabel({ status: "unavailable" })?.tone).toBe("warning");
    expect(vatCheckLabel({ status: "not_applicable" })?.tone).toBe("neutral");
    expect(vatCheckLabel(undefined)).toBeNull();
  });

  it("takes PDFs and photos up to 10 MB as the registration document", () => {
    expect(documentProblem({ type: "application/pdf", size: 1000 })).toBeNull();
    expect(documentProblem({ type: "image/jpeg", size: 1000 })).toBeNull();
    expect(documentProblem({ type: "text/plain", size: 1000 })).toMatch(/PDF or a photo/);
    expect(documentProblem({ type: "image/png", size: 11 * 1024 * 1024 })).toMatch(/10 MB/);
    expect(documentProblem({ type: "image/png", size: 0 })).toMatch(/empty/);
  });
});

describe("wallet and document routes", () => {
  type Call = { url: string; init: RequestInit };
  const calls: Call[] = [];
  const client = createAgentIdClient({
    baseUrl: "http://api/agent-id",
    getToken: async () => "tok",
    fetch: vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init: init ?? {} });
      return new Response(JSON.stringify({}), { status: 200 });
    }) as unknown as typeof fetch,
  });

  it("adds money, buys by card and withdraws on the owner's routes", async () => {
    calls.length = 0;
    await client.addMoneyInfo("agt_1");
    await client.buyWithCard("agt_1", "50.00");
    await client.withdraw("agt_1", { to: "0xabc", value: "12.50", remember: true });
    expect(calls.map((c) => [c.init.method, c.url])).toEqual([
      ["GET", "http://api/agent-id/v1/agents/agt_1/wallet/add-money"],
      ["POST", "http://api/agent-id/v1/agents/agt_1/wallet/add-money"],
      ["POST", "http://api/agent-id/v1/agents/agt_1/wallet/withdraw"],
    ]);
    expect(JSON.parse(String(calls[1]!.init.body))).toEqual({ amount: "50.00" });
    expect(JSON.parse(String(calls[2]!.init.body))).toEqual({
      to: "0xabc",
      value: "12.50",
      remember: true,
    });
  });

  it("uploads the business document as the raw body, named in a header", async () => {
    calls.length = 0;
    const file = new File(["%PDF"], "Bolagsverket extract.pdf", { type: "application/pdf" });
    await client.uploadBusinessDocument("org-1", file);
    expect(calls[0]!.url).toBe(
      "http://api/agent-id/v1/account/verification/document?organization=org-1",
    );
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/pdf");
    expect(headers["X-Filename"]).toBe("Bolagsverket%20extract.pdf");
    expect(calls[0]!.init.body).toBe(file);
  });
});

describe("setting up a new agent", () => {
  it("polls while any resource is still being set up", async () => {
    const { settingUp } = await import("@/lib/agent-id/queries");
    expect(settingUp([{ resources: { mail: { status: "active" } } }])).toBe(false);
    expect(
      settingUp([
        { resources: { mail: { status: "active" }, wallet: { status: "provisioning" } } },
      ]),
    ).toBe(true);
    expect(settingUp([])).toBe(false);
  });
});
