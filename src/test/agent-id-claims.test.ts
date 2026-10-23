import { describe, expect, it, vi } from "vitest";

import {
  CLAIM_SESSION_HEADER,
  claimCommand,
  claimScreen,
  cleanCode,
  createClaimsClient,
  readClaimMemory,
  resendWait,
  writeClaimMemory,
  type Claim,
} from "@/lib/agent-id/claims";
import { AgentIdError } from "@/lib/agent-id/client";

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

const claim = (patch: Partial<Claim> = {}): Claim => ({
  code: "abcdefghijklmnopqrstuvwx",
  name: "Travel Planner",
  app: { app: "claude-code", label: "Claude Code" },
  device: "MacBook Pro",
  startedBy: "agent",
  matchCode: "ABCD-EFGH",
  status: "pending",
  email: null,
  emailConfirmed: false,
  expiresAt: "2026-10-20T16:00:00.000Z",
  createdAt: "2026-10-20T15:00:00.000Z",
  ...patch,
});

class MemoryStorage implements Storage {
  private items = new Map<string, string>();
  get length() {
    return this.items.size;
  }
  clear() {
    this.items.clear();
  }
  getItem(key: string) {
    return this.items.get(key) ?? null;
  }
  key(index: number) {
    return [...this.items.keys()][index] ?? null;
  }
  removeItem(key: string) {
    this.items.delete(key);
  }
  setItem(key: string, value: string) {
    this.items.set(key, value);
  }
}

describe("claims client", () => {
  const base = "http://127.0.0.1:54341/agent-id";

  it("starts a claim as a person, with no Authorization header", async () => {
    const { fn, calls } = fakeFetch(() =>
      json({ claim: claim({ startedBy: "person" }), url: "u", secret: "twc_x" }),
    );
    const client = createClaimsClient({ baseUrl: base, fetch: fn });
    const result = await client.start({ name: "Travel Planner", app: "codex" });
    expect(result.secret).toBe("twc_x");
    expect(calls[0]!.url).toBe(`${base}/v1/claims`);
    expect(calls[0]!.init.method).toBe("POST");
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({
      name: "Travel Planner",
      app: "codex",
      startedBy: "person",
    });
    expect(headersOf(calls[0])["Authorization"]).toBeUndefined();
  });

  it("sends the claim session only once there is one", async () => {
    const { fn, calls } = fakeFetch(() => json({ claim: claim() }));
    const client = createClaimsClient({ baseUrl: base, fetch: fn, gatewayKey: "pk" });
    await client.get("abcdefghijklmnopqrstuvwx");
    await client.get("abcdefghijklmnopqrstuvwx", "twcs_session");
    expect(calls[0]!.init.method).toBe("GET");
    expect(headersOf(calls[0])[CLAIM_SESSION_HEADER]).toBeUndefined();
    expect(headersOf(calls[0])["apikey"]).toBe("pk");
    expect(headersOf(calls[1])[CLAIM_SESSION_HEADER]).toBe("twcs_session");
  });

  it("posts the email, the code (with the terms ticked next to the email) and the terms to their routes", async () => {
    const { fn, calls } = fakeFetch(() => json({ claim: claim() }));
    const client = createClaimsClient({ baseUrl: base, fetch: fn });
    await client.sendCode("abc123abc123abc123abc123", "me@example.com");
    await client.confirmEmail("abc123abc123abc123abc123", "123456", "2026-10-20");
    await client.confirmEmail("abc123abc123abc123abc123", "654321");
    await client.acceptTerms("abc123abc123abc123abc123", "twcs_s", "2026-10-20");
    expect(calls.map((c) => c.url.replace(base, ""))).toEqual([
      "/v1/claims/abc123abc123abc123abc123/email",
      "/v1/claims/abc123abc123abc123abc123/email/confirm",
      "/v1/claims/abc123abc123abc123abc123/email/confirm",
      "/v1/claims/abc123abc123abc123abc123/terms",
    ]);
    expect(JSON.parse(String(calls[1]!.init.body))).toEqual({
      code: "123456",
      terms: "2026-10-20",
    });
    expect(JSON.parse(String(calls[2]!.init.body))).toEqual({ code: "654321" });
    expect(headersOf(calls[3])[CLAIM_SESSION_HEADER]).toBe("twcs_s");
  });

  it("starts a claim from the website without a name", async () => {
    const { fn, calls } = fakeFetch(() => json({ claim: claim(), url: "u", secret: "twc_x" }));
    const client = createClaimsClient({ baseUrl: base, fetch: fn });
    await client.start();
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ startedBy: "person" });
  });

  it("turns API errors into AgentIdErrors with their code", async () => {
    const { fn } = fakeFetch(() =>
      json({ error: { code: "wrong_code", message: "That code isn't right." } }, 400),
    );
    const client = createClaimsClient({ baseUrl: base, fetch: fn });
    const error = await client.confirmEmail("abc", "000000").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AgentIdError);
    expect((error as AgentIdError).code).toBe("wrong_code");
    expect((error as AgentIdError).message).toBe("That code isn't right.");
  });

  it("says so when the network is down", async () => {
    const client = createClaimsClient({
      baseUrl: base,
      fetch: (async () => {
        throw new TypeError("Failed to fetch");
      }) as typeof fetch,
    });
    await expect(client.get("abc")).rejects.toMatchObject({ code: "network" });
  });
});

