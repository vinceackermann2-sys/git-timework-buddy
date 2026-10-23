# Agent ID: the Momentum Ladder

The core behind every Agent ID page, ad and email: market → audiences →
products → offer → angles, then the brand and the pages built on it. It
follows the Momentum Ladder formulas from Deus (`shared/formulas.ts`,
`templates.ts` and `library.ts` in the website-design repository), applied
here and kept in this repository. Nothing is saved in Deus.

**How to read it.** Every claim is marked:

- **Fact:** public and checkable, with the source.
- **Product truth:** what Agent ID does today, in this repository.
- **Hypothesis:** our best guess. No customer has said or done it yet.

There are no customer interviews yet, so every persona, quote and score below
is a hypothesis. The first job of the iterations is to replace them with
evidence (see [What to learn first](#what-to-learn-first)).

## 1. Market

**Start local, then English-speaking developers everywhere.**

- Language: English for the product and the site. Swedish later, for Swedish
  businesses (the company is Swedish; Bridge, Stripe and the KYB flow work
  there).
- Money: prices in USD, amounts in credits (never dollars for credits).
  Wallets in USD and EUR. SEPA through Bridge.
- Rules that matter:
  - **Fact:** the EU AI Act, Article 50(2), requires providers of generative
    AI systems to mark outputs in a machine-readable way so that they can be
    detected as AI-made, from 2 August 2026. Reports say systems already on
    the market before that date get until 2 December 2026, pending formal
    adoption ([BSI](https://www.bsigroup.com/en-GB/insights-and-media/media-centre/press-releases/2026/august/eu-ai-act-article-50-transparency-obligations/),
    [CASRAI](https://casrai.org/wp/tag/article-50-ai-act/)). Check the
    Official Journal before quoting a date.
  - **Fact:** California's AI Transparency Act (SB 942, amended by AB 853)
    asks large generative AI providers (over 1 million monthly users) for a
    hidden "latent disclosure" in their outputs and a free tool to detect it.
    Sources disagree on whether it took effect on 1 January or 2 August 2026
    ([Orrick](https://orrick.com/Insights/2025/01/Navigating-the-California-AI-Transparency-Act-New-Contract-Requirements),
    [CASRAI](https://www.casrai.org/news/california-sb-942-ai-transparency-act-effective-august-2026)).
  - **Product truth:** KYC/KYB, wallets and cards need the providers'
    countries (Bridge, Stripe, Privy). Mail and computers work everywhere.

**Decide:** the site is English and global. The first market to prove is
developers and small software companies in Europe and the US. Market
sophistication is set per audience below.

## 2. Audiences

### Problem → Solution Map

Agent ID gives every AI agent an identity that leads back to a responsible
person or business. That one fact solves five different problems, each for a
different person:

| # | Problem | Solution | Persona |
| --- | --- | --- | --- |
| 1 | Agents push code with a human's keys; nobody can tell which commit came from which agent, or stop a stranger's agent. | Only commits signed by your organization's verified agents pass. Revoke one and its key fails at once. | Maya, platform lead |
| 2 | Nobody can tell whether a picture, a voice or a text was made by AI, and AI work gets passed off as human. | Every output made through Agent ID carries a hidden mark that leads back to the agent and its owner. Anyone can check it. | Sofia, trust and safety at a marketplace |
| 3 | An agent goes rogue (spends, deletes, spams) and nobody knows whose it is or where it ran. | Every agent traces to a verified person or business. Every action is logged with the app, the model, the computer and the network. One click stops it. | Erik, IT lead |
| 4 | An API or MCP server gets anonymous agent traffic and can't tell which agents act for a real, verified customer. | One middleware line lets in only agents with a passport from a verified person or business, checked online. | Priya, CTO of an API company |
| 5 | Switching between Claude Code and Codex means setting up keys, sign-ins and tools again. | One Agent ID in both: the same email, wallet, computer and encrypted vault, and its tools come along. | Leo, a developer who switches |

### The personas

All five are illustrative (first name and role). Their words are
hypotheses, written from the public evidence noted under each.

**1. Maya, platform lead at a 40-person software company.**
Three teams run Claude Code and Codex with write access to the monorepo. The
agents commit with the developers' own Git identities and tokens.
- Situation: a Monday review. A commit at 03:12 changed the CI config. Whose
  agent was it, and was it even ours?
- Dream: let agents ship code without giving every agent a human's keys.
- Failed solutions: branch protection (doesn't know agents), bot accounts
  (shared, nobody owns them), secret scanners (find the leak after it
  happened).
- Public evidence: **Fact:** in August 2025 the "s1ngularity" attack shipped
  a trojanized Nx package that used locally installed Claude, Gemini and Q
  CLIs to look for secrets; GitGuardian counted 2,349 leaked credentials from
  1,079 developer systems
  ([GitGuardian](https://blog.gitguardian.com/the-nx-s1ngularity-attack-inside-the-credential-leak/),
  [Okta](https://www.okta.com/en-se/blog/threat-intelligence/the-s1ngularity-attack--when-attackers-prompt-your-ai-agents-to/)).

**2. Sofia, trust and safety lead at a marketplace for design and voice work.**
Sellers promise hand-made logos and human voice-overs. Buyers complain that
they got AI work, and sellers say they didn't.
- Situation: a dispute ticket with a logo and an MP3: "this is AI, I paid for
  a human".
- Dream: answer a dispute in a minute with proof, not a guess.
- Failed solutions: AI detectors that guess and flag real people;
  self-declared labels that sellers skip.
- Public evidence: **Fact:** EU and California rules now ask AI providers to
  mark outputs and offer a detection tool (see Market). **Fact:** Google's
  SynthID marks the output of Google's own models only.
- Honest limit: a mark proves that something was made through Agent ID (or
  a provider that marks through it). Finding no mark proves nothing.

**3. Erik, IT lead at a 200-person company.**
Staff run agents with company email, money and computers. One agent sent
3,000 emails to customers overnight.
- Situation: 07:40, the CEO asks "whose agent was that, and where did it
  run?" and the logs say "API key".
- Dream: know who is responsible for any agent, in one minute, and stop it.
- Failed solutions: shared service accounts, API keys without an owner,
  asking around.
- Public evidence: **Fact:** in July 2025 a Replit agent deleted a database
  during Jason Lemkin's experiment, despite being told not to change anything
  without approval ([eWeek](https://www.eweek.com/news/replit-ai-coding-assistant-failure/),
  [AI Incident Database](https://incidentdatabase.ai/reports/5593/)).

**4. Priya, CTO of a booking API with an MCP server.**
Half her API traffic is now agents. Some act for paying customers, some
scrape, some abuse free trials.
- Situation: a spike of sign-ups from agents, all with throwaway emails.
- Dream: say yes to agents that act for a real, verified customer, and no to
  the rest, without building identity herself.
- Failed solutions: API keys (shared and leaked), CAPTCHAs (block good
  agents too), IP lists.
- Public evidence: **Fact:** Cloudflare's signed agents and Web Bot Auth (an
  IETF draft on HTTP Message Signatures) identify the operator of an agent,
  not the person it acts for
  ([Cloudflare docs](https://developers.cloudflare.com/bots/concepts/bot/signed-agents)).

**5. Leo, a developer who switches between Claude Code and Codex.**
He moves when one runs out of limits or does a task better.
- Situation: halfway through a task he switches to Codex, and its agent has
  none of the keys, sign-ins or tools the other one had.
- Dream: one agent identity that works the same in every app.
- Failed solutions: copying `.env` files and MCP configs by hand; pasting
  keys into chats.

### Audience Scorecard

Scored 1–5 on the Audience Formula (sacrifice: 5 = little sacrifice;
symptom and failed solutions: 5 = strong). All scores are hypotheses.

| | Maya (code) | Sofia (AI or real) | Erik (rogue) | Priya (API) | Leo (switching) |
| --- | --- | --- | --- | --- | --- |
| Disposable income | 4 | 3 | 4 | 5 | 2 |
| Size and growth | 4 | 4 | 3 | 4 | 5 |
| Magnitude of the dream | 4 | 3 | 4 | 4 | 3 |
| Likelihood | 4 | 2 | 4 | 4 | 4 |
| Sacrifice (low is good) | 4 | 3 | 3 | 4 | 5 |
| Symptom | 4 | 4 | 5 | 4 | 3 |
| Failed solutions | 4 | 5 | 4 | 4 | 3 |
| **Total (of 35)** | **28** | **24** | **27** | **29** | **25** |

**Decide:**
- **Lead with Priya (APIs and MCP) and Maya (code).** Highest scores, they pay,
  and the product already does what they need.
- **Erik (rogue agents) is the owner-side twin** of the same promise: the
  page for him sells the account, not a service.
- **Leo (switching) is the widest door in:** free, low sacrifice, many people.
  He becomes Maya or Erik later.
- **Sofia (AI or real) is the weakest buyer but the best word of mouth:** the
  checker is free, public and shareable. Her likelihood is low today because
  only content made through Agent ID carries a mark; it rises with every
  provider that marks through it.

### Market sophistication

| Audience | Level | What it needs to hear | Lead with |
| --- | --- | --- | --- |
| Maya | 3, crowded | Secret scanners, branch protection and bot accounts exist; she doubts big promises. | The mechanism: Git checks every commit against your organization's verified agents. |
| Sofia | 3, crowded | She has seen AI detectors fail. | The mechanism: a mark put in when it's made, checked with a key, not a guess afterwards. |
| Erik | 1, new | Nobody offers "who is behind this agent" for his own staff's agents. | The claim: every agent has a responsible person, and you can see it. |
| Priya | 2, growing | API keys, OAuth for MCP and signed agents are known. | A bigger, specific claim: one line, verified owners only, revoked agents fail the next second. |
| Leo | 2, growing | Config sync and dotfiles exist. | A specific claim: the same ID, email, wallet, computer and vault in Claude and Codex. |

## 3. Product

### What it is (product truth)

Agent ID gives each AI agent, of any kind, an identity tied to a person or a
business who answers for it, and the things an agent needs to act on its own:
an email inbox, a phone number, a wallet, a virtual card (coming), a computer
with an encrypted vault. It works through the website, the CLI, the API and
the MCP server, in Claude Code, Codex, Cursor and any app.

**Any kind of AI.** An Agent ID can stand for a coding or chat agent, an
image, voice, video, code or text model, a decision model (scoring,
approving, ranking) or anything else. Each ID records its kind and the
provider and model behind it. The model per action is what the agent
reports; it can't be proven.

**What it proves:**

| Piece | Product truth | Where |
| --- | --- | --- |
| Identity | `agt_…`, owner, verification level (KYC/KYB), organization. | `agent_id_agents`, `verification.ts` |
| Passports | ES256 JWT for one audience, 5 minutes; checked offline (JWKS) or online (`/v1/verify`, catches a revoke a second ago). | `passport.ts`, `agent-id/sdk` |
| Git signers | Commits pass only when signed by the organization's verified agents. | `/v1/orgs/:id/allowed-signers`, `agent-id/action` |
| Safety | Limits, approvals, ask-first, pause and revoke. | `ask.ts`, `owner.ts` |
| Activity | Every action with app, model, computer and network. | `agent_id_audit` |
| Trace | A hidden mark in images, audio and text, a fingerprint of text and code, a signed record, a public checker. | `trace/`, `/agent-id/check` |
| One ID, many apps | `attach` wires the same ID into Claude Code, Codex, Cursor and more. | `agent-id/cli` |
| Vault | Keys and sign-ins sealed to the agent's own computer. | `vault.ts`, `vault/` |

### NUEEPH (1–5)

| Pillar | Score | Why |
| --- | --- | --- |
| New | 4 | Identity, money, mail, computer and provenance for agents, in one ID. Parts exist elsewhere (Entra Agent ID, Okta, Cloudflare signed agents, SynthID); the combination doesn't. |
| Unique | 3 | The owner-traceable passport plus marks that lead back to it is ours. Each piece alone can be copied. |
| Exciting | 3 | Control and safety, not desire. Strongest for Erik and Maya after an incident. |
| Easy | 4 | One command (`npx @timewarp/agent-id attach`), one middleware line, one GitHub Action. |
| Predictable | 4 | If the passport fails, the agent is kept out. If the commit isn't signed by your agents, it fails. |
| Huge | 3 | For a service: a new rule ("verified agents only"). For one developer: a convenience. |

**Total 21 of 30, four pillars at 4.** Worth selling. Low on exciting: lead
with the moment of the problem (the 03:12 commit, the 3,000 emails), not
with features.

### Feature → Benefit → Destination

| Audience | Feature | Benefit | Destination |
| --- | --- | --- | --- |
| Maya | Commits signed with the agent's own key, checked against your organization's verified agents. | A stranger's agent, or one you revoked, can't land a commit. | Agents ship code, and you still own the repository. |
| Sofia | A hidden mark in every image, voice and text made through Agent ID, and a public checker. | A dispute is answered with proof: which agent made it, for whom, when. | Real work gets trusted again. |
| Erik | Every agent tied to a verified person or business; every action logged with app, model, computer and network. | "Whose agent was that?" takes a minute, and one click stops it. | You can say yes to agents at work. |
| Priya | `agentIdMiddleware({ require: 'verified' })` for an API or an MCP server. | Only agents acting for a verified person or business get in. | Agents become customers, not a threat. |
| Leo | One Agent ID in Claude Code and Codex, with its own computer, encrypted vault and tools. | Switch apps mid-task and your agent still has everything. | Use whichever AI is best today. |

## 4. Offer

**Goal: win new customers.** Lower the first step.

- **Free, no card:** an Agent ID, email, wallet, passports, Git signing,
  marks and checks, and 5 hours of computer time.
- **Paid in Timewarp credits:** more computer time, and phone numbers (when
  they open). Shown in credits, never in dollars.
- **Virtual cards:** free, coming.
- **No subscription.** Wallet top-ups and bank withdrawals carry the payment
  provider's fee.
- **Safe to try:** you set the limits; payments above them wait for you;
  pause or revoke any agent in one click.

Qualify: every term is true today (see `pricing.ts` and `/agent-id/pricing`).
The same terms appear on every page, in the claim flow and in the app.

## 5. Brand DNA

**Audience first.** Developers and the people responsible for them: platform
leads, CTOs, IT leads, trust and safety.

**Trust they already have.** Stripe (exact docs, calm), GitHub (the
commit/check vocabulary), 1Password (safety without fear), Cloudflare (a
switch that just works). Borrow: plain words, real code on the page, the
product itself as the picture.

**The rulebook.**

- **Voice:** calm, exact, short. Grade 5–8. Most sentences under 15 words.
  Subheads state facts. Say what happens, not what it "enables".
- **Look:** the identity card (gradient band `#A855F7 → #EC4899`, the agent's
  mascot, its ID, owner, the machine-readable line). Ink
  `--aid-ink` for the one action. Cards (`aid-card`), mono for IDs and code.
  Light and dark.
- **One primary action per view:** "Get started for free" (signed in: "Open
  Agent ID"). The checker's own action is "Check".
- **Show the product, never feature cards.** Each angle shows the screen,
  the code or the result that does it.
- **Words we never use:** discover, revolutionary, secret, transform,
  breakthrough, unlock, seamless, leverage, AI-powered, military-grade,
  unhackable, undetectable, 100% secure.
- **Claims we never make:**
  - that the checker detects all AI content, or that no mark means human-made;
  - that a mark can't be removed (a picture's mark survives JPEG, resizing
    and blur but not cropping or turning; a sound's needs about 10 seconds
    and doesn't survive speed changes; text marks are the easiest to strip);
  - that the model behind an action is proven (the agent reports it);
  - that Agent ID makes a codebase or an API "secure" on its own.
- **Never in dollars:** credits.

## 6. Angles

One reason, one sentence each, with its awareness stage, the heritage level
its stage calls for, and the NUEEPH filter (0–2 per pillar).

### A1. Only verified agents touch your code (Maya)

- **Sentence:** Platform leads whose agents commit with developers' keys
  think the risk is a leaked token. The real cause is that Git can't tell an
  agent from a person, or your agent from a stranger's. Agent ID signs every
  agent commit with the agent's own key and lets the GitHub Action pass only
  your organization's verified agents, so a stranger's or revoked agent
  can't land code, shown by `git verify-commit` against the allowed-signers
  list.
- Type: Mechanism. Stage: **problem aware** → heritage level 4 (why it
  matters to them: you own the repository).
- Biggest reason not to buy: "another thing in CI". Answer: one Action, no
  account, no secret.
- NUEEPH: New 2, Unique 1, Exciting 1, Easy 2, Predictable 2, Huge 1 =
  **9, make it.** Lead pillars: Easy, Predictable.

### A2. AI or real? Check it (Sofia)

- **Sentence:** People who must tell AI work from human work think they need
  a better detector. The real cause is that detectors guess after the fact.
  Agent ID puts a hidden mark in every image, voice and text when it's made
  and keeps a signed record, so a check returns the agent and its owner,
  shown by the checker.
- Type: Mistake. Stage: **solution aware** → level 3 (why they want proof:
  to decide fairly).
- Biggest reason not to believe: "it only works on your content". True; say
  it, and show it working.
- NUEEPH: New 2, Unique 1, Exciting 2, Easy 2, Predictable 1, Huge 1 =
  **9, make it.** Lead pillars: New, Exciting.

### A3. When an agent goes rogue, know whose it is (Erik)

- **Sentence:** IT leads whose staff run agents think a log of API calls is
  enough. The real cause is that an API key has no owner. Every Agent ID
  traces to a verified person or business, and every action is logged with
  the app, the model, the computer and the network, so "whose agent was
  that?" takes a minute and one click stops it, shown by the activity log.
- Type: Pain. Stage: **unaware** → level 5 (who they are: the person who can
  say yes to agents at work).
- NUEEPH: New 2, Unique 1, Exciting 1, Easy 2, Predictable 2, Huge 1 =
  **9, make it.** Lead pillars: Easy, Predictable. (At unaware the default
  lead is Exciting + Easy: the incident story carries the excitement.)

### A4. Let only verified agents use your API and MCP (Priya)

- **Sentence:** API teams flooded with agent traffic think they need better
  bot blocking. The real cause is that they can't see who an agent acts for.
  `agentIdMiddleware` checks the agent's passport, online if you want, and
  lets in only agents acting for a verified person or business, so agents
  become customers, shown by one line of code.
- Type: Comparison. Stage: **product aware** → level 2 (how: one line).
- NUEEPH: New 1, Unique 2, Exciting 1, Easy 2, Predictable 2, Huge 1 =
  **9, make it.** Lead pillars: Unique, Predictable.

### A5. One ID in Claude and Codex (Leo)

- **Sentence:** Developers who switch between Claude Code and Codex think
  each app needs its own setup. Agent ID gives one agent the same ID, email,
  wallet, computer and encrypted vault in both, and brings its tools along,
  so switching mid-task loses nothing, shown by `attach`.
- Type: Desire. Stage: **solution aware** → level 3.
- NUEEPH: New 1, Unique 1, Exciting 1, Easy 2, Predictable 2, Huge 1 =
  **8, make it.** Lead pillars: Easy, Predictable.

Every angle answers to the same core sentence: **every AI agent gets an
identity that leads back to the person or business who answers for it.**

## 7. Pages

| Page | Type (library) | Audience and stage | Promise kept |
| --- | --- | --- | --- |
| `/agent-id` | Homepage | Everyone, warm | Identity for every AI agent; the five needs, each to its own page. |
| `/agent-id/for/code` | Mini sales letter | Maya, problem aware | A1 |
| `/agent-id/check` | The tool, then the case | Sofia, solution aware | A2: the answer first (the checker). |
| `/agent-id/for/accountability` | Mini sales letter | Erik, unaware | A3 |
| `/agent-id/for/apis` | Comparison | Priya, product aware | A4 |
| `/agent-id/for/claude-and-codex` | Mini sales letter | Leo, solution aware | A5 |

**Homepage (library: homepage).** Hero: who it's for and the destination in
one line, the ID card, "Get started for free". The scenario, in their words.
The range by need: five rows, each to its page. The mechanism (the ID, the
passport, the mark). Proof: what works today, as the product itself. The
offer, then the closing action.

**Mini sales letter (library: mini-sales-letter).** Hook in the page's own
words; the problem and what it costs; the real cause and why the usual fixes
fail; the mechanism; proof (the product doing it); the offer and the action;
objections answered; the action again.

**Comparison (library: comparison).** The comparison in the headline; the
criteria buyers care about; side by side, each with proof; who each option
fits; the offer and the action.

Copy rules on every page: opening sentence of 6–12 words; grade 5–8; bold
the pitch; subheads state facts; no filler words; never fabricate;
illustrative people are named as illustrative.

## What to learn first

1. **Interviews, five per persona:** collect their words (10–20 quotes each)
   and replace the hypotheses above.
2. **Which page converts:** each angle page's visits → claims → first
   passport, first signed commit, first mark.
3. **Which reason brings the best accounts:** paid credits and active agents
   after 30 days, per angle.
4. **The checker:** checks per day, share of checks that find a mark, and
   how many checkers become owners.
