# Timewarp desktop engine

The Timewarp desktop app is being rebuilt as Timewarp-owned source, replacing
the compiled Energy 0.8.20 runtime that `timewarp-runtime` patches today. The
new engine is written from Timewarp's own feature specification. It does not
contain, decompile or translate Energy code.

## Architecture

| Layer | Source |
| --- | --- |
| Desktop shell | Electron 43 (official) with Timewarp's own main, preload and React renderer in `timewarp/app` |
| Agent harness | OpenAI Codex app server (official `@openai/codex`, Apache-2.0) over its documented JSON-RPC protocol |
| Agent browser control | `agent-browser` (Vercel Labs, Apache-2.0) |
| Local data | Built-in SQLite (`node:sqlite`) in the existing profile |
| Account, billing, organizations, onboarding, connectors, chat sync, model bridge | Existing Timewarp modules in `timewarp/desktop` and `timewarp/shared` |
| Cloud | Unchanged Supabase functions in `timewarp/supabase` |

The new engine keeps the existing profile (`%APPDATA%\Timewarp Energy`,
`~/Library/Application Support/Timewarp Energy`). Users stay signed in and keep
their Codex connection, onboarding state, browser sign-ins and Codex thread
history (`runtime/codex`). On first start it imports agents, chats, messages and
settings from the previous local database once, without modifying it.

```
timewarp/app/
  main/       Electron main process (CommonJS)
  preload/    contextBridge API for the renderer
  renderer/   React interface, bundled with esbuild
```

## Development

From `timewarp`:

    npm run engine:dev       # build and open (separate "Timewarp Dev" profile)
    npm run engine:preview   # signed-in sample account, scripted model, real Codex
    npm run test:engine      # engine tests, including a real Codex conversation

Preview mode is compiled only into `--fixture` development builds and is
refused for release builds.

## Parity checklist

Status: ☐ not started · ◐ in progress · ☑ done and verified

Core
- ☑ Window, single instance, app protocol, icons, profile, About panel
- ◐ Sign-in, sign-up, email code, password recovery, Google sign-in
- ◐ Organization gate (create, join, switch, picture)
- ☐ Onboarding (agent name, preferred name, browser profiles, knowledge import, theme, plan)
- ◐ Billing, plans, credits, Codex/ChatGPT connection
- ◐ Agents: create (Orbit, Nova, Cosmo or picture), rename, instructions, star, reorder, archive
- ☑ Conversations: new, list, search, rename, archive, read state
- ◐ Chat: streaming replies, reasoning, plans, commands, file changes, tool calls, web search, images, sub-agents
- ◐ Approvals, interrupt, retry, steer
- ◐ Model picker (Sol and Luna, or the connected Codex catalog) and reasoning effort
- ◐ Attachments and dictation
- ☑ Cloud chat history sync and restore, Privacy Mode
- ☑ Import of existing local data

Workspace
- ☐ Right pane with browser tabs, files and tools
- ☐ Built-in browser: tabs, navigation, profiles, profile import, recent sites, agent control, cursor
- ☐ Files: tree, search, text and code, images, PDF, spreadsheets, documents
- ☐ Vault: passwords, cards, secrets, agent access, autofill; passkeys

Capabilities
- ☐ Memory and instructions
- ☐ Skills
- ◐ Connected apps (Composio) and custom MCP servers
- ☐ Automations
- ◐ Settings: appearance and colors, notifications, privacy, preferences
- ◐ Feedback and bug reports

Distribution
- ☐ Windows installer, Microsoft Store package, macOS DMG built from this source only
- ☐ Updates through the Timewarp feed
- ☐ CI checks; `timewarp-runtime` and the patch pipeline removed
