import { describe, expect, it } from "vitest";

import {
  amountValue,
  auditActionLabel,
  auditDetail,
  centsToInput,
  counterpartyLabel,
  declineReason,
  formatCents,
  formatMoney,
  formatRelativeTime,
  liveAvailability,
  parseAmount,
  parseList,
  runtimeLabel,
  safeRedirect,
} from "@/lib/agent-id/format";
import {
  ATTACH_COMMAND,
  attachCommand,
  claudeCodeCommand,
  codexConfig,
  envExport,
  githubActionSnippet,
  verifySdkSnippet,
} from "@/lib/agent-id/connect";
import type { PublicConfig } from "@/lib/agent-id/types";

describe("money", () => {
  it("formats minor units", () => {
    expect(formatCents(1234, "USD")).toBe("$12.34");
    expect(formatCents(100000, "USD")).toBe("$1,000.00");
    expect(formatCents(250, "USDC")).toBe("2.50 USDC");
    expect(formatMoney({ amount: 5, currency: "EUR" })).toBe("€0.05");
    expect(formatMoney(null)).toBe("—");
  });

  it("parses what people type into cents", () => {
    expect(parseAmount("12.50")).toBe(1250);
    expect(parseAmount("12,5")).toBe(1250);
    expect(parseAmount("$7")).toBe(700);
    expect(parseAmount(" 0.01 ")).toBe(1);
    expect(parseAmount("0")).toBeNull();
    expect(parseAmount("0", { allowZero: true })).toBe(0);
    expect(parseAmount("1.234")).toBeNull();
    expect(parseAmount("-3")).toBeNull();
    expect(parseAmount("abc")).toBeNull();
    expect(parseAmount("")).toBeNull();
  });

  it("gives the API's decimal value and back", () => {
    expect(amountValue("3")).toBe("3.00");
    expect(amountValue("nope")).toBeNull();
    expect(centsToInput(2500)).toBe("25.00");
    expect(centsToInput(undefined)).toBe("");
  });
});

describe("labels", () => {
  it("reads relative times", () => {
    const now = Date.parse("2026-10-20T12:00:00Z");
    expect(formatRelativeTime(null, now)).toBe("Never");
    expect(formatRelativeTime("2026-10-20T11:59:50Z", now)).toBe("just now");
    expect(formatRelativeTime("2026-10-20T11:55:00Z", now)).toBe("5 min ago");
    expect(formatRelativeTime("2026-10-20T09:00:00Z", now)).toBe("3 h ago");
    expect(formatRelativeTime("2026-10-19T10:00:00Z", now)).toBe("yesterday");
    expect(formatRelativeTime("2026-10-17T12:00:00Z", now)).toBe("3 days ago");
    expect(formatRelativeTime("2026-09-01T12:00:00Z", now)).toMatch(/Sep 1, 2026/);
  });

  it("names runtimes, declines and audit actions", () => {
    expect(runtimeLabel("codex")).toBe("Codex");
    expect(runtimeLabel("any")).toBe("Any runtime");
    expect(declineReason("over_transaction_limit")).toBe("Over the per-payment limit");
    expect(declineReason("something_new")).toBe("something new");
    expect(declineReason(undefined)).toBe("Declined");
    expect(auditActionLabel("wallet.approval_requested")).toBe("Transfer waiting for approval");
    expect(auditActionLabel("brand.new_thing")).toBe("Brand new thing");
  });

  it("summarizes audit details without secrets", () => {
    expect(
      auditDetail({
        action: "wallet.send",
        detail: { amount: 3000, currency: "USD", to: "Bob (agt_x)", mode: "test" },
      }),
    ).toBe("Test · $30.00 · to Bob");
    expect(
      auditDetail({
        action: "resource.provision",
        detail: { kind: "vm", mode: "live", provider: "azure" },
      }),
    ).toBe("Machine · Live");
    expect(auditDetail({ action: "mail.send", detail: { to: 2, mode: "test" } })).toBe(
      "Test · 2 recipients",
    );
    expect(
      auditDetail({ action: "agent_key.create", detail: { key: "uuid", prefix: "twa_abcd" } }),
    ).toBe("twa_abcd…");
  });

  it("names other agents without their ids", () => {
    expect(counterpartyLabel("Courier Beta (agt_o3yao55unwybnxltgonfkbkg)")).toBe("Courier Beta");
    expect(counterpartyLabel("test_abc")).toBe("test_abc");
    expect(counterpartyLabel(null)).toBe("—");
  });

  it("splits category lists", () => {
    expect(parseList("Gambling, airlines\nairlines,, ")).toEqual(["gambling", "airlines"]);
  });

  it("only returns to Agent ID pages after sign-in", () => {
    expect(safeRedirect("/agent-id/agents/agt_1?tab=mail")).toBe("/agent-id/agents/agt_1?tab=mail");
    expect(safeRedirect("/agent-id")).toBe("/agent-id");
    expect(safeRedirect("https://evil.example")).toBe("/agent-id/dashboard");
    expect(safeRedirect("//evil.example/agent-id")).toBe("/agent-id/dashboard");
    expect(safeRedirect("/agent-id//evil.example")).toBe("/agent-id/dashboard");
    expect(safeRedirect("/agent-idx")).toBe("/agent-id/dashboard");
    expect(safeRedirect(undefined)).toBe("/agent-id/dashboard");
  });
});

