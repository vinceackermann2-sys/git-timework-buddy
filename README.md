# Timewarp

This repository contains the Timewarp desktop source and the existing Timewarp website hosted through Lovable.

- Website: `timewarp-site/dist`; the root TanStack app serves these existing files.
- Desktop: `timewarp`; see the build and operations documentation below.
- Lovable editor: https://lovable.dev/projects/cbb636a5-6463-4d72-8642-2660fb02af3e

Run `npm ci` and `npm run dev` from this folder for the website. Desktop commands run inside `timewarp`.

Private backend credentials remain in the existing production Supabase secret manager. Never add service keys to browser code or Git.

## Desktop integration

This is the **timework** source repository for the Timewarp desktop integration.
Version **1.1.24** is available as a signed, notarized Apple Silicon Mac DMG;
the Windows Store update is submitted for certification and will publish automatically
after approval. See the [release record](docs/release-1.1.24.md), remaining live acceptance checks in the
[production readiness review](docs/production-readiness.md), and
[checkout/build prerequisites](docs/building.md).

The supplied Electron runtime, device data, credentials, backups and generated
acceptance reports stay outside Git. GitHub Actions runs portable source and
email checks. A manual Windows job now builds verified preview/signed artifacts
from the hash-pinned supplied inputs; it does not publish them. The repository
was made public for the Apple Silicon Mac build. Version 1.1.24 passed native
startup, packaged contracts, Developer ID signatures, hardened runtime, Apple
notarization, stapling, and Gatekeeper checks. Installers and checksums are
published in the separate public
[downloads repository](https://github.com/vinceackermann2-sys/timewarp-releases/releases/tag/v1.1.24),
so the source can return to private visibility without breaking downloads.
See [native distribution](docs/native-distribution.md).

Run **launch.cmd** in this folder. The single desktop app keeps the original
Energy interface with Timewarp's name, logo and Windows icon.

After sign-in and organization selection, incomplete accounts enter one fullscreen
mascot-led chat setup: name the agent, choose your preferred name, connect local browser
profiles and knowledge, choose light/dark and an accent with the app’s named color tiles, then select a plan.
Individual offers Free, Pro and Max; Enterprise offers Free and Ultra, matching
the website. The mascot stays beside the conversation as setup progresses.
Previously completed accounts bypass setup; progress is encrypted locally per
Timewarp owner. Native **Redo Onboarding** clears that owner's saved draft.
Browser sessions use the native profile importer. Local Codex/ChatGPT and Claude
memory and skills use the native setup importer; Cursor rules and skills are
supported from ~/.cursor or a selected project's .cursor folder. Online ChatGPT
memories are not available through this local importer. Paid selections finish
only after billing confirms the plan; Free does not require a purchase.

`npm run verify:onboarding` exercises the production UI with isolated fixtures.
`npm run preview:onboarding` serves the same UI at http://127.0.0.1:4176 with
sample sign-in, profiles and plans, without accessing real accounts or files.

The default accent for new users is Pale lilac (`#E9D2FF`), taken from the logo.
Settings → Colors offers thirteen named pastel presets, including Ice blue,
Soft lime, Warm cream and Pink lilac, with color swatches and hex values.
Changes save locally. Existing saved accents and the light/dark setting are
preserved. The original upstream blue still upgrades to Ice blue on startup.
Brand assets are saved in `timewarp/assets` and packaged into the desktop app.
The in-app `timewarp-logo.svg` and desktop icons have transparent backgrounds
behind the same purple-and-white artwork. `app-icon.svg` is
exported to the 1024px `app-icon.png`, and every icon size is resized from that
same PNG. Exports are in `timewarp/assets/icons`. Windows uses `app-icon.ico`,
macOS assets include `app-icon.icns` and its Dock uses the transparent PNG, and Linux
windows use the PNG. Local executable builds target Windows; the Mac workflow
builds Apple Silicon DMGs on `macos-15`.
`npm run build:icons` in `timewarp` regenerates these assets; the desktop build
runs this too.
The app chrome and Settings omit version, release-channel badges and the
open-source license link. Themes use a smooth background, including for existing
profiles, with color and radiance controls. Packaged third-party notices remain
available in the application resources.
Dropdowns, including Billing's monthly and one-time extra credits, use themed
menus, selection highlights and chevrons. Plain buttons and connection-browser
controls share Timewarp's colors, rounded corners and focus states.

The agent harness runs on this computer. Its shell, workspace files, memory,
browser profiles and vault use the original local desktop services. Model
inference uses Timewarp's cloud or the connected user's eligible ChatGPT plan.
There is no Saved documents or Cloud files
page and no separate cloud agent workspace.

## Cloud services

- Supabase authentication with encrypted device sessions. Email confirmation,
  sign-in links, password recovery and Google sign-in return to the desktop callback.
- Sol and Luna use the production Azure provider credentials. Provider keys and
  service-role credentials remain on the server.
- Chat messages and chat display metadata synchronize to an owner-scoped history
  table. Sync pulls updates on every pass, including all chat pages, and uploads
  long conversations in retryable batches without truncating older messages.
  Signing in on a fresh device restores messages into its local database.
  Assistant workspaces and instructions remain local.
- Real plan status, personal credits, usage and credit activity. Checkout and
  subscription management open Stripe's hosted pages. Tasks spend personal
  credits; organization billing remains separate.
- Existing Timewarp organization membership and profile services. Switching an
  organization does not share personal chats. Organization names and pictures,
  profile names and pictures and active organization selection persist in
  production. Partial preference saves merge atomically.
  There is no personal workspace: every account works inside a cloud
  organization. An account without one sees **Create your organization**
  (a name it chooses, plus an optional photo) or can join a pending invite.
  Organizations without a photo use the standard picture (the Timewarp mark on
  the accent color); owners and admins upload a photo under Organization →
  Edit. The account menu switches, opens and creates organizations, and its
  button shows the active organization's picture. Owners and admins invite by
  email; invited people join from the in-app prompt. Organization pages show
  no credit balance, since credits stay personal and Billing stays available
  to every member. `npm run verify:organizations` checks this live with
  disposable accounts and removes them afterwards.

Chat synchronization pauses in Privacy Mode. Local tasks require the desktop to
remain running. Model calls require a connection and either available Timewarp
credits or a connected ChatGPT account with provider-approved plan access.

## Data boundary

| Saved in the cloud | Stored on this computer |
| --- | --- |
| Chat text and display metadata, account/profile, organizations, billing/plan and credit usage | Harness state and tool traces, assistant instructions, workspace files, memory, browser profiles/cookies, vault and saved payment details, encrypted login session |

The model receives conversation context and selected tool results needed to
answer. Keeping files and memory locally does not mean content used in a cloud
model request stays offline. They are not copied into a cloud document or memory
store. Timewarp proxy requests use `store: false`; Codex owns its native subscription
transport. On the Timewarp proxy, known payment and credential patterns
are rejected before transport; this is not a complete sensitive-data detector.
New local card saves omit verification codes.

Settings → Capabilities → Vault manages passwords, credit cards, passkeys and
secrets in the device vault, encrypted with the OS key store (Windows DPAPI via
Electron `safeStorage`). The local bridge enables its `passwords` feature flag;
`product.vault.*` and `product.secretInputs.*` calls are refused before cloud
transport. Agents use entries only after **Vault access** is turned on for that
agent. Values are injected into child processes (`vault run`, `browser fill`)
and never appear in chat or model context.

The app uses `%APPDATA%\Timewarp Energy`. Existing profiles are preserved. Private
backups, acceptance fixtures and retired integration code are excluded from the
packaged app.

## Build and verification

Editable integration source is in `timewarp`. With Node 24 installed:

```powershell
cd timewarp
npm ci --ignore-scripts
npm run check
npm test
npm run build
npm run verify:build
npm run verify:contracts
```

Close this workspace's Timewarp app before rebuilding. The build extracts the
pristine Energy archive, verifies patch boundaries, applies the integration and
local logo/icon, and updates Electron archive integrity. `config.json` contains
public configuration only. `npm run dev` opens the same desktop executable.

Google OAuth uses the existing **TimeWarp Supabase Production** client and
Local TimeWarp's published website routes at
`https://timewarpdev.com/auth/google` and
`https://timewarpdev.com/auth/v1/callback`. Its `energy-desktop` target encrypts
the Google identity assertion to an ephemeral device key. The device exchanges
that assertion with Supabase using its saved raw nonce, retaining the existing
Google account identity. No Google client secret or additional auth server is
needed. The branded flow is enabled in `timewarp/config.json` and the rebuilt
desktop app. See [the setup and rollback instructions](timewarp/auth-bridge/README.md).

Keep `https://timewarpdev.com/auth/v1/callback` in Google's Authorized redirect
URIs. Retain `https://mrqoeywofslgnquvzhuf.supabase.co/auth/v1/callback` for older
clients, and `http://127.0.0.1:17654/oauth-callback` in Supabase's redirect allowlist
for desktop email links. Run `npm run verify:oauth` to check the selected Google
flow against the live services without changing a device session. The check
stops at Google's sign-in page; completing a Google account sign-in is still a
separate acceptance step.

Cloud source is in `timewarp/cloud`; migrations are in
`timewarp/supabase/migrations`. `schema.sql` describes the current integration
tables for a fresh production-service database. Existing installations use the
ordered migrations. Run `node scripts/stage-cloud.cjs` from `timewarp` to stage
all cloud modules, then deploy `timewarp-energy`, `stripe-billing` and `stripe-webhook` from
`supabase/functions`. Apply the checked-in migrations first. Authentication is validated with
Supabase `getUser` inside the handler. Release packages contain no acceptance
harness, and the backend exposes no verification endpoint.

The hosted document/memory tables and remote-execution worker scheduler have
been removed. The new database-local credit settlement retry job handles billing
recovery only. Earlier migrations and dated reports describe historical
versions. Current checks are in `timewarp/reports/local-harness-execute.json`,
`local-harness-restore.json` and `local-cloud-verification.json`.

The supplied Energy base is compiled JavaScript. This project reproducibly
patches it with editable integration code. Copyright and third-party notices
are preserved. Development builds are unsigned with updates disabled. Release
staging now builds an isolated NSIS installer, requires timestamped Timewarp
signatures for public artifacts, and uses a Timewarp HTTPS update feed with
closed-on-error signature verification. Certificate/feed provisioning and live
acceptance remain outstanding. See [release building](docs/building.md#isolated-installers-and-release-signing)
and the [operations runbook](docs/operations.md).

## Branded emails

The production `auth-email-hook`, `timewarp-workspaces`, and `contact` functions
share the email shell in `timewarp/supabase/functions/_shared/email-templates`.
Authentication emails, account security notices, workspace invitations,
contact receipts, support submissions, and waitlist confirmations use the
Timewarp name, app icon, Ice blue accent, and support/legal footer. Each message
has HTML and plain-text versions. Confirmation and passwordless sign-in emails
include both a secure link and the service-issued one-time code. Recovery uses
the password-reset link accepted by the app; reauthentication uses its
service-issued code. Desktop links preserve the
loopback callback and PKCE flow. Secure email changes keep separate links for
the current and new addresses.

`TIMEWARP_EMAIL_FROM` supplies the branded sender. The public logo is the app
icon in the `timewarp-brand-assets` storage bucket; run
`node scripts/publish-email-brand-assets.cjs` from `timewarp` when it changes.
`TIMEWARP_EMAIL_LOGO_URL` can override its public URL. Publishing requires the
existing authenticated Supabase CLI; credentials are never embedded in emails.

With Deno installed, run `npm run test:email` and `npm run preview:emails` from
`timewarp`. `npm run verify:email-layout` checks all previews at 600px and 320px
using the existing isolated Electron harness. The preview gallery is
`timewarp/reports/email-previews/index.html`. Deploy these three functions after
changing the shared shell, since each deployed function bundles its own copy.

## ChatGPT usage, connected apps and mascots

**Connect Codex account** is available on the Free plan under Billing, after normal
Timewarp login. It authorizes AI funding and does not create or sign into a
Timewarp account. The implementation follows the working local Timewarp app at
C:\Users\vince\dev\Desktop-APP: Codex app-server owns its built-in browser
login, callback, credential storage and refresh. The retired dynamic agent
registration flow is no longer used.

Free requests use the native OpenAI Codex provider, preserving the existing
harness tools, approvals, streaming and chat history. The current plan is checked
against cloud billing before each turn. Pro, Max and Ultra use Timewarp credits.
A provider change updates an existing chat before the next turn. A failed or
incomplete Codex connection never silently spends purchased credits. Free users
can choose **Disconnect Codex account** to switch to their purchased credits.

Codex uses the app-private CODEX_HOME under the Timewarp profile with its OS
keyring credential store. No personal Codex auth files are imported. An encrypted
local binding restricts the saved Codex connection to the same Timewarp owner;
a different owner must reconnect. OpenAI credentials are never sent to Timewarp's
backend. Optional ChatGPT authentication is disabled on the credit-funded proxy.

Billing shows the connected Codex email, subscription, remaining allowance meters
and reset times, with a single Connect or Disconnect action. Plan usage at the top
always measures monthly Timewarp credits; Active credits under Extra credits shows
the purchased balance. Connection approval can be cancelled while it is pending.
Native verification can still perform a small real Codex turn, with a funding
guard that prevents verification from running on a paid Timewarp plan.

See [Codex app-server authentication](https://learn.chatgpt.com/docs/app-server#authentication-endpoints)
and [Codex credential storage](https://learn.chatgpt.com/docs/auth#credential-storage).

The existing authenticated production Composio service supplies the real
connected-app catalog, account authorization and tool execution. Its API key
stays server-side. The device registers an authenticated local MCP endpoint
with the native agent for assistant discovery, account discovery, tool-schema
search and execution. Assistant access selections stay encrypted locally;
connection ownership is rechecked by the server. Connected-app OAuth tokens
are held by Composio. Custom MCP servers remain managed by the original local
desktop interface.

The model picker lists only the models the current plan runs: the connected
Codex catalog on Free with a Codex account, otherwise Sol and Luna. A chat saved
with a model outside that catalog shows the model it is routed to.

Voice input (dictation) uploads the recording through the device bridge to
`timewarp-energy`'s `/v1/transcriptions`, which uses the Azure
`GPT_REALTIME_TRANSCRIBE_MODEL` deployment (default `gpt-4o-mini-transcribe`)
with the `GPT_REALTIME_KEY` secret. Codex has no transcription endpoint, so
dictation spends Timewarp credits on every plan, including Free with a
connected Codex account; without credits the app opens the credits prompt.

The app calls assistants **agents**. When adding an agent, choose **Orbit**,
**Nova**, or **Cosmo** in the New Agent dialog, or upload your own picture.
The selected mascot is saved with the agent and stays selected on restart.

The right pane in an agent chat starts with the default browser tab. Its browser toolbar
keeps the address/search field, back, forward, refresh and profile picker together.
New browser tabs open a home page with **Tools → Agent / Files** and
**Recommended** with up to four recent websites, shown as large favicons and names.
The home has centered, spacious cards; there are no separate Chat or Workspace labels.
Tools open inside the same pane;
the home button returns to the browser home. Browser tabs and open file tabs
remain available. Recent websites are saved locally for that chat and browser
profile, with at most twelve entries; a profile change shows that profile's list.

Orbit, Nova and Cosmo are bundled alien mascots: animated, square avatars
rendered in Blender, with matching icon sets. Their source and rebuild steps
are in `timewarp/design/mascots`. Existing assistants without
an avatar, built-in avatars, and cloud-restored assistants receive a stable
mascot. Uploaded user pictures are preserved.

Current source tests cover native Codex login, cancellation, owner isolation,
provider selection on all plans, completed-turn verification and no paid
fallback. Historical reports of invalid_grant and
3p_login_workspace_scope_denied came from the retired dynamic agent flow.
The optional Sign in with ChatGPT onboarding draft is historical, not a step
required by the current desktop connection. Live owner acceptance is recorded
separately in timewarp/reports/chatgpt-desktop.json. Temporary acceptance code
is excluded from release packages.

## Plans, billing and unit economics

| Plan | Monthly USD | Included AI credits |
| --- | ---: | ---: |
| Free | $0 | 0; bring an eligible ChatGPT/Codex subscription or purchase credits |
| Pro | $20 | 100 |
| Max | $50 | 250 |
| Ultra | $100 | 500 |

Extra-credit packs are available on every plan. Credits are granted only after
Stripe confirms payment. New desktop checkouts validate the actual USD amounts
and monthly recurrence, with tax-inclusive prices and card payments. The signed
webhook checks payment status before granting credits and handles delayed
success events. Existing subscriptions keep
their current price until their owner explicitly changes plan. Purchasers can
open their own Stripe portal for invoices, including on Free. Checkout returns
reconcile against Stripe, pending sessions can be cancelled, and unpaid or
another person's checkout cannot grant entitlement.

Subscription checkout stops on failed database or Stripe lookups. A durable
pending attempt per billing scope makes concurrent requests and lost responses
reuse the same Stripe session. The guard also checks previous open sessions and
live subscriptions before creating a checkout. This source fix requires the
new guard migration and a coordinated billing-function deployment; see
[billing guard deployment](docs/building.md#billing-guard-deployment).

Timewarp-funded requests debit 2.5 × the configured provider token cost,
converted at $0.125 per credit. Reservations cap output and prevent concurrent
overspending; settlement uses actual returned tokens and an idempotent ledger.
Connected ChatGPT requests are separate and never debit these credits.
The modeled contribution margin is about 66% for plans and at least 47% for
credit packs after assuming 25% inclusive tax and payment fees of 4% + $0.30,
before infrastructure, support and other overhead. This is a model, not a
measurement of total profit. See `timewarp/reports/billing-economics.md` for
the calculation and pricing-review assumptions.

The live acceptance report is `timewarp/reports/billing-cloud.json`: real
Stripe checkout amounts and portal, account-isolated cloud saves restored after
fresh sign-in, profile/organization pictures, 101-chat pagination and a real
Luna request charged at the configured conversion. No payment was submitted;
isolated fixture accounts and test resources were removed. The packaged UI was
checked separately in `timewarp/reports/billing-desktop.json` and
`billing-desktop.png`. Release archives exclude both temporary verifiers.
