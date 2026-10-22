import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { parseHosts, sealForVault, siteOrigin } from "@/lib/agent-id/vault";
import { VAULT_VM_SCRIPT } from "../../timewarp/supabase/functions/agent-id/vault/vm-script";

// The vault program on a stand-in computer: sealed in the browser here,
// opened by the same program the agent's computer runs.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tw-vault-web-"));
const script = path.join(dir, "vault.js");
fs.writeFileSync(script, VAULT_VM_SCRIPT);
const run = (op: string, input: object = {}) =>
  JSON.parse(
    execFileSync(
      process.execPath,
      [script, op, Buffer.from(JSON.stringify(input)).toString("base64")],
      {
        env: { ...process.env, AGENT_ID_VAULT_HOME: path.join(dir, "home") },
        encoding: "utf8",
      },
    ),
  );
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("sealing in the browser", () => {
  it("is opened by the vault on the agent's computer, and only there", async () => {
    const { publicKey } = run("init");
    const sealed = await sealForVault(publicKey, {
      kind: "key",
      value: "sk-browser-sealed-1",
      hosts: ["api.example.com"],
      send: { as: "header", name: "X-Api-Key" },
    });
    expect(JSON.stringify(sealed)).not.toContain("sk-browser");
    expect(run("put", { id: `vlt_${"1".repeat(24)}`, envelope: sealed })).toEqual({
      kind: "key",
      hosts: ["api.example.com"],
      send: "header",
    });
    const login = await sealForVault(publicKey, {
      kind: "login",
      site: "https://github.com",
      username: "ada",
      password: "pw-long-enough",
    });
    expect(run("put", { id: `vlt_${"2".repeat(24)}`, envelope: login })).toEqual({
      kind: "login",
      site: "https://github.com",
      totp: false,
    });
    // Tampered on the way: refused.
    const tampered = { ...sealed, data: sealed.data.slice(0, -4) + "AAAA" };
    expect(() => run("put", { id: `vlt_${"3".repeat(24)}`, envelope: tampered })).toThrow();
  });

  it("reads the sites a key may go to, and a sign-in's website", () => {
    expect(parseHosts("api.github.com, https://API.openai.com/v1 *.example.com")).toEqual([
      "api.github.com",
      "api.openai.com",
      "*.example.com",
    ]);
    expect(parseHosts("localhost")).toBeNull();
    expect(parseHosts("")).toBeNull();
    expect(siteOrigin("github.com/login")).toBe("https://github.com");
    expect(siteOrigin("http://example.com")).toBeNull();
  });
});
