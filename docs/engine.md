# Timewarp desktop engine

The Timewarp desktop app is rebuilt as Timewarp-owned source, replacing the
compiled Energy 0.8.20 runtime that `timewarp-runtime` patches. The engine is
written from Timewarp's own feature specification. It does not contain,
decompile or translate Energy code. Status as of 9 October 2026: feature
complete for everything below except the items marked otherwise, and verified
in preview builds. A live check with a real account is still needed before
shipping (see [Before shipping](#before-shipping)).

## Architecture

| Layer | Source |
| --- | --- |
| Desktop shell | Electron 43 (official) with Timewarp's own main, preload and React renderer in `timewarp/app` |
| Agent harness | OpenAI Codex app server (official `@openai/codex` 0.160.1, Apache-2.0) over its documented JSON-RPC protocol |
| Built-in browser and agent browser tools | Electron `WebContentsView` and its in-process debugger (`app/main/browser.cjs`, `browser-tools.cjs`) |
| File previews | pdf.js, ExcelJS, JSZip, highlight.js, markdown-it, loaded on demand |
| Local data | Built-in SQLite (`node:sqlite`) in the existing profile |
| Account, billing, organizations, onboarding screens, connectors, chat sync | Timewarp modules in `timewarp/desktop` and `timewarp/shared` |
| Cloud | Unchanged Supabase functions in `timewarp/supabase` |

The engine keeps the existing profile (`%APPDATA%\Timewarp Energy`,
`~/Library/Application Support/Timewarp Energy`). Users stay signed in and keep
their Codex connection, onboarding state, browser sign-ins and Codex thread
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
    npm run engine:e2e               # end-to-end harness check in a preview build (17 scenarios)
    npm run test:engine              # engine tests, including a real Codex conversation
    npm run engine:audit             # build and check the engine contains nothing from Energy
    npm run engine:package:draft     # unsigned Windows installer (build/engine-installer-draft)
    npm run engine:package           # signed Windows release (release.json and signing needed)
    npm run engine:package:store     # unsigned Microsoft Store MSIX (build/engine-store)
    npm run engine:package:mac:draft # macOS DMGs, on a Mac (or the engine-mac workflow)
    npm run engine:smoke -- <app>    # smoke test a packaged app (Windows or macOS)
    npm run engine:bench             # speed comparison with the previous app (Windows)

Preview mode is compiled only into `--fixture` development builds and is
refused for release builds. The local model bridge uses port 7788, or a free
port when another app (such as the previous Timewarp app) already uses it. `TIMEWARP_TRACE_STARTUP=1` prints start-up timings.

The app log is `runtime/logs/main.log` in the profile, as in the previous app
(one older file, `main.1.log`, is kept): start-up timing, window and renderer
errors, browser page failures, Codex status and stderr, content-free turn
records (status and duration), connector sign-ins, updates and shutdown. It
never contains chat or page content, files, account details or vault values.
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
| Organizations (create, join, switch, invite, picture) | Timewarp gate and settings | Same gate; settings page rebuilt |
| Onboarding (agent name, your name, knowledge, theme, plan) | Timewarp screens | Same screens; knowledge import rebuilt; "Run setup again" added |
| Billing, plans, credits, ChatGPT / Codex connection and usage | Timewarp billing screen | Same screen |
| Agents (create, mascot or picture, rename, instructions, star, reorder, archive) | Energy UI | Same; avatars are mascots, as the previous app's "generate avatar" was |
| Chats (new, list, search, rename, archive, read state, notifications) | Energy UI | Same |
| Chat (streaming, reasoning, plans, commands, file changes, tools, web search, images, sub-agents) | Energy harness on Energy's Codex build | Same on the official Codex; activity cards rebuilt |
| Agent working rules (task execution contract, delegation, Windows shell) | Timewarp's harness instructions and patches | Same text; the previous app's worker guidance replaces Codex's default "only delegate on request" hint; up to 4 agents at once |
| Run limits (200 tool calls, 20 minutes, stop after 3 identical failures or on the first error when asked; Stop ends workers too) | Timewarp execution guard | Same guard, counting the official app server's tool items |
| Approvals for extra access (commands outside the workspace, network, MCP tools) | Automatic review by a reviewer agent; a denial stops the run | Same (Codex's automatic reviewer); each review shows in the chat; Settings → General → Approvals can switch to asking the user |
| Task panel (stop reason, tool, error and token counts, workers you can follow) | Timewarp task activity | Rebuilt above the composer; a worker's transcript opens from it |
| Approvals, stop, retry a failed message, per-chat model | Energy UI | Same |
| Warm chat session on open | Energy | Same |
| Attachments | Files | Same: images to the model, other files copied into the agent's workspace |
| Dictation | Cloud transcription | Same service |
| Chat history sync, restore, Privacy Mode | Timewarp sync | Same format and service |
| Built-in browser (tabs, profiles, recent sites, downloads) | Energy browser | Rebuilt on `WebContentsView`; profiles can be created, renamed and removed from the chat's browser and Settings → Browser, and switching reopens the chat's pages in the chosen profile |
| Agent browser control, agent cursor, take over / hand back | agent-browser and Timewarp cursor | Rebuilt as in-process tools (open, snapshot, click, type, press, scroll, read, screenshot, tabs, back, forward, wait, close); cursor in the page; take over supported; works with the pane closed |
| Files view and previews (PDF, Excel, CSV, Word, images, code, markdown) | Energy UI | Rebuilt; refreshes as the agent works |
| Vault (sign-ins, cards, secrets, agent access, fill without revealing values) | Energy vault | Rebuilt; cards and secrets need permission each time; address-bar fill; password import from browser CSV exports; card security codes are never stored, as before |
| Passkeys | Energy (macOS 13.3+) | Not carried over |
| Memory (notes, imports from ChatGPT / Codex, Claude, Cursor) | Energy memory | Rebuilt on the same files (`memories/user.md`, `memories/imports`). Imports find the same memory files, skills (including skills linked in by skill installers) and MCP servers (Codex `config.toml`, Claude Code, Claude's desktop app, Cursor) on Windows and macOS; a Cursor project folder can be chosen |
| Skills (list, enable, import, view) | Codex skills | Same; previously connected skill folders stay available |
| Instructions for every agent | Energy | Same (Codex global `AGENTS.md`) |
| Automations (schedules, run now, history) | Energy | Rebuilt; previous automations import paused |
| Connected apps (Composio), per-agent access | Timewarp Composio | Same service and agent tools; sign-in opens in an app window with the default browser profile, as before; access UI rebuilt |
| MCP servers (URL with sign-in, or local command) | Energy | Rebuilt on the Codex config |
| Codex plugin catalog | Energy defaults plugin | Not carried over (it shipped Energy's own plugin) |
| Windows command sandbox setup | Codex | Same |
| Suggested tasks | Energy, off for the reference account | Not carried over |
| Feedback, diagnostics | Timewarp reporting, Energy debug export | Same feedback; diagnostics file rebuilt (no chats or account data) |
| Conversation trace (Activity) | Energy UI | Rebuilt: turns and events with input, cached and output tokens and timing |
| Browser sign-in import from Chrome/Edge profiles | Energy | Not carried over: it would read other browsers' protected sign-in data. Saved passwords import from a browser's CSV export (Settings → Browser, the chat's profile menu or the Vault) |
| Updates | Timewarp feed (Windows) | Same feed and checks |

The interface has the previous app's layout and screens: the sidebar with
agent groups, activity feed, usage card and account menu; the home screen with
its composer, tools, agent and model pickers and suggestions; the chat with
Report, the Activity trace and thread actions; the side pane; and Settings
(General, Tools, Browser, Vault, Memories, Skills, Organization, Billing, plus
Automations). It is rebuilt in Timewarp's own React code from screenshots and
measurements of the running previous app, not copied from Energy's code. The
Timewarp-made screens (sign-in, organization, billing, onboarding) are the same
files. Engine-only settings (notifications, instructions for every agent,
command sandbox, setup, diagnostics) are in Settings → General.

### Verified how

- `npm run engine:e2e`: the real app and Codex with the preview account and a
  scripted model go through chat, commands with approval, decline and stop,
  browser use with the pane open and closed, vault fill, connected-app tools,
  an added MCP server, files, automations, workers, connector sign-in, the log
  file and diagnostics, automatic approval review allowing and denying, and
  asking the user (17 scenarios, all passing).
- 290 tests (`npm test`), of which 57 are engine tests (`npm run test:engine`),
  including a real Codex conversation against a local model.
- Every feature above was exercised end to end in preview builds: a signed-in
  sample account, the real Codex runtime and a scripted local model, with
  screenshots.
- The packaged Windows app starts, shows sign-in and runs its bundled Codex
  (`smoke-engine`). The Store MSIX builds with the existing Store identity.
- Not yet verified: a real account against the production cloud (sign-in,
  billing, connected apps, chat sync and model replies), and a real Mac.

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
2. Run the `engine-mac` workflow (previews on macOS 14, 15 and Intel), then
   a signed build; try it on an Intel Mac.
3. Signed Windows release: `release.json` and signing; Store: bump the version.
4. Update the website's Mac download dialog, which still tells Intel visitors
   the app is Apple Silicon only.
5. After cutover, remove `timewarp-runtime` and the patch pipeline.
