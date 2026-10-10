"use strict";
// Timewarp desktop main process.
const { app, BrowserWindow, Menu, Notification, ipcMain, nativeTheme, net, protocol, session, shell, dialog, safeStorage, clipboard } = require("electron");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

// Recent app log lines for the diagnostics file, also written to
// runtime/logs/main.log. The app logs its own state messages only; chat
// content, files and secrets are never logged, and web addresses only by origin.
const recentLog = [];
let appLog = null;
require("./log.cjs").captureConsole({ console, process, recent: recentLog, log: () => appLog });

const appRoot = path.resolve(__dirname, "..");
const build = (() => { try { return JSON.parse(fs.readFileSync(path.join(appRoot, "build.json"), "utf8")); } catch { return {}; } })();
const VERSION = build.version || app.getVersion();
const profile = process.env.TIMEWARP_USER_DATA_DIR ? path.resolve(process.env.TIMEWARP_USER_DATA_DIR) : path.join(app.getPath("appData"), build.profile || "Timewarp Dev");
const runtimeDir = path.join(profile, "runtime");
fs.mkdirSync(runtimeDir, { recursive: true });
appLog = require("./log.cjs").createLog(path.join(runtimeDir, "logs"));
// A session that didn't end with a normal quit leaves its marker behind; the
// window then says Timewarp closed unexpectedly, as the previous app did.
const sessionMarker = path.join(runtimeDir, "session-open");
const previousSessionUnclean = fs.existsSync(sessionMarker);
try { fs.writeFileSync(sessionMarker, new Date().toISOString()); } catch {}
appLog.info("startup", `Timewarp ${VERSION} starting`, { platform: process.platform, arch: process.arch, osRelease: require("node:os").release(), electron: process.versions.electron, packaged: app.isPackaged });
app.setName("Timewarp");
app.setPath("userData", profile);
app.setPath("sessionData", profile);
app.setAppLogsPath(path.join(profile, "logs"));
if (process.platform === "win32") app.setAppUserModelId(build.appId || "com.timewarp.desktop.dev");
// Some older Macs (including ones on a newer macOS through OpenCore Legacy
// Patcher) and older PCs have graphics drivers Chromium can't use. When the
// graphics process keeps failing, Timewarp restarts without hardware
// acceleration and remembers that on this device.
const softwareRendering = path.join(profile, "software-rendering");
if (fs.existsSync(softwareRendering)) app.disableHardwareAcceleration();
let graphicsFailures = 0;
app.on("child-process-gone", (_event, details) => {
  if (details.type !== "GPU" || ["clean-exit", "killed"].includes(details.reason) || fs.existsSync(softwareRendering)) return;
  if (++graphicsFailures < 2) return;
  console.error("[timewarp] The graphics process failed; restarting without hardware acceleration.", details.reason);
  try { fs.writeFileSync(softwareRendering, JSON.stringify({ reason: details.reason, at: new Date().toISOString() })); } catch { return; }
  // Quit normally so the session marker and Codex are cleaned up.
  app.relaunch();
  app.quit();
});
protocol.registerSchemesAsPrivileged([{ scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, codeCache: true } }]);

const rendererDir = path.join(appRoot, "renderer");
const assetsDir = path.join(appRoot, "assets");
const appIcon = path.join(assetsDir, process.platform === "win32" ? "app-icon.ico" : "app-icon.png");

function serveApp(request) {
  const url = new URL(request.url);
  if (url.host !== "app") return new Response("Not found", { status: 404 });
  const relative = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
  const file = path.resolve(rendererDir, "." + relative);
  if (!file.startsWith(rendererDir + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return new Response("Not found", { status: 404 });
  return net.fetch(pathToFileURL(file).href);
}

function appWindows() {
  return BrowserWindow.getAllWindows().filter(window => !window.isDestroyed() && window.webContents.getURL().startsWith("app://app/"));
}
function broadcast(name, payload) {
  for (const window of appWindows()) window.webContents.send("tw:event", name, payload);
}
let mainWindow = null;
// On Windows the title bar is hidden and the window buttons sit over the top of
// the app in its colours, as in the previous app; the top bar is the drag area.
const TITLE_BAR_HEIGHT = 36;
const windowColors = dark => {
  const background = dark ? "#17161c" : "#f7f6fb";
  return { background, overlay: { color: "#00000000", symbolColor: dark ? "#f5f5f5" : "#17171a", height: TITLE_BAR_HEIGHT } };
};
function applyWindowColors(window) {
  if (!window || window.isDestroyed()) return;
  const colors = windowColors(nativeTheme.shouldUseDarkColors);
  window.setBackgroundColor(colors.background);
  if (process.platform === "win32") window.setTitleBarOverlay(colors.overlay);
}
function createWindow(route = "") {
  const colors = windowColors(nativeTheme.shouldUseDarkColors);
  mainWindow = new BrowserWindow({
    width: 1200, height: 800, minWidth: 520, minHeight: 480, show: false, title: "Timewarp", icon: appIcon,
    backgroundColor: colors.background,
    ...(process.platform === "darwin" ? { titleBarStyle: "hiddenInset", trafficLightPosition: { x: 18, y: 18 } }
      : process.platform === "win32" ? { titleBarStyle: "hidden", titleBarOverlay: colors.overlay }
        : { autoHideMenuBar: true }),
    // Developer tools only in development builds, as before.
    webPreferences: { preload: path.join(appRoot, "preload", "preload.cjs"), contextIsolation: true, sandbox: true, nodeIntegration: false, webviewTag: false, spellcheck: true, devTools: !app.isPackaged },
  });
  mainWindow.once("ready-to-show", () => mainWindow.show());
  // Ctrl/⌘+W closes what's open in the app (a file, the agent tab or a browser
  // tab) rather than the window; the interface decides, and asks before quitting.
  mainWindow.webContents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown" || input.isAutoRepeat || input.alt || input.shift || String(input.key).toLowerCase() !== "w") return;
    if (process.platform === "darwin" ? !(input.meta && !input.control) : !(input.control && !input.meta)) return;
    event.preventDefault();
    mainWindow.webContents.send("tw:event", "app.closeShortcut", {});
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//i.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (url.startsWith("app://app/")) return;
    event.preventDefault();
    appLog.warn("window-navigation", "Blocked navigation away from the app", { origin: (() => { try { return new URL(url).origin; } catch { return "invalid"; } })() });
  });
  mainWindow.webContents.on("render-process-gone", (_event, details) => appLog.error("renderer:error", "The window's renderer stopped", { reason: details.reason, exitCode: details.exitCode }));
  mainWindow.webContents.on("unresponsive", () => appLog.warn("renderer:error", "The window stopped responding"));
  mainWindow.webContents.on("responsive", () => appLog.info("renderer:error", "The window responds again"));
  mainWindow.webContents.on("console-message", details => {
    if (details.level === "error") appLog.error("renderer:error", String(details.message || "").slice(0, 300), { source: path.basename(String(details.sourceId || "")), line: details.lineNumber });
  });
  mainWindow.webContents.on("did-finish-load", () => appLog.info("startup-timing", `window loaded after ${Date.now() - traceStart}ms`));
  mainWindow.on("closed", () => { mainWindow = null; });
  void mainWindow.loadURL("app://app/index.html" + route);
  return mainWindow;
}
function focusApp(route = "") {
  const window = mainWindow || createWindow(route);
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
}
// Opens a screen of the app, such as a chat from its notification; a window
// that has to be created (macOS, after it was closed) starts there.
function openRoute(route) {
  if (mainWindow) { focusApp(); broadcast("app.navigate", { route }); }
  else focusApp(route);
}

