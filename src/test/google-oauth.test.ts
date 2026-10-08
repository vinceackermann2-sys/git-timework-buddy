// @vitest-environment node
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import {
  beginGoogleOAuth,
  consumePendingGoogleOAuth,
  encryptDesktopHandoff,
} from "../lib/googleOAuth";

const require = createRequire(import.meta.url);
const {
  createGoogleFlow,
  decryptGoogleHandoff,
} = require("../../timewarp/shared/google-oauth.cjs");

describe("branded Google desktop handoff", () => {
  beforeEach(() => {
    const storage = new Map<string, string>();
    vi.stubGlobal("sessionStorage", {
      setItem: (key: string, value: string) => storage.set(key, value),
      getItem: (key: string) => storage.get(key) ?? null,
      removeItem: (key: string) => storage.delete(key),
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("uses the branded registered callback, device nonce, and one-use browser state", async () => {
    const flow = createGoogleFlow();
    const desktop = {
      state: flow.state,
      publicKey: flow.publicKey,
      nonceHash: createHash("sha256").update(flow.nonce).digest("hex"),
    };
    const url = new URL(await beginGoogleOAuth({ target: "energy-desktop", desktop }));
    expect(url.origin).toBe("https://accounts.google.com");
    expect(url.searchParams.get("redirect_uri")).toBe("https://timewarpdev.com/auth/v1/callback");
    expect(url.searchParams.get("nonce")).toBe(desktop.nonceHash);
    const state = url.searchParams.get("state")!;
    expect(consumePendingGoogleOAuth(state)?.desktop).toEqual(desktop);
    expect(consumePendingGoogleOAuth(state)).toBeNull();
  });

  it("produces an assertion the initiating desktop can decrypt and another device cannot", async () => {
    const flow = createGoogleFlow();
    const desktop = {
      state: flow.state,
      publicKey: flow.publicKey,
      nonceHash: createHash("sha256").update(flow.nonce).digest("hex"),
    };
    const assertion = "test-google-identity-assertion";
    const code = await encryptDesktopHandoff(assertion, desktop);
    expect(code).not.toContain(assertion);
    expect(decryptGoogleHandoff(code, flow)).toBe(assertion);
    expect(() => decryptGoogleHandoff(code, createGoogleFlow())).toThrow();
  });

  it("rejects expired requests and an invalid desktop encryption key", async () => {
    const state = "a".repeat(64);
    sessionStorage.setItem(
      "timewarp.google-oauth." + state,
      JSON.stringify({ nonce: state, target: "energy-desktop", createdAt: Date.now() - 600001 }),
    );
    expect(consumePendingGoogleOAuth(state)).toBeNull();
    await expect(
      beginGoogleOAuth({
        target: "energy-desktop",
        desktop: { state, publicKey: "bad", nonceHash: state },
      }),
    ).rejects.toThrow();
  });
});
