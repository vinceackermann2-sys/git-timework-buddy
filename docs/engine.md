# Timewarp desktop engine

The Timewarp desktop app is rebuilt as Timewarp-owned source, replacing the
compiled Energy 0.8.20 runtime that `timewarp-runtime` patches. The engine is
written from Timewarp's own feature specification. It does not contain,
decompile or translate Energy code. Status as of 10 October 2026: feature
complete for everything below except the items marked otherwise, compared
with the previous app's code and screens area by area, and verified in
preview builds. A live check with a real account is still needed before
shipping (see [Before shipping](#before-shipping)).

## Architecture

| Layer | Source |
| --- | --- |
| Desktop shell | Electron 43 (official) with Timewarp's own main, preload and React renderer in `timewarp/app` |
| Agent harness | OpenAI Codex app server (official `@openai/codex` 0.160.1, Apache-2.0) over its documented JSON-RPC protocol |
| Built-in browser and agent browser tools | Electron `WebContentsView` and its in-process debugger (`app/main/browser.cjs`, `browser-tools.cjs`) |
| Timewarp's agent tools (browser, vault, automations, chats) | MCP servers on the local bridge (`app/main/tool-server.cjs`), so every agent thread, workers included, has them; Codex settings in `app/main/codex-config.cjs` |
| File previews | pdf.js, ExcelJS, JSZip, highlight.js, markdown-it, loaded on demand |
| Display font | Quadrant Text (Matter of Sorts), the same file the previous app and the website use, from `store-assets/fonts` |
| Local data | Built-in SQLite (`node:sqlite`) in the existing profile |
| Account, billing, organizations, onboarding screens, connectors, chat sync | Timewarp modules in `timewarp/desktop` and `timewarp/shared` |
| Cloud | Unchanged Supabase functions in `timewarp/supabase` |

The engine keeps the existing profile (`%APPDATA%\Timewarp Energy`,
`~/Library/Application Support/Timewarp Energy`). Users stay signed in and keep
their Codex connection, onboarding state, browser sign-ins (the previous app's
browser profiles are imported once and keep their storage) and Codex thread
history (`runtime/codex`). On first start it imports agents, chats, messages,
automations and settings from the previous local database once, without
modifying it.

```
timewarp/app/
  main/       Electron main process (CommonJS)
  preload/    contextBridge API for the renderer
  renderer/   React interface, bundled with esbuild
```

## Development

From `timewarp`:

    npm run engine:dev               # build and open (separate "Timewarp Dev" profile)
    npm run engine:preview           # signed-in sample account, scripted model, real Codex
    npm run engine:e2e               # end-to-end harness check in a preview build (21 scenarios)
    npm run test:engine              # engine tests, including a real Codex conversation
    npm run engine:audit             # build and check the engine contains nothing from Energy
    npm run engine:package:draft     # unsigned Windows installer (build/engine-installer-draft)
    npm run engine:package           # signed Windows release (release.json and signing needed)
    npm run engine:package:store     # unsigned Microsoft Store MSIX (build/engine-store)
    npm run engine:package:mac:draft # macOS DMGs, on a Mac (or the engine-mac workflow)
    npm run engine:smoke -- <app>    # smoke test a packaged app (Windows or macOS)
    npm run engine:bench             # speed comparison with the previous app (Windows)
    npm run engine:eval -- --launch build/engine-<name>/app --disposable  # live model tasks (see Live model evaluation)

Preview mode is compiled only into `--fixture` development builds and is
refused for release builds. The local model bridge uses port 7788, or a free
port when another app (such as the previous Timewarp app) already uses it. `TIMEWARP_TRACE_STARTUP=1` prints start-up timings.

The app log is `runtime/logs/main.log` in the profile, as in the previous app
(one older file, `main.1.log`, is kept): start-up timing, window and renderer
errors, browser page failures, Codex status and stderr, content-free turn
records (status and duration), connector sign-ins, updates and shutdown. It
never contains chat or page content, files, account details or vault values.
Every line is cleaned where it is written, including Codex's own output:
web addresses are cut to their origin, and bearer tokens, JWTs, API keys and
key=value secrets are removed (`log.cjs`).
Settings → General → Diagnostics opens the folder.

## Independence from Energy

`scripts/audit-engine.cjs` runs on every engine package build and in CI. It
checks every source file that goes into the bundles (only `app/`, Timewarp's
`desktop/` and `shared/` modules, `config.json`, assets and open-source npm
packages; none of the old pipeline's patches) and scans the built app for
Energy's services and identifiers. The only remaining names are production
names kept by decision: the `timewarp-energy` cloud function route, the
`energy-desktop` sign-in target and the `Timewarp Energy` profile folder.
The previous app's bundled Energy builds (its custom Codex 0.0.0, `energy-git`,
agent-browser) are not used; the engine runs the official Codex release.

## Comparison with the previous app

Each capability of the previous app (from its API surface) and where it is in
the engine. "Same" means the same behaviour, rebuilt; differences are noted.

| Area | Previous app | Engine |
| --- | --- | --- |
| Sign-in, sign-up, email code, password reset, Google | Timewarp screens | Same screens (`auth-ui.js`); sign-in methods remembered so the screen shows sooner |
| Organizations (create, join, switch, invite, picture) | Timewarp gate and settings | Same gate; settings page rebuilt (members by email with all their roles, shown at once on later visits, the member count, invitations in their own "Invited users" table). The account menu lists the other organizations to switch to; invitations take several addresses at once; the create dialog has the previous wording |
| Onboarding (agent name, your name, knowledge, theme, plan) | Timewarp screens | Same screens; knowledge import rebuilt; "Run setup again" in Settings → General (the previous app had it behind a flag only) |
| Billing, plans, credits, ChatGPT / Codex connection and usage | Timewarp billing screen | Same screen |
| Agents (create, mascot or picture, rename, instructions, star, reorder, archive) | Energy UI | Same; a new agent opens its first chat and introduces itself; Edit opens the agent page in the side pane (instructions editable there, workflows, recent files); avatars are mascots, as the previous app's "generate avatar" was |
| Chats (new, list, search, rename, archive, read state, notifications) | Energy UI | Same: search (Ctrl/⌘+K) matches titles and message text from three characters, shows the matching words and opens the chat at that message; a spinner replaces the time while an agent works; the activity feed groups unread and working chats under Priority, then Today, Yesterday, weekdays and older, and the bell shows a dot for unread chats; Show more adds five chats; Mark as read or unread, the Rename dialog and the automation marker on chat rows; Home lists upcoming automations and the previous setup suggestions |
| Chat (streaming, reasoning, plans, commands, file changes, tools, web search, images, sub-agents) | Energy harness on Energy's Codex build | Same on the official Codex |
| Activity while the agent works | No tool log in the chat: a working line with the agent's latest note, "Using browser" and "Waiting for …"; it opens the agent's thread sheet with its steps as one-line rows; "Working for 12s"; Paused / Continue; friendly errors with Try again, Reconnect ChatGPT or Add credits; generated images below the reply | Same (`AgentThread.jsx`, `turns.mjs`); interim notes aren't kept as chat messages. Not carried over: "Assistant instructions updated" and "Responded in …" events, and suggested replies |
| Cards in agent messages (connect an app or MCP server, file, choices, buttons, email and chat drafts with Send, tabs, secure secret input, sources, links to files, tabs and workers) | Energy widgets | Rebuilt (`cards.mjs`, `widgets.jsx`), described to agents in `widget-instructions.cjs`; code blocks and tables have Copy. A draft's Send posts the edited draft as the user's go-ahead; secrets are saved in the vault. Files open in a preview dialog rather than the side pane |
| Messages | Hover time, day and time separators, long messages folded with Show more, Not Delivered · Retry, reply to a message, send while the agent works; the user's own messages as Markdown; attachments that open; a draft kept per chat | Same: a message sent while the agent works joins the running reply (`turn/steer`), and one the agent didn't take before a Stop shows Not Delivered · Retry; Retry resends attached files too; clicking a reply's quote scrolls to the quoted message; the user's messages render as Markdown with reference chips; sent images show as thumbnails and files as chips that open a preview; each chat (and Home) keeps its unsent draft; Copy leaves out card markup; long chats show the latest 100 rows with Load older messages; Report (Ctrl/⌘+Alt+F) sends the chat, app version and platform and shows the feedback ID. Agent text keeps a safe subset of HTML (line breaks, details, kbd, sub/sup, images), footnotes and `data:` images, and model citation markers are removed |
| Composer | @ for people, skills and files, $ for skills; prompt history; large pastes as a clipboard chip | Same: @ offers the organization's members, skills and the agent's files, $ offers skills, with arrow keys, Enter or Tab and Escape; skills go to Codex as skill items and files and people as references; Up/Down for earlier prompts; a paste over 10 lines becomes a "Clipboard (N lines)" chip; the previous labels ("Add photos & files", "Send message", "Stop response", "Dictate") |
| Agent working rules (base prompt, task execution contract, delegation, Windows shell) | The previous app's system prompt plus Timewarp's harness instructions and patches | A Timewarp base prompt (`base-instructions.cjs`, in Timewarp's own words, with Codex's open-source guidance on commands, files and plans adapted under Apache-2.0) replaces Codex's own on every thread and worker, whatever the funding source. It carries the previous app's rules: short colleague-like replies without em dashes, a ⚠️ line when the result differs from what the user expected, a user's request authorizes the action including sending or submitting (purchases always need a go-ahead), no citation markers, Google links through the account chooser, writing to others in the user's style, signing in to sites the task needs without asking, connected apps before the browser and no browser fallback for an account that needs reconnecting, bounded automations that stay quiet when nothing changed, and an introduction in a new chat. Each message carries its send time, the user's account and connected accounts (marking those that need reconnecting) and the memory as turn context. On Windows files are written with PowerShell rather than apply_patch, which stalls in Codex's Windows sandbox there; on macOS a protected-data rule applies and commands get the login shell's PATH. The previous app's worker guidance replaces Codex's default "only delegate on request" hint; up to 4 agents at once; workers run on the chat's model and don't start workers of their own. Chat titles come from the first message, then a short title from the small model after the first reply, as before |
| Workers' tools | Browser workers drove the browser through a shell command; workers had the connected apps | Workers have the same tools as the chat's agent: the browser, the vault, automations, chat search, connected apps and MCP servers; a worker's browser actions happen in the chat's browser, each worker in its own background tab so workers running at once don't navigate each other's pages (`workerTools` end-to-end check) |
| Agent settings (permissions, reasoning) | Workspace permission profile with network access; detailed reasoning summaries, concise replies; skills described to the agent | Same, through a `timewarp` permission profile that extends Codex's `:workspace` (this Codex treats the older `workspace-write` setting as read-only). On Windows, commands run without an approval review once the command sandbox is set up |
| ChatGPT apps, Codex plugin suggestions, remote plugins, goals, Codex's own browser and computer use | Off | Off: agents use Timewarp's tools and the user's connected apps |
| Run limits (200 tool calls, 20 minutes, stop after 3 identical failures or on the first error when asked; Stop ends workers too) | Timewarp execution guard | Same guard, counting the official app server's tool items |
| Approvals for extra access (commands outside the workspace, network, MCP tools) | Automatic review by a reviewer agent; a denial stops the run | Same (Codex's automatic reviewer); a denied review shows in the chat, all reviews in the agent's thread sheet |
| Task panel (stop reason, tool, error and token counts, workers you can follow) | Timewarp task activity | Rebuilt above the composer with the same wording ("Subagents (N)", "Needs input"); a worker's sheet opens from it (Codex doesn't record the task a worker was given, so the sheet starts at its steps) |
| Approvals, stop, retry a failed message, per-chat model | Energy UI | Same; Stop also works while a reply is still starting. Workers' approval and input requests reach their chat |
| Model picker (model, thinking slider, speed, per-chat model) | Timewarp's picker | Same (`ModelPicker.jsx`, ported from Timewarp's own picker): Speed (Standard / Fast) when the model offers it, sent with each message; the bolt turns Fast on and off for models that offer it (a connected ChatGPT plan's models) and the trigger shows "Fast"; new chats keep the default they started with; a ChatGPT catalog that can't be read shows Retry and keeps the saved choice |
| Warm chat session on open | Energy | Same |
| Attachments | Files, drag and drop, paste | Same: images to the model, other files copied into the agent's workspace; files can be dropped on the chat or Home and pasted into the composer (up to 10, 100 MB each) |
| Dictation | Cloud transcription; Retry after a failure; Transcribe and send; level meter | Same service and controls: a failed transcription keeps the recording for Retry |
| Chat history sync, restore, Privacy Mode | Timewarp sync | Same format and service |
| Built-in browser (tabs, profiles, recent sites, downloads) | Energy browser | Rebuilt on `WebContentsView` with the same tab strip and toolbar; searches go to Google and pages see a Chrome user agent. Settings → Browser and setup list the Chrome, Edge, Brave and Vivaldi profiles on the computer to import; profiles are renamed and removed in Settings → Browser and chosen from the chat's profile button, which reopens the chat's pages in that profile. Agents link the tabs they open (`timewarp://conversation/…/browser/…`); the link opens the tab in the pane. The previous app's browser profiles are imported once and keep their storage, so sites stay signed in, and its open tabs come back once with their pins and back/forward pages. Pop-ups (such as "Sign in with Google" and PayPal) open as tabs that keep their link to the page that opened them; Google's sign-in page gets the app's own user agent, as before. A page's alert, confirm and prompt never block: in the user's tab on screen they show as a dialog, beforeunload asks "Leave site?", and in a hidden tab they're dismissed as Chrome does. Right-click offers spelling suggestions, open or copy a link, copy an image, cut, copy, paste, select all, back, forward, reload and "Open page in default browser". Camera and microphone are asked per site in the user's own tab (an Allow is remembered per profile); pages can't show notifications, read the clipboard or use the location. Tabs can be pinned from the tab's menu. Background tabs sleep after 16 open pages, but never while on screen, pinned, loading, playing media, edited, showing a dialog, downloading, a pop-up or its opener, or used by an agent, and they wake with their back/forward history. The home button opens a separate home tab instead of replacing the page. Removing a profile deletes its storage folder |
| Agent browser control, agent cursor, take over / hand back | agent-browser and Timewarp cursor | Rebuilt as in-process tools (open, snapshot with link addresses and focus, click including double click and checkboxes, type into a field or the focused element, press keys and combinations such as Control+A or Shift+Tab, scroll, read a page, an element's attribute or another address without leaving the tab, screenshot, tabs, back, forward, wait for text, an address or a load, close, choose from dropdowns, hover, upload from the workspace, answer a page's dialog); a page dialog never stalls an agent: an alert is reported, a confirm or prompt waits for the agent's answer up to 60 s; key presses reach background and worker tabs too (they're laid out off screen, with in-page fallbacks when the window is minimized); cursor in the page; take over supported; works with the pane closed (and on macOS with the window closed). Snapshots and actions reach into frames, including other sites' frames such as hosted card forms. Files an agent downloads go to `downloads` in its workspace without a Save dialog, and the next tool result names them |
| Files view and previews (PDF, Excel, CSV, Word, images, code, markdown) | Energy UI | Rebuilt as a tree that remembers open folders, with Search files and closable file tabs, remembered per chat; refreshes as the agent works. Programs and scripts an agent wrote don't open from Files (Show in folder instead), as with chat cards |
| Vault (sign-ins, cards, secrets, agent access, fill without revealing values) | Energy vault | Rebuilt; the previous vault's sign-ins, cards and secrets import once after sign-in, the newest copy of a duplicate winning, with every agent's access unless the previous app had it turned off (items the key store can't open are retried at later starts, up to five times; cards that fail the checksum are kept); each item is sealed together with its kind, site and username, so an edited database row fails its integrity check instead of filling elsewhere; notes, cardholder and expiry are encrypted, only the label, site, username and a card's brand and last four digits are readable; a sign-in fills on the same protocol, port and host (ignoring "www."), as before; cards and secrets need permission each time; passwords fill only into password fields, never into new-password fields; a card fill checks each field (choosing list options, two- or four-digit years) and reports any it couldn't fill; values filled from the vault are hidden from every browser tool result, including page addresses, and a page showing a filled value, whether in its field, copied elsewhere on the page or shown again after a reload, isn't captured by screenshots; sign-ins for plain-http sites (routers, NAS, intranet) are kept and fill only on the same protocol; address-bar fill; password import from browser CSV exports; card security codes are never stored, as before |
| Passkeys | Energy (macOS 13.3+) | Not carried over |
| Memory (notes, daily logs, background memory writer, imports from ChatGPT / Codex, Claude, Cursor; Enabled, Read only, Write only or None) | Energy memory, kept in a Git store per user (`runtime/personal-memory`) | Rebuilt on `memories/user.md`, `memories/daily-logs` and `memories/imports`. The previous app's memory store is read once per user without Git (`legacy-memory.cjs`, never modified): its notes replace placeholder notes, other files go to `imports/timewarp-previous`. Each turn carries the full notes, today's log and the last seven days' summaries. A background writer (`memory-writer.cjs`) updates the notes and the daily log after a chat has been idle four minutes, one job at a time on the funding source's small model; it is skipped in Privacy Mode and when memory is read only or off, and refuses rewrites that would drop most of the notes. The memory folder (when it may be written) and the skills folder are writable for agents without a review. Imports find the same memory files, skills (including skills linked in by skill installers) and MCP servers (Codex `config.toml`, Claude Code including `~/.claude/.mcp.json`, Claude's desktop app, Cursor) on Windows and macOS; a Cursor project folder can be chosen |
| Skills (list, enable, import, view) | Codex skills | Same; previously connected skill folders stay available. The previous app's built-in browser, vault and memory-writer skills (for its browser command, vault and memory writer) are turned off once, since Timewarp's own tools replace them; they can be turned on again |
| Chat tools for agents (find chats, search messages, read a chat) | Built-in tools | Same, read-only, over the user's chats that aren't archived; a chat can be read around a message or a time |
| Reactions, thread replies, report-an-issue and open tools for agents | Built-in tools | Not carried over |
| Running a command with vault secrets (`vault run`), `energy://` links opened from outside the app, the previous app's bundled default skills | Energy | Not carried over: running commands from Timewarp itself would bypass Codex's sandbox and approval reviews, and output redaction can't be made reliable (needs its own design); the links and the default skills were Energy's own |
| Instructions for every agent | Energy | Same (Codex global `AGENTS.md`) |
| Automations (schedules with a time zone, count or end date; run now; history; retries) | Energy | Rebuilt. Previous automations keep their schedule (date and recurrence rules are mapped to once, hourly, daily, weekdays, weekly, monthly or interval in their time zone) and their on/off state when the mapping is exact; the rest (Slack event triggers, every other day and similar) come over paused with the closest schedule. A run that finds its chat busy waits for the reply to end ("queued"), and a run that can't start is retried every minute until the next one is due. The agent knows a run is scheduled and can mark it as having nothing to report: the chat then isn't marked unread and no notification shows. An automation an agent creates runs in the chat where the user asked; one made on the agent page has its own chat. Each automation opens from its agent's page in a dialog with Enabled, schedule, recent runs, Test run, Save and Delete, as before. Archiving a chat with an automation asks first and pauses the automation |
| Connected apps (Composio), per-agent access | Timewarp Composio | Same service and agent tools; the calling agent is worked out from its chat thread, so an agent can't use another agent's accounts; reconnecting an account keeps its agents' access; sign-in opens in an app window with the default browser profile, its title bar naming the site, as before; access UI rebuilt. Accounts that need signing in again show above the composer, and Skip removes the account, as before (the previous app also listed them a second time through the agent, without Skip; the engine lists each once) |
| MCP servers (URL with sign-in, or local command) | Energy | Rebuilt on the Codex config. Removing a server signs it out; a server whose sign-in expired shows Sign in again; servers the previous app added with names such as "GitHub" can be managed; imports keep a server's off switch, keep `${VAR}` placeholders as environment references and skip SSE-only servers; plain HTTP is allowed on the local network; a local command is confirmed in a system dialog showing the command before it runs |
| Codex's plugin catalog | Not offered (the previous app listed its own bundled catalog) | Not offered: Settings → Tools lists the user's connected apps and MCP servers |
| Windows command sandbox setup | Codex; set up automatically (unelevated) in onboarding | Not set up by the engine: `sandbox.status` and `sandbox.setup` exist but nothing in the interface calls them. Profiles from the previous app keep the setup they had; new users' commands are reviewed (see Open) |
| Suggested tasks | Energy, off for the reference account | Not carried over |
| Feedback, diagnostics | Timewarp reporting, Energy debug export | Same feedback (Ctrl/⌘+Alt+F); Settings → General → Diagnostics opens the log folder and exports a diagnostics file (no chats or account data) |
| Conversation trace (Activity) | Energy UI | Rebuilt: turns with input, cached and output tokens and timing, events with approximate tokens, workers nested under the step that started them, older turns and events loaded on request. Billed cost and cache writes aren't recorded locally, so they show as "—" |
| Browser profile import from Chrome/Edge | Energy | The same list, most recently used first, and Import button; importing makes a Timewarp profile with the profile's name and account (from the browser's profile list only). Sign-ins and cookies are not copied, since that would read other browsers' protected data: sites are signed in to once in Timewarp's browser, and saved passwords import from a CSV export in Vault |
| Updates | Timewarp feed (Windows); a notification, then a restart prompt | Same feed, checks and prompt; the prompt says when an agent is still working |
| Window and shortcuts | No title bar on Windows (window buttons over the app in its colours); the window follows the app's theme; zoom and full screen from the menu's shortcuts; Ctrl/⌘+W closes what's open in the app | Same; the window can be as small as 520 × 480 |
| Reply notifications | From the main process: the agent's name and the reply's text; open the chat; cleared once the chat is read; unread badge | Same (`notifications.cjs`), also when the window is closed on macOS |
| Quitting, damaged data | Waits for the runtime to stop | Same: quitting waits up to a few seconds for chat history to save and Codex to stop, then closes the database. A damaged local database is set aside (kept) and a new one started; chats come back through history sync and the previous app's data is imported again |

The interface has the previous app's layout and screens: the sidebar with
agent groups, activity feed, usage card and account menu; the home screen with
its composer, tools, agent and model pickers and suggestions; the chat with
Report, the Activity trace and thread actions; the side pane; the search
dialog and right-click menus on agents and chats; and Settings (General at
`#/customize/settings`, Tools, Browser, Vault, Memories, Skills, Organization,
Billing; like before there is no Automations page: an agent's automations are on
its page in the side pane, and the agent manages them). It is rebuilt in Timewarp's own React code from
screenshots and measurements of the running previous app, not copied from Energy's code. The
Timewarp-made screens (sign-in, organization, billing, onboarding) are the same
files. Settings → General has the previous app's rows plus Diagnostics and
"Run setup again"; reply notifications stay on. Confirmations (archive a chat,
remove, delete, disconnect) are in-app dialogs, as before; archiving an agent
doesn't ask, as before. Below 768 px wide the sidebar slides over the page, as
before, and the sidebar can be dragged between 220 and 360 px or collapsed.
The previous app's keyboard shortcuts work: Ctrl/⌘ K search, N or T new task,
B sidebar, J pane, L address bar, comma Settings, W close (a file, a tab, the
pane, then "Quit Timewarp?"), + - 0 zoom, F and G to find in a chat, Alt+F
feedback, [ and ] or Alt+arrows back and forward; F11 full screen; in the composer,
Ctrl+Space voice input, Escape to discard a recording, and Up/Down for earlier
prompts. Menus can be used with the arrow keys. Invitations to another organization are offered as "Join …?"
(checked every minute), and "Invite members" shows for owners and admins only.

### Verified how

- `npm run engine:e2e`: the real app and Codex with the preview account and a
  scripted model go through chat, commands with approval, decline and stop,
  browser use with the pane open and closed, vault fill, connected-app tools,
  an added MCP server, files, automations, workers, connector sign-in, the log
  file and diagnostics, automatic approval review allowing and denying, and
  asking the user, workers using the browser, vault and connected apps, and
  workspace and network access for commands, Stop pressed before a reply starts, a message sent while the agent works, and page dialogs, key combinations, checkboxes, double clicks, background reads and address waits with the pane hidden and on screen (23 scenarios, all passing).
- 497 tests (`npm test`), including the engine tests (`npm run test:engine`)
  and a real Codex conversation against a local model.
- On 10 October the previous app's code (its bundle and Timewarp's patches)
  was compared with the engine area by area: agent harness, chat view, app
  shell and screens, and main-process services. The differences found were
  fixed or are listed above as not carried over. Both apps then ran side by
  side on the same real account (home, chat, Settings, activity feed, agent
  page, zoom keys, window frame).
- The interface was measured side by side with the running previous app at the
  same window size (positions, sizes, fonts and colours of every visible text),
  and again on 9 October at window widths from 1200 to 2560 px for Settings, the
  chat column, messages and the composer, which follow the previous app's rules
  at every width; and 11 click-through flows (agents, browser profiles, skills, vault, archive,
  settings, model, pane, chat, navigation, links) pass on a real account.
- Every feature above was exercised end to end in preview builds: a signed-in
  sample account, the real Codex runtime and a scripted local model, with
  screenshots.
- The packaged Windows app starts, shows sign-in and runs its bundled Codex
  (`smoke-engine`). The Store MSIX builds with the existing Store identity.
- Verified with a real account against the production cloud: sign-in,
  organization, billing, ChatGPT connection and usage, connected apps, chat
  history sync. Model replies were verified with real models through the
  production cloud (see Live model evaluation); a connected ChatGPT plan's
  replies and a real Mac are not yet verified (the test account's ChatGPT plan
  was at its usage limit).

### Live model evaluation

`scripts/eval-engine.cjs` sends realistic tasks through the same calls the
interface makes and checks the result each produced (the page state, the file,
the memory, the automation), the reply, what the chat shows, speed and token
use. With `--disposable` it runs a preview build whose model requests go to the
production cloud for a throwaway account with a credit grant (the most the run
can spend), deleted afterwards; with `--port` it attaches to a running app.
Results on 9 October 2026 (Windows, low reasoning), in `reports/engine-eval`:

| | Luna | Sol (default for Timewarp credits) |
| --- | --- | --- |
| Passed | 14 of 15 after the fixes below (11 before); the miss is linking the tab | 9 of 11 (tab link, and the automation it asked to confirm, since fixed) |
| First words, replies without tools | 1.8–2.3 s | 1.5–2.9 s |
| One-line answer | 2 s, 1 request | 2.5 s, 1 request, about 1.5 credits |
| Browser task (open, read a code, type, click, read back) | 15–18 s, 6–7 requests | 37 s, 7 requests, about 10 credits |

Fixed after the evaluation: parallel browser workers shared one tab (one read
the other's page and the agent reported a wrong answer); apply_patch stalled
for 30 s or more per attempt in Codex's Windows sandbox, so writing one file
took 233 s and 16 requests (now 16 s and 5) and memory updates failed; a
connected ChatGPT plan at its limit showed "needs additional credits · View
plans" instead of the plan's reset time; Sol asked to confirm an automation the
user had asked for.

Open:

- Every request carries about 18,000 tokens of instructions and tool
  descriptions, and the cloud bills cached input at the full input price, so
  on Sol a one-line answer costs about 1.4 credits and a short browser task
  about 10.
- The cloud runs and bills Codex's approval reviews (`codex-auto-review`) as
  Sol whatever the chat's model, and reserves each call's worst case (the
  request's size as cache writes plus 16,384 output tokens: 11–16 credits on
  Sol). With less than that left a call fails with "Not enough unreserved AI
  credits", and a failed review stops the run.
- Without the Windows command sandbox set up (the default), every command
  waits for an approval review (one more request, 2–4 s). Codex's sandbox
  itself (restricted token) stalled on the reference PC, which runs Acronis
  Active Protection; check on another PC before setting it up for users.
- Agents rarely link the browser tabs they open, though told to.
- The Timewarp base prompt, turn context and background memory writer (10
  October) haven't been through the live model evaluation yet: run it on Luna
  and Sol before shipping. The base prompt adds about 2,000 tokens to every
  request; the memory writer and generated titles add one small-model request
  per idle chat and per new chat.

## Speed and memory

`npm run engine:bench` on the reference Windows PC, 5-run medians, warm,
throwaway profiles, no account or network model. Previous app: staged current
build (Energy 0.8.20 runtime, Electron 43.7.7). Engine: packaged draft.

| | Previous app | Engine |
| --- | --- | --- |
| Launch to window | 967 ms | 262 ms |
| Launch to sign-in screen (fresh profile) | 2,260 ms | 1,210 ms |
| Memory after start (working set / private) | 693 / 532 MB, 6 processes | 341 / 248 MB, 4 processes |
| Agent engine start | 169 ms | 166 ms |
| Open a chat (thread start) | 115 ms | 115 ms |
| First message: to model / first word / reply | 157 / 159 / 215 ms | 158 / 159 / 211 ms |
| Follow-up: to model / first word / reply | 80 / 81 / 132 ms | 76 / 77 / 131 ms |
| Installed size | 860 MB | 818 MB |

Model inference itself is the same for both: the same cloud function and
models. The first launch after installing is slower for both while Windows
scans the new files.

## Platforms

| Platform | Package | Minimum | Status |
| --- | --- | --- | --- |
| Windows x64 | NSIS installer (`engine:package`) | Windows 10 | Draft built and smoke tested; signed release needs `release.json` and signing |
| Windows x64 | Microsoft Store MSIX (`engine:package:store`) | Windows 10 1809 | Built and checked; a submission needs a version above 1.1.25 |
| macOS Apple Silicon | DMG (`package-engine-mac`, `engine-mac` workflow) | macOS 12 | Script and CI ready; not yet run on a Mac |
| macOS Intel (incl. OpenCore Legacy Patcher Macs) | DMG | macOS 12 | Script and CI ready; not yet run on a Mac |

The previous Mac build was Apple Silicon only with a macOS 15 floor. The
engine's floor is set by Electron 43 (macOS 12); measured with
`scripts/macho-min-os.cjs`:

| Part | Intel | Apple Silicon |
| --- | --- | --- |
| Electron 43 | 12.0 | 12.0 |
| Codex app server, code-mode host, ripgrep | 10.12 | 11.0 |
| Codex voice host (unused, left out) | 14.0 | 14.0 |
| Codex zsh build for an experimental feature (unused, left out) | 15.0 | 15.0 |

Older Macs running macOS 12 or later through OpenCore Legacy Patcher use the
Intel build. If their graphics driver makes Chromium's graphics process fail,
Timewarp restarts without hardware acceleration and remembers that; it can
also be turned off in Settings → General.

macOS 11 or older would need Electron 37 or older, which no longer gets
security fixes; not recommended for an app with a built-in browser.

## Before shipping

1. Live acceptance with a real account on Windows: sign-in, billing, a
   connected app, chat sync between two devices, replies on both funding
   sources (Timewarp credits and a connected ChatGPT plan), an automation.
   Include the live model evaluation (`engine:eval`, Luna and Sol) for the
   new base prompt, turn context and background memory writer, and an upgrade
   from a profile of the previous app with memory, automations and vault items.
2. Decide on setting up the Windows command sandbox in onboarding, as the
   previous app did (see Open).
3. Run the `engine-mac` workflow (previews on macOS 14, 15 and Intel), then
   a signed build; try it on an Intel Mac.
4. Signed Windows release: `release.json` and signing; Store: bump the version.
5. Update the website's Mac download dialog, which still tells Intel visitors
   the app is Apple Silicon only.
6. After cutover, remove `timewarp-runtime` and the patch pipeline.
