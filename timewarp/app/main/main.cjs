"use strict";
// Timewarp desktop main process.
const { app, BrowserWindow, Menu, ipcMain, nativeTheme, net, protocol, session, shell, dialog } = require("electron");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const appRoot = path.resolve(__dirname, "..");
const build = (() => { try { return JSON.parse(fs.readFileSync(path.join(appRoot, "build.json"), "utf8")); } catch { return {}; } })();
const VERSION = build.version || app.getVersion();
const profile = process.env.TIMEWARP_USER_DATA_DIR ? path.resolve(process.env.TIMEWARP_USER_DATA_DIR) : path.join(app.getPath("appData"), build.profile || "Timewarp Dev");
const runtimeDir = path.join(profile, "runtime");
fs.mkdirSync(runtimeDir, { recursive: true });
app.setName("Timewarp");
app.setPath("userData", profile);
app.setPath("sessionData", profile);
app.setAppLogsPath(path.join(profile, "logs"));
if (process.platform === "win32") app.setAppUserModelId(build.appId || "com.timewarp.desktop.dev");
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
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default", autoHideMenuBar: true,
    webPreferences: { preload: path.join(appRoot, "preload", "preload.cjs"), contextIsolation: true, sandbox: true, nodeIntegration: false, webviewTag: false, spellcheck: true },
  });
  mainWindow.once("ready-to-show", () => mainWindow.show());
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//i.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => { if (!url.startsWith("app://app/")) event.preventDefault(); });
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

