"use strict";
// Timewarp desktop main process.
const { app, BrowserWindow, Menu, ipcMain, nativeTheme, net, protocol, session, shell, dialog, safeStorage, clipboard } = require("electron");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

// Recent app log lines for the diagnostics file, also written to
// runtime/logs/main.log. The app logs its own state messages only; chat
// content, files and secrets are never logged.
const recentLog = [];
let appLog = null;
for (const level of ["error", "warn"]) {
  const original = console[level].bind(console);
  console[level] = (...args) => {
    let line;
    try { line = args.map(value => value instanceof Error ? value.message : typeof value === "string" ? value : JSON.stringify(value)).join(" "); } catch { line = String(args[0]); }
    recentLog.push(`${new Date().toISOString()} ${level} ${line.slice(0, 500)}`);
    if (recentLog.length > 300) recentLog.shift();
    appLog?.[level](/^\[timewarp\]/.test(line) ? "timewarp" : "console", line.replace(/^\[timewarp\]\s*/, ""));
    original(...args);
  };
}

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
  app.relaunch();
  app.exit(0);
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
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1320, height: 860, minWidth: 960, minHeight: 620, show: false, title: "Timewarp", icon: appIcon,
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#17161c" : "#f7f6fb",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default", trafficLightPosition: { x: 18, y: 18 }, autoHideMenuBar: true,
    webPreferences: { preload: path.join(appRoot, "preload", "preload.cjs"), contextIsolation: true, sandbox: true, nodeIntegration: false, webviewTag: false, spellcheck: true },
  });
  mainWindow.once("ready-to-show", () => mainWindow.show());
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
  void mainWindow.loadURL("app://app/index.html");
  return mainWindow;
}
function focusApp() {
  const window = mainWindow || createWindow();
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
}

function applicationMenu() {
  if (process.platform !== "darwin") return Menu.setApplicationMenu(null);
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { role: "appMenu" }, { role: "editMenu" }, { role: "viewMenu" }, { role: "windowMenu" },
  ]));
}

// Start-up timing, printed when TIMEWARP_TRACE_STARTUP is set.
const traceStart = Date.now();
const trace = label => {
  if (process.env.TIMEWARP_TRACE_STARTUP) console.log(`[timewarp] startup ${Date.now() - traceStart}ms ${label}`);
  if (!/^(call|answered|request) /.test(label)) appLog?.info("startup-timing", `${Date.now() - traceStart}ms ${label}`);
};

