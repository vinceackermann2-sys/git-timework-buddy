// Sealing a vault item in the owner's browser, before it goes anywhere: an
// AES-256-GCM key encrypts the item, and the agent's computer's public key
// (RSA-OAEP with SHA-256) wraps that key. Only the computer's vault can open it
// (timewarp/supabase/functions/agent-id/vault/vm-script.ts); Timewarp passes it
// on sealed.

export type VaultSecret =
  | { kind: "login"; site: string; username: string; password: string; totp?: string }
  | {
      kind: "key";
      value: string;
      hosts: string[];
      send:
        | { as: "bearer" }
        | { as: "header"; name: string }
        | { as: "query"; name: string }
        | { as: "basic"; username: string };
    };

export type SealedItem = { v: 1; key: string; iv: string; data: string };

const base64 = (bytes: ArrayBuffer | Uint8Array) => {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let text = "";
  for (const byte of view) text += String.fromCharCode(byte);
  return btoa(text);
};
const spki = (pem: string) =>
  Uint8Array.from(atob(pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "")), (c) =>
    c.charCodeAt(0),
  );

export async function sealForVault(publicKeyPem: string, secret: VaultSecret): Promise<SealedItem> {
  const subtle = globalThis.crypto.subtle;
  const computer = await subtle.importKey(
    "spki",
    spki(publicKeyPem),
    { name: "RSA-OAEP", hash: "SHA-256" },
    false,
    ["encrypt"],
  );
  const aes = await subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt"]);
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const data = await subtle.encrypt(
    { name: "AES-GCM", iv },
    aes,
    new TextEncoder().encode(JSON.stringify(secret)),
  );
  const key = await subtle.encrypt(
    { name: "RSA-OAEP" },
    computer,
    await subtle.exportKey("raw", aes),
  );
  return { v: 1, key: base64(key), iv: base64(iv), data: base64(data) };
}

// "api.github.com, *.example.com" → the host names a key may be sent to.
export function parseHosts(input: string): string[] | null {
  const hosts = input
    .split(/[\s,]+/)
    .map((h) =>
      h
        .trim()
        .toLowerCase()
        .replace(/^https?:\/\//, "")
        .replace(/\/.*$/, ""),
    )
    .filter(Boolean);
  const valid = /^(\*\.)?([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
  return hosts.length && hosts.length <= 20 && hosts.every((h) => valid.test(h))
    ? [...new Set(hosts)]
    : null;
}

// "github.com/login" → "https://github.com", or null.
export function siteOrigin(input: string): string | null {
  try {
    const url = new URL(
      /^https?:\/\//i.test(input.trim()) ? input.trim() : `https://${input.trim()}`,
    );
    return url.protocol === "https:" && url.hostname.includes(".") ? url.origin : null;
  } catch {
    return null;
  }
}
