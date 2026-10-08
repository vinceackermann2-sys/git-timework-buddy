# App, vault, organization and member review

Reviewed 8 October 2026 on `main`. **The deployed app cannot yet be called safe for all of these flows.** The review confirmed a live organization permission bypass and a device-wide vault boundary. Targeted organization fixes are prepared and tested locally; no migration, Edge Function deployment, desktop rebuild, Git push, or release was performed.

## Confirmed findings

| Priority | Finding | Evidence | Status |
| --- | --- | --- | --- |
| P1 | An organization admin can become an owner and demote the last owner through the database API. | With disposable accounts, the workspace service rejected promotion with 403 and last-owner removal with 409, but authenticated REST PATCH returned 204 and actually changed both roles. | Local migration removes direct browser writes; transactional member changes also recheck the actor. Production remains affected until rollout. |
| P1 | Different Timewarp accounts using the same OS user and app profile share the local vault. | The native `PJ` repository lists the device's vault table without an account predicate. The patched `HN.backend()` returns that same repository. An isolated native-class test returned the same fixture entry after changing the account, with zero account checks during listing. No real vault was read. | Unresolved. Keeping the vault on-device prevents cloud sharing but does not isolate accounts on that device. |
| P2 | New agents have vault access by default when the Vault feature is enabled. | The native repository's `getAgentAccess` returns `allowed ?? true`. An isolated run with no stored setting returned true. Active-turn and permission-toggle checks exist in the vault command handler, but the initial permission is broad. | Unresolved. Explicit opt-in would provide a safer default. |
| P1 | Accepting an invite writes membership and invite state separately and can replace an existing active member's role. | `acceptInviteRow` previously upserted the invited role, then marked the invitation accepted in another request. Revocation can race with the first write, and failure of the second leaves a partial join. | Fixed locally with one locked database transaction. An active owner's role and original join time are preserved. |
| P2 | Joining through the desktop rotates the emailed invitation token before the join succeeds. | The deployed `timewarp-energy` version 24 contains the same `token_hash` update as the original source. A failed join, including an organization-limit rejection, can invalidate the email link. | Fixed locally. Authenticated in-app acceptance uses the invitation ID without changing the token. |
| P2 | The Organization page lacks member removal, role changes, ownership transfer, leaving, and invitation resend controls. | Inspected the actual supplied renderer. Its member table has Name, Role and Joined columns; supported actions are invite, revoke, edit organization and switch organization. The native account adapter likewise does not expose member-management mutations. | Unresolved product gap. Lower-level workspace-service operations exist for member changes and leaving, but they are not usable through this page. |
| P2 | Ordinary members can read unrelated invitations and their delivery details. | Deployed invite SELECT policy permits every active member; `loadWorkspaceDetails` also returned all invitations to every member. | Fixed locally: managers see organization invitations; direct database reads also allow an invitation's own recipient. |
| P2 | Breached-password protection is disabled. | Supabase's live security advisor reports `auth_leaked_password_protection`. | Unresolved Auth configuration. See [Supabase password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection). |
| P3 | Organization copy incorrectly promises shared credits. | The actual Organization header says inviting people gives access to shared credits, although the app's billing and AI routes use personal balances. | Source patch corrected and matched against the supplied renderer. The desktop needs rebuilding for this text to change in an installed app. |

The deployed organization tables also granted unnecessary privileges, including TRUNCATE, to `anon` and `authenticated`. PostgreSQL does not apply row policies to TRUNCATE; a successful anonymous-role TRUNCATE was reproduced in an isolated database only. This does **not** establish that anonymous HTTP callers have a route to execute arbitrary SQL. The local migration removes these excess privileges together with the confirmed REST write bypass.

## What currently works and what membership means