describe("which claim screen to show", () => {
  it("starts visitors without the session at the email step", () => {
    expect(claimScreen(claim())).toBe("email");
    expect(claimScreen(claim({ status: "verifying", emailConfirmed: true }))).toBe("email");
  });

  it("follows the API's step once the email is confirmed here", () => {
    expect(claimScreen(claim({ step: "terms" }))).toBe("terms");
    expect(claimScreen(claim({ status: "claimed", step: "done" }))).toBe("done");
  });

  it("knows expired links and Agent IDs claimed in another browser", () => {
    expect(claimScreen(claim({ status: "expired" }))).toBe("expired");
    expect(claimScreen(claim({ status: "claimed" }))).toBe("claimed-elsewhere");
  });
});

describe("claim helpers", () => {
  it("keeps the digits of a typed or pasted code", () => {
    expect(cleanCode("123 456")).toBe("123456");
    expect(cleanCode("12-34-56-78")).toBe("123456");
    expect(cleanCode("abc")).toBe("");
  });

  it("counts down to the next code", () => {
    expect(resendWait(null)).toBe(0);
    expect(resendWait(1_000, 1_000)).toBe(30);
    expect(resendWait(1_000, 11_500)).toBe(20);
    expect(resendWait(1_000, 40_000)).toBe(0);
  });

  it("shows the attach command with the claim secret", () => {
    expect(claimCommand("twc_abc")).toBe("npx @timewarp/agent-id attach --claim twc_abc");
  });

  it("remembers a claim's secret and session per tab, and forgets them", () => {
    const store = new MemoryStorage();
    expect(readClaimMemory("c1", store)).toEqual({});
    writeClaimMemory("c1", { secret: "twc_one" }, store);
    writeClaimMemory("c1", { session: "twcs_s" }, store);
    expect(readClaimMemory("c1", store)).toEqual({ secret: "twc_one", session: "twcs_s" });
    expect(readClaimMemory("c2", store)).toEqual({});
    writeClaimMemory("c1", { session: null }, store);
    expect(readClaimMemory("c1", store)).toEqual({ secret: "twc_one" });
    writeClaimMemory("c1", { secret: null }, store);
    expect(store.length).toBe(0);
  });

  it("ignores what doesn't look like a claim secret", () => {
    const store = new MemoryStorage();
    store.setItem("agent-id-claim:c1", JSON.stringify({ secret: "nope", session: 4 }));
    expect(readClaimMemory("c1", store)).toEqual({});
    store.setItem("agent-id-claim:c1", "{not json");
    expect(readClaimMemory("c1", store)).toEqual({});
    expect(readClaimMemory("c1", null)).toEqual({});
  });
});