async function boot() {
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
  const { engineInstructions } = require("./instructions.cjs");
  const { createBrowser } = require("./browser.cjs");
  const { createBrowserTools } = require("./browser-tools.cjs");
  const { createKnowledge } = require("./knowledge.cjs");
  const { createOnboarding } = require("./onboarding.cjs");
  const { createAutomations } = require("./automations.cjs");
  const { createMcp } = require("./mcp.cjs");
  const { resolveModelSettings } = require("../../shared/model-capabilities.cjs");
  const { migrateAppearance, defaultAccent } = require("../../shared/appearance.cjs");

  const store = openStore(path.join(profile, "timewarp.sqlite"));
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
    runtimeDir, codexHome, cursorRoot: () => onboarding?.service.cursorRoot(),
    ...(fixture ? { home: fixture.sampleHome(path.join(profile, "preview-home")), env: {} } : {}),
  });
  fs.mkdirSync(path.join(runtimeDir, "codex-app-server-cwd"), { recursive: true });
  const vendor = vendorRoot();
  const client = new CodexClient({
    executable: codexExecutable(vendor), cwd: path.join(runtimeDir, "codex-app-server-cwd"),
    args: [
      "-c", 'model_providers.timewarp={name="Timewarp",base_url="http://127.0.0.1:7788/v1",wire_api="responses",env_key="TIMEWARP_BRIDGE_TOKEN"}',
      "-c", 'model_provider="timewarp"',
    ],
    env: { CODEX_HOME: codexHome, TIMEWARP_BRIDGE_TOKEN: bridgeToken, TIMEWARP_COMPOSIO_TOKEN: mcpToken, ...codexEnv(vendor) },
    clientInfo: { name: "timewarp", title: "Timewarp", version: VERSION },
  });
  client.on("status", state => broadcast("codex.status", { status: state.status }));
  client.on("notification", ({ method, params }) => { if (method === "windowsSandbox/setupCompleted") broadcast("sandbox.changed", params); });
  let executionNotice = null;
  const executionChanged = () => {
    if (executionNotice) return;
    executionNotice = setTimeout(() => { executionNotice = null; for (const window of appWindows()) window.webContents.send("timewarp:executionChanged"); broadcast("execution.changed", {}); }, 200);
    executionNotice.unref?.();
  };
  const guard = require("../../desktop/execution-guard.cjs").bindExecutionGuard(client, { userId: () => userId(), onChange: executionChanged });
  require("../../desktop/codex-funding.cjs").bindCodexFunding({ client, chatgpt: services.chatgpt, funding: services.funding, userId: () => userId(), cloudProvider: "timewarp", backgroundRole: "timewarp-memory-writer" });

  async function modelChoices() {
    await services.ready;
    if (userId() && (await services.funding.current()).source === "chatgpt") return services.chatgpt.models();
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

  const browser = createBrowser({ window: () => mainWindow, store, notify: broadcast });
  const browserTools = createBrowserTools({ browser, onActivity: (conversationId, action) => broadcast("browser.agent", { conversationId, action }) });
  // Raise when the tool set changes: chats then continue in a new thread.
  const TOOLS_VERSION = 1;
  const tools = {
    version: TOOLS_VERSION,
    specs: () => browserTools.specs(),
    call: (conversationId, params, agent) => {
      if (params.namespace === "timewarp_browser") return browserTools.call(conversationId, params, agent);
      return Promise.reject(Object.assign(new Error("This tool is not available in Timewarp."), { status: 404 }));
    },
    finished: conversationId => browserTools.finished(conversationId),
  };

  let automations = null;
  harness = createHarness({
    store, client, userId: () => userId(), instructionsFor, tools,
    modelSettings: () => store.settings.get("modelSettings"),
    notify: (name, payload) => { broadcast(name, payload); automations?.observe(name, payload); },
    log: (...args) => console.error("[timewarp]", ...args),
  });
  automations = createAutomations({ store, harness, userId: () => userId(), notify: broadcast, log: (...args) => console.error("[timewarp]", ...args) });

  const mcp = createMcp({ client, openExternal: url => services.openExternal(url), notify: broadcast });

  const bridge = createModelBridge({ token: bridgeToken, cloud: services.cloud, funding: services.funding, chatgpt: services.chatgpt, integrations: services.integrations, mascots: require("../../desktop/mascots.cjs") });
  const bridgeReady = bridge.listen();
  bridgeReady.catch(error => console.error("[timewarp]", error.message));

  async function registerTools(force = false) {
    if (!userId() || (toolsRegistered && !force)) return;
    await client.request("config/value/write", { keyPath: "mcp_servers.timewarp_composio", value: { url: "http://127.0.0.1:7788/mcp/composio", enabled: true, bearer_token_env_var: "TIMEWARP_COMPOSIO_TOKEN" }, mergeStrategy: "replace" });
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
    await history.sync();
    agents.assignMascots();
    await selectModel().catch(() => console.error("[timewarp] The default model could not be updated."));
    void registerTools().catch(() => console.error("[timewarp] Connected-app tools are pending; refresh Tools to retry."));
    void connectLegacySkills().catch(() => console.error("[timewarp] Previously connected skill folders are unavailable."));
    if (fixture && !process.env.TIMEWARP_FIXTURE_ONBOARDING) await onboarding.skip();
  }

  const defaultAppearance = () => ({ scheme: "system", accent: defaultAccent, radiance: 0.5, texture: { type: "dots", step: 0 } });
  // Browser profile import arrives with the profile importer.
  const browserImport = { profileManager: { detect: async () => ({ profiles: [], errors: [] }) }, importProfiles: async () => { throw new Error("Browser profile import isn't available yet."); } };
  onboarding = createOnboarding({ profile, store, services, agents, knowledge, browserImport, dialog, shell, defaultAppearance });

  const methods = require("./methods.cjs").createMethods({
    app, dialog, shell, store, services, agents, harness, client, guard, browser, version: VERSION, profile, runtimeDir,
    modelChoices, selectModel, registerTools, historyStatus: () => historyStatus, flushHistory: () => history?.sync(), defaultAppearance, knowledge, onboarding, automations, mcp, codexHome,
  });
  if (fixture) methods["debug.browserFrame"] = ({ conversationId }) => browser.inspect(conversationId);
  const legacy = require("./legacy-requests.cjs").createLegacyRequests({ services, harness, guard, version: VERSION, selectModel, registerTools, historyStatus: () => historyStatus, onboarding: onboarding.service });
  const trusted = event => event.senderFrame && event.senderFrame === event.sender.mainFrame && event.senderFrame.url.startsWith("app://app/");
  ipcMain.handle("tw:call", async (event, method, input) => {
    if (!trusted(event)) return { ok: false, error: { message: "Untrusted window.", status: 403 } };
    const handler = Object.hasOwn(methods, method) ? methods[method] : null;
    if (!handler) return { ok: false, error: { message: "Unknown action.", status: 404 } };
    try { await services.ready; return { ok: true, value: await handler(input ?? {}, event) }; }
    catch (error) { return { ok: false, error: { message: error.message || "Request failed.", status: error.status || 500 } }; }
  });
  ipcMain.handle("timewarp:request", async (event, action, input = {}) => {
    if (!trusted(event)) throw new Error("Untrusted window.");
    await Promise.all([services.ready, bridgeReady.catch(() => {})]);
    return legacy(action, input, event);
  });

  markBooted();
  automations.start();
  createWindow();
  await services.ready.catch(() => {});
  await accountReady().catch(error => console.error("[timewarp] Account startup failed:", error.message));
  require("../../desktop/updates.cjs").configureUpdates({
    app, autoUpdater: require("electron-updater").autoUpdater, release: build.release || { enabled: false },
    readUpdateConfig: () => require("js-yaml").load(fs.readFileSync(path.join(process.resourcesPath, "app-update.yml"), "utf8")),
    notify: install => {
      void dialog.showMessageBox({ type: "info", title: "Timewarp update", message: "An update is ready. Restart Timewarp to install it.", buttons: ["Restart and install", "Later"], defaultId: 1, cancelId: 1 })
        .then(result => { if (result.response === 0) install(); }).catch(() => {});
    },
  });
  app.on("before-quit", () => { automations.stop(); browser.destroy(); clearTimeout(executionNotice); guard.stop?.(); history?.stop(); services.close(); bridge.close(); void client.stop(); store.close(); });
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
