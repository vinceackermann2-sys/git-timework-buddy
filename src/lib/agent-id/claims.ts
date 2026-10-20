// Getting an Agent ID without an account (the API's /v1/claims). Someone
// (a person on this website, or an agent through the CLI) starts a claim and
// gets a link; whoever opens it confirms an email with a code and verifies
// their identity, which makes their Timewarp account. No sign-in anywhere:
// the link, the email code, the claim session and the claim secret stand in.
import { AgentIdError, buildUrl, errorFromResponse } from "./client";
import type { PublicConfig } from "./types";

export type ClaimStatus = "pending" | "verifying" | "claimed" | "expired";
export type ClaimStep = "email" | "identity" | "checking" | "done";

export type ClaimPerson = {
  status: "unverified" | "pending" | "verified" | "rejected";
  provider?: string | null;
  legalName?: string | null;
  country?: string | null;
  verifiedAt?: string | null;
  lastError?: string | null;
  consentAt?: string | null;
};

export type Claim = {
  code: string;
  name: string;
  app: { app: string; label: string } | null;
  device: string | null;
  startedBy: "agent" | "person";
  // Shown by the agent too, so the person can tell it's the same request.
  matchCode: string;
  status: ClaimStatus;
  // Masked ("v••••@example.com") unless the browser holds the claim session.
  email: string | null;
  emailConfirmed: boolean;
  expiresAt: string;
  createdAt: string;
  // The full view, for the browser that confirmed the email:
  step?: ClaimStep;
  person?: ClaimPerson;
  terms?: { accepted: boolean; current: string };
  agent?: { id: string; name: string; handle: string } | null;
  keyCollected?: boolean;
};

export type StartedClaim = { claim: Claim; url: string; secret: string };
export type SentCode = { sent: boolean; email: string; devCode?: string };
export type ConfirmedEmail = {
  session: string;
  auth: { access_token: string; refresh_token: string; expires_in: number } | null;
  claim: Claim;
};

export const CLAIM_SESSION_HEADER = "timewarp-claim-session";
export const CLAIM_CODE = /^[a-z0-9]{20,40}$/;

// The command that hands a person-started claim's key to the agent.
export const claimCommand = (secret: string) => `npx @timewarp/agent-id attach --claim ${secret}`;

// The claim routes are open: no Authorization header, only the claim session
// once the email is confirmed.
export function createClaimsClient(options: {
  baseUrl: string;
  gatewayKey?: string | undefined;
  fetch?: typeof fetch;
}) {
  const doFetch = options.fetch ?? ((input, init) => fetch(input, init));

  async function call<T>(
    path: string,
    { body, session }: { body?: unknown; session?: string | null } = {},
  ): Promise<T> {
    if (!options.baseUrl)
      throw new AgentIdError(0, "not_configured", "Agent ID isn't configured on this site.");
    const headers: Record<string, string> = {};
    if (options.gatewayKey) headers["apikey"] = options.gatewayKey;
    if (session) headers[CLAIM_SESSION_HEADER] = session;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    let response: Response;
    try {
      response = await doFetch(buildUrl(options.baseUrl, path), {
        method: body === undefined ? "GET" : "POST",
        headers,
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
    } catch {
      throw new AgentIdError(
        0,
        "network",
        "Can't reach Agent ID. Check your connection and try again.",
      );
    }
    if (!response.ok) throw await errorFromResponse(response);
    return (await response.json()) as T;
  }

  const at = (code: string, rest = "") => `/v1/claims/${encodeURIComponent(code)}${rest}`;

  return {
    // The deployment's public settings (which identity check it uses).
    config: () => call<PublicConfig>("/v1/config"),
    start: (input: { name: string; app?: string }) =>
      call<StartedClaim>("/v1/claims", { body: { ...input, startedBy: "person" } }),
    get: (code: string, session?: string | null) =>
      call<{ claim: Claim }>(at(code), { session: session ?? null }),
    sendCode: (code: string, email: string) =>
      call<SentCode>(at(code, "/email"), { body: { email } }),
    confirmEmail: (code: string, digits: string) =>
      call<ConfirmedEmail>(at(code, "/email/confirm"), { body: { code: digits } }),
    verifyIdentity: (
      code: string,
      session: string,
      input: { consent: true; terms?: string; legalName?: string; country?: string },
    ) => call<{ url?: string; claim: Claim }>(at(code, "/identity"), { body: input, session }),
  };
}

export type ClaimsClient = ReturnType<typeof createClaimsClient>;

// --- What this browser keeps (per tab, per claim) ---------------------------------

export type ClaimMemory = { secret?: string; session?: string };
const memoryKey = (code: string) => `agent-id-claim:${code}`;

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

export function readClaimMemory(code: string, store: Storage | null = storage()): ClaimMemory {
  try {
    const raw = store?.getItem(memoryKey(code));
    const value = raw ? (JSON.parse(raw) as unknown) : null;
    if (!value || typeof value !== "object") return {};
    const { secret, session } = value as Record<string, unknown>;
    return {
      ...(typeof secret === "string" && secret.startsWith("twc_") ? { secret } : {}),
      ...(typeof session === "string" && session ? { session } : {}),
    };
  } catch {
    return {};
  }
}

export function writeClaimMemory(
  code: string,
  patch: Partial<Record<keyof ClaimMemory, string | null>>,
  store: Storage | null = storage(),
): ClaimMemory {
  const next: Record<string, string> = { ...readClaimMemory(code, store) };
  for (const [key, value] of Object.entries(patch)) {
    if (value) next[key] = value;
    else delete next[key];
  }
  try {
    if (Object.keys(next).length) store?.setItem(memoryKey(code), JSON.stringify(next));
    else store?.removeItem(memoryKey(code));
  } catch {
    // Storage may be blocked; the flow still works within this page.
  }
  return next;
}

// --- Which screen to show ------------------------------------------------------------

export type ClaimScreen = "expired" | "claimed-elsewhere" | ClaimStep;

// The screen for a claim: the step the API says when this browser holds the
// session, else where a visitor without it starts (or why they can't).
export function claimScreen(claim: Claim): ClaimScreen {
  if (claim.step === "done") return "done";
  if (claim.status === "claimed") return claim.step ? "done" : "claimed-elsewhere";
  if (claim.status === "expired") return "expired";
  return claim.step ?? "email";
}

// The three steps a person sees, and which one a screen belongs to.
export const CLAIM_STEPS = ["Email", "Identity", "Ready"] as const;
export function claimStepIndex(screen: ClaimScreen): number {
  return screen === "email" ? 0 : screen === "identity" || screen === "checking" ? 1 : 2;
}

// Keeps what a person types or pastes as the 6-digit code.
export const cleanCode = (value: string) => value.replace(/\D/g, "").slice(0, 6);

export const isCountryCode = (value: string) => /^[A-Za-z]{2}$/.test(value.trim());

// Seconds until another code may be sent (the API allows one every 30 s).
export function resendWait(sentAt: number | null, now: number = Date.now(), gap = 30): number {
  if (!sentAt) return 0;
  return Math.min(gap, Math.max(0, Math.ceil(gap - (now - sentAt) / 1000)));
}
