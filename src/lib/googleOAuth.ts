const GOOGLE_AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_CLIENT_ID = "657009835367-1doqgk3lsldhgm0sqitko2ecbqn3677d.apps.googleusercontent.com";
const GOOGLE_CALLBACK_URL = "https://timewarpdev.com/auth/v1/callback";
const GOOGLE_OAUTH_STORAGE_PREFIX = "timewarp.google-oauth.";
const GOOGLE_OAUTH_MAX_AGE_MS = 10 * 60 * 1000;

export type GoogleOAuthTarget = "web" | "desktop" | "energy-desktop";

export type DesktopHandoffRequest = { state: string; publicKey: string; nonceHash: string };

export type PendingGoogleOAuth = {
  nonce: string;
  next: string;
  target: GoogleOAuthTarget;
  createdAt: number;
  desktop?: DesktopHandoffRequest;
};

export function validateDesktopHandoffRequest(
  value: Partial<DesktopHandoffRequest> | undefined,
): DesktopHandoffRequest {
  if (
    !value ||
    !/^[a-f0-9]{64}$/.test(value.state || "") ||
    !/^[a-f0-9]{64}$/.test(value.nonceHash || "") ||
    !/^[A-Za-z0-9_-]{100,256}$/.test(value.publicKey || "")
  )
    throw new Error("Start Google sign-in from the Timewarp desktop app.");
  return { state: value.state!, publicKey: value.publicKey!, nonceHash: value.nonceHash! };
}

function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function toBase64Url(value: Uint8Array): string {
  return btoa(Array.from(value, (byte) => String.fromCharCode(byte)).join(""))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

// Encrypt the identity assertion to the initiating device. Only that device
// holds the private key and raw Google nonce; it performs the Supabase exchange.
export async function encryptDesktopHandoff(
  idToken: string,
  request: DesktopHandoffRequest,
): Promise<string> {
  const desktop = validateDesktopHandoffRequest(request);
  if (!idToken || idToken.length > 16384)
    throw new Error("Google did not return a valid identity token.");
  const context = new TextEncoder().encode("timewarp-google-desktop-v1");
  const peer = await crypto.subtle.importKey(
    "spki",
    fromBase64Url(desktop.publicKey),
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
  const ephemeral = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
    "deriveBits",
  ]);
  const secret = await crypto.subtle.deriveBits(
    { name: "ECDH", public: peer },
    ephemeral.privateKey,
    256,
  );
  const material = await crypto.subtle.importKey("raw", secret, "HKDF", false, ["deriveKey"]);
  const key = await crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: new TextEncoder().encode(desktop.state), info: context },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt"],
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: context },
    key,
    new TextEncoder().encode(JSON.stringify({ state: desktop.state, idToken })),
  );
  const envelope = {
    version: 1,
    key: toBase64Url(new Uint8Array(await crypto.subtle.exportKey("spki", ephemeral.publicKey))),
    iv: toBase64Url(iv),
    data: toBase64Url(new Uint8Array(data)),
  };
  return "twgi_" + toBase64Url(new TextEncoder().encode(JSON.stringify(envelope)));
}

function randomHex(bytes: number): string {
  const values = crypto.getRandomValues(new Uint8Array(bytes));
  return Array.from(values, (value) => value.toString(16).padStart(2, "0")).join("");
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function safeAuthNext(value: string | null | undefined): string {
  if (
    !value?.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\") ||
    Array.from(value).some((character) => character.charCodeAt(0) <= 32)
  )
    return "/account";
  try {
    const url = new URL(value, "https://timewarpdev.com");
    const pathname = decodeURIComponent(url.pathname);
    // Retired workspace links and auth loops return to account management.
    // Explicit destinations such as invites and MCP consent still work.
    if (/^\/(?:app|billing|login|signup)(?:\/|$)/i.test(pathname)) return "/account";
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "/account";
  }
}

export function getGoogleOAuthStartUrl(
  options: {
    target?: GoogleOAuthTarget;
    next?: string;
  } = {},
): string {
  const url = new URL("/auth/google", "https://timewarpdev.com");
  url.searchParams.set("target", options.target === "desktop" ? "desktop" : "web");
  url.searchParams.set("next", safeAuthNext(options.next));
  return url.toString();
}

export async function beginGoogleOAuth(
  options: {
    target?: GoogleOAuthTarget;
    next?: string;
    desktop?: DesktopHandoffRequest;
  } = {},
): Promise<string> {
  const state = randomHex(32);
  const nonce = randomHex(32);
  const desktop =
    options.target === "energy-desktop"
      ? validateDesktopHandoffRequest(options.desktop)
      : undefined;
  if (desktop)
    await crypto.subtle.importKey(
      "spki",
      fromBase64Url(desktop.publicKey),
      { name: "ECDH", namedCurve: "P-256" },
      false,
      [],
    );
  const pending: PendingGoogleOAuth = {
    nonce,
    next: safeAuthNext(options.next),
    target: desktop ? "energy-desktop" : options.target === "desktop" ? "desktop" : "web",
    createdAt: Date.now(),
    ...(desktop ? { desktop } : {}),
  };

  sessionStorage.setItem(`${GOOGLE_OAUTH_STORAGE_PREFIX}${state}`, JSON.stringify(pending));

  const authorizeUrl = new URL(GOOGLE_AUTHORIZE_URL);
  authorizeUrl.searchParams.set("client_id", GOOGLE_CLIENT_ID);
  authorizeUrl.searchParams.set("redirect_uri", GOOGLE_CALLBACK_URL);
  authorizeUrl.searchParams.set("response_type", "id_token");
  authorizeUrl.searchParams.set("response_mode", "fragment");
  authorizeUrl.searchParams.set("scope", "openid email profile");
  authorizeUrl.searchParams.set("state", state);
  authorizeUrl.searchParams.set("nonce", desktop?.nonceHash || (await sha256Hex(nonce)));
  authorizeUrl.searchParams.set("prompt", "select_account");
  return authorizeUrl.toString();
}

export function consumePendingGoogleOAuth(state: string): PendingGoogleOAuth | null {
  if (!/^[a-f0-9]{64}$/.test(state)) return null;

  const key = `${GOOGLE_OAUTH_STORAGE_PREFIX}${state}`;
  const stored = sessionStorage.getItem(key);
  sessionStorage.removeItem(key);
  if (!stored) return null;

  try {
    const pending = JSON.parse(stored) as Partial<PendingGoogleOAuth>;
    if (
      typeof pending.nonce !== "string" ||
      !/^[a-f0-9]{64}$/.test(pending.nonce) ||
      typeof pending.createdAt !== "number" ||
      Date.now() - pending.createdAt < 0 ||
      Date.now() - pending.createdAt > GOOGLE_OAUTH_MAX_AGE_MS ||
      (pending.target !== "web" &&
        pending.target !== "desktop" &&
        pending.target !== "energy-desktop")
    ) {
      return null;
    }

    return {
      nonce: pending.nonce,
      next: safeAuthNext(pending.next),
      target: pending.target,
      createdAt: pending.createdAt,
      ...(pending.target === "energy-desktop"
        ? { desktop: validateDesktopHandoffRequest(pending.desktop) }
        : {}),
    };
  } catch {
    return null;
  }
}
