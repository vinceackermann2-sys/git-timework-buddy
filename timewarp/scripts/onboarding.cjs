"use strict";
const {replaceFunctionBody}=require('./patch-native.cjs');

function once(source,from,to){if(source.split(from).length!==2)throw Error('Native onboarding contract changed: '+from.slice(0,70));return source.replace(from,to);}
const readyHook='const[twReady,twSetReady]=b.useState(!!window.timewarpReadyOrganization);b.useEffect(()=>{const ready=()=>twSetReady(!0);window.addEventListener("timewarp:organization-ready",ready);return()=>window.removeEventListener("timewarp:organization-ready",ready)},[]);';
// One native route owns the fullscreen onboarding; completed accounts bypass it.
function patchLegacyOnboarding(source){
  source=replaceFunctionBody(source,
    'const{done:t,loaded:e}=X3e(),n=Nn();return R3e().pending',
    '{'+readyHook+'const{done:t,loaded:e}=X3e(),n=Nn();return !twReady||n.pathname.startsWith("/customize/billing")||R3e().pending?h.jsx(N8,{}):e?t?h.jsx(N8,{}):h.jsx(Ui,{to:"/onboarding",replace:!0,state:{from:n.pathname}}):null}');
  return replaceFunctionBody(source,
    'const t=le.useUtils(),e=le.product.settings.get.useQuery(),n=e.data?.onboarding.conversationId??null',
    '{const{done:t,loaded:e}=X3e();return !e?null:t?h.jsx(Ui,{to:"/",replace:!0}):h.jsx("main",{className:"timewarp-onboarding-root",ref:node=>{if(node)window.timewarpMountOnboarding?.(node)}})}');
}
function patchOnboardingPrompts(source){
  source=once(source,'const r=await this.fetchRemote(n),s=Yw(r)','const r=require("./timewarp/desktop/onboarding.cjs").brandPromptBundle(await this.fetchRemote(n)),s=Yw(r)');
  return once(source,'const a=i??nce(n);return{bundle:a','const a=require("./timewarp/desktop/onboarding.cjs").brandPromptBundle(i??nce(n));return{bundle:a');
}
function patchCursorImports(source){
  source=once(source,'Ku=["codex-chatgpt:mcp"','Ku=["cursor:memory","cursor:skills","codex-chatgpt:mcp"');
  source=once(source,'Sg={"codex-chatgpt"','Sg={cursor:"Cursor","codex-chatgpt"');
  source=once(source,'return{codexHome:k.join(n,".codex"),claudeHome:i','return{get cursorHome(){return require("./timewarp/desktop/runtime.cjs").getCursorImportRoot()},codexHome:k.join(n,".codex"),claudeHome:i');
  source=once(source,'r.has("claude-code:skills")&&k.join(this.options.paths.claudeHome,"skills")','r.has("claude-code:skills")&&k.join(this.options.paths.claudeHome,"skills"),r.has("cursor:skills")&&k.join(this.options.paths.cursorHome,"skills")');
  source=once(source,'const[n,r,s,i,a,c,l]=await Promise.all','const[n,r,s,i,a,c,l,u,h]=await Promise.all');
  source=once(source,'rI(this.options.paths.claudeDesktopConfigPath,e)]);return{items:','rI(this.options.paths.claudeDesktopConfigPath,e),require("./timewarp/desktop/setup-imports.cjs").detectCursorMemory(this.options.paths.cursorHome),Qz(k.join(this.options.paths.cursorHome,"skills"),e)]);return{items:');
  source=once(source,'Qw("claude-desktop:mcp",l)].filter','Qw("claude-desktop:mcp",l),Jz("cursor:memory",u),Zz("cursor:skills",h)].filter');
  source=once(source,'["Claude home",this.options.paths.claudeHome]])','["Claude home",this.options.paths.claudeHome],["Cursor home",this.options.paths.cursorHome]])');
  return source;
}
module.exports={patchLegacyOnboarding,patchOnboardingPrompts,patchCursorImports};
