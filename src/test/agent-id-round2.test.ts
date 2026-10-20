import { describe, expect, it, vi } from "vitest";

import { createAgentIdClient } from "@/lib/agent-id/client";
import { attachAgentCommand, loginWithKey } from "@/lib/agent-id/connect";
import {
  callKind,
  conversations,
  formatBytes,
  formatDuration,
  formatListTime,
  formatUsd,
  initials,
  originOf,
  runtimeForOrigin,
} from "@/lib/agent-id/format";

describe("where agents come from", () => {
  it("uses the origin the API reports", () => {
    expect(originOf({ origin: { app: "cursor", label: "Cursor", detail: "~/work" } })).toEqual({
      app: "cursor",
      label: "Cursor",
      detail: "~/work",
    });
    expect(originOf({ origin: { app: "strawberry" } }).label).toBe("Strawberry");
  });

  it("falls back to the older runtime field", () => {
    expect(originOf({ runtime: "codex" }).label).toBe("Codex");
    expect(originOf({ runtime: "claude", origin: null }).app).toBe("claude");
    expect(originOf({ runtime: "any" }).label).toBe("Other");
  });

  it("keeps the runtime field meaningful", () => {
    expect(runtimeForOrigin("claude-code")).toBe("claude");
    expect(runtimeForOrigin("chatgpt")).toBe("codex");
    expect(runtimeForOrigin("energy")).toBe("timewarp");
    expect(runtimeForOrigin("grok")).toBe("other");
  });

  it("makes initials", () => {
    expect(initials("Research Alpha")).toBe("RA");
    expect(initials("bot")).toBe("BO");
  });
});

describe("consumer formats", () => {
  it("shows dollars", () => {
    expect(formatUsd(123456)).toBe("$1,234.56");
    expect(formatUsd(0)).toBe("$0.00");
    expect(formatUsd(null)).toBe("—");
  });

  it("shows list times like a mail app", () => {
    const now = Date.parse("2026-10-20T15:00:00");
    expect(formatListTime("2026-10-20T09:05:00", now)).toMatch(/9:05/);
    expect(formatListTime("2026-03-02T09:05:00", now)).toBe("Mar 2");
    expect(formatListTime("2025-03-02T09:05:00", now)).toBe("Mar 2, 2025");
  });

  it("shows sizes and durations", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5 MB");
    expect(formatDuration(42)).toBe("42s");
    expect(formatDuration(125)).toBe("2:05");
  });
});

describe("phone", () => {
  it("names call kinds, missed included", () => {
    expect(callKind({ direction: "in", status: "missed" })).toBe("missed");
    expect(callKind({ direction: "in", status: "no-answer" })).toBe("missed");
    expect(callKind({ direction: "in", status: "voicemail" })).toBe("voicemail");
    expect(callKind({ direction: "in", status: "completed" })).toBe("incoming");
    expect(callKind({ direction: "out", status: "no-answer" })).toBe("outgoing");
  });

  it("groups texts into conversations", () => {
    const texts = [
      { counterparty: "+1555", at: "2026-10-20T10:00:00Z", direction: "in", text: "hi" },
      { counterparty: "+1666", at: "2026-10-20T11:00:00Z", direction: "out", text: "yo" },
      { counterparty: "+1555", at: "2026-10-20T12:00:00Z", direction: "out", text: "hey" },
    ];
    const threads = conversations(texts, [{ name: "Bob", phone: "+1555" }]);
    expect(threads.map((t) => [t.number, t.name])).toEqual([
      ["+1555", "Bob"],
      ["+1666", null],
    ]);
    expect(threads[0]!.messages.map((m) => m.text)).toEqual(["hi", "hey"]);
    expect(threads[0]!.last.text).toBe("hey");
  });
});

describe("CLI commands", () => {
  it("attaches one agent and signs in with a key", () => {
    expect(attachAgentCommand("bot-1")).toBe("npx @timewarp/agent-id attach --agent bot-1");
    expect(loginWithKey("two_x")).toBe("npx @timewarp/agent-id login --owner-key two_x");
  });
});

describe("client: mail, files and the rest of round 2", () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchFn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} });
    if (String(input).includes("/v1/me/files/f1")) return new Response("data");
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }) as unknown as typeof fetch;
  const client = createAgentIdClient({
    baseUrl: "http://api",
    getToken: async () => "tok",
    fetch: fetchFn,
  });
  const headersOf = (i: number) => (calls[i]?.init.headers ?? {}) as Record<string, string>;

  it("lists, moves and deletes mail as the agent", async () => {
    calls.length = 0;
    const me = client.asAgent("agt_1");
    await me.mail({ folder: "trash", q: "invoice", unread: true });
    await me.mailCounts();
    await me.moveMail("m1", "trash");
    await me.markRead("m1", false);
    await me.deleteMail("m1");
    expect(calls.map((c) => `${c.init.method} ${c.url}`)).toEqual([
      "GET http://api/v1/me/mail?folder=trash&q=invoice&unread=1",
      "GET http://api/v1/me/mail/counts",
      "POST http://api/v1/me/mail/m1/move",
      "POST http://api/v1/me/mail/m1/read",
      "DELETE http://api/v1/me/mail/m1",
    ]);
    expect(headersOf(0)["Timewarp-Agent"]).toBe("agt_1");
    expect(JSON.parse(String(calls[2]?.init.body))).toEqual({ folder: "trash" });
    expect(JSON.parse(String(calls[3]?.init.body))).toEqual({ read: false });
  });

  it("uploads a file as the raw body with its name", async () => {
    calls.length = 0;
    const file = new File(["hello"], "Q3 report.pdf", { type: "application/pdf" });
    await client.asAgent("agt_1").uploadFile(file);
    expect(calls[0]?.url).toBe("http://api/v1/me/files");
    expect(calls[0]?.init.method).toBe("POST");
    expect(calls[0]?.init.body).toBe(file);
    expect(headersOf(0)).toMatchObject({
      "Content-Type": "application/pdf",
      "X-Filename": "Q3%20report.pdf",
    });
  });

  it("downloads a file as a blob", async () => {
    calls.length = 0;
    const blob = await client.asAgent("agt_1").downloadFile("f1");
    // jsdom's Blob has no text(); its size is enough to know the bytes came back.
    expect(blob.size).toBe(4);
    expect(calls[0]?.url).toBe("http://api/v1/me/files/f1");
  });

  it("applies for a card and lists machine files", async () => {
    calls.length = 0;
    await client.applyForCard("agt_1", { useCase: "Cloud", monthlySpend: 50000, country: "SE" });
    await client.asAgent("agt_1").machineFiles("/home/agent");
    await client.updateAgent("agt_1", { origin: { app: "cursor" } });
    expect(calls.map((c) => `${c.init.method} ${c.url}`)).toEqual([
      "POST http://api/v1/agents/agt_1/card-application",
      "GET http://api/v1/me/vm/files?path=%2Fhome%2Fagent",
      "PATCH http://api/v1/agents/agt_1",
    ]);
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      useCase: "Cloud",
      monthlySpend: 50000,
      country: "SE",
    });
  });
});
