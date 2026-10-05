"use strict";
const acorn = require('acorn');
const { recentWebsite, createUseRecentWebsites, createWorkspaceHome } = require('../desktop/workspace-home.js');

function replaceOnce(source, before, after, label) {
  if (source.split(before).length !== 2) throw new Error('Workspace pane contract changed: ' + label);
  return source.replace(before, after);
}

function replaceComponent(source, name, transform) {
  const ast = acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'module' });
  const declarations = ast.body.flatMap(node => node.declarations || []).filter(node => node.id.name === name);
  if (declarations.length !== 1) throw new Error('Workspace component contract changed: ' + name);
  const node = declarations[0].init;
  return source.slice(0, node.start) + transform(source.slice(node.start, node.end)) + source.slice(node.end);
}

function patchWorkspacePane(source) {
  source = replaceOnce(source, '[i,a]=$n(`${e}.mode`,"assistant")', '[i,a]=$n(`${e}.workspaceMode`,"browser")', 'unified home default');
  source = replaceComponent(source, 'qMn', () => '()=>null');
  source = replaceComponent(source, 'RMn', component => {
    component = replaceOnce(component, 'const a=b.useRef(null)', 'const TWLayout=is(),a=b.useRef(null)', 'tab strip layout actions');
    component = replaceOnce(component, 'className:"relative flex min-h-8 shrink-0', 'className:"app-titlebar-safe-area relative flex min-h-8 shrink-0', 'tab strip window controls');
    return replaceOnce(component, 'children:h.jsx(Pn,{})})]})}', 'children:h.jsx(Pn,{})}),h.jsx("div",{className:"app-no-drag flex shrink-0 items-center pr-1",children:TWLayout.layout==="secondary"?h.jsx(ne,{variant:"ghost",size:"icon-sm","aria-label":"Show chat",title:"Show chat",onClick:()=>TWLayout.setLayout("split"),children:h.jsx(Qhe,{})}):h.jsx(GMn,{})})]})}', 'pane controls beside browser tabs');
  });
  source = replaceComponent(source, 'KMn', component => {
    component = replaceOnce(component, 'className:"flex h-full min-h-0 min-w-0 flex-col bg-background"', 'className:"flex h-full min-h-0 min-w-0 flex-col bg-background",style:{containerType:"inline-size"}', 'responsive workspace');
    component = replaceOnce(component, 'n&&h.jsx(zTe,{placeholder:"Search..."', 'v==="files"&&n&&h.jsx(zTe,{placeholder:"Search files..."', 'file search in the Files tool');
    component = replaceOnce(component, 'a&&h.jsx(_o,', 'a&&(v==="files"&&(n||l.openItems.length>0)||!window.newco?.browserView)&&h.jsx(_o,', 'default tab replaces the heading row');
    component = replaceOnce(component, '(l.openItems.length>0||c?.tabs.some(_=>_.pinned))', 'l.openItems.length>0', 'file tabs in the Files tool');
    component = replaceOnce(component, 'window.newco?.browserView&&h.jsx(WMn,{ownerId:t}),', '', 'pinned sites remain in the browser tab strip');
    const start = component.indexOf('children:v==="assistant"?r:');
    const end = component.indexOf('})]})}', start);
    if (start < 0 || end < 0) throw new Error('Workspace pane contract changed: pane content');
    const fileStart = component.indexOf('i||(y&&g?', start);
    if (fileStart < 0) throw new Error('Workspace pane contract changed: file viewer');
    const fileContent = component.slice(fileStart, end);
    const content = `children:window.newco?.browserView?g&&h.jsx(HMn,{browserOwnerId:t,mode:v,assistantIcon:s,showAssistant:!!r,toolContent:v==="assistant"?r:v==="files"?(${fileContent}):null}):v==="assistant"?r:(${fileContent})`;
    return component.slice(0, start) + content + component.slice(end);
  });
  source = replaceComponent(source, 'HMn', () => '({browserOwnerId:t,...props})=>{const e=M0();return e&&h.jsx($Mn,{local:e,browserOwnerId:t,...props})}');
  source = replaceComponent(source, '$Mn', component => {
    const patch = (before, after, label) => { component = replaceOnce(component, before, after, label); };
    patch('({local:t,browserOwnerId:e})', '({local:t,browserOwnerId:e,mode="browser",toolContent=null,assistantIcon=null,showAssistant=true})', 'tool properties');
    patch('{clearPendingBrowserUrl:r,pendingBrowserUrl:s}=Ba()', '{clearPendingBrowserUrl:r,pendingBrowserUrl:s,setMode:TWSetMode}=Ba()', 'shared tool navigation');
    patch('M=b.useRef(s).current??s_;', 'M=b.useRef(s).current??"about:blank";const[TWToolTabs,TWSetToolTabs]=$n(`timewarp.workspace.${e}.tools`,{}),TWSwitching=b.useRef(null),TWIsHome=mode==="browser"&&(!d||!d.url||d.url==="about:blank"),TWHidePage=mode!=="browser"||TWIsHome,TWRecent=TWRecents(e,u,f);b.useEffect(()=>{const pending=TWSwitching.current;if(pending){if(pending.closed){if(d?.id===pending.closed)return;TWSwitching.current=null;TWSetMode(TWToolTabs[d?.id]||"browser");return}if(d?.id!==pending.target)return;TWSwitching.current=null}if(d&&mode!=="browser")TWSetToolTabs(previous=>previous[d.id]===mode?previous:{...previous,[d.id]:mode})},[d?.id,mode,TWSetToolTabs]);', 'home and local recents');
    patch('G?(n.setLayout({ownerId:e,layout:ee()}),Promise.resolve())', 'G?(!TWHidePage&&n.setLayout({ownerId:e,layout:ee()}),Promise.resolve())', 'home layout');
    patch('return U||!de.ok?de:n.show({ownerId:e,layout:ee()})', 'if(U||!de.ok)return de;if(TWHidePage){await n.hide({ownerId:e});return de}return n.show({ownerId:e,layout:ee()})', 'native surface visibility');
    patch('de.ok&&(G=!0,n.setLayout({ownerId:e,layout:ee()}))', 'de.ok&&(G=!0,!TWHidePage&&n.setLayout({ownerId:e,layout:ee()}))', 'native surface bounds');
    patch('[e,n,M,u]);const N=', '[e,n,M,u,TWHidePage]);const N=', 'tool visibility changes');
    patch('const N=BMn(d?.url??null)', 'const N=TWHidePage?"":BMn(d?.url??null)', 'home search label');
    patch('H=!!n&&!!d&&p.trim().length>0', 'H=!!n&&p.trim().length>0', 'home search enabled');
    patch('m(che(d?.url??null)),y(null)', 'm(mode==="browser"?che(d?.url??null):""),y(null)', 'tool search state');
    patch('[d?.url,e]),b.useEffect', '[d?.url,e,mode]),b.useEffect', 'tool search reset');
    patch('const V=()=>{!n||!d||!H||R(()=>n.navigate({ownerId:e,tabId:d.id,url:zMn(p)}))},j=()=>X(s_),W=', `const TWClearTool=()=>{d&&TWSetToolTabs(previous=>{const next={...previous};delete next[d.id];return next})},TWOpen=F=>{if(!n)return;if(!u){y({error:"Choose a browser profile to start browsing."});return}TWClearTool();TWSetMode("browser");d?R(()=>n.navigate({ownerId:e,tabId:d.id,url:F})):X(F)},TWHome=()=>{TWClearTool();TWSetMode("browser");const F=f.find(tab=>tab.profileId===u&&(!tab.url||tab.url==="about:blank")&&!TWToolTabs[tab.id])||(d&&(!d.url||d.url==="about:blank")?d:null);F?R(()=>n.selectTab({ownerId:e,tabId:F.id})):X("about:blank")},V=()=>{H&&TWOpen(zMn(p))},j=()=>{TWSetMode("browser");X("about:blank")},W=`, 'home search and add tab');
    patch('R(()=>n.connect({ownerId:e,profileId:F,url:s_}))', '(TWSetMode("browser"),R(()=>n.connect({ownerId:e,profileId:F,url:"about:blank"})))', 'profile switching');
    patch('return U.ok&&O&&i("primary"),U', 'if(U.ok&&O){TWSetMode("browser");return n.connect({ownerId:e,profileId:u,url:"about:blank"})}return U', 'last tab returns home');
    patch('const O=f.length===1;R(async()=>{const U=await n.closeTab({ownerId:e,tabId:F.id});', 'const O=f.length===1;if(F.id===d?.id){TWSwitching.current={closed:F.id};TWSetMode("browser")}R(async()=>{const U=await n.closeTab({ownerId:e,tabId:F.id});if(U.ok)TWSetToolTabs(previous=>{const next={...previous};delete next[F.id];return next});else TWSwitching.current=null;', 'closing tool tabs');
    patch('if(!u)return h.jsx(VMn,{isPending:o.isPending,isError:o.isError,onRetry:()=>o.refetch()});', '', 'tools before profile setup');
    patch('h.jsx(RMn,{tabs:f,', 'h.jsx(RMn,{tabs:f.map(tab=>TWToolTabs[tab.id]?{...tab,title:TWToolTabs[tab.id]==="assistant"?"Agent":"Files"}:!tab.url||tab.url==="about:blank"?{...tab,title:"New tab"}:tab),', 'unified tab titles');
    patch('onSelectTab:F=>{R(()=>n.selectTab({ownerId:e,tabId:F.id}))}', 'onSelectTab:F=>{TWSwitching.current={target:F.id};TWSetMode(TWToolTabs[F.id]||"browser");R(async()=>{const result=await n.selectTab({ownerId:e,tabId:F.id});if(!result.ok)TWSwitching.current=null;return result})}', 'tab selection restores tool');
    patch('ref:A,className:"flex h-9 shrink-0 items-center gap-0.5 bg-card px-1 text-muted-foreground",children:[', 'ref:A,className:"timewarp-browser-toolbar flex shrink-0 items-center bg-card px-1 text-muted-foreground",children:[h.jsx(ne,{variant:"ghost",size:"icon-sm","aria-label":"Browser home",title:"Browser home",onClick:TWHome,children:h.jsx(b4,{})}),', 'home toolbar');
    patch('h.jsx(ne,{ref:S,variant:', '!TWHidePage&&h.jsx(ne,{ref:S,variant:', 'audio control on websites');
    patch('placeholder:"Enter a URL"', 'placeholder:"Search or enter a URL","aria-label":"Search or enter a URL"', 'address search label');
    patch('P&&h.jsx(UMn,{profiles:l,selectedProfile:P,onSelectProfile:W})', 'P?h.jsx(UMn,{profiles:l,selectedProfile:P,onSelectProfile:W}):h.jsx(ne,{render:h.jsx(ur,{to:"/customize/browser"}),nativeButton:!1,variant:"ghost",size:"icon-sm","aria-label":"Manage browser profiles",children:h.jsx(A8,{})})', 'profile setup shortcut');
    patch('children:z&&h.jsx(Kc.div', 'children:!TWHidePage&&z&&h.jsx(Kc.div', 'audio notice on websites');
    patch('className:"relative min-h-0 flex-1 bg-background",children:x&&', `className:"relative min-h-0 flex-1 bg-background",children:TWIsHome?h.jsx(TWWorkspaceHome,{recents:TWRecent,onOpen:TWOpen,onTool:TWSetMode,assistantIcon,showAssistant,error:x?.error,profilePrompt:!u&&h.jsx(VMn,{isPending:o.isPending,isError:o.isError,onRetry:()=>o.refetch()})}):mode!=="browser"?h.jsxs("div",{className:"timewarp-workspace-tool",children:[h.jsxs("div",{className:"timewarp-workspace-tool-heading",children:[h.jsx(ne,{variant:"ghost",size:"icon-sm","aria-label":"Back to browser home",onClick:TWHome,children:h.jsx(_$,{})}),h.jsx("strong",{children:mode==="assistant"?"Agent":"Files"})]}),h.jsx("div",{className:"timewarp-workspace-tool-body",children:toolContent})]}):x&&`, 'shared home and tool content');
    return component;
  });
  return source + '\nconst TWWorkspaceHome=(' + createWorkspaceHome.toString() + ')({h,AgentIcon:b4,FilesIcon:Whe,SiteIcon:LDe});\nconst TWRecents=(' + createUseRecentWebsites.toString() + ')({b,record:(' + recentWebsite.toString() + ')});\n';
}

module.exports = { patchWorkspacePane };