async function boot() {
  trace("ready");
  protocol.handle("app", serveApp);
  applicationMenu();
  app.setAboutPanelOptions({ applicationName: "Timewarp", applicationVersion: VERSION, copyright: "Copyright © 2026 Timewarp." });
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(webContents.getURL().startsWith("app://app/") && ["media", "clipboard-sanitized-write"].includes(permission));
  });

  const config = require("../../config.json");
  const { openStore } = require("./store.cjs");
  const { importLegacyProfile } = require("./import-legacy.cjs");
  const { createAgents } = require("./agents.cjs");
  const { createHarness } = require("./harness.cjs");
  const { createModelBridge } = require("./model-bridge.cjs");
  const { CodexClient } = require("./codex-client.cjs");
  const { vendorRoot, codexExecutable, codexEnv } = require("./codex-paths.cjs");
  const { createServices } = require("./services.cjs");
  const { createHistoryAdapter } = require("./history-adapter.cjs");
  const { engineInstructions, DELEGATION } = require("./instructions.cjs");
  const { createBrowser } = require("./browser.cjs");
  const { createBrowserTools } = require("./browser-tools.cjs");
  const { createKnowledge } = require("./knowledge.cjs");
  const { createOnboarding } = require("./onboarding.cjs");
  const { createAutomations } = require("./automations.cjs");
  const { createMcp } = require("./mcp.cjs");
  const { createVault, safeStorageCipher } = require("./vault.cjs");
  const { createVaultTools } = require("./vault-tools.cjs");
  const { resolveModelSettings } = require("../../shared/model-capabilities.cjs");
  const { migrateAppearance, defaultAccent } = require("../../shared/appearance.cjs");

  const store = openStore(path.join(profile, "timewarp.sqlite"));
  trace("store open");
  try { importLegacyProfile({ store, runtimeDir, log: (...args) => console.error("[timewarp]", ...args) }); }
  catch (error) { console.error("[timewarp] Previous local data could not be imported.", error.message); }
  const appearance = store.settings.get("appearance");
  if (appearance) { const migrated = migrateAppearance(appearance); if (migrated !== appearance) store.settings.set("appearance", migrated); }

  const mcpToken = crypto.randomBytes(32).toString("base64url");
  const bridgeToken = crypto.randomBytes(32).toString("base64url");
  let history = null, historyStatus = { state: "starting" }, toolsRegistered = false;
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
      if (changedUser) { harness.reset(); toolsRegistered = false; }
      await accountReady();
      broadcast("account.changed", { signedIn: !!services.auth.user() });
    },
    onCodexConnected: async () => { await booted; await selectModel(); broadcast("funding.changed", {}); },
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
  const bridge = createModelBridge({ token: bridgeToken, cloud: services.cloud, funding: services.funding, chatgpt: services.chatgpt, integrations: services.integrations, mascots: require("../../desktop/mascots.cjs") });
  const bridgeReady = bridge.listen();
  bridgeReady.catch(error => console.error("[timewarp]", error.message));
  const vendor = vendorRoot();
  const client = new CodexClient({
    executable: codexExecutable(vendor), cwd: path.join(runtimeDir, "codex-app-server-cwd"),
    // Codex starts once the bridge has its port.
    args: async () => {
      await bridgeReady.catch(() => {});
      return [
        // Each chat picks its provider (codex-funding.cjs): "timewarp" for Timewarp
        // credits, "openai" for a connected ChatGPT plan. The default stays OpenAI so
        // Codex reports the connected ChatGPT account (account/read) and its models.
        "-c", `model_providers.timewarp={name="Timewarp",base_url="http://127.0.0.1:${bridge.port}/v1",wire_api="responses",env_key="TIMEWARP_BRIDGE_TOKEN"}`,
        // The previous app's guidance on when to use workers.
        "-c", "features.multi_agent_v2.multi_agent_mode_hint_text=" + JSON.stringify(DELEGATION),
      ];
    },
    env: {
      CODEX_HOME: codexHome, TIMEWARP_BRIDGE_TOKEN: bridgeToken, TIMEWARP_COMPOSIO_TOKEN: mcpToken, ...codexEnv(vendor, process.env, { home: codexHome }),
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
  let executionNotice = null;
  const executionChanged = () => {
    if (executionNotice) return;
    executionNotice = setTimeout(() => { executionNotice = null; for (const window of appWindows()) window.webContents.send("timewarp:executionChanged"); broadcast("execution.changed", {}); }, 200);
    executionNotice.unref?.();
  };
  const guard = require("../../desktop/execution-guard.cjs").bindExecutionGuard(client, { userId: () => userId(), onChange: executionChanged, countItems: true });
  require("../../desktop/codex-funding.cjs").bindCodexFunding({ client, chatgpt: services.chatgpt, funding: services.funding, userId: () => userId() });

  async function modelChoices() {
    await services.ready;
    // A ChatGPT connection that needs signing in again still shows Timewarp's models.
    if (userId() && (await services.funding.current()).source === "chatgpt") {
      const choices = await services.chatgpt.models().catch(error => { appLog.warn("models", "ChatGPT models unavailable: " + error.message); return []; });
      if (choices.length) return choices;
    }
    return require("../../shared/models.cjs").models();
  }
  async function selectModel(choices) {
    choices = choices || await modelChoices();
    const current = store.settings.get("modelSettings") || {};
    const selected = resolveModelSettings(choices, current);
    if (selected && Object.keys(selected).some(key => selected[key] !== current[key])) store.settings.set("modelSettings", selected);
    return selected;
  }

  function instructionsFor(agent) {
    const account = services.auth.user();
    const lines = [
      `You are ${agent.name}, a Timewarp agent working for the user on this computer.`,
      `Your Timewarp agent ID is ${agent.id}. Use it whenever a connected-app tool asks for the current agent ID.`,
      `Your workspace folder is ${agent.workspace}. Keep files you create for the user there unless they ask otherwise.`,
    ];
    if (account?.name) lines.push(`The user's name is ${account.name}.`);
    return lines.join("\n") + "\n\n" + knowledge.instructions(store.settings.get("memory")?.mode) + "\n\n" + engineInstructions();
  }

  const browser = createBrowser({ window: () => mainWindow, store, notify: broadcast, log: appLog });
  const browserTools = createBrowserTools({ browser, onActivity: (conversationId, action) => broadcast("browser.agent", { conversationId, action }) });
  // Raise when the tool set changes: chats then continue in a new thread.
  const vault = createVault({ store, cipher: safeStorageCipher(safeStorage), userId: () => userId() });
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
  // Raised when the dynamic tools change, so chats continue in a thread that has them
  // (3: browser select, hover and upload; cards without security codes; 4: automations).
  const TOOLS_VERSION = 4;
  const tools = {
    version: TOOLS_VERSION,
    specs: () => [...browserTools.specs(), ...vaultTools.specs(), ...require("./automation-tools.cjs").toolSpecs()],
    call: (conversationId, params, agent) => {
      if (params.namespace === "timewarp_browser") return browserTools.call(conversationId, params, agent);
      if (params.namespace === "timewarp_vault") return vaultTools.call(conversationId, params, agent);
      if (params.namespace === "timewarp_automations" && automationTools) return automationTools.call(conversationId, params, agent);
      return Promise.reject(Object.assign(new Error("This tool is not available in Timewarp."), { status: 404 }));
    },
    finished: conversationId => browserTools.finished(conversationId),
  };

  let automations = null;
  harness = createHarness({
    store, client, userId: () => userId(), instructionsFor, tools,
    modelSettings: () => store.settings.get("modelSettings"),
    // Automatic review unless the user chose to be asked (Settings → General).
    approvalsReviewer: () => process.env.TIMEWARP_APPROVALS_REVIEWER || (store.settings.get("preferences")?.approvals === "ask" ? "user" : "auto_review"),
    notify: (name, payload) => { broadcast(name, payload); automations?.observe(name, payload); },
    log: (...args) => console.error("[timewarp]", ...args),
  });
  automations = createAutomations({ store, harness, userId: () => userId(), notify: broadcast, log: (...args) => console.error("[timewarp]", ...args) });
  automationTools = require("./automation-tools.cjs").createAutomationTools({ automations });

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
  const mcp = createMcp({ client, openExternal: url => openConnector(url, "Sign in to a server"), notify: broadcast });

  async function registerTools(force = false) {
    if (!userId() || (toolsRegistered && !force)) return;
    // The bridge may have moved to a free port (the previous app holds the usual
    // one), so Codex gets the port only once the bridge is listening.
    await bridgeReady;
    await client.request("config/value/write", { keyPath: "mcp_servers.timewarp_composio", value: { url: `http://127.0.0.1:${bridge.port}/mcp/composio`, enabled: true, bearer_token_env_var: "TIMEWARP_COMPOSIO_TOKEN" }, mergeStrategy: "replace" });
    await client.request("config/mcpServer/reload", undefined);
    toolsRegistered = true;
  }
  // Skill folders the previous app kept connected stay available.
  async function connectLegacySkills() {
    const extraRoots = knowledge.legacySkillRoots();
    if (extraRoots.length) await client.request("skills/extraRoots/set", { extraRoots });
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
    // Tools first: Codex keeps the previous run's bridge address until they're registered.
    void registerTools().catch(error => appLog.warn("tools", "Connected-app tools are pending; refresh Tools to retry. " + error.message));
    void connectLegacySkills().catch(() => console.error("[timewarp] Previously connected skill folders are unavailable."));
    await history.sync();
    agents.assignMascots();
    agents.prepareWorkspaces();
    await selectModel().catch(() => console.error("[timewarp] The default model could not be updated."));
    if (fixture && !process.env.TIMEWARP_FIXTURE_ONBOARDING) await onboarding.skip();
  }

  async function diagnostics() {
    let codexVersion = null;
    try { codexVersion = JSON.parse(fs.readFileSync(path.join(vendor, "codex-package.json"), "utf8")).version || null; } catch {}
    const owner = userId();
    const sandbox = process.platform === "win32" ? await client.request("windowsSandbox/readiness", {}).catch(error => ({ error: error.message })) : null;
    const servers = owner ? await mcp.list().catch(() => []) : [];
    return {
      createdAt: new Date().toISOString(),
      app: { version: VERSION, profile: build.profile || null, appId: build.appId || null, releaseUpdates: !!build.release?.enabled, packaged: app.isPackaged },
      runtime: { electron: process.versions.electron, chrome: process.versions.chrome, node: process.versions.node, codex: codexVersion },
      system: { platform: process.platform, arch: process.arch, release: require("node:os").release(), memoryGb: Math.round(require("node:os").totalmem() / 1e9) },
      state: {
        signedIn: !!owner, codex: client.status, history: historyStatus.state, sandbox: sandbox?.status || sandbox?.error || null,
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
    modelChoices, selectModel, registerTools, historyStatus: () => historyStatus, flushHistory: () => history?.sync(), defaultAppearance, knowledge, onboarding, automations, mcp, codexHome, vault, clipboard, diagnostics, logs: appLog, openConnector, previousSessionUnclean, browserImport,
  });
  if (fixture) methods["debug.browserFrame"] = ({ conversationId }) => browser.inspect(conversationId);
  if (fixture) methods["debug.diagnostics"] = () => diagnostics();
  const legacy = require("./legacy-requests.cjs").createLegacyRequests({ services, harness, guard, version: VERSION, selectModel, registerTools, historyStatus: () => historyStatus, onboarding: onboarding.service, openConnector });
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
  trace("window created");
  await services.ready.catch(() => {});
  trace("account storage ready");
  await accountReady().catch(error => console.error("[timewarp] Account startup failed:", error.message));
  trace("account ready");
  require("../../desktop/updates.cjs").configureUpdates({
    app, autoUpdater: require("electron-updater").autoUpdater, release: build.release || { enabled: false },
    logger: { info: (...args) => appLog.info("updater", args.join(" ")), warn: (...args) => appLog.warn("updater", args.join(" ")), error: (...args) => appLog.error("updater", args.map(value => value?.message || value).join(" ")), log: (...args) => appLog.info("updater", args.join(" ")) },
    readUpdateConfig: () => require("js-yaml").load(fs.readFileSync(path.join(process.resourcesPath, "app-update.yml"), "utf8")),
    notify: install => {
      void dialog.showMessageBox({ type: "info", title: "Timewarp update", message: "An update is ready. Restart Timewarp to install it.", buttons: ["Restart and install", "Later"], defaultId: 1, cancelId: 1 })
        .then(result => { if (result.response === 0) install(); }).catch(() => {});
    },
  });
  app.on("will-quit", () => { appLog.info("shutdown", "Timewarp quit"); try { fs.rmSync(sessionMarker, { force: true }); } catch {} });
  app.on("before-quit", () => { appLog.info("shutdown", "Quitting"); automations.stop(); browser.destroy(); clearTimeout(executionNotice); guard.stop?.(); history?.stop(); services.close(); bridge.close(); void client.stop(); store.close(); });
}

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
