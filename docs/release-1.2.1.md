# Timewarp 1.2.1 release record

Release work on 10 October 2026 (Europe/Stockholm). Sets up Codex's command
sandbox in the engine the way the previous app did (see
[engine](engine.md#comparison-with-the-previous-app)).

## Source and validation

Release PR: https://github.com/vinceackermann2-sys/git-timework-buddy/pull/7,
merged as `4a917a3`. It was built in its own worktree from `main`, because
other sessions had unfinished work in the shared folder; none of it is in the
release.

- Windows: setup's knowledge step runs Codex's unelevated sandbox setup with
  the previous app's "Protect work with Windows security" row; accounts past
  setup get it at their next start. Codex uses Windows' own app container
  sandbox (MXC) where Windows offers it (`features.prefer_mxc`). Every Codex
  start checks one sandboxed command and turns a sandbox that fails or stalls
  off for that Codex version, so commands are reviewed instead of hanging.
- macOS: Codex's Seatbelt sandbox, no setup, as before.
- With the sandbox working, agents edit files with apply_patch again.

Findings on the reference PC (Windows 11 build 26300, Acronis Active
Protection): Codex's restricted-token sandbox stalls every command, inside
and outside the Claude app's container, with Codex 0.160.1 and 0.162; MXC
runs commands in about 0.5 s, keeps writes in the workspace (Documents and
other folders are denied) and allows the network. Codex's setup never
finishes with `cwd: null` (what the previous app's Codex build took), and a
setup applies only after Codex restarts. The previous app's profile on this
PC never had the sandbox set up: Timewarp's own setup screens had replaced
Energy's step that ran it.

GitHub's Windows runner has no MXC. There a new test sets up Codex's
unelevated sandbox as start-up does: the check passes, a write outside the
workspace is denied (reported as an error rather than an exit code) and the
network is reachable. PowerShell took 7 to over 30 seconds to start in that
sandbox on those small machines, so the test uses cmd and curl. macOS 14, 15
and Intel runners ran the same test under Seatbelt.

Local validation: 509 tests, the independence audit, `npm run check`, the
portable tests, and all 25 engine end-to-end scenarios on a preview build of
the release commit, including the new `sandboxIsolation` and `filePatch`
(apply_patch in 2 s, shown as a file change). In an earlier full run
`interrupt` failed once ("Codex did not answer turn/interrupt in time") and
then passed in every rerun.

CI: all checks passed on the final commit `8bd41c6` (source and website, for
the push and the PR). Before that the new real-Codex test failed twice on
GitHub's Windows runner, first because that sandbox reports a denied write as
an error, then because one PowerShell command took over 30 s to start; both
were test fixes (`b4ea673`, `f246bcc`). Unsigned previews **38075609169** and
**38076669674** passed on macOS 14, 15 and Intel, including the sandbox test
under Seatbelt.

## Supabase

No migration or function changes since 1.2.0. `migration list --linked`
shows `20261010120000` applied and only the known local-only IDs (applied
earlier under other remote IDs). The deployed `timewarp-energy` (26),
`stripe-billing` (50), `stripe-webhook` (46), `timewarp-workspaces`,
`auth-email-hook` and `contact` were downloaded: all 37 files match the
repository, so nothing was redeployed.

## Windows

Package: `timewarp/build/engine-store/Timewarp-Store-1.2.1-x64.msix`, version
**1.2.1.0** following 1.2.0.0, **346,066,648 bytes**, SHA256
`e1de1022bfe984ac7d59a2df2c7e86967c6dd430daefadc2d48d876bb28b1ef3`, built
from `bf1cbd7`; the commits after it changed only a test and the engine
document, so the app is the same as the merge's. The staged app passed the
smoke test: sign-in after 6.8 s, 357 MB, a conversation through the bundled
Codex in 254 ms. Upload to
Partner Center (Store ID `9N6WRN6GN0KR`) is done by the owner.

## macOS and website

The signed run **38077043412** on `4a917a3` passed the engine tests on
macOS, signing, notarization, packaging and smoke tests on both architectures.

| | Apple Silicon | Intel |
| --- | --- | --- |
| Artifact | `Timewarp-1.2.1-arm64.dmg` | `Timewarp-1.2.1-x64.dmg` |
| Size | 270,330,393 bytes | 286,831,610 bytes |
| SHA256 | `6e48245588deb6fee70c111e9eb99c4bffb873cbe5f10032ebaa5032114cd7f7` | `07a4764f4df75400b4f334b197d19f00b734d793769d00496251d91763544411` |
| Notarization | `00bbac61-6eaf-4229-8505-a18318f5e721`, Accepted | `023441ee-cf5e-49a6-93db-1d137646bd48`, Accepted |
| Stapled, Gatekeeper | yes, accepted | yes, accepted |
| Minimum macOS | 12.0 (Electron Framework) | 12.0 (Electron Framework) |

The downloaded CI artifacts match the hashes CI recorded, and GitHub's asset
digests match them. Published release (latest):
https://github.com/vinceackermann2-sys/timewarp-releases/releases/tag/v1.2.1,
with `SHA256SUMS.txt`. Both links answer 200 with the expected sizes.

The website's `download-config.js` points `mac` and `macIntel` at the 1.2.1
DMGs; Windows continues to use the Microsoft Store listing. Mac updates
remain manual.

## Remaining limits

The new base prompt, turn context and background memory writer still haven't
been through the live model evaluation (`engine:eval`). The unelevated
Windows sandbox is checked on GitHub's Windows runner only; a real PC without
MXC and the signed DMGs on a physical Mac are not yet tried.
