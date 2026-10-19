"use strict";
// Runs before every page of a browser profile: the built-in browser's tabs and
// pop-ups, and the sign-in windows (browser.cjs registers it with each
// profile's session). Pages see a computer without passkeys, as Chrome does
// where Windows Hello isn't set up, so sign-ins and sign-ups go on with a
// password or a code and the system's passkey window never opens: the user had
// to close it at each sign-in, and an agent can't. A page that asks for a
// passkey anyway is answered as if that window had been closed.
const { contextBridge } = require("electron");

try {
  contextBridge.executeInMainWorld({
    func: () => {
      const define = (target, name, value) => Object.defineProperty(target, name, { value, writable: true, enumerable: true, configurable: true });
      // Refused at once, or, for a passkey offered with the sign-in fields
      // (conditional), left unanswered until the page drops it, as when none is picked.
      const refuse = (options, waits) => new Promise((_resolve, reject) => {
        const signal = options.signal;
        if (signal?.aborted) return reject(signal.reason);
        if (!waits) return reject(new DOMException("The operation either timed out or was not allowed.", "NotAllowedError"));
        signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
      const container = window.CredentialsContainer?.prototype;
      const { get, create } = container || {};
      // Other credentials (passwords, one-time codes, federated sign-in) are left as they are.
      if (typeof get === "function") define(container, "get", { get(options) { return options?.publicKey ? refuse(options, options.mediation === "conditional") : get.call(this, options); } }.get);
      if (typeof create === "function") define(container, "create", { create(options) { return options?.publicKey ? refuse(options, false) : create.call(this, options); } }.create);
      const credential = window.PublicKeyCredential;
      if (typeof credential !== "function") return;
      const none = { isUserVerifyingPlatformAuthenticatorAvailable() { return Promise.resolve(false); }, isConditionalMediationAvailable() { return Promise.resolve(false); } };
      for (const [name, value] of Object.entries(none)) if (typeof credential[name] === "function") define(credential, name, value);
      const capabilities = credential.getClientCapabilities;
      if (typeof capabilities === "function") define(credential, "getClientCapabilities", { getClientCapabilities() { return capabilities.call(credential).then(found => Object.fromEntries(Object.keys(found || {}).map(key => [key, false]))); } }.getClientCapabilities);
    },
  });
} catch {}
