# Timewarp 1.2.4 release record

Release work on 12 October 2026 (Europe/Stockholm). Setup runs once per
account: signing in again, signing in on another computer or reinstalling
no longer shows setup to an account that finished it.

## Source and validation

Release PR: https://github.com/vinceackermann2-sys/git-timework-buddy/pull/15,
merged as `1c41657`. Built in its own worktree (`timewarp-onboarding-once`)
from `origin/main` at `88fb052`; the shared folder's unfinished work is not
part of it.

- Before, setup's completion lived only in the profile's `onboarding.bin`, so
  a new computer, a new profile or a reinstall showed setup again.
- The cloud now keeps it: `onboardingCompletedAt` in the account's
  `timewarp_energy_settings`, through two new account calls,
  `product.onboarding.status` and `product.onboarding.complete`.
- A computer without a record asks the cloud before showing setup. Finishing
  setup tells the cloud, and a computer that finished it before tells the
  cloud once.
- Accounts with synced desktop chats or AI cost events count as set up, since
  both only happen after setup.
- "Run setup again" still runs setup on that computer, also when it's chosen
  while the cloud is answering.
- Where the cloud can't answer (an older function, an outage), setup runs as
  before.
- Preview builds take `TIMEWARP_FIXTURE_SETUP_DONE=1` for an account that
  finished setup elsewhere.

Local validation:
- `tests/engine-onboarding.test.cjs` (7 tests), 320 engine tests, 572
  portable tests;
- `npm run check`, `verify:cloud-source`, the frozen Deno type-check, the
  engine build and independence audit.

A preview build driven over CDP passed 7 scenarios:
- a new account sees setup, and after finishing it the app shows;
- signing out and in skips setup, and so does the next launch;
- another computer skips it;
- "Run setup again" shows it, and it is still there at the next launch.

CI passed on the PR. The unsigned macOS preview **38225855184** passed on
macOS 14, 15 and Intel.

## Supabase

`timewarp-energy` was redeployed on 12 October from the release branch. No
migration: the flag uses the existing settings table.

- The deployed copy before it matched `88fb052`. A backup is in
  `timewarp/reports/function-backup-before-1.2.4` (not in git).
- After the deploy, the downloaded function matches the release branch,
  `/healthz` answers 200, and the new call answers 401 without a session.
- The new calls weren't exercised with a signed-in account against
  production.

## Windows

Package: `timewarp/build/engine-store/Timewarp-Store-1.2.4-x64.msix`, built
from `f7b361e` (the same tree as the merge).

| | |
| --- | --- |
| Version | **1.2.4.0**, following 1.2.3.0 |
| Size | **346,074,329 bytes** |
| SHA256 | `e09e336d659aef040ebf58c709e822f43ab3a4e2ff39323fa418d2f41dbb4d1f` |
| Smoke test | sign-in after 6.6 s, 340 MB; a conversation through the bundled Codex in 214 ms |

The owner uploads it to Partner Center (Store ID `9N6WRN6GN0KR`).

## macOS and website

The first signed run (**38226557514**, on `1c41657`) passed on Apple Silicon.
Its Intel job failed three times after Apple had accepted the DMG:
1. ejecting the image (`hdiutil: couldn't eject … Resource busy`);
2. `stapler staple`;
3. `stapler validate`.

`notarize-mac.cjs` hid stapler's own message. PR
https://github.com/vinceackermann2-sys/git-timework-buddy/pull/16 (merged as
`826c7ad`) tries each stapler step up to six times, 30 seconds apart, and keeps
Apple's message.

The signed run **38232989940** on `826c7ad` passed on both architectures:
- engine tests, signing, notarization, packaging and smoke tests;
- Intel's `stapler validate` failed twice with "Error 68" and passed on its
  third try.

| | Apple Silicon | Intel |
| --- | --- | --- |
| DMG | `Timewarp-1.2.4-arm64.dmg`, 270,379,427 bytes | `Timewarp-1.2.4-x64.dmg`, 286,864,425 bytes |
| DMG SHA256 | `5b2b57cb1376ef49589a1db9ec198cf0bb802280b017511b389668fabcb013ef` | `3abb431bb59ba60791a22521a683af34e5627882036640751aae703fbfc16069` |
| Notarization | `b19f994f-0e66-4d7d-9905-58a70eb57238`, Accepted | `53121ee1-14db-48bc-bec6-4975c035f1ab`, Accepted |
| Stapled, Gatekeeper | yes, accepted | yes, accepted |
| Update zip | `Timewarp-1.2.4-arm64-mac.zip`, 269,207,737 bytes | `Timewarp-1.2.4-x64-mac.zip`, 285,941,298 bytes |
| Zip SHA256 | `740dba8750a46e8eb50be6786475d6d2270d2ee32d420fdaea19c44fa45997a0` | `537db67f7e7249c80140ce20d6c1dc52330e86358efbedfb9c7885f2c7b90ce6` |

Checks on the downloaded files:
- they match the hashes CI recorded;
- the SHA-512 in each `latest-mac-<arch>.yml` matches its zip;
- `merge-mac-update-info.cjs` joined the two into `latest-mac.yml`.

Published release (latest):
https://github.com/vinceackermann2-sys/timewarp-releases/releases/tag/v1.2.4.
It has the two DMGs, the two update zips, `latest-mac.yml` and
`SHA256SUMS.txt`. Through GitHub's redirect,
`releases/latest/download/latest-mac.yml` gives version 1.2.4, and both zips
and both DMGs answer 200 with the expected sizes.

The website's `download-config.js` points `mac` and `macIntel` at the 1.2.4
DMGs. Windows continues to use the Microsoft Store listing.

## Remaining limits

- No real Mac has updated from 1.2.3 to 1.2.4 through the updater yet.
- The new account calls haven't been checked live with a signed-in account.
- An account that finished setup on a computer still running 1.2.3, and has
  neither synced chats nor AI use, sees setup once more on a new computer
  until that first computer runs 1.2.4.
