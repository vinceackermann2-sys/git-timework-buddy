import { describe, expect, it, vi } from "vitest";

import {
  AgentIdError,
  buildUrl,
  createAgentIdClient,
  errorMessage,
  resolveApiBase,
  resolveDevToken,
  resolveGatewayKey,
} from "@/lib/agent-id/client";
import { shouldRetry } from "@/lib/agent-id/queries";

type Call = { url: string; init: RequestInit };

function fakeFetch(respond: (call: Call) => Response) {
  const calls: Call[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const call = { url: String(input), init: init ?? {} };
    calls.push(call);
    return respond(call);
  });
  return { fn: fn as unknown as typeof fetch, calls };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const headersOf = (call: Call | undefined) => (call?.init.headers ?? {}) as Record<string, string>;

describe("API base and tokens", () => {
  it("uses VITE_AGENT_ID_API when set, without a trailing slash", () => {
    expect(resolveApiBase({ VITE_AGENT_ID_API: "http://127.0.0.1:54329/agent-id/" })).toBe(
      "http://127.0.0.1:54329/agent-id",
    );
  });

  it("falls back to the Supabase function", () => {
    expect(resolveApiBase({ VITE_SUPABASE_URL: "https://abc.supabase.co/" })).toBe(
      "https://abc.supabase.co/functions/v1/agent-id",
    );
    expect(resolveApiBase({})).toBe("");
  });

  it("sends the gateway key only to the Supabase function", () => {
    expect(resolveGatewayKey({ VITE_SUPABASE_PUBLISHABLE_KEY: "pk" })).toBe("pk");
    expect(
      resolveGatewayKey({
        VITE_AGENT_ID_API: "http://localhost/agent-id",
        VITE_SUPABASE_PUBLISHABLE_KEY: "pk",
      }),
    ).toBeUndefined();
  });

  it("reads the dev token", () => {
    expect(resolveDevToken({ VITE_AGENT_ID_DEV_TOKEN: " session:abc " })).toBe("session:abc");
    expect(resolveDevToken({ VITE_AGENT_ID_DEV_TOKEN: "" })).toBeUndefined();
    expect(resolveDevToken({})).toBeUndefined();
  });

  it("builds query strings and skips empty values", () => {
    expect(
      buildUrl("http://x/agent-id/", "/v1/audit", {
        agent: "agt_1",
        limit: 50,
        before: undefined,
        q: "",
      }),
    ).toBe("http://x/agent-id/v1/audit?agent=agt_1&limit=50");
    expect(buildUrl("http://x", "v1/agents")).toBe("http://x/v1/agents");
  });
});

