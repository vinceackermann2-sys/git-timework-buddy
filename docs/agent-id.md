# Timewarp Agent ID

Agent ID gives each AI agent an identity that traces back to a responsible
person or business, plus its own **mail inbox, phone number, wallet, virtual
card and virtual machine**. Owners hand these out instantly from the website,
the CLI or the API. Agents use them headless through the API, the MCP server
or the CLI, whether they run in Codex, Claude Code, Claude Desktop, Cursor,
Timewarp or anything else. Owners see everything the agents do.

Companies can accept **only verified agents**, using a passport check through
the SDK or the API. They can also accept Git commits **only from their own
verified agents**, using the GitHub Action or a pre-receive hook.

| Piece | Where |
| --- | --- |
| Cloud service (API, MCP, webhooks) | `timewarp/supabase/functions/agent-id/` |
| Database | `timewarp/supabase/migrations/20261020120000_agent_id.sql`, `20261020180000_agent_id_claims.sql` |
| Website dashboard | `src/routes/agent-id*`, served at `timewarpdev.com/agent-id` |
| CLI, stdio MCP server, `attach` for existing agents | `agent-id/cli` (`@timewarp/agent-id`, command `timewarp-id`) |
| Verification SDK for companies | `agent-id/sdk` (`@timewarp/agent-id-verify`) |
| Repository protection | `agent-id/action` (GitHub Action), `agent-id/hooks/pre-receive.sh` |
| Local API and tests | `timewarp/scripts/agent-id-dev.cjs`, `timewarp/tests/agent-id*.test.cjs` |

## How it works

```
 owner ──► website / CLI (owner key) ─┐
                                      ├─► agent-id edge function ──► Postgres (agent_id_*)
 agent ──► API / MCP / CLI (agent key)┘          │  ▲
                                                 │  └── webhooks: Resend, Telnyx/Twilio, Stripe
 company ──► SDK (offline, JWKS) / API (secret) ─┘
                                                 └──► Resend · Telnyx/Twilio · Privy · Stripe Identity · Azure sandboxes
```

The function decides what a caller may do from its credential:

- **Signed-in Timewarp session or owner key** (`two_…`): the account's agents,
  their resources and limits, approvals, verification and companies. Only a
  signed-in session can create owner keys, so a leaked key can't mint more.
- **Agent key** (`twa_…`): one agent acting as itself (`/v1/me/…`, `/mcp`).
- **Owner credential plus a `Timewarp-Agent: agt_…` header**: the owner acting
  as one of their agents. The dashboard uses this, and so will the desktop app.
- **Company secret** (`twrp_…`): checking passports (`/v1/verify`) and listing
  Git signers (`/v1/allowed-signers`).

Only SHA-256 hashes of keys and secrets are stored. Browser roles have no access to
the `agent_id_*` tables or functions. Every action an owner, an agent, a
provider or a company takes is written to `agent_id_audit`.

## Giving your existing agents an Agent ID

```
npx @timewarp/agent-id attach                     # pick from the agents it finds
```

No account or sign-in is needed first. On a computer that isn't signed in,
`attach` starts a **claim**: it prints a link (and opens it) with a match code.
On that page the person enters their email, ticks the terms and types the
6-digit code they get. That creates their Timewarp account, or uses the one
they have, signs them in to the website and creates the agent at once; no
identity check (that comes the first time money leaves a wallet). `attach`
collects its key and wires it in. Everything chosen in one `attach` shares
that one Agent ID. On the website, `/agent-id/claim` asks only for an email:
the agent is named after its owner ("Ada's agent", renamed any time) and the
page ends with `npx @timewarp/agent-id attach --claim twc_…`. Signed in
(`timewarp-id login --owner-key two_…`), `attach` creates agents directly as
before.

