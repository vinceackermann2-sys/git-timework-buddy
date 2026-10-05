# Branded Google sign-in

This integration uses the branded flow already implemented in the local
TimeWarp website repository:

`C:/Users/vince/OneDrive/Dokument/ChatGPT/Local TimeWarp/Local TimeWarp`

The public Google callback is **https://timewarpdev.com/auth/v1/callback**.
The Google start, callback, and browser-to-desktop bridge now match this
desktop app's Ice blue accent, transparent logo, account card, and light/dark
appearance. The website uses `GoogleAuthScreen` for both Google routes, with
`public/desktop-auth-logo.svg` copied from this app's `assets/timewarp-logo.svg`.
`public/desktop-auth.css` and `src/components/google-auth-screen.css` are copies
of `assets/auth-bridge.css`. Keep these copies together when publishing a brand
update. The desktop loopback callback serves the same assets locally, including
for failed sign-ins and connector returns.

Google decides the text on its account and consent screens; this callback keeps
the displayed domain under timewarpdev.com. Verified app branding can also show
the Timewarp name and logo. STRATO DNS does not need a new auth subdomain.

## Website changes

Publish the website with these changes from the existing repository:

- `src/lib/googleOAuth.ts`: add the `energy-desktop` target, device nonce and
  encrypted identity handoff.
- `src/pages/GoogleOAuthStart.tsx`: accept the initiating device's request.
- `src/pages/GoogleOAuthCallback.tsx`: return the encrypted identity assertion
  to the loopback callback for this target.
- `public/timewarp-desktop-auth.json`: readiness manifest.
- `tests/energy-google-auth.test.mjs`: runtime browser cryptography and state tests.

The web sign-in and original TimeWarp desktop targets retain their existing
behavior. This integration does not need a Google client secret, PHP, Node
hosting, a Supabase custom-domain add-on, or a new provider/account database.

Keep this URI registered on the existing **TimeWarp Supabase Production**
Google OAuth client, ID
`657009835367-1doqgk3lsldhgm0sqitko2ecbqn3677d.apps.googleusercontent.com`:

```text
https://timewarpdev.com/auth/v1/callback
```

Retain the existing Supabase callback for clients still using that flow.

## Activate the desktop

After publishing the website, run from this project's `timewarp` folder:

```powershell
npm run verify:branded-auth
node scripts/verify-branded-google.cjs --activate
npm run build
npm run verify:build
```

Close this workspace's Timewarp app before rebuilding. The activation command
changes public `config.json` only after the live manifest, website routes,
Google provider and registered branded callback pass. The configuration entry
is `"googleAuthBridgeUrl": "https://timewarpdev.com"`. Before then, existing
Google sign-in remains selected. `npm run verify:oauth` follows the selected flow.
Complete a real Google sign-in on the rebuilt desktop to accept the final
Google UI and account session; the routing check does not sign into an account.

To roll back, remove `googleAuthBridgeUrl` from `config.json` and rebuild.

## Device and browser binding

1. The desktop creates a ten-minute attempt with a random state, raw Google
   nonce and ephemeral P-256 keypair in its encrypted pending-flow store.
2. The website receives the public key, state and SHA-256 nonce hash. It creates
   its own one-use browser state and asks Google for an ID token using the
   branded callback and the device's nonce hash.
3. The callback consumes the browser state, clears the identity assertion from
   browser history and encrypts it using ECDH, HKDF-SHA256 and AES-256-GCM.
4. The loopback URL carries only the encrypted envelope. The desktop decrypts
   it with the saved private key and checks its state. Supabase verifies the
   Google token's signature, audience, expiry and nonce before returning a
   session for the existing identity.
5. Completion consumes the pending device attempt. Concurrent completion,
   tampering, another device, expiry and callbacks from a cancelled attempt
   cannot create a session. Email confirmation and recovery keep their PKCE flow.

References: [Google OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect)
and [Supabase Google ID-token sign-in](https://supabase.com/docs/guides/auth/social-login/auth-google).