describe("Agent ID client", () => {
  it("sends the bearer token and the gateway key", async () => {
    const { fn, calls } = fakeFetch(() => json({ agents: [] }));
    const client = createAgentIdClient({
      baseUrl: "http://api/agent-id",
      getToken: async () => "tok",
      gatewayKey: "pk",
      fetch: fn,
    });
    await expect(client.listAgents()).resolves.toEqual({ agents: [] });
    expect(calls[0]?.url).toBe("http://api/agent-id/v1/agents");
    expect(calls[0]?.init.method).toBe("GET");
    expect(headersOf(calls[0])).toMatchObject({ Authorization: "Bearer tok", apikey: "pk" });
    expect(headersOf(calls[0])["Content-Type"]).toBeUndefined();
  });

  it("acts as an agent with the Timewarp-Agent header and a JSON body", async () => {
    const { fn, calls } = fakeFetch(() => json({ status: "completed", transfer: {} }));
    const client = createAgentIdClient({
      baseUrl: "http://api/agent-id",
      getToken: async () => "tok",
      fetch: fn,
    });
    await client.asAgent("agt_abc").sendMoney({ to: "bob-1234", value: "12.50", memo: "lunch" });
    expect(calls[0]?.url).toBe("http://api/agent-id/v1/me/wallet/transfers");
    expect(calls[0]?.init.method).toBe("POST");
    expect(headersOf(calls[0])).toMatchObject({
      "Timewarp-Agent": "agt_abc",
      "Content-Type": "application/json",
    });
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      to: "bob-1234",
      value: "12.50",
      memo: "lunch",
    });
  });

  it("uses the right method and path for owner changes", async () => {
    const { fn, calls } = fakeFetch(() => json({ ok: true }));
    const client = createAgentIdClient({
      baseUrl: "http://api",
      getToken: async () => "tok",
      fetch: fn,
    });
    await client.updateResource("agt_1", "card", { status: "suspended" });
    await client.removeResource("agt_1", "vm");
    await client.events("agt_1", { kind: ["sms", "call"], direction: "in", limit: 10 });
    await client.decideReview("person", "user/1", "reject", "Blurry");
    expect(calls.map((c) => `${c.init.method} ${c.url}`)).toEqual([
      "PATCH http://api/v1/agents/agt_1/resources/card",
      "DELETE http://api/v1/agents/agt_1/resources/vm",
      "GET http://api/v1/agents/agt_1/events?kind=sms%2Ccall&direction=in&limit=10",
      "POST http://api/v1/reviews/person/user%2F1",
    ]);
    expect(JSON.parse(String(calls[3]?.init.body))).toEqual({ decision: "reject", note: "Blurry" });
  });

  it("calls the bank routes: verify, accounts, deposit details, withdraw to a bank", async () => {
    const { fn, calls } = fakeFetch(() => json({ ok: true }));
    const client = createAgentIdClient({
      baseUrl: "http://api",
      getToken: async () => "tok",
      fetch: fn,
    });
    await client.bank();
    await client.startBankVerification();
    await client.addBankAccount({
      kind: "iban",
      ownerName: "Ada Lovelace",
      iban: "SE4550000000058398257466",
      address: { line1: "Drottninggatan 1", city: "Stockholm", postalCode: "111 51" },
    });
    await client.removeBankAccount("bnk_1");
    await client.bankDeposit("agt_1", "eur");
    await client.withdraw("agt_1", { bankAccount: "bnk_1", value: "60" });
    expect(calls.map((c) => `${c.init.method ?? "GET"} ${c.url}`)).toEqual([
      "GET http://api/v1/account/bank",
      "POST http://api/v1/account/bank/verify",
      "POST http://api/v1/account/bank/accounts",
      "DELETE http://api/v1/account/bank/accounts/bnk_1",
      "POST http://api/v1/agents/agt_1/wallet/bank-deposit",
      "POST http://api/v1/agents/agt_1/wallet/withdraw",
    ]);
    expect(JSON.parse(String(calls[4]?.init.body))).toEqual({ currency: "eur" });
    expect(JSON.parse(String(calls[5]?.init.body))).toEqual({ bankAccount: "bnk_1", value: "60" });
  });

  it("reads and sets an agent's connected apps, and asks Timewarp about its automations", async () => {
    const { fn, calls } = fakeFetch(() => json({ ok: true }));
    const client = createAgentIdClient({
      baseUrl: "http://api",
      getToken: async () => "tok",
      fetch: fn,
    });
    await client.connectors("agt_1");
    await client.setConnectors("agt_1", { connections: ["ca_gmail"] });
    await client.setConnectors("agt_1", { all: true });
    await client.automations("agt_1");
    await client.automationRequest("agt_1", "auto/1", "run");
    expect(calls.map((c) => `${c.init.method} ${c.url}`)).toEqual([
      "GET http://api/v1/agents/agt_1/connectors",
      "PUT http://api/v1/agents/agt_1/connectors",
      "PUT http://api/v1/agents/agt_1/connectors",
      "GET http://api/v1/agents/agt_1/automations",
      "POST http://api/v1/agents/agt_1/automations/auto%2F1/requests",
    ]);
    expect(
      calls.slice(1).map((c) => (c.init.body ? JSON.parse(String(c.init.body)) : null)),
    ).toEqual([{ connections: ["ca_gmail"] }, { all: true }, null, { action: "run" }]);
  });

  it("turns API errors into AgentIdError with the server's message", async () => {
    const { fn } = fakeFetch(() =>
      json(
        {
          error: {
            code: "over_limit",
            message: "This is over the wallet's limit set by its owner.",
            limit: "daily",
          },
        },
        403,
      ),
    );
    const client = createAgentIdClient({
      baseUrl: "http://api",
      getToken: async () => "tok",
      fetch: fn,
    });
    const error = await client
      .asAgent("agt_1")
      .sendMoney({ to: "x", value: "1.00" })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AgentIdError);
    expect(error).toMatchObject({ status: 403, code: "over_limit", details: { limit: "daily" } });
    expect(errorMessage(error)).toBe("This is over the wallet's limit set by its owner.");
  });

  it("has friendly messages when the server gives none", async () => {
    const { fn } = fakeFetch(() => new Response("Bad gateway", { status: 502 }));
    const client = createAgentIdClient({
      baseUrl: "http://api",
      getToken: async () => "tok",
      fetch: fn,
    });
    const error = (await client.account().catch((e: unknown) => e)) as AgentIdError;
    expect(error.status).toBe(502);
    expect(error.message).toMatch(/having trouble/);
  });

  it("reports network failures and missing sign-in without calling out", async () => {
    const failing = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch;
    const offline = createAgentIdClient({
      baseUrl: "http://api",
      getToken: async () => "tok",
      fetch: failing,
    });
    await expect(offline.account()).rejects.toMatchObject({ code: "network", status: 0 });

    const { fn, calls } = fakeFetch(() => json({}));
    const signedOut = createAgentIdClient({
      baseUrl: "http://api",
      getToken: async () => null,
      fetch: fn,
    });
    await expect(signedOut.account()).rejects.toMatchObject({
      status: 401,
      code: "unauthenticated",
    });
    expect(calls).toHaveLength(0);

    const unconfigured = createAgentIdClient({
      baseUrl: "",
      getToken: async () => "tok",
      fetch: fn,
    });
    await expect(unconfigured.account()).rejects.toMatchObject({ code: "not_configured" });
  });

  it("retries only what a retry could fix", () => {
    expect(shouldRetry(0, new AgentIdError(404, "not_found", "x"))).toBe(false);
    expect(shouldRetry(0, new AgentIdError(503, "unavailable", "x"))).toBe(true);
    expect(shouldRetry(0, new AgentIdError(0, "network", "x"))).toBe(true);
    expect(shouldRetry(2, new AgentIdError(503, "unavailable", "x"))).toBe(false);
  });
});