Claims (`agent_id_claims`, `claims.ts`) are open routes: `POST /v1/claims`,
`GET /v1/claims/:code`, `POST /v1/claims/:code/email`,
`…/email/confirm` (with `terms`, the version ticked), `…/terms` (when the
terms weren't ticked; `…/identity` is its older name) and
`POST /v1/claims/collect`. The link code is random, and an unfinished link
expires after an hour. The email code allows 5 tries and 5 sends, 30
seconds apart, and a network can start 20 claims an hour. The agent's key goes
once, to the holder of the claim's secret.

**One Agent ID, many apps.** An Agent ID keeps its name, mail, number, wallet
and machine in every app that uses it. Each app it connects from (the MCP
client's name) or is set up in (`attach`, `POST /v1/me/apps`) is recorded in
`agent_id_agent_clients`, and agents carry `apps` (most recent first) for the
dashboard.

`attach` finds the agents already on the computer: Claude Code (the main
agent, user or project scope, and its subagents), Codex, Cursor, Claude
Desktop, Timewarp's desktop agents, and any project folder (`--here`). It
gives the chosen one a new Agent ID named after it, or the one you name with
`--agent <handle>`. That Agent ID can be one made on the dashboard: the
command fetches a key for this computer. It then saves the link in that
agent's own files:

- a short identity block in the agent's instructions (subagent file,
  `AGENTS.md`, `CLAUDE.md`, Cursor rule);
- `.timewarp-id.json` in its folder, so `timewarp-id` commands and the MCP
  server there act as that agent;
- the MCP server entry in the tool's config. Each subagent gets its own,
  pinned server, added to its `tools:` list.

Timewarp agents can't have their own MCP server yet. They use the
`timewarp-id` command from their workspace, and their Agent ID is linked to
the desktop agent (`desktopAgentId`).

`attach` is idempotent and backs up each config file it changes. `detach`
removes exactly what it added, and `agents scan` lists what it finds.

When an agent's transfer is over the approval amount, the agent is told to ask
you to run `timewarp-id approve <id>`. `timewarp-id approvals` lists what's
waiting and asks approve or deny for each; the dashboard shows the same list.
Owner commands mention it when anything is waiting.

## Resources: test and live

Every kind works in **test mode** everywhere. Test resources cost nothing and
only reach other Agent ID agents:

- mail goes to `<handle>@agents.timewarp.test`;
- phone numbers use fictional `+1 xxx 555-01xx` numbers;
- wallets hold test dollars that the owner adds on the dashboard;
- the card is Stripe's public test number, and agents can try charges against
  their limits;
- the machine has a state but runs no commands.

A kind is **live** only when it is listed in `AGENT_ID_LIVE` *and* its
provider's secrets are set. Deploying the function never starts spending money
on its own.

| Kind | Live provider | What the agent gets | Gates (defaults) |
| --- | --- | --- | --- |
| mail | Resend on `TIMEWARP_AGENT_MAIL_DOMAIN` (`agents.timewarpdev.com`), the domain the previous app's agent mail used | `<handle>@agents.timewarpdev.com`; send, receive, reply in thread; delivery status | — |
| phone | Telnyx (or Twilio, `AGENT_ID_PHONE_PROVIDER`), on Timewarp's account. Telnyx: one messaging profile and one TeXML app made on first use, Ed25519-signed webhooks | A local number that can text and call; texts; calls that read a message aloud; incoming calls get a greeting and voicemail | paid plan |
| wallet | Privy server wallets on Base holding USDC and USDT, shown together as US dollars (`AGENT_ID_WALLET_CHAIN=base`, or `base_sepolia` to try it on testnet). Privy keeps the keys; with gas sponsorship on, sends need no ETH | An 0x address; a USD balance; deposits and sends in its history; transfers to addresses, other agents and contacts | given at once; money leaves it only once the owner is verified |
| card | An early-access application for now (`/v1/agents/:id/card-application`). Stripe Issuing cards are built in and turn on with `AGENT_ID_CARDS=issuing` once a card program is approved | A virtual card; every payment decided in real time by the limits | verified owner, paid plan |
| vm | Azure Container Apps sandboxes (Linux microVMs), the same as the previous app's cloud agents | A computer that resumes for each command, stops after it and keeps its files. Set up the first time the agent uses it (its `vm_*` tools are always listed) | credits (time is charged) |

**Ready on creation.** A new Agent ID, whether made on the dashboard, by
`attach`, through the API or by a claim link, comes with its resources
(`provisioning.ts`):
- mail and a wallet for everyone (`AGENT_ID_AUTO_GIVE`, default `mail,wallet`);
- a phone number on paid plans (`AGENT_ID_AUTO_GIVE_PAID`, default `phone`);
  `none` turns either list off;
- no computer: the agent gets one the first time it uses it.

The usual checks still apply: the provider is live, and phone numbers need a
paid plan. Wallets come before the owner is verified; money leaves one only
after (`AGENT_ID_VERIFY_TO_SEND`, on by default). A kind that can't be given now is
listed in the response's `setup.skipped` with its reason, and never stops the
agent being made. Providers answer in the background (`EdgeRuntime.waitUntil`).
The slots show as `provisioning` until they're ready, and one that fails is
freed, so the owner can add it later. `resources: []` on
`POST /v1/agents` makes an agent with nothing.

**Adding and taking out money.** A live wallet holds real USDC and USDT on
Base (Privy). Money comes in and goes out in three ways:

- **Crypto.** `GET /v1/agents/:id/wallet/add-money` gives the address and
  network to send USDC or USDT on Base from an exchange or another wallet.
  `POST /v1/agents/:id/wallet/withdraw` with `to` sends to the owner's own
  address.
- **Bank (Bridge).** With `BRIDGE_API_KEY` set, the owner's one identity check
  is Bridge's (a Stripe company): `POST /v1/account/bank/verify` or
  `POST /v1/account/verification` gives Bridge's hosted terms and ID check,
  and Bridge's approval also verifies them on Agent ID. After that:
  - **SEPA, as a form.** `POST /v1/agents/:id/wallet/bank-payins` with
    `amount` (euro cents, €1 to €100,000) opens one Bridge transfer of that
    amount to the wallet (`agent_id_bank_payins`). The person gets exactly
    what to send: amount, name, IBAN, BIC and a reference. Bridge converts the
    euros and sends USDC to the wallet; SEPA Instant arrives in minutes.
    `GET …/bank-payins` lists them (open ones are looked at again every half
    minute, and Bridge's transfer webhook updates them), `DELETE
    …/bank-payins/:id` cancels one still waiting for the money.
  - `POST /v1/agents/:id/wallet/bank-deposit` with `currency` (`usd` or
    `eur`) gives the wallet its own bank details (a Bridge virtual account).
    Money sent there arrives as USDC. The website uses these for US dollars
    only.
  - `POST /v1/account/bank/accounts` saves a bank account at Bridge: an IBAN
    (euros, SEPA) or a US account (ACH), with the holder's address. Agent ID
    keeps only the bank's name and the last four characters.
  - `POST /v1/agents/:id/wallet/withdraw` with `bankAccount` opens a Bridge
    payout for the amount, and the wallet sends Bridge the USDC. If the USDC
    isn't sent, the payout is cancelled.
  - The payout's progress (`data.bank.state`) comes from Bridge's webhook
    and from a look when the history is read.
  - US dollars need Bridge's `base` endorsement, euros its `sepa` one. Bridge
    opens SEPA per developer account; until it does, set
    `AGENT_ID_BANK_CURRENCIES=usd`.
- **Card (Privy's funding by default).** Wherever Privy runs the wallets,
  cards go through the onramps switched on in Privy's dashboard (Funding:
  Stripe for USD and EUR in the US and EU, MoonPay, and Meld for more
  currencies once its KYB is done). Privy opens them in the browser with its
  SDK (`@privy-io/react-auth`, loaded only when someone opens Card), and only
  for someone signed in to Privy, so the first time the owner confirms their
  email with a Privy code (filled in). `POST /v1/agents/:id/wallet/add-money`
  records the purchase (audit `wallet.add_money_card`) and returns the
  destination: the wallet's address, USDC on Base, euros for people in Europe.
  The website's domain must be in the Privy app's allowed origins.
  Development deployments buy in Privy's sandbox. `PRIVY_CLIENT_APP_ID` sets a
  separate public app ID for the browser (default `PRIVY_APP_ID`).
  Privy's Custom authentication (Scale plan) would sign owners in to Privy
  with their Agent ID login and drop the code.
- **Card (MoonPay, or Stripe, by choice).** `AGENT_ID_CARD_PROVIDER=moonpay`
  with `MOONPAY_API_KEY` and `MOONPAY_SECRET_KEY` set (same mode) makes
  `POST /v1/agents/:id/wallet/add-money` return MoonPay's page for buying USDC on Base by card, Apple Pay or Google
  Pay, in Europe and the US. The page's address is signed with the secret key
  (so the wallet can't be swapped), bound to the buyer's IP address
  (`allowedIpAddress`), and names the Agent ID account and the purchase
  (`externalCustomerId`, `externalTransactionId`). The buyer pays in their
  own money (euros in the euro area, crowns in Sweden, and so on). MoonPay
  checks the buyer itself the first time. Without MoonPay, and with
  `STRIPE_CRYPTO_ONRAMP_ENABLED` set and Stripe's onramp approved, the same
  call starts Stripe's crypto onramp (US buyers only): embedded with
  `STRIPE_PUBLISHABLE_KEY`, else on Stripe's own page.

Withdrawals need a signed-in session. They are screened like any transfer,
but they don't count against the agent's limits.

An agent has at most one resource of each kind. Mail and wallet addresses are
never given to anyone else, even after the agent is revoked. Phone numbers,
cards and machines go back to their provider.

## Safety

- **Owner limits, enforced in the database.**
  - Wallets have `perTransfer` and `daily` caps, and an `approvalAbove` amount;
    a transfer above it waits for the owner on the dashboard. New wallets start
    at 50 / 100 per day / approval above 25.
  - Cards have `perTransaction`, `daily` and `monthly` caps, plus blocked or
    allowed merchant categories. New cards start at 50 / 100 / 500.
  - The caps always hold, even for transfers the owner approves.
  - Wallets are locked while a transfer runs, so two concurrent transfers can't
    spend the same money.
  - Live card payments are decided by Agent ID in Stripe's real-time
    authorization webhook. Any failure declines.
- **Pausing and revoking.** Pausing an agent, or one of its resources, stops it
  at once: keys, card authorizations, Git signing and passport checks all fail.
  Revoking is final: keys and signing keys stop working, and resources are
  released.
- **Rate limits** apply to mail, texts, calls, transfers, card reveals, machine
  commands and passports. They use the shared `timewarp_consume_rate_limit`.
- **Machine time is paid in credits.** Each command reserves the most it can
  cost before it runs, at the same 2.5 × provider cost and 0.125 USD per credit
  as AI usage, then settles what it actually used.
- **Verification (KYC/KYB).**
  - A person verifies once, the first time they move money out of a wallet:
    a document and a matching live selfie. Where Bridge moves money to and
    from banks, that check is Bridge's, so nobody is checked twice
    (`kycProvider: 'bridge'`; its approval arrives by webhook). Elsewhere it
    is Stripe Identity (`AGENT_ID_KYC=stripe_identity`), and without either,
    Timewarp reviewers named in `AGENT_ID_REVIEWERS` review submissions by hand.
  - A business is checked the same way: where Bridge moves money, by Bridge's
    business check (`kybProvider: 'bridge'`, `agent_id_bank_businesses`): its
    registration, owners and a document on Bridge's page, then Bridge's
    review. Elsewhere it's reviewed by Timewarp from its registration details.
    Either way it's started by an organization owner or admin who is verified
    themselves, with their role and a signed confirmation.
  - Only the outcome, the legal name and the country are stored. Documents stay
    with Bridge or Stripe.
  - An organization's agent counts as the business's only while its owner is an
    active member. Someone who leaves takes no company standing or Git rights
    along.

## Passports: proving who an agent is

`POST /v1/me/passport { audience }` (MCP tool `passport_issue`, CLI
`timewarp-id passport --audience …`) returns an ES256 JWT that lives for 5
minutes:

```json
{
  "iss": "https://timewarpdev.com/agent-id", "sub": "agt_…", "aud": "https://api.example.com",
  "iat": 0, "nbf": 0, "exp": 300, "jti": "…",
  "agent": { "name": "Research bot", "handle": "research-bot-x7k2", "runtime": "claude", "principal": "agt_…@agents.timewarpdev.com" },
  "owner": { "ref": "own_…", "type": "business", "verified": true, "level": "kyb", "name": "Acme AB", "country": "SE" },
  "org": { "id": "…", "name": "Acme", "verified": true },
  "resources": ["mail", "wallet"]
}
```

- `owner.ref` is a pseudonym that is stable for one audience but different for
  each audience, so companies can't track an owner across services. A person's
  name is never included; a verified business's legal name is. Timewarp can map
  any agent back to its responsible owner.
- Agents send the passport in an `Agent-Passport` header.
- Companies check it either way:
  - **offline:** the signature against `GET /.well-known/jwks.json`, plus
    issuer, audience and expiry;
  - **online:** `POST /v1/verify` with their secret, which also catches an
    agent revoked a second ago and applies the company's policy (`any`,
    `verified`, `kyc` or `kyb`; allowed organizations or agents). Every check is
    on the owner's audit log.
- Rotate the signing key with `scripts/agent-id-keygen.cjs` and
  `AGENT_ID_PREVIOUS_PUBLIC_KEYS`.

## Protecting a codebase

1. An agent registers an SSH ed25519 key with `timewarp-id git setup`. The
   command generates the key locally, registers the public half
   (`POST /v1/me/signing-keys`) and configures Git to sign every commit with
   `user.email` set to the agent's principal.
2. The company puts the GitHub Action in its repository with its
   organization id. No account, registration or secret is needed.
3. `GET /v1/orgs/:orgId/allowed-signers` (public) returns Git's
   `allowed_signers` file. It lists
   every active key of the organization's active agents whose owner meets the
   policy. The GitHub Action (or the pre-receive hook) runs `git verify-commit`
   on every new commit against it. Branch protection makes the check required.
   Humans who commit too are allowed by **their signing keys**, never by email
   (an author email can be faked). They are listed through the `human-signers`
   input, read from the base commit so that a pull request can't add its own
   key.
4. Pausing or revoking an agent, removing a key, or the owner leaving the
   organization drops the key from the list immediately. A swarm of agents
   that aren't the company's own can't produce a commit that passes.

## API reference

Base: `https://mrqoeywofslgnquvzhuf.supabase.co/functions/v1/agent-id`. JSON
in and out. Errors are `{ "error": { "code", "message" } }`. Money is
`{ amount (cents), currency, display }`; transfers and charges also accept
`value: "12.50"`.

| Owner | |
| --- | --- |
| `GET /v1/account` | user, verification, organizations (with KYB), plan, reviewer flag, config |
| `POST /v1/account/verification` | `{kind:'person'}` → Bridge's or Stripe Identity's `url`, or `{legalName,country}` for review · `{kind:'business', organizationId, legalName, country, representativeRole, attestation, website?, registrationNumber?}` → Bridge's `url` where Bridge checks businesses (else the registration number is required, for review) |
| `GET/POST /v1/agents` · `GET/PATCH/DELETE /v1/agents/:id` | create (returns the agent key once), list, rename, runtime, organization, desktop link, pause/resume, revoke |
| `POST /v1/agents/:id/keys` · `DELETE …/keys/:keyId` | more agent keys |
| `POST /v1/agents/:id/resources` | `{kind, mode:'test'|'live', settings, options}` (options: `size`, `country`, `areaCode`, `billing`, `currency`) |
| `PATCH/DELETE /v1/agents/:id/resources/:kind` | settings (limits, greeting), pause, remove |
| `POST /v1/agents/:id/wallet/test-funds` | test money |
| `GET /v1/agents/:id/events?kind=` · `GET …/contacts` | everything the agent did |
| `GET /v1/approvals` · `POST /v1/approvals/:id {decision}` | approve or deny transfers |
| `GET /v1/audit?agent=` | audit log |
| `GET/POST /v1/keys` · `DELETE /v1/keys/:id` | owner keys for the CLI (created with a session only) |
| `GET/POST /v1/relying-parties` · `PATCH/DELETE …/:id` · `POST …/:id/secret` | companies: audience, policy, secret (shown once; rotate replaces it at once). An audience is not owned: several companies may use the same one |
| `GET /v1/reviews` · `POST /v1/reviews/:person|business/:id` | reviewers only |

| Agent (`/v1/me`) | |
| --- | --- |
| `GET /v1/me` | identity, owner verification, organization, resources |
| `GET/POST /v1/me/mail` · `GET /v1/me/mail/:id` | list (`folder`, `unread`), send (`to`, `cc`, `subject`, `text`, `replyTo`), read |
| `GET/POST /v1/me/sms` · `GET/POST /v1/me/calls` | texts; calls (`say`) and voicemail |
| `GET/POST /v1/me/contacts` · `PATCH/DELETE …/:id` | contacts |
| `GET /v1/me/wallet` · `GET …/transactions` · `POST …/transfers` | balance, limits, history; send (`to`: agent id, handle, address or contact) |
| `GET /v1/me/card` · `POST …/reveal` · `GET …/transactions` · `POST …/test-charge` | card |
| `GET /v1/me/vm` · `POST …/start|stop|exec` · `GET …/commands` | machine |
| `POST /v1/me/passport` | passport for an audience |
| `GET/POST /v1/me/signing-keys` · `DELETE …/:id` | Git signing keys |
| `POST /mcp` | MCP (Streamable HTTP). Lists only the tools for what the agent has |

| Public (no account) | |
| --- | --- |
| `POST /v1/verify {passport, audience, require?, organizations?}` | `valid`, `allowed`, `reasons`, agent, owner verification: any service can check a passport an agent showed it, including whether the agent was revoked a second ago |
| `GET /v1/orgs/:orgId/allowed-signers[?format=json&require=kyb]` | Git `allowed_signers` for an organization's verified agents (agent ids and public keys only) |
| `GET /.well-known/jwks.json` · `GET /v1/config` | public keys and what this deployment offers |

Developers use the SDK (`@timewarp/agent-id-verify`): `verifyPassport` checks
offline against the public keys, `checkPassport` asks the endpoint above, and
`withAgentId` / `agentIdMiddleware` protect an API or an MCP server. There is
nothing to register. The older company-secret endpoints still work, but they
aren't needed any more.

## Mail, phone and where agents come from

- **Mail** works like a mailbox:
  - folders: Inbox, Sent and Bin (`folder`);
  - search (`q`), unread counts (`/v1/me/mail/counts`), read or unread;
  - moving to the Bin and restoring, then deleting for good from the Bin.
- **Attachments** are uploaded first (`POST /v1/me/files`, raw bytes, up to
  10 MB) and attached by id, up to 25 MB per message. Received attachments are
  downloaded from Resend and kept with the message. All files live in the
  private `agent-id-files` storage bucket.
- **Phone:** an incoming call that ends without a voicemail is `missed`.
- **Origin:** `origin { app, label, detail, client }` says where an agent
  comes from.
  - The owner or `timewarp-id attach` sets it.
  - The MCP client an agent connects with (`clientInfo`, such as
    claude-code, codex-mcp-client or cursor) is recorded, and fills in agents
    nobody labelled.
- **Machines** keep the agent's files on their disk between commands until the
  machine is removed. `GET /v1/me/vm/files?path=~` lists a folder; it is
  paid like a command.

## Configuration

Secrets on the Supabase project, read by the `agent-id` function:

| Secret | Needed for |
| --- | --- |
| `AGENT_ID_SIGNING_KEY`, `AGENT_ID_WEBHOOK_SECRET` | Passports, phone webhooks, owner pseudonyms. Generate with `node scripts/agent-id-keygen.cjs`. **Required.** |
| `AGENT_ID_LIVE` | Comma list of the kinds that are live, e.g. `mail,vm`. Empty means everything is test. |
| `AGENT_ID_REQUIRE_VERIFICATION` | Kinds whose live resources need a verified owner up front (default `card`). Add `agent` to require verification before any agent at all. `all` means everything. |
| `AGENT_ID_VERIFY_TO_SEND` | `false` lets money leave live wallets before the owner is verified (on by default) |
| `AGENT_ID_PAID_PLAN_KINDS` | Live kinds that need Pro/Max/Ultra (default `phone,card`) |
| `AGENT_ID_KYC` | Bridge's check wherever bank transfers are on; otherwise `stripe_identity` (recommended), else manual review. `test` verifies at once: development only. |
| `AGENT_ID_KYB` | Bridge's business check wherever bank transfers are on; otherwise manual review. `manual` keeps manual review. `test` is for development only. |
| `AGENT_ID_REVIEWERS` | User ids of Timewarp staff who review verifications |
| `AGENT_ID_MAX_AGENTS` | Agents per account (default 25) |
| `RESEND_API_KEY` (exists), `AGENT_ID_RESEND_WEBHOOK_SECRET` | Live mail. Optional `AGENT_ID_MAIL_DOMAIN` overrides the domain. |
| `TELNYX_API_KEY`, `TELNYX_PUBLIC_KEY` | Live phone numbers through Timewarp's own Telnyx account (used when its key is set) |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` | Live phone numbers through Twilio instead (`AGENT_ID_PHONE_PROVIDER=twilio`) |
| `PRIVY_APP_ID`, `PRIVY_APP_SECRET`, `AGENT_ID_WALLET_CHAIN` | Live wallets |
| `BRIDGE_API_KEY`, `AGENT_ID_BANK_CURRENCIES` | Bank deposits and withdrawals for live wallets on Base (`usd,eur` by default; `AGENT_ID_BANK=off` hides them). Keys starting with `sk-test` use Bridge's sandbox. The Bridge webhook registers itself (`BRIDGE_WEBHOOK_PUBLIC_KEY` overrides). |
| `AGENT_ID_CARD_PROVIDER`, `PRIVY_CLIENT_APP_ID` | Card payments: `privy` (default where Privy runs the wallets), `moonpay` or `stripe`. `AGENT_ID_CARD_PAYMENTS=off` hides them. |
| `MOONPAY_API_KEY`, `MOONPAY_SECRET_KEY` | Card payments through Timewarp's own MoonPay account (`AGENT_ID_CARD_PROVIDER=moonpay`, once MoonPay has approved it). `pk_test_`/`sk_test_` use MoonPay's sandbox. |
| `STRIPE_CRYPTO_ONRAMP_ENABLED`, `STRIPE_PUBLISHABLE_KEY` | Buying USDC by card through Stripe's onramp (US only, once approved), when MoonPay isn't set. The publishable key embeds the form. |
| `STRIPE_SECRET_KEY` (exists), `AGENT_ID_STRIPE_WEBHOOK_SECRET` | Live cards and Stripe Identity |
| `AZURE_*` (exist) | Live machines |
| `AGENT_ID_SITE_URL`, `AGENT_ID_ISSUER`, `AGENT_ID_PUBLIC_URL`, `AGENT_ID_PASSPORT_SECONDS` | Overrides (defaults: `https://timewarpdev.com`, `<site>/agent-id`, the function URL, 300) |

## Legal and verification

- **Agent ID Terms:** at `/legal/agent-id-terms`. Accounts accept the current
  version (`POST /v1/account/terms`) before they create agents. The version
  and the time of acceptance are recorded.
- **Privacy Policy:** section 7 covers Agent ID. It lists the data, the legal
  bases, Stripe Identity, Privy, Telnyx, Twilio and Azure as processors, Bridge
  (bank transfers and identity checks) and MoonPay (card payments) as
  companies responsible for their own data, and how long
  records are kept (content: while it exists, plus 30 days; verification, the
  agent–owner link and the audit log: 5 years).
- **KYC:** explicit consent to the biometric check (GDPR Art. 9(2)(a)) is
  required and recorded (`consent_at`, `consent_version`) before a Stripe
  Identity session starts.
- **KYB:** submitted by an organization owner or admin who is personally
  verified, with their role and a signed confirmation (`attested_at`).
  Checked by Bridge where it moves money, else reviewed by operators.
- **Sanctions:** with `CHAINALYSIS_API_KEY` set, live transfers to sanctioned
  addresses are refused, and a transfer fails closed when screening can't be
  reached.
- **Production:** `AGENT_ID_ALLOW_TEST=false`. No test resources; giving a
  resource gives the real one.

**Business checks.** A business uploads its registration document
(`POST /v1/account/verification/document?organization=…`, PDF or photo,
private bucket). An EU VAT number is checked against VIES, and the registered
name and address are stored in `checks.vat`. Reviewers see both in the review
queue (`GET /v1/reviews/business/:id/document`) before approving.

**Webhooks set themselves up.** On the first request after a deploy, the
function registers its Stripe (identity, cards), Resend (incoming mail) and
Bridge (bank verification, payouts) webhooks if they're needed and missing, and remembers that in
`agent_id_settings` (`setup.auto`). `AGENT_ID_AUTO_SETUP=false` turns this
off. The operator button does the same by hand.

## Production state (20 October 2026)

- Migration `20261020120000` is applied, and the `agent-id` function is
  deployed on `mrqoeywofslgnquvzhuf`.
- Secrets are set: signing key, webhook secret, `AGENT_ID_LIVE=mail,vm`,
  `AGENT_ID_ALLOW_TEST=false`, `AGENT_ID_KYC=stripe_identity`, operators,
  and `AGENT_ID_WALLET_CHAIN=base`.
- Migration `20261020180000` (claims, apps, business checks, withdrawals) and
  the updated function go live with `timewarp/reports/agent-id-update.ps1`. The
  same script can then connect wallets and phone numbers through
  `agent-id-connect-providers.ps1`, which asks for the Privy and Telnyx (or Twilio)
  credentials (and optional Chainalysis and Stripe publishable keys) hidden.
- Then, once:
  - activate Identity in Stripe;
  - turn on gas sponsorship for Base in Privy.
  The function registers its webhooks itself on its first request after the
  deploy.

## Going live

Run `timewarp/reports/deploy-agent-id.ps1` (kept out of Git) in Windows
PowerShell. It applies the migration, creates the signing key and webhook
secret without showing them, asks for the Privy App ID and secret (typed
hidden), switches on live mail, machines and wallets with Stripe Identity for
verification, makes you the operator, deploys the function and checks it.
Then, once, in the browser:

- Stripe dashboard: activate Identity.
- Privy dashboard: turn on gas sponsorship for Base.
- Agent ID dashboard: Review queue, then Operator, then **Connect webhooks**.
  This calls `POST /v1/admin/setup`, which registers the service's own
  Stripe and Resend webhooks and keeps their secrets in `agent_id_settings`.

## Rollout by hand

1. **Apply the migration.** It only adds `agent_id_*` tables and functions.
   ```
   supabase db query --linked -f supabase/migrations/20261020120000_agent_id.sql
   supabase migration repair --status applied 20261020120000
   ```
2. **Set the secrets.** Run `node scripts/agent-id-keygen.cjs` and set the two
   secrets it prints, plus `AGENT_ID_REVIEWERS`.
3. **Deploy the function** from `timewarp`:
   `supabase functions deploy agent-id --project-ref mrqoeywofslgnquvzhuf --use-api`.
   Then check that `GET …/agent-id/healthz` returns 200 and that `/v1/config`
   shows everything in test mode.
4. **Publish the website** in Lovable after merging. That serves the dashboard
   at `/agent-id`. Publish the CLI and SDK to npm under the `@timewarp` scope.
5. **Turn kinds live one at a time.** Add each kind to `AGENT_ID_LIVE` once its
   provider is set up:
   - **mail:** in Resend, add a webhook to `…/agent-id/webhooks/resend` for
     `email.received` and the delivery events. Set its signing secret as
     `AGENT_ID_RESEND_WEBHOOK_SECRET`. The domain and its inbound MX already
     serve the previous app's agent mail.
   - **vm:** the Azure sandbox group already exists. Run one command with a
     test account and check that credits were charged.
   - **phone:** a Twilio account with a funded balance. US numbers need A2P
     10DLC registration before they can text US recipients; most other
     countries need regulatory bundles.
   - **card:** Stripe Issuing must be enabled for the account (an application
     to Stripe). Revealing full card numbers by API also needs Stripe's PCI
     approval. Add a Stripe webhook to `…/agent-id/webhooks/stripe` for
     `issuing_authorization.request`, `issuing_transaction.created` and
     `issuing_card.updated`.
   - **KYC:** enable Stripe Identity, add the `identity.verification_session.*`
     events to the same webhook, and set `AGENT_ID_KYC=stripe_identity`.
   - **wallet:** a Privy app (its App ID and an App secret) with gas
     sponsorship on for Base.
6. **Require verification for everything** when you're ready:
   `AGENT_ID_REQUIRE_VERIFICATION=agent,mail,phone,wallet,card,vm`.

## Before real money and real people: decisions to make

- **Wallets are custodial in practice.** Timewarp controls the Privy
  accounts that hold users' funds. In the EU this is likely a crypto-asset
  service under MiCA, which needs authorization or a licensed partner. Get legal
  advice before `wallet` goes live on mainnet. A non-custodial design, with keys
  only in the agent's environment or a provider that holds the license, is the
  alternative.
- **Cards.** Stripe Issuing makes Stripe the regulated issuer. Timewarp still
  needs Issuing approval, cardholder terms and dispute handling.
- **Privacy policy.** It must cover identity verification through Stripe, mail
  and text content stored per agent, call recordings, the audit log and the
  providers named above (Resend, Twilio, Privy, Stripe, Microsoft). Update
  `/legal/privacy-policy` before launch.
- **Costs.**
  - Live phone numbers have monthly fees and are gated to paid plans; there is
    no per-number charge in credits yet.
  - Machine time is charged in credits.
  - Mail and texts are rate limited but not charged.
- **Abuse.** Live outbound mail and texts can be misused for spam. Consider
  requiring verification for `mail` and `phone` too, which is one setting.

## Not built yet (and how it fits)

- **Agent ID tools built into the Timewarp desktop app.** Today `attach`
  links a Timewarp agent and its chats use the `timewarp-id` command. A native
  version needs a tool server in the desktop that proxies `/mcp` with the
  user's session and `Timewarp-Agent`, listed only for agents that have an
  Agent ID, plus a picker in the agent's settings.
- **OAuth for the remote MCP server**, so claude.ai and ChatGPT connectors can
  add it without pasting a key. The previous app's `timewarp-mcp` OAuth 2.1
  server can be reused.
- **Proof of possession for passports.** Bind a passport to the agent's own
  key, through a `cnf` claim or HTTP message signatures in the style of
  Cloudflare's Web Bot Auth, so a stolen passport is useless. Agents already
  hold ed25519 keys for Git signing.
- **Real-time voice conversations** on calls. Calls read a message aloud and
  take voicemail today.
- Charging live phone numbers in credits.

## Development

```
cd timewarp
npm run agent-id:dev          # local API on :54329 with seeded accounts (prints tokens)
npm run test:agent-id         # the service end to end on PGlite, providers scripted
```
