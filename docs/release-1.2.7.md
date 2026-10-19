# Timewarp 1.2.7 release record

Release work on 19 October 2026 (Europe/Stockholm).

## Source and validation

Release PR: https://github.com/vinceackermann2-sys/git-timework-buddy/pull/21,
merged as `5d33578`. It was built in its own worktree (`timewarp-release-1.2.7`)
from `origin/main` at `a302d28`, merging three branches, each committed in its
own worktree:

- `claude/apps-browser-passkey-prompts-99f9e1`: pages in the built-in
  browser's tabs, pop-ups and sign-in windows see a computer without passkeys
  (`app/preload/no-passkeys.cjs`, registered on each browser profile's
  session), so the system passkey window never opens. A page that asks for a
  passkey anyway is answered as if that window had been closed.
- `claude/onboarding-single-display-75781f`: the First steps tour counts as
  seen as soon as it is on screen, so quitting or reloading partway through
  doesn't bring it back. Settings → General → Tour still shows it.
- `claude/browser-profile-memory-import-1a6865`:
  - importing a Chrome, Edge, Brave, Arc or Vivaldi profile copies its
    readable sign-ins (cookies) into the new Timewarp profile, as the previous
    app did; sign-ins protected by App-Bound Encryption (newer Chrome and
    Edge) are counted, and the user is asked to sign in to those once;
  - imported ChatGPT/Codex, Claude and Cursor memory gets a pointer block in
    the notes, removed with the source's last imported file;
  - the Cursor folder picker accepts the project folder or `.cursor`, and
    finds `.cursorrules`.

The merges had no conflicts. The release commit `09864ff` sets 1.2.7 in
`store.json` (after 1.2.6.0) and `mac-release.json`, and adds
`browser-cookies.cjs` to the `check` script.

Local validation on the merged branch:
- `npm run check`, 684 portable tests, 409 engine tests;
- the engine build and independence audit, `verify:cloud-source`, 19 email
  tests;
- the frozen Deno type-check of every cloud entry point, `npm audit` (0
  vulnerabilities);
- `engine:e2e`: 31 of 32 scenarios, including `firstSteps`, `browser`,
  `browserDialogs`, `vault` and `accounts`. `browserDialogsVisible` was cut
  off by the code tool's 30 s limit. Across six reruns of the two dialog
  scenarios, the script took 3.5–24 s and was cut off 1 of 6 times with the
  passkey preload and 2 of 6 times without it, so it is a timing flake on
  that PC, not this release;
- the sign-in copy in real Electron 43, against a made-up Chrome profile
  whose key was wrapped with the user's real DPAPI: two v10 cookies written
  with their values and flags, one v20 cookie counted as App-Bound,
  "sign in once" set. No real browser data was read. The import holds the
  main process about 2 s while PowerShell unwraps the key.

CI passed on the PR after one rerun: the first `source` run hit `EPERM`
while `engine-shares.test.cjs` removed its temp folder (a Windows file lock).
The push run of the same commit passed. The unsigned macOS preview
**39288963970** passed on macOS 14, 15 and Intel.

## Supabase

Nothing to deploy: 1.2.7 changes nothing under `supabase/` or `cloud/`, and
neither did anything on `main` since the 1.2.6 rollout. The live functions
are still the 1.2.6 deploy (`timewarp-energy` v31, `timewarp-workspaces` v46,
`auth-email-hook` v43, `contact` v44), and the newest four migrations,
through `20261014120000`, are applied.

## Windows

Package: `timewarp/build/engine-store/Timewarp-Store-1.2.7-x64.msix`, built
from `09864ff` (the same tree as the merge).

| | |
| --- | --- |
| Version | **1.2.7.0**, following 1.2.6.0 |
| Size | **346,127,355 bytes** |
| SHA256 | `9b60c80e8f0839534e6990f24f67c2dcd465f526a0f1fdfface6cad6bc8dc5e5` |
| Smoke test | sign-in after 3.1 s, 357 MB; a conversation through the bundled Codex in 577 ms |

The owner uploads it to Partner Center (Store ID `9N6WRN6GN0KR`).

## macOS and website

The signed run **39294446821** on `5d33578` passed on both architectures:
engine tests, signing, notarization, packaging and smoke tests.

| | Apple Silicon | Intel |
| --- | --- | --- |
| DMG | `Timewarp-1.2.7-arm64.dmg`, 270,425,935 bytes | `Timewarp-1.2.7-x64.dmg`, 286,905,379 bytes |
| DMG SHA256 | `c87ba6fd334dbdcb176741347663cc9fbe659bded90cb56ccb2acc22ede093d9` | `12854f2d53b05f15804ff0bf44b74409b782624254d7cf5c796a64507594821f` |
| Notarization | `d3086f6b-452b-476a-ab2a-c6704dc373f1`, Accepted | `934e5a1f-554c-4ea8-942f-048a88b9362f`, Accepted |
| Stapled, Gatekeeper | yes, accepted | yes, accepted |
| Update zip | `Timewarp-1.2.7-arm64-mac.zip`, 269,257,940 bytes | `Timewarp-1.2.7-x64-mac.zip`, 285,991,555 bytes |
| Zip SHA256 | `cc889eeec42093022977b9c9256f0a8d233492d07ae16522cd1cbc29e8738f53` | `54b53087f6a3515aa0a9ff5543a6a97d6ca226097bf57598aff3c93da004e3b0` |

Checks on the downloaded files:
- they match the hashes CI recorded;
- the SHA-512 in each `latest-mac-<arch>.yml` matches its zip;
- `merge-mac-update-info.cjs` joined the two into `latest-mac.yml`;
- `sha256sum -c SHA256SUMS.txt` passes.

Published release (latest):
https://github.com/vinceackermann2-sys/timewarp-releases/releases/tag/v1.2.7.
It has the two DMGs, the two update zips, `latest-mac.yml` and
`SHA256SUMS.txt`. Through GitHub's redirect,
`releases/latest/download/latest-mac.yml` gives version 1.2.7, and both zips
and both DMGs answer 200 with the expected sizes.

The website's `download-config.js` points `mac` and `macIntel` at the 1.2.7
DMGs. Windows continues to use the Microsoft Store listing.

## Remaining limits

- The sign-in copy has only been run against a made-up profile. Real Chrome
  and Edge on Windows mostly use App-Bound Encryption now, so most of their
  sign-ins will still need one sign-in inside Timewarp. On macOS, copying
  asks for Keychain access to the browser's "Safe Storage" item; that prompt
  hasn't been tried on a real Mac.
- Passkeys stay visible in cross-origin frames (preloads run in main frames
  only).
- No real Mac has updated from 1.2.6 to 1.2.7 through the updater yet.
