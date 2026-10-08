"use strict";
const fs = require("node:fs");
const path = require("node:path");
const cp = require("node:child_process");
const crypto = require("node:crypto");
const { rebrandJavaScript, rebrandAssistantLogo } = require("./rebrand.cjs");
const { patchAppearanceDefaults, patchRendererPalette, patchPresetPicker, patchProfileLogo, patchSmoothBackdrop, patchAppChrome, patchSmoothThemePicker, patchSidebarAccount } = require("./appearance.cjs");
const { replaceFunctionBody,replaceMethodBody } = require("./patch-native.cjs");
const { renameAgentCopy, patchAgentCreation, patchAgentAvatarResolver } = require("./agents.cjs");
const { patchOrganizations } = require("./organizations.cjs");
const { patchModelPicker, patchReasoningSchema } = require("./model-picker.cjs");
const { patchWorkspacePane } = require("./workspace-pane.cjs");
const { patchBrowserCursor, patchBrowserCursorActivity } = require("./browser-cursor.cjs");
const { patchHarnessPath, patchBrowserInstructions, patchHarnessPolicy } = require("./harness.cjs");
const { patchTaskActivity } = require("./task-activity.cjs");
const { patchLegacyOnboarding,patchOnboardingPrompts,patchCursorImports } = require("./onboarding.cjs");
const root = path.resolve(__dirname, "..");
const energy = path.resolve(root, "../energy-testv1");
const tree = path.join(root, "build/app");
const config = require("../config.json");
const { verifyUpstream, copyRuntime } = require('./upstream.cjs');
const { validateRelease } = require('../shared/release.cjs');
const storeBuild = process.argv.includes('--store');
const macBuild = process.argv.includes('--mac');
const macRelease = macBuild && process.env.TIMEWARP_MAC_RELEASE === '1';
const stageOnly = process.argv.includes('--stage') || storeBuild || macBuild;
const acceptance = process.env.TIMEWARP_ACCEPTANCE_HARNESS === '1';
const localAcceptance = process.env.TIMEWARP_LOCAL_HARNESS_CHECK === '1';
const servicesAcceptance=process.env.TIMEWARP_VERIFY_SERVICES==='1';
const billingAcceptance=process.env.TIMEWARP_VERIFY_BILLING==='1';
const chatgptAcceptance=process.env.TIMEWARP_VERIFY_CHATGPT==='1';
function run(script, args) { cp.execFileSync(process.execPath, [script, ...args], { stdio: "pipe" }); }
function replaceOnce(text, from, to, name) {
  if (text.split(from).length !== 2) throw new Error(`Bundle contract changed: ${name}`);
  return text.replace(from, to);
}
function patchConnectorRouting(source){
  source=replaceOnce(source,'s=Oa(),i=ZAe(),[a,o]=b.useState(null)','s=Oa(),i=ZAe(),j=Mqe(),[a,o]=b.useState(null)','connector dialog context');
  source=replaceOnce(source,'await window.newco.app.openExternal(y.connectUrl)','await window.timewarpOpenConnectorBrowser(y.connectUrl,{onReady:()=>j?.querySelector(\'[data-slot="dialog-close"]\')?.click()})','connector redirect in the app browser');
  source=replaceOnce(source,'GAe({app:window.newco.app,nangoIntegrationId:y.nangoIntegrationId,onAuthorizationOpened:()=>o(null)','GAe({app:window.newco.app,nangoIntegrationId:y.nangoIntegrationId,onAuthorizationOpened:()=>{o(null);j?.querySelector(\'[data-slot="dialog-close"]\')?.click()}','connector dialog yields to authorization');
  source=replaceOnce(source,'sCe=({local:t,item:e,open:n,onConnected:r})=>{const s=t.trpc.useUtils()','sCe=({local:t,item:e,open:n,onConnected:r})=>{const j=Mqe(),s=t.trpc.useUtils()','app authorization dialog context');
  source=replaceOnce(source,'window.open(l.authorizationUrl,"_blank","noopener,noreferrer")','await window.timewarpOpenConnectorBrowser(l.authorizationUrl,{serverName:e?.serverName,onReady:()=>j?.querySelector(\'[data-slot="dialog-close"]\')?.click()})','app OAuth inside the app browser');
  source=replaceOnce(source,'Gun=({local:t,open:e,item:n,onOpenChange:r})=>{const s=t.trpc.useUtils()','Gun=({local:t,open:e,item:n,onOpenChange:r})=>{const j=Mqe(),s=t.trpc.useUtils()','custom MCP authorization dialog context');
  source=replaceOnce(source,'window.open(g.authorizationUrl,"_blank","noopener,noreferrer"),await d.reconcile()','await window.timewarpOpenConnectorBrowser(g.authorizationUrl,{serverName:n?.name,onReady:()=>j?.querySelector(\'[data-slot="dialog-close"]\')?.click()}),await d.reconcile()','custom MCP OAuth inside the app browser');
  return replaceOnce(source,'openAuthorization:async a=>(await t.openExternal(a),null)','openAuthorization:async a=>(await window.timewarpOpenConnectorBrowser(a),null)','connector authorization in the app browser');
}
async function build() {
  const asar = await import("@electron/asar");
  if (macBuild && (storeBuild || process.env.TIMEWARP_RELEASE_CONFIG)) throw new Error('The Mac build uses its separate signing and distribution configuration.');
  const inputs = macBuild ? require('./mac-inputs.cjs').verifyMacInputs() : verifyUpstream();
  const store = storeBuild ? require('../shared/store.cjs').validateStore(JSON.parse(fs.readFileSync(process.env.TIMEWARP_STORE_CONFIG || path.join(root,'store.json'),'utf8'))) : null;
  const release = process.env.TIMEWARP_RELEASE_CONFIG ? validateRelease(JSON.parse(fs.readFileSync(process.env.TIMEWARP_RELEASE_CONFIG, 'utf8'))) : { enabled: false };
  if (store && process.env.TIMEWARP_RELEASE_CONFIG) throw new Error('Store updates are managed by Microsoft; remove TIMEWARP_RELEASE_CONFIG.');
  if (release.enabled && !stageOnly) throw new Error('Public releases must use the isolated staging build.');
  if (release.enabled && [acceptance,localAcceptance,servicesAcceptance,billingAcceptance,chatgptAcceptance].some(Boolean)) throw new Error('Acceptance harnesses cannot enter a public release.');
  if (store && [acceptance,localAcceptance,servicesAcceptance,billingAcceptance,chatgptAcceptance].some(Boolean)) throw new Error('Acceptance harnesses cannot enter a Store package.');
  if (macBuild && [acceptance,localAcceptance,servicesAcceptance,billingAcceptance,chatgptAcceptance].some(Boolean)) throw new Error('Acceptance harnesses cannot enter a Mac package.');
  const exe = path.join(energy, "app/Timewarp.exe");
  const requireClosedApp = () => {
    const snapshot = cp.execFileSync("powershell.exe", ["-NoProfile", "-Command", `Get-CimInstance Win32_Process -Filter "Name='Timewarp.exe'" | Where-Object { $_.ExecutablePath -eq '${exe.replaceAll("'", "''")}' } | Select-Object -ExpandProperty ProcessId`], { windowsHide: true, encoding: "utf8" });
    if (snapshot.trim()) throw new Error("Close this workspace's Timewarp app before rebuilding.");
  };
  if (!stageOnly) requireClosedApp();
  await require('./build-icons.cjs').buildIcons();
  fs.mkdirSync(path.join(root, "backups"), { recursive: true });
  const baselineExe = inputs.executable;
  const oldAsar = path.join(energy, "app/resources/app.asar");
  const backupAsar = path.join(root, "backups/pre-timewarp.asar");
  if (!stageOnly && !fs.existsSync(backupAsar)) fs.copyFileSync(oldAsar, backupAsar);
  fs.mkdirSync(path.dirname(tree), { recursive: true });
  if (fs.existsSync(tree)) {
    const actual = fs.realpathSync(tree);
    const expectedBase = fs.realpathSync(path.join(root, "build"));
    if (actual !== path.join(expectedBase, "app") || fs.lstatSync(tree).isSymbolicLink()) throw new Error("Unsafe build output path.");
    fs.rmSync(actual, { recursive: true, maxRetries: 5, retryDelay: 200 });
  }
  asar.extractAll(inputs.archive, tree);
  // Patch a YAML parser used by the inherited updater with the reviewed local
  // version. The rest of the vendor dependency inventory is audited separately.
  fs.cpSync(path.dirname(require.resolve('js-yaml/package.json')), path.join(tree, 'node_modules/js-yaml'), { recursive: true });
  fs.cpSync(path.dirname(require.resolve('undici/package.json')), path.join(tree, 'node_modules/undici'), { recursive: true });
  const bootFile = path.join(tree, "out/main/bootstrap.js");
  run(path.join(energy, "build/patch.js"), [tree, "Timewarp", "http://127.0.0.1:7788", '--no-shim']);
  const bootstrap = fs.readFileSync(bootFile, "utf8");
  const mainFile = path.join(tree, "out/main/index.js");
  let main = fs.readFileSync(mainFile, "utf8");
  main = patchReasoningSchema(main);
  main = patchBrowserCursorActivity(main);
  main = patchHarnessPath(main);
  main = patchBrowserInstructions(main);
  main = patchHarnessPolicy(main);
  // Stop the inherited service resetting the Timewarp feed and update policy.
  for(const method of ['start','configure','useFeed']) main=replaceMethodBody(main,'BRe',method,'{}');
  for(const method of ['checkCurrentFeed','requestInstall']) main=replaceMethodBody(main,'BRe',method,'{return Promise.resolve({ok:false,error:"Timewarp updates use the verified release feed.",data:this.state})}');
  // Preserve the upstream attribution. Rebranding does not convey a license.
  main = main.replaceAll("Copyright © 2026 Timewarp", "Copyright © 2026 Energy");
  main = replaceOnce(main, 'applicationVersion:"0.8.20"', 'applicationVersion:""', "about panel version");
  const vaultStart = main.indexOf("class HN{");
  const backendStart = main.indexOf("async backend(){", vaultStart);
  const backendEnd = main.indexOf("async submitInput(", backendStart);
  if (vaultStart < 0 || backendStart < 0 || backendEnd < backendStart || backendEnd - backendStart > 3000) throw new Error("Vault backend contract changed.");
  main = main.slice(0, backendStart) + 'async backend(){return{type:"local",vault:this.local}}' + main.slice(backendEnd);
  main = replaceOnce(main, 'async function pp(t,e,n,r){return Lp+', 'async function pp(t,e,n,r){e=require("./timewarp/shared/vault.cjs").sanitizeCard(r,e);return Lp+', "card persistence");
  main = replaceOnce(main, 'm=new Jre(t,{browserBaseUrl:t,deviceId:u},B.net.fetch,p),f=', 'm=require("./timewarp/desktop/runtime.cjs").bindNativeAccount(new Jre(t,{browserBaseUrl:t,deviceId:u},B.net.fetch,p)),f=', "desktop account session");
  main = replaceOnce(main,'f=new tSe(l.codexHome,B.safeStorage,m);await f.prepare();','f=null;','replace legacy ChatGPT credential handoff');
  main = replaceOnce(main,'P=new S9(R);return','P=require("./timewarp/desktop/runtime.cjs").bindCodexClient(require("./timewarp/desktop/harness-instructions.cjs").bindHarnessClient(new S9(R)));return','Codex subscription provider and built-in login');
  main = replaceOnce(main,'GK=t=>[["model_provider",So]','GK=t=>[["model_provider","openai"],...require("./timewarp/shared/codex-catalog.cjs").nativeCatalogConfig(t)','native Codex model catalog default');
  main = replaceOnce(main,'if(r.method==="thread/context/read"){const s=this.getAgentRole','if(r.method==="thread/context/read"){if(require("./timewarp/desktop/runtime.cjs").chatgpt.isVerificationThread(r.params.threadId)){this.client.respond(r.id,{context:{}});return}const s=this.getAgentRole','minimal context for the read-only Codex connection test');
  main = main.replaceAll('allows_optional_chatgpt_auth`,!0','allows_optional_chatgpt_auth`,!1');
  main = replaceOnce(main,'I=new sSe(f,b)','I={...require("./timewarp/desktop/runtime.cjs").chatgpt,disconnect:async()=>{await require("./timewarp/desktop/runtime.cjs").chatgpt.disconnect()}}','local protected ChatGPT connection');
  main = replaceMethodBody(main,'Uke','currentChatgptBrowserLogin','{return require("./timewarp/desktop/runtime.cjs").chatgpt.currentBrowserLogin()}');
  main = replaceMethodBody(main,'Uke','startChatgptBrowserLogin','{return require("./timewarp/desktop/runtime.cjs").chatgpt.startBrowserLogin()}');
  main = replaceMethodBody(main,'Uke','cancelChatgptBrowserLogin','{return require("./timewarp/desktop/runtime.cjs").chatgpt.cancelLogin()}');
  main = replaceMethodBody(main,'Uke','generateAgentAvatar','{return require("./timewarp/desktop/runtime.cjs").mascot(e.displayName+" "+(e.instructions||""))}');
  main = replaceOnce(main,'ge=new Aye({agents:a.agents,','ge=require("./timewarp/desktop/runtime.cjs").createIntegrations({agents:a.agents,','real Composio integration service');
  main = replaceOnce(main,'vn=new Cce({client:r,metadataPath:k.join(s.home,"energy-mcp-metadata.json")})','vn=require("./timewarp/desktop/runtime.cjs").bindToolRuntime({client:r,mcp:new Cce({client:r,metadataPath:k.join(s.home,"energy-mcp-metadata.json")})})','Composio tools in the native harness');
  main = replaceOnce(main,'qCe(u,t,e)','qCe(u,require("./timewarp/desktop/runtime.cjs").bindBrowserManager(t),e)','native browser for connector authorization');
  main = replaceOnce(main,'r.pluginIds.filter(i=>n.has(i)||Kt(i).kind==="generic-mcp")','r.pluginIds.filter(i=>!i.startsWith("composio-")&&(n.has(i)||Kt(i).kind==="generic-mcp"))','Composio uses its own MCP server');
  const oldMascots=['http://127.0.0.1:7788/cdn-cgi/imagedelivery/5877peT6T6VbMjKS-hOjuQ/13bb9b0b-1df0-4ef7-1106-cf788e976100/avatar','http://127.0.0.1:7788/cdn-cgi/imagedelivery/5877peT6T6VbMjKS-hOjuQ/ea3823c3-2796-4fe9-a09c-dee60663a200/avatar'];
  for(const [index,url]of oldMascots.entries())main=main.replaceAll(url,'http://127.0.0.1:7788/mascots/'+['orbit','nova'][index]+'.png');
  main = replaceOnce(main, 'jl.executable().then(()=>re.info("[libreoffice] background install ready"),', 'Promise.resolve().then(()=>re.info("[timewarp] Local document tools load when requested."),', 'skip unrequested background office installation');
  main = replaceOnce(main, 'const n=await e.auth.accountSession(),r=!!n&&await e.featureFlags.isEnabled(xv,n);return{userId:n?.user.id??null,allowed:r,enabled:r&&await e.settingsStore.cloudProductApiEnabled(n.user.id)}', 'const n=await e.auth.accountSession();return{userId:n?.user.id??null,allowed:false,enabled:false}', "local product interface");
  main = replaceOnce(main,'const Tr=async(t,e,n)=>!!n&&await e.isEnabled(xv,n)&&await t.cloudProductApiEnabled(n.user.id)', 'const Tr=async()=>false', 'disable remote execution and workspace publishing');
  main = replaceOnce(main,'$e=async M=>(await O.prepareWorkspace(M),ye.push(M))','$e=async M=>await O.prepareWorkspace(M)','local assistant workspace');
  main = replaceOnce(main,'_W=(t,e)=>oJ(t,"energy",e)','_W=async()=>{}','keep assistant Git repositories local');
  main = replaceFunctionBody(main,'const n=this.requireRepositoryPath(e.repositoryPath);if(!await T.stat(n)', '{const n=this.requireRepositoryPath(e.repositoryPath);if(!await T.stat(n).then(()=>true).catch(error=>{if(error.code==="ENOENT")return false;throw error})){await T.mkdir(n,{recursive:true});await zP(n,e.displayName,"",null)}return n}');
  main = replaceOnce(main,'Ed={name:"energy/auto",reasoningEffort:"high",serviceTier:null}', 'Ed={name:"openai/gpt-5.6-sol",reasoningEffort:"low",serviceTier:null}', 'default hosted model for local harness');
  main = replaceOnce(main,'output(Gwe).query(({ctx:t})=>t.services.models.list())','output(Gwe).query(()=>require("./timewarp/desktop/runtime.cjs").availableModels())','available production models');
  main = replaceOnce(main,'gP=aI.parse(kj)', 'gP=aI.parse({...kj,onboarding:{done:false,conversationId:null},suggestions:{enabled:false},modelSettings:Ed})', 'local desktop defaults');
  main = patchCursorImports(patchOnboardingPrompts(main));
  main = replaceOnce(main,'K=i7(nh,un);return{services:jn,appRouter:nh', 'K=i7(nh,un);await require("./timewarp/desktop/runtime.cjs").attachNativeRuntime({entities:r,paths:n,settings:s,workspace:O,resolveBrowserAgent:async({threadId,turnId})=>{const id=await ge.resolveBrowserVaultAgentId(threadId,turnId)??await ge.conversationRuntimeContext.findAgentId(threadId,agentId=>r.agents.get(agentId));return id?await r.agents.get(id):null},caller:()=>K.createCaller(hq({services:jn,source:"ipc",auth:u,settingsStore:s,assetBaseUrl:g,appBaseUrl:g,telemetry:d,featureFlags:c,fetch:C}))});return{services:jn,appRouter:nh', 'local history synchronization');
  main = patchAgentAvatarResolver(patchAppearanceDefaults(rebrandJavaScript(main)));
  fs.writeFileSync(mainFile, main);
  const profileName = stageOnly && !release.enabled && !store && !macRelease ? 'Timewarp Preview' : 'Timewarp Energy';
  const appId=store?store.appUserModelId:(stageOnly&&!release.enabled?'com.timewarp.desktop.preview':'com.timewarp.desktop');
  const profileShim = `"use strict";\n(() => {\n const {app}=require('electron');const path=require('node:path');const fs=require('node:fs');\n const base=process.env.TIMEWARP_USER_DATA_DIR?path.resolve(process.env.TIMEWARP_USER_DATA_DIR):path.join(app.getPath('appData'),${JSON.stringify(profileName)});\n fs.mkdirSync(base,{recursive:true});app.setName('Timewarp');app.setPath('userData',base);app.setPath('sessionData',base);app.setAppLogsPath(path.join(base,'logs'));\n process.env.ENERGY_DATA_DIR=path.join(base,'runtime');\n require('./timewarp/desktop/runtime.cjs');\n})();\n`;
  const entry=profileShim.replace("require('./timewarp/desktop/runtime.cjs');",`if(!app.requestSingleInstanceLock()){app.exit(0);return;}app.on('second-instance',()=>{for(const window of require('electron').BrowserWindow.getAllWindows()){if(window.isMinimized())window.restore();window.show();window.focus();}});\n ${localAcceptance?"require('./timewarp/verify-local-harness.cjs').init();":''}\n require('./timewarp/${acceptance?'verify-packaged-auth.cjs':'desktop/runtime.cjs'}');`);
  fs.writeFileSync(bootFile, entry.replace("app.setName('Timewarp');",`app.setName('Timewarp');if(process.platform==='win32')app.setAppUserModelId(${JSON.stringify(appId)});`) + (acceptance?'':bootstrap.replaceAll("Energy failed to start", "Timewarp failed to start")));
  const pkgFile = path.join(tree, "package.json");
  const pkg = JSON.parse(fs.readFileSync(pkgFile, "utf8"));
  pkg.name = "timewarp-desktop"; pkg.productName = "Timewarp"; pkg.description = "Timewarp desktop with a local agent harness";
  pkg.version = macRelease ? require('../mac-release.json').version : (store ? store.version : (release.enabled ? release.version : (stageOnly ? require('../package.json').version + '-draft.1' : require('../package.json').version)));
  fs.writeFileSync(pkgFile, JSON.stringify(pkg, null, 2));
  const target = path.join(tree, "out/main/timewarp");
  for (const folder of ["desktop", "shared", "assets"]) fs.cpSync(path.join(root, folder), path.join(target, folder), { recursive: true });
  fs.copyFileSync(path.join(root, "config.json"), path.join(target, "config.json"));
  fs.writeFileSync(path.join(target, 'release.json'), JSON.stringify(release, null, 2));
  if(acceptance)fs.copyFileSync(path.join(root,'scripts/verify-packaged-auth.cjs'),path.join(target,'verify-packaged-auth.cjs'));
  if(localAcceptance)fs.copyFileSync(path.join(root,'scripts/verify-local-harness.cjs'),path.join(target,'verify-local-harness.cjs'));
  if(servicesAcceptance){fs.copyFileSync(path.join(root,'scripts/verify-services.cjs'),path.join(target,'verify-services.cjs'));fs.appendFileSync(bootFile,'\nrequire("./timewarp/verify-services.cjs").init();\n');}
  if(billingAcceptance){fs.copyFileSync(path.join(root,'scripts/verify-billing-desktop.cjs'),path.join(target,'verify-billing-desktop.cjs'));fs.appendFileSync(bootFile,'\nrequire("./timewarp/verify-billing-desktop.cjs").init();\n');}
  if(chatgptAcceptance){fs.copyFileSync(path.join(root,'scripts/verify-chatgpt-desktop.cjs'),path.join(target,'verify-chatgpt-desktop.cjs'));fs.appendFileSync(bootFile,'\nrequire("./timewarp/verify-chatgpt-desktop.cjs").init();\n');}
  const brandSource = path.join(root, "assets/timewarp-logo.svg");
  const renderer = path.join(tree, "out/renderer");
  fs.cpSync(path.join(root,'assets/onboarding-icons'),path.join(renderer,'onboarding-icons'),{recursive:true});
  fs.copyFileSync(brandSource, path.join(renderer, "timewarp-logo.svg"));
  fs.copyFileSync(path.join(root, 'assets/app-icon.svg'), path.join(renderer, 'app-icon.svg'));
  const rendererAssets = path.join(renderer, "assets");
  for (const file of fs.readdirSync(rendererAssets).filter(name => name.endsWith(".js"))) {
    const targetFile = path.join(rendererAssets, file);
    let source = rebrandJavaScript(fs.readFileSync(targetFile, "utf8"));
    if (file === (macBuild ? inputs.lock.rendererIndex : "index-C6BbfH_v.js")) source = patchReasoningSchema(patchSmoothBackdrop(patchRendererPalette(patchAppearanceDefaults(rebrandAssistantLogo(source, fs.readFileSync(brandSource, "utf8"))))));
    if (file === (macBuild ? inputs.lock.rendererUi : "mermaid-GHXKKRXX-YWFhvrpV.js")) {
      source=patchTaskActivity(source);
      source=patchAgentCreation(patchConnectorRouting(source));
      source=patchLegacyOnboarding(source);
      source=replaceFunctionBody(source,'const r=ja(),s=M0(),i={open:t,onOpenChange:e,conversationId:n}', '{return h.jsx(_4e,{open:t,onOpenChange:e,conversationId:n,diagnostics:null})}');
      source=replaceOnce(source,'Tell us what happened or what could be better. We will include diagnostic context from this app so we can investigate.','Tell us what happened or what could be better. Your report, app version, and platform will be sent to Timewarp support.','feedback data disclosure');
      // Connected Codex catalog ids are unprefixed (gpt-5.5), so they never
      // resolved to provider "openai" and the free-credit gate blocked them.
      source=replaceOnce(source,'a3e=t=>!!t&&Ihe(t).provider==="openai"','a3e=t=>!!t&&(Ihe(t).provider==="openai"||!t.includes("/"))','Codex catalog models use the ChatGPT allowance');
      source = patchProfileLogo(patchPresetPicker(source));
      source = patchModelPicker(source);
      source = patchWorkspacePane(source);
      source = patchBrowserCursor(source);
      source = patchOrganizations(patchSidebarAccount(patchSmoothThemePicker(patchAppChrome(source))));
      for(const [index,url]of oldMascots.entries())source=source.replaceAll(url,'http://127.0.0.1:7788/mascots/'+['orbit','nova'][index]+'.png');
      source=replaceOnce(source,'a=i==="account"||i==="local"&&e,o=', 'a=(i==="account"||i==="local"&&e)&&/^product\\.(?:organizations\\.|profile\\.update$|images\\.beginUpload$|usage\\.(?:energy|chatgpt)$|chatgpt\\.(?:connection|disconnect)$|integrations\\.(?:list|beginConnect|completeConnect|connectWithCredential|disconnect|remove|getAccess|setAccess|mcps\\.list)$|feedback\\.submit$|surveys\\.list$)/.test(r.path),o=', "cloud account routes only");
      source=replaceFunctionBody(source,'const t=ku(),{retrySession:e,session:n}=bn(),r=_p(),s=le.useUtils(),i=!!n?.activeOrganization,a=le.product.billing.overview', '{return h.jsx("div",{className:"min-h-0 flex-1 overflow-auto bg-background",ref:node=>{if(node)window.timewarpMountBilling?.(node)}})}');
      source=replaceOnce(source,'nU=async(t,e)=>{const n=await e();if(!n)throw new Error("Picture uploads are unavailable.");const r=new FormData;if(r.set("file",t),!(await fetch(n.uploadUrl,{method:"POST",body:r})).ok)', 'nU=async(t,e)=>{const n=await e();if(!n)throw new Error("Picture uploads are unavailable.");if(t.size>5242880||!["image/png","image/jpeg","image/webp"].includes(t.type))throw new Error("Choose a PNG, JPEG or WebP picture smaller than 5 MB.");if(!(await fetch(n.uploadUrl,{method:"PUT",headers:{"content-type":t.type},body:t})).ok)', 'signed profile picture upload');
      source=replaceOnce(source,'title:"Connect your browser",subtitle:"Use your signed-in websites",action:"Connect"', 'title:"Browser profiles",subtitle:"Manage profiles on this device",action:"Manage"', 'local browser suggestion');
      source=replaceOnce(source,'return e?h.jsxs(Jte,{children:[k.length>0?h.jsx(s1t,', 'return e?h.jsxs(Jte,{children:[h.jsx("p",{className:"px-4 text-sm text-muted-foreground",children:"Browser profiles, cookies, passwords and browser actions stay on this device. The local harness uses the cloud model."}),k.length>0?h.jsx(s1t,', 'local browser data boundary');
      source=source.replace('Disables background conversation, workspace, and debug-trace uploads from this device. Browser profiles and tabs are still shared with cloud tasks. Diagnostic error reports are still sent.', 'Pauses cloud chat-history synchronization. Your model requests still use the cloud. Files, memory, browser profiles, cookies and the vault stay on this device.');
      source=replaceFunctionBody(source,'emailInputId:"login-email"','{return h.jsx("main",{id:"timewarp-auth-view",className:"relative flex h-full w-full items-center justify-center bg-background px-6 py-12 text-foreground",ref:node=>{if(node)window.timewarpMountAuth?.(node)}})}');
    }
    fs.writeFileSync(targetFile, renameAgentCopy(source));
  }
  fs.copyFileSync(path.join(root,'assets/mascots/orbit.png'),path.join(rendererAssets,'spike-CJAAbuRN.png'));
  fs.copyFileSync(path.join(root,'assets/mascots/nova.png'),path.join(rendererAssets,'inbox-zero-BnnLXYIU.png'));
  for (const {name} of require('../shared/mascots.cjs').choices) fs.copyFileSync(path.join(root,'assets/mascots',name.toLowerCase()+'.png'),path.join(rendererAssets,'timewarp-mascot-'+name.toLowerCase()+'.png'));
  fs.copyFileSync(path.join(root,"desktop/native-billing.js"),path.join(renderer,"timewarp-billing.js"));
  fs.copyFileSync(path.join(root,"desktop/billing.css"),path.join(renderer,"timewarp-billing.css"));
  fs.copyFileSync(path.join(root,"desktop/auth-ui.js"),path.join(renderer,"timewarp-auth.js"));
  fs.copyFileSync(path.join(root,"desktop/organization-gate.js"),path.join(renderer,"timewarp-organization.js"));
  fs.copyFileSync(path.join(root,"desktop/connector-browser.js"),path.join(renderer,"timewarp-connector-browser.js"));
  fs.copyFileSync(path.join(root,"desktop/auth.css"),path.join(renderer,"timewarp-auth.css"));
  fs.copyFileSync(path.join(root,"desktop/appearance.css"),path.join(renderer,"timewarp-appearance.css"));
  fs.copyFileSync(path.join(root,"desktop/controls.css"),path.join(renderer,"timewarp-controls.css"));
  fs.copyFileSync(path.join(root,"desktop/model-picker.css"),path.join(renderer,"timewarp-model-picker.css"));
  fs.copyFileSync(path.join(root,"desktop/agents.css"),path.join(renderer,"timewarp-agents.css"));
  fs.copyFileSync(path.join(root,"desktop/workspace.css"),path.join(renderer,"timewarp-workspace.css"));
  fs.copyFileSync(path.join(root,"desktop/browser-cursor.css"),path.join(renderer,"timewarp-browser-cursor.css"));
  fs.copyFileSync(path.join(root,"desktop/onboarding-ui.js"),path.join(renderer,"timewarp-onboarding.js"));
  fs.copyFileSync(path.join(root,"desktop/onboarding.css"),path.join(renderer,"timewarp-onboarding.css"));
  const htmlFile = path.join(renderer, "index.html");
  fs.copyFileSync(path.join(root,'desktop/task-activity.css'),path.join(renderer,'timewarp-task-activity.css'));
  fs.writeFileSync(htmlFile,fs.readFileSync(htmlFile,'utf8').replace('</head>','<link rel="stylesheet" href="./timewarp-task-activity.css"></head>'));
  fs.writeFileSync(htmlFile, fs.readFileSync(htmlFile,"utf8").replace("</head>", '<link rel="stylesheet" href="./timewarp-onboarding.css"><script src="./timewarp-onboarding.js" defer></script></head>'));
  fs.writeFileSync(htmlFile, fs.readFileSync(htmlFile, "utf8").replace("</head>", '<link rel="stylesheet" href="./timewarp-model-picker.css"></head>'));
  fs.writeFileSync(htmlFile, fs.readFileSync(htmlFile, "utf8").replace("</head>", '<link rel="stylesheet" href="./timewarp-workspace.css"></head>'));
  fs.writeFileSync(htmlFile, fs.readFileSync(htmlFile, "utf8").replace("</head>", '<link rel="stylesheet" href="./timewarp-browser-cursor.css"></head>'));
  fs.writeFileSync(htmlFile, fs.readFileSync(htmlFile, "utf8").replace("</head>", '<link rel="stylesheet" href="./timewarp-billing.css"></head>'));
  fs.writeFileSync(htmlFile, fs.readFileSync(htmlFile, "utf8").replace("</head>", '<link rel="icon" href="./app-icon.svg"><link rel="stylesheet" href="./timewarp-auth.css"><link rel="stylesheet" href="./timewarp-appearance.css"><link rel="stylesheet" href="./timewarp-agents.css"><link rel="stylesheet" href="./timewarp-controls.css"><script src="./timewarp-auth.js" defer></script><script src="./timewarp-organization.js" defer></script><script src="./timewarp-billing.js" defer></script><script src="./timewarp-connector-browser.js" defer></script></head>'));
  const preloads = [];
  const visit = (directory) => { for (const entry of fs.readdirSync(directory, { withFileTypes: true })) { const file = path.join(directory, entry.name); if (entry.isDirectory()) visit(file); else if (entry.name === "index.js" && file.includes(`${path.sep}preload${path.sep}`)) preloads.push(file); } };
  visit(path.join(tree, "out"));
  if (!preloads.length) throw new Error("Desktop preload not found.");
  for (const file of preloads) fs.appendFileSync(file, '\nrequire("electron").contextBridge.exposeInMainWorld("timewarp",{request:(action,input)=>require("electron").ipcRenderer.invoke("timewarp:request",action,input),onExecutionChanged:callback=>{const ipc=require("electron").ipcRenderer,listener=()=>callback();ipc.on("timewarp:executionChanged",listener);return()=>ipc.removeListener("timewarp:executionChanged",listener)}});\n');
  // File-backed app resources and PE integrity remain verifiable after packing.
  const stagedAsar = path.join(root, macBuild ? 'build/timewarp-mac-app.asar' : "build/timewarp-app.asar");
  const stagedExe = path.join(root, "build/Timewarp.exe");
  if (macBuild) {
    await asar.createPackageWithOptions(tree, stagedAsar, { unpack: '**/*.{node,dylib}' });
    fs.mkdirSync(path.join(root,'reports'), {recursive:true});
    fs.writeFileSync(path.join(root,'reports/mac-patched-app.json'),JSON.stringify({version:pkg.version,archive:stagedAsar,arch:inputs.lock.arch,upstreamVersion:inputs.lock.productVersion,asarSha256:crypto.createHash('sha256').update(fs.readFileSync(stagedAsar)).digest('hex'),profile:profileName},null,2));
    console.log('Patched macOS application archive: '+stagedAsar);
    return;
  }
  await asar.createPackage(tree, stagedAsar);
  if(stageOnly)await require('./electron-runtime.cjs').prepareExecutable(stagedExe,stagedAsar);
  else fs.copyFileSync(baselineExe, stagedExe);
  const ico = path.join(path.dirname(brandSource), "app-icon.ico");
  await (await import('rcedit')).rcedit(stagedExe, { icon: ico, 'version-string': { ProductName: 'Timewarp', FileDescription: 'Timewarp desktop' }, 'file-version': pkg.version.split('-')[0], 'product-version': pkg.version.split('-')[0] });
  run(path.join(energy, "build/fix-asar-integrity.js"), [stagedExe, stagedAsar]);
  if (stageOnly) {
    const destination = path.join(root, 'build/native');
    if (fs.existsSync(destination)) {
      const actual = fs.realpathSync(destination), base = fs.realpathSync(path.join(root, 'build'));
      if (actual !== path.join(base, 'native') || fs.lstatSync(destination).isSymbolicLink()) throw new Error('Unsafe native staging path.');
      const running = cp.execFileSync('powershell.exe', ['-NoProfile','-Command', 'Get-CimInstance Win32_Process -Filter "Name=\'Timewarp.exe\' OR Name=\'Timewarp Preview.exe\'" | Where-Object { [System.IO.Path]::GetDirectoryName($_.ExecutablePath) -eq $env:TIMEWARP_STAGED_DIRECTORY } | Select-Object -ExpandProperty ProcessId'], { windowsHide: true, encoding: 'utf8', env: { ...process.env, TIMEWARP_STAGED_DIRECTORY: destination } });
      if (running.trim()) throw new Error('Close the staged preview before rebuilding it.');
      fs.rmSync(actual, { recursive: true, maxRetries: 5, retryDelay: 200 });
    }
    copyRuntime(inputs, destination);
    require('./electron-runtime.cjs').copyElectronCore(destination);
    fs.mkdirSync(path.join(destination, 'resources'), { recursive: true });
    fs.copyFileSync(stagedExe, path.join(destination, 'Timewarp.exe'));
    fs.copyFileSync(stagedAsar, path.join(destination, 'resources/app.asar'));
    if (release.enabled) fs.writeFileSync(path.join(destination, 'resources/app-update.yml'), require('js-yaml').dump({ provider: 'generic', url: release.updateUrl, channel: 'latest', updaterCacheDirName: 'timewarp-updater', publisherName: release.publisherNames }));
    fs.mkdirSync(path.join(root, 'reports'), { recursive: true });
    fs.writeFileSync(path.join(root, 'reports/staged-build.json'), JSON.stringify({ builtAt: new Date().toISOString(), version: pkg.version, upstreamVersion: inputs.lock.productVersion, electronVersion:require('electron/package.json').version, exe: path.join(destination, 'Timewarp.exe'), asarSha256: crypto.createHash('sha256').update(fs.readFileSync(stagedAsar)).digest('hex'), cloud: config.supabaseUrl, signed: false, publicRelease: release.enabled, profile: profileName }, null, 2));
    console.log('Timewarp staged at ' + destination + '. The working app was preserved.');
    return;
  }
  requireClosedApp();
  const previousExe = path.join(root, "build/previous-Timewarp.exe");
  const previousAsar = path.join(root, "build/previous-app.asar");
  if (fs.existsSync(exe)) fs.copyFileSync(exe, previousExe);
  fs.copyFileSync(oldAsar, previousAsar);
  const installFile = (source, destination) => {
    try { fs.renameSync(source, destination); }
    catch (error) {
      // OneDrive can deny replacement-by-rename after Electron closes, while
      // allowing writes. Recheck shutdown and keep the same rollback backups.
      if (!['EPERM', 'EACCES', 'EBUSY'].includes(error.code)) throw error;
      requireClosedApp();
      // Windows may keep an exited executable mapped while its parent retains
      // a process handle. Moving that file aside allows a fresh installation.
      const retired = path.join(root, 'build', 'retired-' + Date.now() + '-' + path.basename(destination));
      let moved = false;
      try { fs.renameSync(destination, retired); moved = true; }
      catch (moveError) { if (!['EPERM', 'EACCES', 'EBUSY'].includes(moveError.code)) throw moveError; }
      try { fs.copyFileSync(source, destination); }
      catch (copyError) { if (moved) fs.renameSync(retired, destination); throw copyError; }
      fs.unlinkSync(source);
      if (moved) { try { fs.unlinkSync(retired); } catch {} }
    }
  };
  try {
    installFile(stagedExe, exe);
    installFile(stagedAsar, oldAsar);
  } catch (error) {
    if (fs.existsSync(previousExe)) fs.copyFileSync(previousExe, exe);
    fs.copyFileSync(previousAsar, oldAsar);
    throw error;
  }
  fs.mkdirSync(path.join(root, "reports"), { recursive: true });
  fs.writeFileSync(path.join(root, "reports/build.json"), JSON.stringify({ builtAt: new Date().toISOString(), exe, profile: "%APPDATA%/Timewarp Energy", upstreamVersion: pkg.version, asarSha256: crypto.createHash("sha256").update(fs.readFileSync(oldAsar)).digest("hex"), cloud: config.supabaseUrl, signed: false, vaultBackend: "local", cvcPersisted: false }, null, 2));
  console.log("Timewarp built. Start launch.cmd in the workspace root.");
}
module.exports={patchConnectorRouting};
if(require.main===module)build().catch(error => { console.error(error.message); process.exitCode = 1; });