- Live disposable-account checks passed: outsiders cannot switch into another organization or read its members/invitations; the wrong person cannot accept an invite; the correct recipient can join; replay is rejected; the joined organization becomes active.
- The workspace service checks active membership and owner/admin roles against database rows. Role authorization is not taken from editable user metadata.
- Every account belongs to named organizations. Owners/admins can invite and edit; ordinary members can view the directory. The database enforces the limit of three active organizations with a per-user lock.
- Chats, history, AI credits and connected-app ownership remain personal. Switching or joining an organization does not intentionally share these with colleagues. Existing automated tests cover the corresponding history, connector, billing and account boundaries.
- Vault data uses the local encrypted credential store. Credential integrity binds metadata and entry identity; cloud vault/file RPCs are blocked; the card-save patch removes verification codes from newly saved card data. These protections are covered by the existing tests and source inspection. They do not address the shared-device-account boundary above.
- Supabase's three executable membership helper warnings were inspected. These helpers answer for `auth.uid()` and are used by row policies; they do not accept another user's ID. They were not treated as privilege-escalation findings. Tables with RLS and no client policy are intentionally unavailable to browser roles.

## Prepared changes

- `timewarp/supabase/migrations/20261008133105_organization_membership_security.sql`: browser organization access is read-only and row-scoped. New service-only RPCs handle member changes and invite acceptance. Member changes serialize on a stable workspace row and check the current actor, target role and last-owner invariant together.
- `timewarp/supabase/functions/timewarp-workspaces/index.ts`: uses the new guards, refuses a missing guard instead of using a non-atomic fallback, accepts an invitation ID or email-link token, and keeps manager invitation details out of ordinary-member responses.
- `timewarp/cloud/nativeAccount.ts` and its matching staged copy: accepts the selected invitation without token rotation, then saves the joined organization as active.
- `timewarp/scripts/organizations.cjs`: corrects the shared-credit claim.
- `timewarp/tests/organization-security.test.cjs`: regression coverage for grants, role authorization, last owners, confirmed/current emails, expiry/revocation/replay, active-role preservation, partial-write rollback, organization limits, missing guards, token preservation and invitation privacy.
- `timewarp/scripts/verify-member-security.cjs`: repeatable live audit using only disposable accounts and seeded invitations. It sends no invitation emails, fails when permission checks fail, and removes its fixtures afterwards. Run from `timewarp` with `node scripts/verify-member-security.cjs`.

## Verification

| Check | Result |
| --- | --- |
| Desktop full suite before changes | 207 passed, no skips |
| Desktop full suite after changes | 228 passed, no skips; includes 21 new organization tests |
| Website suite | 4 passed |
| Desktop syntax checks | Passed |
| Deno check, editable/staged account adapter and workspace function | Passed using the cloud and email JSX configurations respectively |
| Cloud source/staged source match | All 11 modules match |
| Organization patch against actual supplied renderer | Contract matched; misleading header removed |
| Live disposable-account audit | Permission bypass reproduced; normal isolation/acceptance checks passed; fixture accounts and organization removed |
| Native vault investigation | Isolated classes and fixture repository only; no real secrets accessed |
| Diff whitespace checks | Passed |

Local test logs are in `timewarp/reports/member-audit-tests.log` and `.temp/member-audit-website-tests.log`. The live report is in `timewarp/reports/member-security-live.json`. Tests for the previous source failed on token rotation and the missing-guard fallback before the fixes were applied.

## Remaining work and limits

1. Roll out the reviewed migration first, then the workspace function and account-adapter change. Re-run the live audit and verify that admin REST role changes are denied. Other cloud files have pre-existing work in this checkout; review that work separately before bundling a full deployment.
2. Define and implement account-scoped vault storage, including a deliberate migration for existing credentials. Do not automatically assign an existing device vault to whichever account signs in next. Until then, separate OS user/app profiles are needed when different people use the computer.
3. Make agent vault access an explicit choice and provide the missing member-management/resend flows. Enable breached-password protection in Auth.
4. Complete installed-app acceptance after rollout: owner/admin/member navigation, account switching, vault isolation, invitation delivery and email-link retry, ownership transfer/removal, and leaving the last organization.

No real invitation emails, payments or provider calls were made during this review. The SQL regression suite uses PGlite, which queues database operations; it checks transactional state and permissions but is not a substitute for multi-session production lock-contention testing. Actual mailbox delivery, signed installed-app UI acceptance, and every possible app feature were not verified. The passing suites are evidence for their covered flows, not a certification of the entire app.
