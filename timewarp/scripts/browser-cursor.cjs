"use strict";
const acorn = require('acorn');
const { createUseBrowserCursorAgent } = require('../desktop/browser-cursor.js');

function replaceOnce(source, before, after, label) {
  if (source.split(before).length !== 2) throw new Error('Browser cursor contract changed: ' + label);
  return source.replace(before, after);
}
function transformDeclaration(source, name, transform) {
  const declarations = acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'module' }).body.flatMap(node => node.declarations || []);
  const matches = declarations.filter(node => node.id.name === name);
  if (matches.length !== 1) throw new Error('Browser cursor declaration changed: ' + name);
  const node = matches[0].init;
  return source.slice(0, node.start) + transform(source.slice(node.start, node.end)) + source.slice(node.end);
}
function patchBrowserCursor(source) {
  source = transformDeclaration(source, 'YNn', component => {
    component = replaceOnce(component, 'i=XNn(),a=QNn()', 'i=XNn(),TWAgent=TWUseBrowserAgent(i.threadId,i.activeTurnId),a=QNn()', 'active agent lookup');
    return replaceOnce(component, 'summary:i.summary})', 'summary:i.summary,agent:TWAgent})', 'cursor agent identity');
  });
  source = transformDeclaration(source, 'ZNn', component => {
    component = replaceOnce(component, 'pressed:r,summary:s})', 'pressed:r,summary:s,agent:TWA=null})', 'cursor badge properties');
    component = replaceOnce(component, 's&&h.jsx(zIn,{', 'h.jsx(zIn,{', 'badge throughout browser work');
    return replaceOnce(component, 'shimmer:i,summary:s})', 'shimmer:i,summary:s||"Working in the browser",agent:TWA})', 'live browser action');
  });
  source = transformDeclaration(source, 'zIn', component => {
    component = replaceOnce(component, 'shimmer:o=!1,summary:l})', 'shimmer:o=!1,summary:l,agent:TWA=null})', 'badge identity');
    component = replaceOnce(component, 'Math.max(0,e.width-fl*2)', 'Math.min(280,Math.max(0,e.width-fl*2))', 'compact badge bounds');
    component = replaceOnce(component, '"data-cursor-pill":"",', '"data-cursor-pill":"","data-browser-cursor-badge":"","data-agent-id":TWA?.id,role:"status","aria-live":"polite",', 'badge activity status');
    component = replaceOnce(component, 'className:"pointer-events-none absolute', 'className:"timewarp-browser-cursor-badge pointer-events-none absolute', 'mascot badge appearance');
    return replaceOnce(component, 'children:h.jsx("span",{className:te("block min-w-0 truncate",o&&"shimmer"),children:l})', 'children:h.jsxs(h.Fragment,{children:[h.jsx(Tp,{avatar:TWA?.avatar??null,displayName:TWA?.displayName??"Agent",generating:!TWA,className:"timewarp-browser-cursor-mascot"}),h.jsx("span",{className:"timewarp-browser-cursor-copy",children:h.jsx("span",{className:te("timewarp-browser-cursor-action",o&&"shimmer"),children:l})})]})', 'mascot and action text');
  });
  return source + '\nconst TWUseBrowserAgent=(' + createUseBrowserCursorAgent.toString() + ')({b,request:input=>window.timewarp?.request("browserAgent",input)??Promise.resolve(null)});\n';
}

function patchBrowserCursorActivity(source) {
  // Publish every summary, including read-only commands in the same profile.
  source = replaceOnce(source, 'this.runtimes.beginAgentUse(e,n,r)&&(this.dismissTransientUi(Ee(e)),this.emitState(e.ownerId))', '(this.runtimes.beginAgentUse(e,n,r)&&this.dismissTransientUi(Ee(e)),this.emitState(e.ownerId))', 'live action summaries');
  // A new action label should leave the cursor at its existing position.
  source = replaceOnce(source, 'reconcile(e,n,r){const s=this.mount;', 'reconcile(e,n,r){const s=this.mount;const TWAgentChanged=s?.agentPresentation?.activeAgent.threadId!==r?.activeAgent.threadId||s?.agentPresentation?.activeAgent.turnId!==r?.activeAgent.turnId;', 'agent transition');
  return replaceOnce(source, '(i||a||c)&&(s.cursor=null),this.syncSurface(i||a)', '(i||a||TWAgentChanged)&&(s.cursor=null),this.syncSurface(i||a)', 'cursor remains stable during activity updates');
}

module.exports = { patchBrowserCursor, patchBrowserCursorActivity };
