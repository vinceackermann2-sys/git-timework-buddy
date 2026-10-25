"use strict";
// Timewarp desktop main process.
const { app, BrowserWindow, Menu, Notification, ipcMain, nativeImage, nativeTheme, net, protocol, session, shell, dialog, safeStorage, clipboard } = require("electron");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { bindWindowZoom } = require("./window-zoom.cjs");

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
let windowZoom = null; // the main window's zoom (window-zoom.cjs)
let pane = null; // the browser pane's pages, once boot has them
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
  // A window smaller than the screen shows the maximized layout, scaled down
  // to fit (window-zoom.cjs); the pane's pages zoom with it.
  const window = mainWindow;
  windowZoom = bindWindowZoom(window, {
    screen: require("electron").screen,
    onFit: fit => pane?.setPageFit(fit),
    onZoom: factor => { pane?.zoomChanged(); window.webContents.send("tw:event", "window.zoom", { factor }); },
  });
  mainWindow.on("closed", () => { mainWindow = null; windowZoom = null; });
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

// Ctrl/⌘ +, - and 0 zoom the page that has the focus: a page in the pane, the
// app (on top of its fit to the window) or a sign-in window's page.
function zoomFocused(direction) {
  const contents = require("electron").webContents.getFocusedWebContents();
  if (contents && pane?.zoomPage(contents, direction)) return;
  if (windowZoom && mainWindow && (!contents || contents === mainWindow.webContents)) { windowZoom.step(direction); return; }
  if (contents && !contents.isDestroyed()) contents.zoomLevel = direction ? contents.zoomLevel + direction * 0.5 : 0;
}