describe("live availability", () => {
  const config = {
    resources: {
      mail: {
        live: true,
        provider: "resend",
        verificationRequired: false,
        paidPlanRequired: false,
      },
      phone: {
        live: true,
        provider: "twilio",
        verificationRequired: false,
        paidPlanRequired: true,
      },
      wallet: { live: true, provider: "cdp", verificationRequired: true, paidPlanRequired: false },
      card: {
        live: true,
        provider: "stripe_issuing",
        verificationRequired: true,
        paidPlanRequired: true,
      },
      vm: { live: false, provider: "test", verificationRequired: false, paidPlanRequired: false },
    },
  } as unknown as PublicConfig;

  it("is ready when nothing is required", () => {
    expect(liveAvailability("mail", config, { plan: "free" })).toMatchObject({
      available: true,
      ready: true,
      reason: null,
    });
  });

  it("explains what is missing", () => {
    const card = liveAvailability("card", config, { plan: "free", verified: false });
    expect(card.available).toBe(true);
    expect(card.ready).toBe(false);
    expect(card.requirements).toEqual([
      { label: "a verified owner", met: false },
      { label: "a paid Timewarp plan", met: false },
    ]);
    expect(card.reason).toBe("Live needs a verified owner and a paid Timewarp plan.");
    expect(liveAvailability("card", config, { plan: "pro", verified: true }).ready).toBe(true);
    expect(liveAvailability("phone", config, { plan: "pro" }).ready).toBe(true);
  });

  it("says when live isn't offered at all", () => {
    const vm = liveAvailability("vm", config, { plan: "pro", verified: true });
    expect(vm.available).toBe(false);
    expect(vm.reason).toBe("Live machines aren't available yet.");
    expect(liveAvailability("mail", undefined, {}).available).toBe(false);
  });
});

describe("connect snippets", () => {
  const mcp = "https://x.supabase.co/functions/v1/agent-id/mcp";

  it("makes attach the one command to run", () => {
    expect(ATTACH_COMMAND).toBe("npx @timewarp/agent-id attach");
    expect(attachCommand("research-bot-x7k2")).toBe(
      "npx @timewarp/agent-id attach --agent research-bot-x7k2",
    );
    expect(attachCommand(null)).toBe(ATTACH_COMMAND);
  });

  it("matches the documented manual setup", () => {
    expect(claudeCodeCommand(mcp, "twa_secret")).toBe(
      `claude mcp add --transport http timewarp-id ${mcp} --header "Authorization: Bearer twa_secret"`,
    );
    expect(claudeCodeCommand(mcp)).toContain("Bearer twa_…");
    expect(codexConfig(mcp)).toBe(
      `[mcp_servers.timewarp_id]
url = "${mcp}"
bearer_token_env_var = "TIMEWARP_AGENT_KEY"`,
    );
    expect(envExport("twa_k")).toBe('export TIMEWARP_AGENT_KEY="twa_k"');
  });

  it("checks passports for the company's audience", () => {
    expect(verifySdkSnippet("https://api.acme.test")).toContain(
      'verifyPassport(passport, { audience: "https://api.acme.test" })',
    );
    expect(githubActionSnippet()).toContain("uses: timewarp/agent-id/action@v1");
    expect(githubActionSnippet()).toContain("secret: ${{ secrets.AGENT_ID_SECRET }}");
  });
});