// The menu holds the keyboard shortcuts on every platform, as in the previous
// app: zoom (Ctrl/⌘ +, -, 0), full screen and editing. On Windows it isn't
// shown; the title bar is hidden. Ctrl/⌘+W is handled by the window instead.
function applicationMenu() {
  const openSettings = () => openRoute("#/customize/settings");
  const view = { label: "View", submenu: [
    { role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomIn", accelerator: "CommandOrControl+=", visible: false, acceleratorWorksWhenHidden: true }, { role: "zoomOut" },
    { type: "separator" }, { role: "togglefullscreen" },
    ...(app.isPackaged ? [] : [{ type: "separator" }, { role: "reload" }, { role: "toggleDevTools" }]),
  ] };
  const template = process.platform === "darwin"
    ? [
      { label: "Timewarp", submenu: [{ role: "about" }, { type: "separator" }, { label: "Settings…", accelerator: "Command+,", click: openSettings }, { type: "separator" }, { role: "services" }, { type: "separator" }, { role: "hide" }, { role: "hideOthers" }, { role: "unhide" }, { type: "separator" }, { role: "quit" }] },
      { role: "editMenu" }, view,
      { label: "Window", submenu: [{ role: "minimize" }, { role: "zoom" }, { type: "separator" }, { role: "front" }] },
    ]
    : [{ role: "editMenu" }, view];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
// The window's frame, native dialogs and web pages follow the app's
// appearance setting (Settings → General), not only the system's.
function applyThemeSource(scheme) {
  nativeTheme.themeSource = ["light", "dark"].includes(scheme) ? scheme : "system";
}
nativeTheme.on("updated", () => { for (const window of BrowserWindow.getAllWindows()) if (window === mainWindow) applyWindowColors(window); });

// Start-up timing, printed when TIMEWARP_TRACE_STARTUP is set.
const traceStart = Date.now();
const trace = label => {
  if (process.env.TIMEWARP_TRACE_STARTUP) console.log(`[timewarp] startup ${Date.now() - traceStart}ms ${label}`);
  if (!/^(call|answered|request) /.test(label)) appLog?.info("startup-timing", `${Date.now() - traceStart}ms ${label}`);
};

async function boot() {
  trace("ready");
  protocol.handle("app", serveApp);
  app.setAboutPanelOptions({ applicationName: "Timewarp", applicationVersion: VERSION, copyright: "Copyright © 2026 Timewarp." });
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(webContents.getURL().startsWith("app://app/") && ["media", "clipboard-sanitized-write"].includes(permission));
  });

  const config = require("../../config.json");
  const { openStore } = require("./store.cjs");
  const { importLegacyProfile, importLegacyBrowserProfiles, importLegacyBrowserTabs, importLegacyChatExtras, importLegacyVault } = require("./import-legacy.cjs");
  const { createAgents } = require("./agents.cjs");
  const { createHarness } = require("./harness.cjs");
  const { createModelBridge } = require("./model-bridge.cjs");
  const { CodexClient } = require("./codex-client.cjs");
  const { vendorRoot, codexExecutable, codexEnv } = require("./codex-paths.cjs");
  const { createServices } = require("./services.cjs");
  const { createHistoryAdapter } = require("./history-adapter.cjs");
  const { engineInstructions, workerInstructions, DELEGATION, WORKER } = require("./instructions.cjs");
  const { CODEX_FEATURES, WINDOWS_SANDBOX_FEATURES, PERMISSIONS, agentThreadConfig, workspaceRoots, toolServers, REPLACED_SKILLS } = require("./codex-config.cjs");
  // Timewarp's base prompt, in place of Codex's own.
  const { BASE_INSTRUCTIONS } = require("./base-instructions.cjs");
  const { createToolServer } = require("./tool-server.cjs");
  // The cards agents can put in their messages (widgets.jsx).
  const { WIDGETS } = require("./widget-instructions.cjs");
  const { createBrowser } = require("./browser.cjs");
  const { createBrowserTools } = require("./browser-tools.cjs");
  const { createKnowledge } = require("./knowledge.cjs");
  const { createOnboarding } = require("./onboarding.cjs");
  const { createAutomations } = require("./automations.cjs");
  const { createSandbox } = require("./sandbox.cjs");
  const { createMcp } = require("./mcp.cjs");
  const { createVault, safeStorageCipher } = require("./vault.cjs");
  const { createVaultTools } = require("./vault-tools.cjs");
  const { migrateAppearance, defaultAccent } = require("../../shared/appearance.cjs");

  // A damaged database is set aside (kept, never deleted) and a new one is
  // started: chats come back through history sync and the previous app's data
  // is imported again. Anything else, such as a locked file, still stops start-up.
  const openProfileStore = file => {
    try { return openStore(file); }
    catch (error) {
      if (![11, 26].includes((error?.errcode ?? -1) & 0xff)) throw error;
      const aside = `${file}.damaged-${new Date().toISOString().replace(/[:.]/g, "-")}`;
      appLog.error("store", "The local database is damaged; a new one was started", { code: error.errcode, kept: path.basename(aside) });
      for (const suffix of ["", "-wal", "-shm"]) { try { fs.renameSync(file + suffix, aside + suffix); } catch {} }
      return openStore(file);
    }
  };
  const store = openProfileStore(path.join(profile, "timewarp.sqlite"));
  applyThemeSource(store.settings.get("appearance")?.scheme);
  trace("store open");
  try { importLegacyProfile({ store, runtimeDir, log: (...args) => console.error("[timewarp]", ...args) }); }
  catch (error) { console.error("[timewarp] Previous local data could not be imported.", error.message); }
  try { importLegacyBrowserProfiles({ store, runtimeDir }); }
  catch (error) { console.error("[timewarp] Previous browser profiles could not be imported.", error.message); }
  // Files on messages, card answers and open tabs from the previous app (once each).
  try { importLegacyChatExtras({ store, runtimeDir }); }
  catch (error) { console.error("[timewarp] Previous card answers could not be imported.", error.message); }
  try { importLegacyBrowserTabs({ store, runtimeDir }); }
  catch (error) { console.error("[timewarp] Previous browser tabs could not be imported.", error.message); }
  const appearance = store.settings.get("appearance");
  if (appearance) { const migrated = migrateAppearance(appearance); if (migrated !== appearance) store.settings.set("appearance", migrated); }

  const mcpToken = crypto.randomBytes(32).toString("base64url");
  const bridgeToken = crypto.randomBytes(32).toString("base64url");
  const toolsToken = crypto.randomBytes(32).toString("base64url");
  // Timewarp's own agent tools on the bridge, set up once the harness exists.
  let toolServer = null;
  let history = null, historyStatus = { state: "starting" }, toolsRegistered = false, toolsReady = null;
  let userId = () => null, harness = null, markBooted;
  // Sign-in can report a change while startup is still wiring services.
  const booted = new Promise(resolve => { markBooted = resolve; });
  const agents = createAgents({ store, root: path.join(runtimeDir, "agents"), userId: () => userId() });
  const adapter = createHistoryAdapter({ store, createAgent: input => agents.create(input), settings: store.settings });

  // Preview mode exists only in development builds made with --fixture.
  // Loaded by path so it is never bundled; only --fixture builds include the file.
  const fixture = build.fixture === true && !app.isPackaged ? require(path.join(__dirname, "fixture.cjs")).createFixture() : null;
  const services = createServices({
    profile, config, mcpToken, fixture,
    agentsFor: () => adapter.store.agents,
    onAccountChanged: async ({ changedUser }) => {
      await booted;
      // The previous account's runs and approvals end with Codex; it starts
      // again for the next account's first request.
      if (changedUser) { await client.stop().catch(() => {}); harness.reset(); toolsRegistered = false; }
      await accountReady();
      broadcast("account.changed", { signedIn: !!services.auth.user() });
    },
    onCodexConnected: async () => { await booted; await selectModel().catch(() => console.error("[timewarp] The default model could not be updated.")); fundingChanged(); },
  });
  userId = () => services.auth.userId();

  const codexHome = path.join(runtimeDir, "codex");
  fs.mkdirSync(codexHome, { recursive: true });
  let onboarding = null;
  const knowledge = createKnowledge({
    runtimeDir, codexHome, cursorRoot: () => store.settings.get("cursorRoot") || onboarding?.service.cursorRoot(),
    ...(fixture ? { home: fixture.sampleHome(path.join(profile, "preview-home")), env: {} } : {}),
  });
  fs.mkdirSync(path.join(runtimeDir, "codex-app-server-cwd"), { recursive: true });
  // The local endpoint Codex uses for Timewarp models and connected apps.
  const bridge = createModelBridge({ token: bridgeToken, cloud: services.cloud, funding: services.funding, chatgpt: services.chatgpt, integrations: services.integrations, mascots: require("../../desktop/mascots.cjs"), toolServer: () => toolServer });
  const bridgeReady = bridge.listen();
  bridgeReady.catch(error => console.error("[timewarp]", error.message));
  const vendor = vendorRoot();
  // Opened from Finder, the app lacks the PATH the user's shell profile sets
  // (Homebrew, nvm): agent commands get the login shell's PATH, as before.
  const { loginShellPath, mergePath } = require("./login-shell.cjs");
  const shellPath = process.platform === "darwin" ? loginShellPath().catch(() => null) : Promise.resolve(null);
  const client = new CodexClient({
    executable: codexExecutable(vendor), cwd: path.join(runtimeDir, "codex-app-server-cwd"),
    // Codex starts once the bridge has its port.
    args: async () => {
      await bridgeReady.catch(() => {});
      const probed = await shellPath;
      if (probed) Object.assign(client.env, codexEnv(vendor, { ...process.env, PATH: mergePath(process.env.PATH, probed) }, { home: codexHome }));
      // Sign-ins are found where the previous app kept them: installed builds
      // use the system keyring and also read the Codex home's file, development
      // builds a file only.
      const credentials = app.isPackaged ? "auto" : "file";
      return [
        "-c", `cli_auth_credentials_store="${credentials}"`, "-c", `mcp_oauth_credentials_store="${credentials}"`,
        // Each chat picks its provider (codex-funding.cjs): "timewarp" for Timewarp
        // credits, "openai" for a connected ChatGPT plan. The default stays OpenAI so
        // Codex reports the connected ChatGPT account (account/read) and its models.
        "-c", `model_providers.timewarp={name="Timewarp",base_url="http://127.0.0.1:${bridge.port}/v1",wire_api="responses",env_key="TIMEWARP_BRIDGE_TOKEN"}`,
        ...CODEX_FEATURES.flatMap(setting => ["-c", setting]),
        // Windows' own sandbox where available (sandbox.cjs).
        ...(sandbox.useAppContainer() ? WINDOWS_SANDBOX_FEATURES.flatMap(setting => ["-c", setting]) : []),
        // The previous app's guidance on when to use workers.
        "-c", "features.multi_agent_v2.multi_agent_mode_hint_text=" + JSON.stringify(DELEGATION),
        // What workers are told, as the previous app's worker roles were (each
        // chat's thread adds its agent: threadConfig below).
        "-c", "features.multi_agent_v2.subagent_developer_instructions=" + JSON.stringify(WORKER),
      ];
    },
    env: {
      CODEX_HOME: codexHome, TIMEWARP_BRIDGE_TOKEN: bridgeToken, TIMEWARP_COMPOSIO_TOKEN: mcpToken, TIMEWARP_TOOLS_TOKEN: toolsToken, ...codexEnv(vendor, process.env, { home: codexHome }),
      // Git in agent commands handles long Windows paths, as before.
      ...(process.platform === "win32" ? { GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "core.longpaths", GIT_CONFIG_VALUE_0: "true" } : {}),
    },
    clientInfo: { name: "timewarp", title: "Timewarp", version: VERSION },
  });
  client.on("status", state => {
    broadcast("codex.status", { status: state.status });
    (state.status === "failed" ? appLog.error : appLog.info)("codex:app-server", `Codex ${state.status}`, state.status === "failed" ? { code: state.code ?? null, signal: state.signal ?? null } : undefined);
  });
  client.on("stderr", line => appLog.warn("codex:app-server:stderr", line));
  // Skill folders set at run time are gone after Codex restarts.
  client.on("status", state => { if (state.status === "ready" && userId()) void connectLegacySkills().catch(() => {}); });
  // Content-free run records: ids, status and timing, never messages.
  const turnStarts = new Map();
  client.on("notification", ({ method, params }) => {
    if (method === "turn/started") turnStarts.set(params.turn?.id, Date.now());
    if (method === "turn/completed") {
      const started = turnStarts.get(params.turn?.id);
      turnStarts.delete(params.turn?.id);
      appLog.info("turn", `Turn ${params.turn?.status}`, { thread: String(params.threadId || "").slice(0, 8), turn: String(params.turn?.id || "").slice(0, 8), durationMs: started ? Date.now() - started : null, error: params.turn?.error?.codexErrorInfo || (params.turn?.error ? "error" : null) });
    }
    if (method === "error" && !params.willRetry) appLog.warn("turn", "Turn error", { thread: String(params.threadId || "").slice(0, 8), info: params.error?.codexErrorInfo || null });
  });
  client.on("notification", ({ method, params }) => { if (method === "windowsSandbox/setupCompleted") broadcast("sandbox.changed", params); });
  // Codex's command sandbox (sandbox.cjs): set up and checked once signed in.
  // A change applies when Codex restarts, which waits until no chat is
  // replying (urgent: a minute at most, when sandboxed commands stall).
  let codexVersion = null;
  try { codexVersion = JSON.parse(fs.readFileSync(path.join(vendor, "codex-package.json"), "utf8")).version || null; } catch {}
  async function restartCodex({ urgent = false } = {}) {
    for (const end = Date.now() + (urgent ? 60000 : Infinity); harness?.busy() && Date.now() < end;) await new Promise(resolve => setTimeout(resolve, 1000));
    appLog.info("codex:app-server", "Restarting Codex");
    await client.stop().catch(() => {});
    harness?.reset();
    toolsRegistered = false;
    if (userId()) toolsReady = registerTools().catch(error => appLog.warn("tools", "Agent tools are pending. " + error.message));
    else await client.start().catch(() => {});
  }
  fs.mkdirSync(path.join(runtimeDir, "agents"), { recursive: true });
  const sandbox = createSandbox({
    client, settings: store.settings, cwd: path.join(runtimeDir, "agents"), restart: restartCodex, codexVersion,
    log: (level, message, data) => appLog[level === "warn" ? "warn" : "info"]("sandbox", message, data),
  });
  const sandboxChanged = state => { broadcast("sandbox.changed", state); return state; };
  let executionNotice = null;
  const executionChanged = () => {
    if (executionNotice) return;
    executionNotice = setTimeout(() => { executionNotice = null; for (const window of appWindows()) window.webContents.send("timewarp:executionChanged"); broadcast("execution.changed", {}); }, 200);
    executionNotice.unref?.();
  };
  const guard = require("../../desktop/execution-guard.cjs").bindExecutionGuard(client, { userId: () => userId(), onChange: executionChanged, countItems: true });
  require("../../desktop/codex-funding.cjs").bindCodexFunding({ client, chatgpt: services.chatgpt, funding: services.funding, userId: () => userId() });

  // The current funding's models (model-catalog.cjs). A ChatGPT catalog that
  // can't be read (including a connection that needs signing in again) is an
  // error, not Timewarp's models: the saved default stays as the user chose it.
  const modelCatalog = require("./model-catalog.cjs").createModelCatalog({
    ready: () => services.ready, funding: services.funding, chatgpt: services.chatgpt, settings: store.settings, userId: () => userId(),
    log: message => appLog.warn("models", message),
  });
  async function modelChoices() { return modelCatalog.modelChoices(); }
  async function selectModel(choices) { return modelCatalog.selectModel(choices); }

  function instructionsFor(agent) {
    const account = services.auth.user();
    const lines = [
      `You are ${agent.name}, a Timewarp agent working for the user on this computer.`,
      `Your Timewarp agent ID is ${agent.id}. Use it whenever a connected-app tool asks for the current agent ID.`,
      `Your workspace folder is ${agent.workspace}. Keep files you create for the user there unless they ask otherwise.`,
    ];
    if (account?.name) lines.push(`The user's name is ${account.name}.`);
    if (account?.email) lines.push(`The user's email address is ${account.email}. Use it to sign in to sites the user's tasks need.`);
    return lines.join("\n") + "\n\n" + knowledge.instructions(store.settings.get("memory")?.mode) + "\n\n" + engineInstructions({ patchFiles: sandbox.verified() }) +"\n\n" + WIDGETS;
  }

  // Each message's context (harness turnContext): when it was sent, the user's
  // connected app accounts and the memory. An entry Codex already has
  // unchanged isn't sent again, so it costs nothing until it changes.
  const { memoryMode } = require("./knowledge.cjs");
  const appAccounts = new Map(); // agent id -> { at, text, loading }
  const accountsText = ({ items }) => {
    const apps = (items || []).filter(item => item.accounts?.length).map(item => `- ${item.displayName} (app id ${String(item.id).replace(/^composio-/, "")}): `
      + item.accounts.map(account => account.displayName + (account.authStatus === "ready" ? "" : " (needs reconnecting)")).join(", "));
    return apps.length
      ? "Connected app accounts this agent can use (one that needs reconnecting can't be used until the user reconnects it):\n" + apps.join("\n") + "\nOther apps aren't connected."
      : "No app accounts are connected for this agent.";
  };
  function connectedApps(agent) {
    const known = appAccounts.get(agent.id);
    if (!known?.loading && (!known || Date.now() - known.at > 60000)) {
      const loading = services.integrations.list({ agentId: agent.id }).then(accountsText).catch(() => known?.text ?? null)
        .then(text => { appAccounts.set(agent.id, { at: Date.now(), text }); return text; });
      appAccounts.set(agent.id, { ...known, loading });
    }
    const entry = appAccounts.get(agent.id);
    // A known list answers at once while a fresh one loads.
    return entry.text !== undefined ? Promise.resolve(entry.text) : entry.loading;
  }
  async function turnContext(agent, conversation, { sentAt }) {
    const at = new Date(sentAt || Date.now()), zone = Intl.DateTimeFormat().resolvedOptions().timeZone || "local time";
    const offset = -at.getTimezoneOffset(), sign = offset < 0 ? "-" : "+";
    const utc = `UTC${sign}${String(Math.floor(Math.abs(offset) / 60)).padStart(2, "0")}:${String(Math.abs(offset) % 60).padStart(2, "0")}`;
    const local = at.toLocaleString("en-GB", { weekday: "long", year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
    const account = services.auth.user();
    const mode = memoryMode(store.settings.get("memory")?.mode);
    // The first list for an agent is waited for briefly; without it the message goes as it is.
    const apps = agent ? await Promise.race([connectedApps(agent), new Promise(resolve => { const timer = setTimeout(resolve, 1500, null); timer.unref?.(); })]) : null;
    const memory = knowledge.context(mode);
    return {
      timewarp_message_time: `The user's message was sent on ${local} (${zone}, ${utc}).`,
      ...(account ? { timewarp_account: [`Signed in to Timewarp as ${account.name ? account.name + ", " : ""}${account.email || "an account without an email address"}.`, ...(apps ? [apps] : [])].join("\n") } : {}),
      timewarp_memory: memory || (mode === "enabled" || mode === "read" ? "No notes about the user yet." : "Memory is off for reading: don't rely on memory shown earlier in this chat."),
    };
  }

  const browser = createBrowser({ window: () => mainWindow, store, notify: broadcast, log: appLog });
  const browserTools = createBrowserTools({ browser, onActivity: (conversationId, action) => broadcast("browser.agent", { conversationId, action }) });
  // Raise when the tool set changes: chats then continue in a new thread.
  const cipher = safeStorageCipher(safeStorage);
  const vault = createVault({ store, cipher, userId: () => userId() });
  const vaultTools = createVaultTools({
    vault, browserTools,
    ask: async (message, detail) => {
      focusApp();
      const result = await dialog.showMessageBox(mainWindow, { type: "question", title: "Timewarp vault", message, detail, buttons: ["Allow", "Don't allow"], defaultId: 1, cancelId: 1, noLink: true });
      return result.response === 0;
    },
  });
  // Created below, once the harness exists.
  let automationTools = null;
  // Raised when the agent tools change, so chats continue in a thread that has them
  // (3: browser select, hover and upload; cards without security codes; 4: automations;
  // 5: the tools moved to MCP servers, so workers have them too).
  const TOOLS_VERSION = 5;
  // Dynamic tool calls still come from chats started before version 5.
  const tools = {
    version: TOOLS_VERSION,
    call: (conversationId, params, agent) => {
      if (params.namespace === "timewarp_browser") return browserTools.call(conversationId, params, agent);
      if (params.namespace === "timewarp_vault") return vaultTools.call(conversationId, params, agent);
      if (params.namespace === "timewarp_automations" && automationTools) return automationTools.call(conversationId, params, agent);
      return Promise.reject(Object.assign(new Error("This tool is not available in Timewarp."), { status: 404 }));
    },
    finished: conversationId => browserTools.finished(conversationId),
  };

  let automations = null, storeClosed = false;
  const replies = require("./notifications.cjs").createReplyNotifications({
    Notification, store, userId: () => userId(),
    enabled: () => store.settings.get("notifications")?.replies !== false,
    focused: () => BrowserWindow.getAllWindows().some(window => !window.isDestroyed() && window.isVisible() && window.isFocused()),
    quiet: turnId => !!harness?.isQuietRun?.(turnId),
    open: conversationId => openRoute("#/conversation/" + encodeURIComponent(conversationId)),
    setBadge: count => app.setBadgeCount(count),
    log: message => appLog.warn("notifications", message),
  });
  let background = null; // titles and the memory writer, set up below
  harness = createHarness({
    store, client, userId: () => userId(), instructionsFor, tools, permissions: PERMISSIONS, toolsReady: () => toolsReady || (toolsReady = registerTools().catch(error => appLog.warn("tools", "Agent tools are pending. " + error.message))),
    // Each chat's workers learn which agent they work for (connected apps need its ID).
    threadConfig: agent => agentThreadConfig(workerInstructions(agent)),
    baseInstructions: BASE_INSTRUCTIONS, turnContext,
    // The agent's workspace and Codex's skills folder, and the memory folder while memory may be written.
    workspaceRoots: agent => workspaceRoots(agent.workspace, { skills: knowledge.skillsRoot, memories: knowledge.memoriesRoot, memoryWrite: ["enabled", "write"].includes(memoryMode(store.settings.get("memory")?.mode)) }),
    modelSettings: () => store.settings.get("modelSettings"),
    // Automatic review unless the user chose to be asked (Settings → General).
    approvalsReviewer: () => process.env.TIMEWARP_APPROVALS_REVIEWER || (store.settings.get("preferences")?.approvals === "ask" ? "user" : "auto_review"),
    // Late Codex events during quit find the database closed: they're dropped.
    notify: (name, payload) => { if (storeClosed) return; broadcast(name, payload); automations?.observe(name, payload); replies.observe(name, payload); background?.observe(name, payload); },
    log: (...args) => console.error("[timewarp]", ...args),
  });
  // Chat titles and the memory writer run in the background on a small model (memory-writer.cjs).
  background = (() => {
    const { createBackgroundRunner, createTitles, createMemoryWriter } = require("./memory-writer.cjs");
    const { titleFrom } = require("./harness.cjs");
    const backgroundLog = (message, details) => appLog.info("background", message, details);
    const runner = createBackgroundRunner({ client, cwd: path.join(runtimeDir, "codex-app-server-cwd"), disabledServers: () => Object.keys(toolServers(0)), log: backgroundLog });
    const titles = createTitles({ store, runner, autoTitle: text => titleFrom(text), notify: (name, payload) => { if (!storeClosed) broadcast(name, payload); }, log: message => appLog.warn("background", message) });
    const writer = createMemoryWriter({
      store, knowledge, runner, userId: () => userId(),
      memoryMode: () => memoryMode(store.settings.get("memory")?.mode), privateMode: () => store.settings.get("privacy")?.mode === "private",
      running: conversationId => { try { return harness.conversations.status(conversationId).running; } catch { return false; } },
      log: message => appLog.warn("background", message),
    });
    return { observe: (name, payload) => { titles.observe(name, payload); writer.observe(name, payload); }, stop: () => writer.stop() };
  })();
  automations = createAutomations({ store, harness, userId: () => userId(), notify: broadcast, log: (...args) => console.error("[timewarp]", ...args) });
  automationTools = require("./automation-tools.cjs").createAutomationTools({ automations });
  // The browser, vault, automation and chat tools for every agent thread, workers
  // included. A call acts for the chat its thread (or its parent) belongs to.
  const automationSpecs = require("./automation-tools.cjs").toolSpecs;
  const chatTools = require("./chat-tools.cjs").createChatTools({ store, userId: () => userId() });
  toolServer = createToolServer({
    token: toolsToken,
    servers: {
      timewarp_browser: { title: "Timewarp browser", instructions: browserTools.specs()[0].description, specs: browserTools.specs, call: browserTools.call, readOnly: new Set(["tabs", "snapshot", "read", "screenshot", "wait"]) },
      timewarp_vault: { title: "Timewarp vault", instructions: vaultTools.specs()[0].description, specs: vaultTools.specs, call: vaultTools.call, readOnly: new Set(["list"]) },
      timewarp_automations: { title: "Timewarp automations", instructions: automationSpecs()[0].description, specs: automationSpecs, call: automationTools.call, readOnly: new Set(["list"]) },
      timewarp_chats: { title: "Timewarp chats", instructions: chatTools.specs()[0].description, specs: chatTools.specs, call: chatTools.call, readOnly: new Set(["search_conversations", "search_messages", "read_conversation"]) },
    },
    resolve: (threadId, rootThreadId) => {
      const conversationId = harness.conversationFor(threadId) || harness.conversationFor(rootThreadId);
      const conversation = conversationId && store.conversations.get(conversationId);
      if (!conversation || !userId() || conversation.ownerId !== userId()) throw Object.assign(new Error("This tool is unavailable here."), { status: 404 });
      return { conversationId, agent: store.agents.get(conversation.agentId) };
    },
  });

  // App and MCP server sign-ins open in an app window that uses the default
  // browser profile, as in the previous app, so a site signed in there is
  // signed in for the agent's browser too. It closes when the sign-in returns
  // to Timewarp's callback on this computer.
  function openConnector(link, title = "Connect an app") {
    let url;
    try { url = new URL(link); } catch { throw new Error("The sign-in link isn't valid."); }
    if (url.protocol !== "https:" || url.username || url.password) throw new Error("The sign-in link isn't valid.");
    const session = browser.sessionFor(store.browserProfiles.ensureDefault().id);
    const window = new BrowserWindow({
      parent: mainWindow || undefined, width: 560, height: 780, minWidth: 420, minHeight: 560, title, icon: appIcon, autoHideMenuBar: true, backgroundColor: "#ffffff", show: false,
      webPreferences: { session, sandbox: true, contextIsolation: true, nodeIntegration: false, webviewTag: false },
    });
    const loopback = address => { try { return ["127.0.0.1", "localhost", "[::1]"].includes(new URL(address).hostname); } catch { return false; } };
    const web = address => { try { return ["https:", "http:"].includes(new URL(address).protocol); } catch { return false; } };
    window.once("ready-to-show", () => window.show());
    // The title bar always names the site being signed in to, as the previous
    // app's sign-in panel showed its address; pages can't change it.
    const showAddress = () => { if (window.isDestroyed()) return; try { window.setTitle(`${title} — ${new URL(window.webContents.getURL()).host}`); } catch { window.setTitle(title); } };
    window.on("page-title-updated", event => event.preventDefault());
    window.webContents.on("did-navigate", showAddress);
    window.webContents.on("did-navigate-in-page", showAddress);
    window.webContents.setWindowOpenHandler(({ url: next }) => web(next) && new URL(next).protocol === "https:"
      ? { action: "allow", overrideBrowserWindowOptions: { parent: window, autoHideMenuBar: true, webPreferences: { session, sandbox: true, contextIsolation: true, nodeIntegration: false } } }
      : { action: "deny" });
    window.webContents.on("will-navigate", (event, next) => { if (!web(next)) event.preventDefault(); });
    window.webContents.on("did-navigate", (_event, next) => {
      if (!loopback(next)) return;
      appLog.info("connector", "Sign-in returned to Timewarp");
      setTimeout(() => { if (!window.isDestroyed()) window.close(); }, 1500);
    });
    window.webContents.on("did-fail-load", (_event, code, description, next, isMainFrame) => { if (isMainFrame && code !== -3) appLog.warn("connector", "The sign-in page didn't load", { code, description, origin: (() => { try { return new URL(next).origin; } catch { return null; } })() }); });
    appLog.info("connector", "Sign-in window opened", { origin: url.origin });
    void window.loadURL(url.href);
    return { opened: true };
  }
  // The end-to-end check of a preview build answers the command confirmation;
  // other builds always ask.
  const mcp = createMcp({ client, openExternal: url => openConnector(url, "Sign in to a server"), notify: broadcast, ...(fixture && process.env.TIMEWARP_FIXTURE_CONFIRM === "allow" ? { confirmCommand: async () => true } : {}) });

  async function registerTools(force = false) {
    if (!userId() || (toolsRegistered && !force)) return;
    // The bridge may have moved to a free port (the previous app holds the usual
    // one), so Codex gets the port only once the bridge is listening.
    await bridgeReady;
    for (const [name, value] of Object.entries(toolServers(bridge.port))) await client.request("config/value/write", { keyPath: "mcp_servers." + name, value, mergeStrategy: "replace" });
    await client.request("config/mcpServer/reload", undefined);
    toolsRegistered = true;
  }
  // Skill folders the previous app kept connected stay available.
  async function connectLegacySkills() {
    const extraRoots = knowledge.legacySkillRoots();
    if (extraRoots.length) await client.request("skills/extraRoots/set", { extraRoots });
  }
  // Plugin skills from the previous app that drive its browser command, vault
  // and memory writer are turned off once; Timewarp's own tools and memory do
  // that work. The user can turn them on again in Settings → Skills.
  async function retireReplacedSkills() {
    if (store.settings.get("replacedSkillsRetired")) return;
    const listed = await client.request("skills/list", {});
    for (const skill of (listed.data || []).flatMap(entry => entry.skills || [])) {
      // Plugin skills are named "plugin:skill".
      const name = String(skill.name).split(":").pop();
      if (REPLACED_SKILLS.includes(name) && /[\\/]plugins[\\/]cache[\\/]/.test(skill.path) && skill.enabled !== false) await client.request("skills/config/write", { path: skill.path, enabled: false });
    }
    store.settings.set("replacedSkillsRetired", true);
  }

  async function accountReady() {
    const account = userId();
    if (!account) { history?.stop(); history = null; historyStatus = { state: "signed-out" }; return; }
    if (!history) {
      history = require("../../desktop/local-history.cjs").createLocalHistory({
        ...adapter, userId: () => userId(), cloud: services.cloudJson,
        onStatus: state => { historyStatus = state; broadcast("history.status", state); },
        onError: () => console.error("[timewarp] Chat history sync is pending; local chats are preserved."),
      });
    }
    try { importLegacyVault({ store, vault, decrypt: cipher.decrypt, runtimeDir, log: (...args) => console.error("[timewarp]", ...args) }); }
    catch (error) { appLog.warn("vault", "The previous vault could not be imported: " + error.message); }
    // The previous app's memory (its Git store), once per user (legacy-memory.cjs).
    try { require("./legacy-memory.cjs").importLegacyMemory({ runtimeDir, userId: account, knowledge, settings: store.settings, log: message => appLog.info("memory", message) }); }
    catch (error) { appLog.warn("memory", "The previous app's memory could not be imported: " + error.message); }
    // Tools first: Codex keeps the previous run's bridge address until they're registered.
    toolsReady = registerTools().catch(error => appLog.warn("tools", "Connected-app tools are pending; refresh Tools to retry. " + error.message));
    void connectLegacySkills().catch(() => console.error("[timewarp] Previously connected skill folders are unavailable."));
    void retireReplacedSkills().catch(error => appLog.warn("skills", "Replaced skills could not be turned off: " + error.message));
    await history.sync();
    agents.assignMascots();
    agents.prepareWorkspaces();
    await selectModel().catch(() => console.error("[timewarp] The default model could not be updated."));
    if (fixture && !process.env.TIMEWARP_FIXTURE_ONBOARDING) await onboarding.skip();
    // Accounts past setup get the sandbox setup they would have had in it;
    // others get it in setup's knowledge step, as before.
    void onboarding.done().then(done => sandbox.ensure({ setup: done })).then(sandboxChanged)
      .catch(error => appLog.warn("sandbox", "The Windows sandbox couldn't be set up: " + error.message));
  }

  async function diagnostics() {
    let codexVersion = null;
    try { codexVersion = JSON.parse(fs.readFileSync(path.join(vendor, "codex-package.json"), "utf8")).version || null; } catch {}
    const owner = userId();
    const sandboxState = process.platform === "win32" ? await sandbox.status().catch(error => ({ error: error.message })) : null;
    const servers = owner ? await mcp.list().catch(() => []) : [];
    return {
      createdAt: new Date().toISOString(),
      app: { version: VERSION, profile: build.profile || null, appId: build.appId || null, releaseUpdates: !!build.release?.enabled, packaged: app.isPackaged },
      runtime: { electron: process.versions.electron, chrome: process.versions.chrome, node: process.versions.node, codex: codexVersion },
      system: { platform: process.platform, arch: process.arch, release: require("node:os").release(), memoryGb: Math.round(require("node:os").totalmem() / 1e9) },
      state: {
        signedIn: !!owner, codex: client.status, history: historyStatus.state, sandbox: sandboxState?.status || sandboxState?.error || null,
        agents: owner ? store.agents.list(owner).length : 0, conversations: owner ? store.conversations.list(owner).length : 0,
        automations: owner ? store.automations.list(owner).length : 0,
        mcpServers: servers.map(server => ({ transport: server.transport, enabled: server.enabled, tools: server.tools, failed: !!server.error })),
      },
      log: appLog.tail(200).length ? appLog.tail(200) : recentLog.slice(-200),
    };
  }
  const defaultAppearance = () => ({ scheme: "system", accent: defaultAccent, radiance: 0.5, texture: { type: "dots", step: 0 } });
  // Browser profile import arrives with the profile importer.
  const browserImport = require("./browser-import.cjs").createBrowserImport({ store });
  // Setup can import saved passwords the same way Settings → Vault does.
  onboarding = createOnboarding({ profile, store, services, agents, knowledge, browserImport, importPasswords: () => methods["vault.importPasswords"](), dialog, shell, defaultAppearance });

  const methods = require("./methods.cjs").createMethods({
    app, dialog, shell, store, services, agents, harness, client, guard, browser, version: VERSION, profile, runtimeDir,
    modelChoices, selectModel, registerTools, historyStatus: () => historyStatus, flushHistory: () => history?.sync(), defaultAppearance, knowledge, onboarding, automations, mcp, codexHome, vault, clipboard, diagnostics, logs: appLog, openConnector, previousSessionUnclean, browserImport, browserTools, sandbox,
  });
  if (fixture) methods["debug.browserFrame"] = ({ conversationId }) => browser.inspect(conversationId);
  if (fixture) methods["debug.diagnostics"] = () => diagnostics();
  // The window frame and native dialogs follow a theme change at once; reading
  // a chat clears its reply notification and the unread badge.
  const setSetting = methods["settings.set"], markRead = methods["conversations.markRead"];
  methods["settings.set"] = async (input, event) => {
    const value = await setSetting(input, event);
    if (input?.key === "appearance") applyThemeSource(value?.scheme);
    return value;
  };
  methods["conversations.markRead"] = async (input, event) => {
    const value = await markRead(input, event);
    replies.read(input?.id);
    return value;
  };
  // Chats loaded on the previous funding provider are unloaded, so their next
  // message resumes them on the current one; open screens reload models.
  function fundingChanged() {
    void Promise.resolve(harness?.unloadIdle?.()).catch(error => appLog.warn("funding", "Chats could not be reloaded: " + error.message));
    broadcast("funding.changed", {});
  }
  const legacy = require("./legacy-requests.cjs").createLegacyRequests({ services, harness, guard, version: VERSION, selectModel, onFundingChanged: fundingChanged, registerTools, historyStatus: () => historyStatus, onboarding: onboarding.service, openConnector, sandbox });
  const trusted = event => event.senderFrame && event.senderFrame === event.sender.mainFrame && event.senderFrame.url.startsWith("app://app/");
  ipcMain.handle("tw:call", async (event, method, input) => {
    if (!trusted(event)) return { ok: false, error: { message: "Untrusted window.", status: 403 } };
    const handler = Object.hasOwn(methods, method) ? methods[method] : null;
    if (!handler) return { ok: false, error: { message: "Unknown action.", status: 404 } };
    try { trace("call " + method); await services.ready; const value = await handler(input ?? {}, event); trace("answered " + method); return { ok: true, value }; }
    catch (error) { return { ok: false, error: { message: error.message || "Request failed.", status: error.status || 500 } }; }
  });
  ipcMain.handle("timewarp:request", async (event, action, input = {}) => {
    if (!trusted(event)) throw new Error("Untrusted window.");
    trace("request " + action);
    await Promise.all([services.ready, bridgeReady.catch(() => {})]);
    const value = await legacy(action, input, event);
    trace("answered " + action);
    return value;
  });

  trace("services wired");
  markBooted();
  automations.start();
  createWindow();
  // After the window exists: on Windows a window without a title bar only gets
  // the menu's shortcuts when the menu is set once it's open.
  applicationMenu();
  trace("window created");
  await services.ready.catch(() => {});
  trace("account storage ready");
  await accountReady().catch(error => console.error("[timewarp] Account startup failed:", error.message));
  trace("account ready");
  require("../../desktop/updates.cjs").configureUpdates({
    app, autoUpdater: require("electron-updater").autoUpdater, release: build.release || { enabled: false },
    logger: { info: (...args) => appLog.info("updater", args.join(" ")), warn: (...args) => appLog.warn("updater", args.join(" ")), error: (...args) => appLog.error("updater", args.map(value => value?.message || value).join(" ")), log: (...args) => appLog.info("updater", args.join(" ")) },
    readUpdateConfig: () => require("js-yaml").load(fs.readFileSync(path.join(process.resourcesPath, "app-update.yml"), "utf8")),
    // A notification first, as in the previous app; clicking it asks to restart.
    // Agents still working are mentioned, so a restart doesn't cut a run short.
    notify: install => {
      if (updateNotice) return;
      const prompt = () => {
        const working = userId() ? store.conversations.list(userId()).filter(item => { try { return harness.conversations.status(item.id).running; } catch { return false; } }).length : 0;
        void dialog.showMessageBox(mainWindow || undefined, {
          type: "info", title: "Timewarp update", message: "An update is ready. Restart Timewarp to install it.",
          detail: working ? "An agent is still working. Restarting stops it." : undefined,
          buttons: ["Restart and install", "Later"], defaultId: 1, cancelId: 1, noLink: true,
        }).then(result => { if (result.response === 0) install(); else updateNotice = null; }).catch(() => {});
      };
      if (!Notification.isSupported()) return prompt();
      updateNotice = new Notification({ title: "Timewarp update ready", body: "Click to restart and install the verified update." });
      updateNotice.on("click", prompt);
      updateNotice.show();
    },
  });
  app.on("will-quit", () => { appLog.info("shutdown", "Timewarp quit"); try { fs.rmSync(sessionMarker, { force: true }); } catch {} });
  // Quitting waits (a few seconds at most) for Codex to stop and chat history
  // to save, then closes the database, so nothing writes to it once closed.
  // An update's installer starts as Timewarp quits, so that quit doesn't wait.
  let quitting = false, installing = false;
  try { require("electron").autoUpdater.on("before-quit-for-update", () => { installing = true; }); } catch {}
  app.on("before-quit", event => {
    if (storeClosed) return;
    if (installing) {
      appLog.info("shutdown", "Quitting to install an update");
      background?.stop(); automations.stop(); browser.destroy(); guard.stop?.(); history?.stop(); services.close(); bridge.close(); void client.stop();
      storeClosed = true;
      try { store.close(); } catch {}
      return;
    }
    event.preventDefault();
    if (quitting) return;
    quitting = true;
    appLog.info("shutdown", "Quitting");
    replies.clear(); background?.stop();
    automations.stop(); browser.destroy(); clearTimeout(executionNotice); guard.stop?.();
    const within = (promise, ms) => Promise.race([Promise.resolve(promise).catch(() => {}), new Promise(resolve => setTimeout(resolve, ms))]);
    void (async () => {
      await within(history?.sync(), 2000);
      history?.stop(); services.close(); bridge.close();
      await within(client.stop(), 3000);
      storeClosed = true;
      try { store.close(); } catch {}
      app.quit();
    })();
  });
}
let updateNotice = null;
// Errors nothing else caught are logged rather than lost.
process.on("uncaughtException", error => appLog?.error("main", "Uncaught error: " + (error?.stack || error?.message || error)));
process.on("unhandledRejection", reason => appLog?.error("main", "Unhandled rejection: " + (reason?.stack || reason?.message || reason)));

if (!app.requestSingleInstanceLock()) app.exit(0);
else {
  app.on("second-instance", () => focusApp());
  app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
  app.on("activate", () => { if (!mainWindow) createWindow(); });
  app.whenReady().then(boot).catch(error => {
    console.error("[timewarp] Timewarp failed to start:", error);
    dialog.showErrorBox("Timewarp could not start", String(error?.message || error));
    app.exit(1);
  });
}