// The menu holds the keyboard shortcuts on every platform, as in the previous
// app: zoom (Ctrl/⌘ +, -, 0), full screen and editing. On Windows it isn't
// shown; the title bar is hidden. Ctrl/⌘+W is handled by the window instead.
function applicationMenu() {
  const openSettings = () => openRoute("#/customize/settings");
  const view = { label: "View", submenu: [
    { label: "Actual Size", accelerator: "CommandOrControl+0", click: () => zoomFocused(0) },
    { label: "Zoom In", accelerator: "CommandOrControl+Plus", click: () => zoomFocused(1) },
    { label: "Zoom In", accelerator: "CommandOrControl+=", visible: false, acceleratorWorksWhenHidden: true, click: () => zoomFocused(1) },
    { label: "Zoom Out", accelerator: "CommandOrControl+-", click: () => zoomFocused(-1) },
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
  const { createToolServer, mcpResult } = require("./tool-server.cjs");
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
  const { createAgentIds, createAutomationSync, agentIdApi } = require("./agent-id.cjs");
  const { createAgentIdTools } = require("./agent-id-tools.cjs");
  const { protectedStore } = require("../../desktop/protected-store.cjs");
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
  // The signed-in account's agents, memory, settings and the like on its other computers (account-sync.cjs).
  let accountSync = null, accountSyncStatus = { state: "starting" };
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
      // again, in the next account's own Codex home, for its first request.
      // Its browser tabs, reply notifications and sync stop too, and the
      // window takes the next account's appearance.
      if (changedUser) {
        sandboxArmed = false;
        accountSync?.stop(); accountSync = null;
        await client.stop().catch(() => {}); harness.reset(); toolsRegistered = false; agentIdTools.reset();
        // Signed out, the Agent ID window's website session goes too.
        if (services.auth.user()) agentIdWindows.close(); else await agentIdWindows.forget(path.join(app.getPath("userData"), "Partitions"));
        browser.closeAll(); replies.clear();
        applyThemeSource(store.settings.get("appearance")?.scheme);
      }
      await accountReady();
      broadcast("account.changed", { signedIn: !!services.auth.user() });
    },
    onCodexConnected: async () => { await booted; services.funding.invalidate(); await selectModel().catch(() => console.error("[timewarp] The default model could not be updated.")); fundingChanged(); },
    // An app just connected or removed: the next message names the agent's accounts afresh.
    onIntegrationsChanged: () => { void booted.then(() => appAccounts.clear()); },
  });
  userId = () => services.auth.userId();

  // Each account keeps its own data on this computer (accounts.cjs): the
  // settings that are its own, its browser profiles, and its own Codex home
  // and memory folder. The account that owns the computer's earlier data is
  // decided the first time someone signs in.
  const { createAccounts, ACCOUNT_SETTINGS } = require("./accounts.cjs");
  const accounts = createAccounts({ store, runtimeDir });
  const signedInAccount = () => { const id = userId(); if (id) accounts.claim(id); return id; };
  store.settings.scopeTo(signedInAccount, ACCOUNT_SETTINGS);
  store.browserProfiles.scopeTo(signedInAccount, () => accounts.legacyOwner());
  const accountPaths = () => accounts.paths(userId());
  // The signed-in account's Codex home, made when Codex first starts in it.
  const codexHome = () => accountPaths().codexHome;
  let onboarding = null;
  // The signed-in account's memory and skills, whichever module asks: each
  // account's are read from its own folders.
  const knowledgeHome = fixture ? { home: fixture.sampleHome(path.join(profile, "preview-home")), env: {} } : {};
  const knowledgeOf = new Map();
  const accountKnowledge = () => {
    const id = userId() || "";
    if (!knowledgeOf.has(id)) {
      const { codexHome: home, memoriesRoot } = accountPaths();
      knowledgeOf.set(id, createKnowledge({
        runtimeDir, codexHome: home, memoriesRoot, previousApp: !!id && id === accounts.legacyOwner(),
        cursorRoot: () => store.settings.get("cursorRoot") || onboarding?.service.cursorRoot(), ...knowledgeHome,
      }));
    }
    return knowledgeOf.get(id);
  };
  const knowledge = new Proxy({}, { get: (_target, name) => accountKnowledge()[name] });
  fs.mkdirSync(path.join(runtimeDir, "codex-app-server-cwd"), { recursive: true });
  // The local endpoint Codex uses for Timewarp models and connected apps.
  // Sending, paying and deleting in connected apps wait for the user's card (connectedAppGate, below).
  let connectedAppGate = null;
  const bridge = createModelBridge({ token: bridgeToken, cloud: services.cloud, cloudSafe: services.cloudSafe, funding: services.funding, chatgpt: services.chatgpt, integrations: services.integrations, mascots: require("../../desktop/mascots.cjs"), toolServer: () => toolServer, gate: call => connectedAppGate ? connectedAppGate(call) : { isError: true, content: [{ type: "text", text: "Timewarp is still starting; try again in a moment." }] } });
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
      // Codex runs in the signed-in account's own home (accounts.cjs).
      const home = codexHome();
      fs.mkdirSync(home, { recursive: true });
      Object.assign(client.env, { CODEX_HOME: home }, codexEnv(vendor, probed ? { ...process.env, PATH: mergePath(process.env.PATH, probed) } : process.env, { home }));
      // Sign-ins are found where the previous app kept them: installed builds
      // use the system keyring and also read the Codex home's file, development
      // builds a file only. The keyring keeps an MCP server's sign-in by the
      // server's name and address, not by Codex home, so every account but
      // the one that owns the earlier data keeps those in its own home's file:
      // two accounts adding the same server never share its sign-in.
      const credentials = app.isPackaged ? "auto" : "file";
      const serverCredentials = client.mcpCredentials = userId() && userId() !== accounts.legacyOwner() ? "file" : credentials;
      return [
        "-c", `cli_auth_credentials_store="${credentials}"`, "-c", `mcp_oauth_credentials_store="${serverCredentials}"`,
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
    // CODEX_HOME and PATH are set as Codex starts (args above).
    env: {
      TIMEWARP_BRIDGE_TOKEN: bridgeToken, TIMEWARP_COMPOSIO_TOKEN: mcpToken, TIMEWARP_TOOLS_TOKEN: toolsToken,
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
  // MCP servers sync once Codex runs (account-sync.cjs mcpServers).
  client.on("status", state => { if (state.status === "ready") accountSync?.soon(); });
  // Codex's command sandbox (sandbox.cjs): set up and checked by itself once
  // an account is signed in, and checked again whenever Codex starts again.
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
    if (userId()) prepareTools();
    else await client.start().catch(() => {});
  }
  fs.mkdirSync(path.join(runtimeDir, "agents"), { recursive: true });
  const sandbox = createSandbox({
    client, settings: store.settings, cwd: path.join(runtimeDir, "agents"), restart: restartCodex, codexVersion,
    log: (level, message, data) => appLog[level === "warn" ? "warn" : "info"]("sandbox", message, data),
  });
  const sandboxChanged = state => { broadcast("sandbox.changed", state); return state; };
  // Armed once the signed-in account is ready (accountReady), so a setup's
  // restart doesn't cut short the work its first Codex start does.
  let sandboxArmed = false;
  const ensureSandbox = () => sandbox.ensure().then(sandboxChanged)
    .catch(error => appLog.warn("sandbox", "The Windows sandbox couldn't be set up: " + error.message));
  // A Codex that started again (a restart or a crash) is checked again, so
  // its commands stay sandboxed and apply_patch works again.
  client.on("status", state => { if (state.status === "ready" && sandboxArmed && userId()) void ensureSandbox(); });
  // Screens that show a chat's run (executionStatus) reload when it changes.
  // The guard reports every step of a turn; a run whose state (all but its
  // running time) is as last sent isn't sent again.
  let executionNotice = null, executionSent = "[]";
  const executionThreads = new Set(); // chats' threads with a turn in this Codex run
  const executionChanged = () => {
    if (executionNotice) return;
    executionNotice = setTimeout(() => {
      executionNotice = null;
      const state = JSON.stringify(guard.snapshot([...executionThreads]).map(({ durationMs, ...run }) => run));
      if (state === executionSent) return;
      executionSent = state;
      for (const window of appWindows()) window.webContents.send("timewarp:executionChanged");
      broadcast("execution.changed", {});
    }, 200);
    executionNotice.unref?.();
  };
  client.on("notification", ({ method, params }) => { if (method === "turn/started" && harness?.conversationFor(params.threadId)) executionThreads.add(params.threadId); });
  client.on("status", state => { if (["stopped", "failed"].includes(state.status)) executionThreads.clear(); });
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
      + item.accounts.map(account => account.displayName + (account.email && account.email !== account.displayName ? ` <${account.email}>` : "") + (account.authStatus === "ready" ? "" : " (needs reconnecting)")).join(", "));
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

  const browser = createBrowser({ window: () => mainWindow, store, notify: broadcast, log: appLog, zoom: () => mainWindow?.webContents.getZoomFactor() ?? 1 });
  pane = browser;
  if (windowZoom) browser.setPageFit(windowZoom.fit());
  // A click or Enter in a page that sends, pays or deletes asks on a card in the chat (confirmInChat, below).
  const browserTools = createBrowserTools({ browser, onActivity: (conversationId, action) => broadcast("browser.agent", { conversationId, action }), confirm: (conversationId, card) => confirmInChat(conversationId, card) });
  // Raise when the tool set changes: chats then continue in a new thread.
  const cipher = safeStorageCipher(safeStorage);
  const vault = createVault({ store, cipher, userId: () => userId() });
  // Each agent's Agent ID, its key encrypted on this computer (agent-id.cjs).
  // Preview builds answer it themselves, or use a local Agent ID (scripts/
  // agent-id-dev.cjs) with one of its session tokens, and its local website.
  const localAgentId = fixture && process.env.TIMEWARP_FIXTURE_AGENT_ID_URL ? { base: process.env.TIMEWARP_FIXTURE_AGENT_ID_URL, token: process.env.TIMEWARP_FIXTURE_AGENT_ID_TOKEN || "", site: process.env.TIMEWARP_FIXTURE_AGENT_ID_SITE || "http://localhost:8093" } : null;
  const agentIdRequest = localAgentId ? agentIdApi({ config, base: localAgentId.base, auth: { accessToken: async () => localAgentId.token } })
    : fixture ? fixture.agentId : agentIdApi({ config, auth: services.auth });
  const agentIdSite = localAgentId?.site || "https://timewarpdev.com";
  // The owner's own Agent ID pages, in a window no agent reaches (agent-id-window.cjs).
  const agentIdWindows = require("./agent-id-window.cjs").createAgentIdWindows({
    BrowserWindow, session, dialog, icon: appIcon, userId: () => userId(), request: agentIdRequest, site: agentIdSite, supabaseUrl: config.supabaseUrl, loopback: !!fixture,
    onClosed: () => broadcast("agentId.changed", {}), log: (message, detail) => appLog.warn("agent-id", message, { detail }),
  });
  const agentIds = createAgentIds({
    request: agentIdRequest,
    storage: protectedStore(path.join(profile, "agent-ids.bin"), safeStorage), encryption: safeStorage,
    agents, userId: () => userId(), openPage: url => agentIdWindows.open(url), site: agentIdSite, log: (message, detail) => appLog.warn("agent-id", message, { detail }),
  });
  // Each agent's own Agent ID as tools in its chats (agent-id-tools.cjs).
  const agentIdToolsFile = path.join(profile, "agent-id-tools.json");
  const agentIdTools = createAgentIdTools({
    request: agentIdRequest, agentIds, version: VERSION,
    cache: { load: () => JSON.parse(fs.readFileSync(agentIdToolsFile, "utf8")), save: value => fs.writeFileSync(agentIdToolsFile, JSON.stringify(value)) },
    modelOf: conversationId => store.conversations.get(conversationId)?.modelSettings?.name || store.settings.get("modelSettings")?.name || null,
    // Sending, paying and deleting ask on a card in the chat (confirmInChat, below).
    confirm: (conversationId, card) => confirmInChat(conversationId, card),
    log: (message, detail) => appLog.warn("agent-id", message, { detail }),
  });
  void agentIdTools.refresh();
  const vaultTools = createVaultTools({
    vault, browserTools,
    // A card in the chat, as for sending and paying; a dialog only outside a chat.
    ask: async (message, detail, card) => {
      if (card?.conversationId) {
        const { conversationId, ...question } = card;
        return (await confirmInChat(conversationId, question)).decision === "accept";
      }
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
  // Set up with the tool servers below; it follows what working chats are doing.
  let teamTools = null;
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
    store, client, userId: () => userId(), instructionsFor, tools, permissions: PERMISSIONS, toolsReady: () => toolsReady || prepareTools(),
    // Each chat's workers learn which agent they work for (connected apps need its ID).
    threadConfig: agent => agentThreadConfig(workerInstructions(agent)),
    baseInstructions: BASE_INSTRUCTIONS, turnContext,
    // The agent's workspace and Codex's skills folder, and the memory folder while memory may be written.
    workspaceRoots: agent => workspaceRoots(agent.workspace, { skills: knowledge.skillsRoot, memories: knowledge.memoriesRoot, memoryWrite: ["enabled", "write"].includes(memoryMode(store.settings.get("memory")?.mode)) }),
    modelSettings: () => store.settings.get("modelSettings"),
    // Automatic review unless the user chose to be asked (Settings → General).
    approvalsReviewer: () => process.env.TIMEWARP_APPROVALS_REVIEWER || (store.settings.get("preferences")?.approvals === "ask" ? "user" : "auto_review"),
    // An agent's connected apps load as its chat opens or its first message is written.
    prepareContext: agent => { void connectedApps(agent); },
    // What Codex reads as a thread starts besides its settings: its config
    // (MCP servers, skills turned off), instructions for every agent and the
    // agent's own, and the skill folders.
    spareInputs: agent => [path.join(codexHome(), "config.toml"), path.join(codexHome(), "AGENTS.md"), path.join(agent.workspace, "AGENTS.md"), knowledge.skillsRoot, path.join(agent.workspace, ".agents", "skills")]
      .map(file => { try { const stat = fs.statSync(file); return stat.mtimeMs + ":" + stat.size; } catch { return "-"; } }).join(" "),
    // Late Codex events during quit find the database closed: they're dropped.
    notify: (name, payload) => { if (storeClosed) return; broadcast(name, payload); automations?.observe(name, payload); replies.observe(name, payload); background?.observe(name, payload); teamTools?.observe(name, payload); },
    log: (...args) => console.error("[timewarp]", ...args),
    // Approvals, questions and app forms in chats: kind, app, timing and outcome, never their text or answers.
    record: (level, message, facts) => appLog[level === "warn" ? "warn" : "info"]("request", message, facts),
    // Codex asking before a connected app or Agent ID action that Timewarp's own card asks about.
    answerFor: (method, params) => method === "mcpServer/elicitation/request" && require("./approvals.cjs").asksItself(params) ? { action: "accept", content: null, _meta: null } : null,
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
  // Automations show on each agent's Agent ID, and its website's requests come back here (agent-id.cjs).
  let automationSync = null;
  automations = createAutomations({ store, harness, userId: () => userId(), notify: (name, payload) => { broadcast(name, payload); if (name === "automations.changed") automationSync?.changed(); }, log: (...args) => console.error("[timewarp]", ...args) });
  automationSync = createAutomationSync({ request: agentIdRequest, automations, userId: () => userId(), log: (message, detail) => appLog.warn("agent-id", message, { detail }) });
  automationTools = require("./automation-tools.cjs").createAutomationTools({ automations, confirm: (conversationId, card) => confirmInChat(conversationId, card) });
  // The browser, vault, automation and chat tools for every agent thread, workers
  // included. A call acts for the chat its thread (or its parent) belongs to.
  const automationSpecs = require("./automation-tools.cjs").toolSpecs;
  const chatTools = require("./chat-tools.cjs").createChatTools({ store, userId: () => userId() });
  // Agents messaging and asking each other's chats while they work (team-tools.cjs).
  teamTools = require("./team-tools.cjs").createTeamTools({ store, harness, userId: () => userId() });
  // Timewarp itself for agents (app-tools.cjs): usage, settings and the app's
  // state to read; a setting changes only through the card the user answers.
  // When Timewarp isn't in front, a notification points to the card.
  const cardNotices = new Set();
  const confirmInChat = (conversationId, card) => {
    const asked = harness.confirm(conversationId, card);
    const focused = BrowserWindow.getAllWindows().some(window => !window.isDestroyed() && window.isVisible() && window.isFocused());
    if (!focused && Notification.isSupported()) {
      try {
        const notice = new Notification({ title: String(card.agent || "Timewarp").slice(0, 120), body: `${card.title} Open the chat to answer.` });
        const drop = () => { cardNotices.delete(notice); try { notice.close(); } catch {} };
        notice.on("click", () => { drop(); openRoute("#/conversation/" + encodeURIComponent(conversationId)); });
        notice.on("failed", drop);
        cardNotices.add(notice);
        void asked.finally(drop);
        notice.show();
      } catch (error) { appLog.warn("notifications", "A card notification couldn't be shown: " + error.message); }
    }
    return asked;
  };
  // A connected app's action that sends, pays or deletes runs only after the
  // user's OK on a card written from its own arguments (approvals.cjs),
  // even when the user asked for it.
  const approvals = require("./approvals.cjs");
  connectedAppGate = async ({ conversationId, agent, arguments: args }) => {
    const kind = approvals.composioKind(args.toolSlug, args.arguments || {});
    if (!kind) return null;
    let account = null;
    try {
      const apps = (await services.integrations.list({}))?.items || [];
      const found = apps.flatMap(app => app.accounts || []).find(item => item.id === args.connectedAccountId);
      account = found?.email || found?.displayName || null;
    } catch {}
    const answer = await confirmInChat(conversationId, approvals.composioCard({ slug: args.toolSlug, args: args.arguments || {}, kind, agent: agent?.name, account }));
    return answer.decision === "accept" ? null : mcpResult(approvals.refusal(answer, kind));
  };
  const appTools = require("./app-tools.cjs").createAppTools({
    store, harness, userId: () => userId(),
    // What the sidebar's usage card shows (methods.cjs funding.get), with the
    // ChatGPT plan's usage windows when AI runs on it.
    usage: async () => {
      const state = await methods["funding.get"]();
      const chatgpt = state.source === "chatgpt" ? await services.chatgpt.refresh().then(() => services.chatgpt.details(), () => services.chatgpt.details()) : null;
      const { planUsage = null, ...funding } = state;
      return { funding, planUsage, chatgpt };
    },
    settings: {
      // With the appearance's defaults, as Settings → General reads it, so a theme change keeps the rest.
      read: () => { const all = store.settings.all(); return { ...all, appearance: all.appearance || defaultAppearance() }; },
      // As Settings → General writes them, then the open screens reload them
      // and account sync carries them.
      write: async (key, value) => {
        if (key === "modelSettings") await methods["models.select"](value);
        else await methods["settings.set"]({ key, value });
        broadcast("settings.changed", { key });
        accountSync?.soon();
      },
    },
    models: { choices: () => modelChoices(), choose: (choices, wanted) => require("./model-catalog.cjs").chooseModel(choices, wanted), select: choices => selectModel(choices) },
    status: async () => {
      const sandboxState = await sandbox.status().catch(() => null);
      let update = null;
      try { update = updates.state(); } catch {}
      return {
        version: VERSION, platform: process.platform,
        updates: update ? { status: update.status, ...(update.available ? { available: update.available } : {}) } : null,
        agentRuntime: client.status, commandSandbox: sandboxState?.status || null,
        chatHistorySync: historyStatus.state, accountSync: accountSyncStatus.state,
        privacyMode: store.settings.get("privacy")?.mode === "private",
        chatsWorkingNow: harness.conversations.running().length,
      };
    },
    confirm: confirmInChat,
    // What the other screens do (app_action): MCP servers, new agents, Agent ID.
    mcp: () => mcp, agents, agentIds,
  });
  toolServer = createToolServer({
    token: toolsToken,
    servers: {
      timewarp_browser: { title: "Timewarp browser", instructions: browserTools.specs()[0].description, specs: browserTools.specs, call: browserTools.call, readOnly: new Set(["tabs", "snapshot", "read", "screenshot", "wait"]) },
      timewarp_vault: { title: "Timewarp vault", instructions: vaultTools.specs()[0].description, specs: vaultTools.specs, call: vaultTools.call, readOnly: new Set(["list"]) },
      timewarp_automations: { title: "Timewarp automations", instructions: automationSpecs()[0].description, specs: automationSpecs, call: automationTools.call, readOnly: new Set(["list"]) },
      timewarp_chats: { title: "Timewarp chats", instructions: chatTools.specs()[0].description, specs: chatTools.specs, call: chatTools.call, readOnly: new Set(["search_conversations", "search_messages", "read_conversation"]) },
      timewarp_team: { title: "Timewarp team", instructions: teamTools.specs()[0].description, specs: teamTools.specs, call: teamTools.call, readOnly: new Set(["list_agents"]) },
      timewarp_app: { title: "Timewarp app", instructions: appTools.specs()[0].description, specs: appTools.specs, call: appTools.call, readOnly: new Set(["get_usage", "get_settings", "get_status"]) },
      timewarp_agent_id: { title: "Timewarp Agent ID", specs: agentIdTools.specs, call: agentIdTools.call, readOnly: agentIdTools.readOnly },
    },
    resolve: (threadId, rootThreadId) => {
      const conversationId = harness.conversationFor(threadId) || harness.conversationFor(rootThreadId);
      const conversation = conversationId && store.conversations.get(conversationId);
      if (!conversation || !userId() || conversation.ownerId !== userId()) throw Object.assign(new Error("This tool is unavailable here."), { status: 404 });
      return { conversationId, agent: store.agents.get(conversation.agentId) };
    },
  });

  // ChatGPT, app and MCP server sign-ins open in a Timewarp window
  // (signin-window.cjs), never in the system browser or another app.
  const signin = require("./signin-window.cjs").createSigninWindows({
    BrowserWindow, session: () => browser.sessionFor(store.browserProfiles.ensureDefault().id), parent: () => mainWindow, icon: appIcon, log: appLog,
    logo: (() => { try { return nativeImage.createFromPath(path.join(assetsDir, "app-icon.png")).resize({ width: 96, quality: "best" }).toDataURL(); } catch { return ""; } })(),
    css: (() => { try { return fs.readFileSync(path.join(assetsDir, "auth-bridge.css"), "utf8"); } catch { return ""; } })(),
  });
  function openConnector(link, title = "Connect an app") { signin.open(link, { title }); return { opened: true }; }
  // Codex finishes the sign-in, and Timewarp shows how it went. Closing the
  // window before it comes back stops waiting for it; a new Connect replaces it.
  let chatgptSignin = null;
  function openChatgpt({ authUrl, loginId }) {
    chatgptSignin?.close();
    chatgptSignin = signin.open(authUrl, {
      title: "Connect ChatGPT",
      finish: {
        done: answer => answer.status === 200 && answer.path === "/success",
        pending: { title: "Connecting ChatGPT", message: "Finishing your ChatGPT sign-in…" },
        success: { title: "ChatGPT is connected", message: "Your ChatGPT plan now powers AI in Timewarp.", hint: "This window closes by itself." },
        failure: { title: "ChatGPT couldn't connect", message: "The sign-in didn't finish." },
      },
      onClose: ({ returned }) => { if (!returned) return services.chatgpt.cancelLogin(loginId); },
    });
    return { opened: true };
  }
  // The end-to-end check of a preview build answers the command confirmation;
  // other builds always ask.
  // A server added, removed, turned on or off or signed in to: prepared threads started without it.
  const mcpChanged = (name, payload) => { if (name === "mcp.changed" && (!payload?.name || payload.success)) harness?.discardSpares(); broadcast(name, payload); };
  const mcp = createMcp({
    client, notify: mcpChanged, ...(fixture && process.env.TIMEWARP_FIXTURE_CONFIRM === "allow" ? { confirmCommand: async () => true } : {}),
    openExternal: url => signin.open(url, {
      title: "Sign in to a server",
      finish: {
        done: answer => answer.status === 200,
        pending: { title: "Signing in", message: "Finishing your sign-in to the server…" },
        success: { title: "You're signed in", message: "Return to Timewarp to use the server's tools.", hint: "This window closes by itself." },
        failure: { title: "Sign-in couldn't finish", message: "The server didn't accept the sign-in." },
      },
    }),
  });

  async function registerTools(force = false) {
    if (!userId() || (toolsRegistered && !force)) return;
    // The bridge may have moved to a free port (the previous app holds the usual
    // one), so Codex gets the port only once the bridge is listening.
    await bridgeReady;
    for (const [name, value] of Object.entries(toolServers(bridge.port))) await client.request("config/value/write", { keyPath: "mcp_servers." + name, value, mergeStrategy: "replace" });
    await client.request("config/mcpServer/reload", undefined);
    toolsRegistered = true;
    harness?.discardSpares();
  }
  // Agent tools that couldn't be written to Codex's config are tried again as
  // the next chat starts, without the user refreshing Tools.
  function prepareTools() {
    const attempt = registerTools().catch(error => {
      if (toolsReady === attempt) toolsReady = null;
      appLog.warn("tools", "Agent tools are pending; the next chat tries again. " + error.message);
    });
    return toolsReady = attempt;
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

  // Account sync for the signed-in account (account-sync.cjs): each kind of
  // item read from and written to that account's own folders and settings.
  function startAccountSync() {
    const sync = require("./account-sync.cjs");
    const { SYNCED_SETTINGS } = require("./accounts.cjs");
    const folders = account => accounts.paths(account);
    const log = message => appLog.info("account-sync", message);
    // An uploaded agent picture is made at most 256 pixels across before it's synced.
    const shrinkPicture = dataUrl => {
      try {
        const image = nativeImage.createFromDataURL(dataUrl);
        if (image.isEmpty()) return null;
        const { width, height } = image.getSize(), scale = Math.min(1, 256 / Math.max(width, height));
        const smaller = scale < 1 ? image.resize({ width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)), quality: "best" }) : image;
        const png = smaller.toPNG();
        return png.length < 140 * 1024 ? "data:image/png;base64," + png.toString("base64") : "data:image/jpeg;base64," + smaller.toJPEG(85).toString("base64");
      } catch { return null; }
    };
    const result = sync.createAccountSync({
      store, userId: () => userId(), cloud: (account, route, input) => services.cloudJson(route, input, "POST", { account }),
      // Privacy Mode keeps everything on this computer, as it does chats.
      paused: () => store.settings.get("privacy")?.mode === "private",
      adapters: {
        setting: sync.settingsItems({ settings: store.settings, keys: SYNCED_SETTINGS, onChanged: key => { if (key === "appearance") applyThemeSource(store.settings.get("appearance")?.scheme); } }),
        agent: sync.agentItems({ store, agents, shrinkPicture, log }),
        "connector-access": sync.connectorAccess({ integrations: services.integrations, store }),
        instructions: sync.singleFile({ key: "AGENTS.md", file: account => path.join(folders(account).codexHome, "AGENTS.md") }),
        memory: sync.textFiles({ root: account => folders(account).memoriesRoot }),
        skill: sync.skillFolders({ root: account => path.join(folders(account).codexHome, "skills"), onChanged: () => void client.request("skills/list", { forceReload: true }).catch(() => {}) }),
        mcp: sync.mcpServers({ mcp, ready: () => client.status === "ready", signedIn: () => userId() }),
      },
      onStatus: state => { accountSyncStatus = state; if (state.applied) broadcast("account.synced", state); },
      // Chats prepared before a change start again with it.
      onApplied: kind => {
        if (kind === "connector-access") { appAccounts.clear(); broadcast("integrations.changed", {}); }
        if (["instructions", "skill", "agent"].includes(kind)) harness?.discardSpares();
      },
      log,
    });
    return result;
  }

  async function accountReady() {
    const account = userId();
    if (!account) { history?.stop(); history = null; historyStatus = { state: "signed-out" }; accountSync?.stop(); accountSync = null; accountSyncStatus = { state: "signed-out" }; return; }
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
    prepareTools();
    void connectLegacySkills().catch(() => console.error("[timewarp] Previously connected skill folders are unavailable."));
    void retireReplacedSkills().catch(error => appLog.warn("skills", "Replaced skills could not be turned off: " + error.message));
    // The account's agents, memory, settings and the like from its other
    // computers come first, so chats restored next find their agents. A slow
    // first sync doesn't hold up the app; it carries on in the background.
    accountSync ||= startAccountSync();
    await Promise.race([accountSync.sync(), new Promise(resolve => { const timer = setTimeout(resolve, 15000); timer.unref?.(); })]);
    await history.sync();
    agents.assignMascots();
    agents.prepareWorkspaces();
    await selectModel().catch(() => console.error("[timewarp] The default model could not be updated."));
    if (fixture && !process.env.TIMEWARP_FIXTURE_ONBOARDING) await onboarding.skip();
    // The command sandbox is set up for every account, whether or not it
    // finished setup; setup's knowledge step shows how that went.
    sandboxArmed = true;
    void ensureSandbox();
  }

  async function diagnostics() {
    let codexVersion = null;
    try { codexVersion = JSON.parse(fs.readFileSync(path.join(vendor, "codex-package.json"), "utf8")).version || null; } catch {}
    const owner = userId();
    const sandboxState = process.platform === "win32" ? await sandbox.status().catch(error => ({ error: error.message })) : null;
    const servers = owner ? await mcp.list().catch(() => []) : [];
    return {
      createdAt: new Date().toISOString(),
      app: { version: VERSION, profile: build.profile || null, appId: build.appId || null, releaseUpdates: !!build.release?.enabled, updates: updates.state(), packaged: app.isPackaged },
      runtime: { electron: process.versions.electron, chrome: process.versions.chrome, node: process.versions.node, codex: codexVersion },
      system: { platform: process.platform, arch: process.arch, release: require("node:os").release(), memoryGb: Math.round(require("node:os").totalmem() / 1e9) },
      state: {
        signedIn: !!owner, codex: client.status, history: historyStatus.state, accountSync: accountSyncStatus.state, sandbox: sandboxState?.status || sandboxState?.error || null,
        agents: owner ? store.agents.list(owner).length : 0, conversations: owner ? store.conversations.list(owner).length : 0,
        automations: owner ? store.automations.list(owner).length : 0,
        mcpServers: servers.map(server => ({ transport: server.transport, enabled: server.enabled, tools: server.tools, failed: !!server.error })),
      },
      log: appLog.tail(200).length ? appLog.tail(200) : recentLog.slice(-200),
    };
  }
  const defaultAppearance = () => ({ scheme: "system", accent: defaultAccent, radiance: 0.5, texture: { type: "dots", step: 0 } });
  // Browser profile import arrives with the profile importer. It writes the
  // browser's sign-ins into the new profile's session (browser.sessionFor).
  const browserImport = require("./browser-import.cjs").createBrowserImport({ store, sessionFor: profileId => browser.sessionFor(profileId), log: message => appLog.info("browser-import", message) });
  // Memory, projects and scheduled tasks pasted from ChatGPT, Claude and the
  // like, in setup and on the Memories page.
  const assistantImport = require("./assistant-import.cjs").createAssistantImport({ knowledge, agents, automations });
  // Setup can import saved passwords the same way Settings → Vault does.
  onboarding = createOnboarding({ profile, store, services, agents, knowledge, browserImport, assistantImport, importPasswords: () => methods["vault.importPasswords"](), dialog, shell, defaultAppearance });

  // Restarting into a downloaded update asks first, from the notification or
  // the Update button. Agents still working are mentioned, so a restart doesn't
  // cut a run short.
  let restartQuestion = null;
  const confirmRestart = install => restartQuestion || (restartQuestion = (async () => {
    const working = userId() ? store.conversations.list(userId()).filter(item => { try { return harness.conversations.status(item.id).running; } catch { return false; } }).length : 0;
    const result = await dialog.showMessageBox(mainWindow || undefined, {
      type: "info", title: "Timewarp update", message: "An update is ready. Restart Timewarp to install it.",
      detail: working ? "An agent is still working. Restarting stops it." : undefined,
      buttons: ["Restart and install", "Later"], defaultId: 1, cancelId: 1, noLink: true,
    });
    if (result.response !== 0) { updateNotice = null; return false; }
    install();
    return true;
  })().catch(() => false).finally(() => { restartQuestion = null; }));
  // Updates are known from the start for Settings and the sidebar; checks
  // begin once the account is ready, as before (startUpdates below).
  let startUpdates;
  const updatesReady = new Promise(resolve => { startUpdates = resolve; });
  const updates = require("../../desktop/updates.cjs").configureUpdates({
    app, autoUpdater: () => require("electron-updater").autoUpdater, release: build.release || { enabled: false }, macUpdates: build.macUpdates || { enabled: false },
    logger: { info: (...args) => appLog.info("updater", args.join(" ")), warn: (...args) => appLog.warn("updater", args.join(" ")), error: (...args) => appLog.error("updater", args.map(value => value?.message || value).join(" ")), log: (...args) => appLog.info("updater", args.join(" ")) },
    readUpdateConfig: () => require("js-yaml").load(fs.readFileSync(path.join(process.resourcesPath, "app-update.yml"), "utf8")),
    ready: () => updatesReady, onChange: state => broadcast("updates.changed", state), openExternal: url => shell.openExternal(url),
    // A notification first, as in the previous app; clicking it asks to restart.
    notify: install => {
      if (updateNotice) return;
      if (!Notification.isSupported()) return void confirmRestart(install);
      updateNotice = new Notification({ title: "Timewarp update ready", body: "Click to restart and install the verified update." });
      updateNotice.on("click", () => void confirmRestart(install));
      updateNotice.show();
    },
    confirm: confirmRestart,
  });

  // Copies of chats, agents and automations sent to members of the organization.
  const shares = require("./shares.cjs").createShares({ store, agents, harness, automations, accountRpc: (rpc, input) => services.accountRpc(rpc, input), userId: () => userId() });
  const methods = require("./methods.cjs").createMethods({
    app, dialog, shell, store, services, agents, harness, client, guard, browser, version: VERSION, profile, runtimeDir,
    modelChoices, selectModel, registerTools, historyStatus: () => historyStatus, flushHistory: () => history?.sync(), defaultAppearance, knowledge, assistantImport, onboarding, automations, mcp, codexHome, vault, agentIds, clipboard, diagnostics, logs: appLog, openConnector, previousSessionUnclean, browserImport, browserTools, sandbox, updates, shares,
  });
  if (fixture) methods["debug.browserFrame"] = ({ conversationId }) => browser.inspect(conversationId);
  if (fixture) methods["debug.diagnostics"] = () => diagnostics();
  if (fixture) methods["debug.plan"] = ({ plan }) => { fixture.setPlan(plan); services.funding.invalidate(); return { plan }; };
  // A pass of account sync now, and where it stands.
  if (fixture) methods["debug.accountSync"] = async () => { await accountSync?.sync(); return accountSyncStatus; };
  // Preview builds have no updates; debug.updates shows one (such as a ready
  // update) in Settings and the sidebar, and counts Update clicks.
  if (fixture) {
    let shown = null, installs = 0;
    const { "updates.state": realState, "updates.install": realInstall } = methods;
    methods["updates.state"] = () => shown || realState();
    methods["updates.install"] = () => shown ? (installs++, { installing: false }) : realInstall();
    methods["debug.updates"] = input => { shown = input?.status ? { ...realState(), ...input } : null; broadcast("updates.changed", methods["updates.state"]()); return { installs }; };
  }
  // The window frame and native dialogs follow a theme change at once; reading
  // a chat clears its reply notification and the unread badge.
  const setSetting = methods["settings.set"], markRead = methods["conversations.markRead"], getSettings = methods["settings.get"];
  // ownsEarlierData: the signed-in account owns what this computer kept before
  // each account had its own (accounts.cjs), so the interface's earlier drafts
  // and lists are its.
  methods["settings.get"] = async (input, event) => ({ ...(await getSettings(input, event)), ownsEarlierData: !!userId() && accounts.legacyOwner() === userId() });
  // The sign-in screen keeps the last account's appearance.
  methods["settings.set"] = async (input, event) => {
    const value = await setSetting(input, event);
    if (input?.key === "appearance") { applyThemeSource(value?.scheme); store.settings.setDevice("appearance", value); }
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
    services.funding.invalidate();
    void Promise.resolve(harness?.unloadIdle?.()).catch(error => appLog.warn("funding", "Chats could not be reloaded: " + error.message));
    broadcast("funding.changed", {});
  }
  const legacy = require("./legacy-requests.cjs").createLegacyRequests({ services, harness, guard, version: VERSION, selectModel, onFundingChanged: fundingChanged, registerTools, historyStatus: () => historyStatus, onboarding: onboarding.service, openConnector, openChatgpt, sandbox });
  const trusted = event => event.senderFrame && event.senderFrame === event.sender.mainFrame && event.senderFrame.url.startsWith("app://app/");
  // Actions that change what account sync carries send it a moment later;
  // changes made otherwise (agents writing memory) go at the next pass.
  const SYNCED_ACTIONS = /^(agents\.(create|update|archive|reorder)|memory\.(save|removeImport)|knowledge\.import|instructions\.save|skills\.|mcp\.(add|setEnabled|remove)|integrations\.(setAccess|disconnect|beginConnect)|settings\.set|onboarding\.)/;
  ipcMain.handle("tw:call", async (event, method, input) => {
    if (!trusted(event)) return { ok: false, error: { message: "Untrusted window.", status: 403 } };
    const handler = Object.hasOwn(methods, method) ? methods[method] : null;
    if (!handler) return { ok: false, error: { message: "Unknown action.", status: 404 } };
    try {
      trace("call " + method); await services.ready; const value = await handler(input ?? {}, event); trace("answered " + method);
      if (SYNCED_ACTIONS.test(method)) accountSync?.soon();
      return { ok: true, value };
    }
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
  automationSync.start();
  createWindow();
  // After the window exists: on Windows a window without a title bar only gets
  // the menu's shortcuts when the menu is set once it's open.
  applicationMenu();
  trace("window created");
  await services.ready.catch(() => {});
  trace("account storage ready");
  await accountReady().catch(error => console.error("[timewarp] Account startup failed:", error.message));
  trace("account ready");
  startUpdates();
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
