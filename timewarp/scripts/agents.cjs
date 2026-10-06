"use strict";
const acorn = require('acorn');
const { choices } = require('../shared/mascots.cjs');
const { replaceFunctionBody } = require('./patch-native.cjs');

function replaceOnce(source, before, after, label) {
  if (source.split(before).length !== 2) throw new Error('Agent UI contract changed: ' + label);
  return source.replace(before, after);
}

// Preserve runtime roles, routes, CSS selectors, stored keys and analytics names.
function renameAgentCopy(source) {
  const changes = [];
  for (const token of acorn.tokenizer(source, { ecmaVersion: 'latest', sourceType: 'module', allowReturnOutsideFunction: true })) {
    if (!['string', 'template'].includes(token.type.label) || typeof token.value !== 'string') continue;
    const value = token.value;
    if (!/\bassistants?\b/i.test(value) || /copyright|licensed under/i.test(value)) continue;
    if (!/\s/.test(value) && !/^Assistants?$/.test(value)) continue;
    const rename = text => text.replace(/(?<![\w./:<>?=-])assistants?(?![\w./:<>?=-])/gi, word =>
      (word[0] === 'A' ? 'Agent' : 'agent') + (/s$/i.test(word) ? 's' : ''));
    const replacement = token.type.label === 'string' ? JSON.stringify(rename(value)) : rename(source.slice(token.start, token.end));
    if (replacement !== source.slice(token.start, token.end)) changes.push({ start: token.start, end: token.end, replacement });
  }
  for (const change of changes.reverse()) source = source.slice(0, change.start) + change.replacement + source.slice(change.end);
  return source;
}

function patchAgentAvatarResolver(source) {
  return replaceOnce(source,
    'GC=async(t,e)=>e?e.type==="native"&&e.imageId===xq?I0:e.type==="native"&&e.imageId===ane?one:{avatarType:e.type,avatarUrl:await t.resolveImageUpload(e.imageId)}:{avatarType:null,avatarUrl:null}',
    'GC=async(t,e)=>e?(e.type==="native"&&require("./timewarp/desktop/mascots.cjs").selectedAvatar(e.imageId))||(e.type==="native"&&e.imageId===xq?I0:e.type==="native"&&e.imageId===ane?one:{avatarType:e.type,avatarUrl:await t.resolveImageUpload(e.imageId)}):{avatarType:null,avatarUrl:null}',
    'native mascot persistence');
}

function patchAgentCreation(source) {
  const defaultAvatar = JSON.stringify({ kind: 'mascot', imageId: choices[0].imageId });
  if (source.split('{kind:"empty"}').length !== 3) throw new Error('Agent UI contract changed: creation defaults');
  source = source.replaceAll('{kind:"empty"}', defaultAvatar);
  source = replaceOnce(source, 'avatar:o?{type:"upload",imageId:o}:null,instructions:a,introduction:"generated"',
    'avatar:r.kind==="mascot"?{type:"native",imageId:r.imageId}:o?{type:"upload",imageId:o}:null,instructions:a,introduction:"generated"', 'selected mascot submission');
  source = replaceFunctionBody(source, 'const s=b.useRef(null),[i,a]=b.useState(null),o=b.useMemo(()=>t.kind', `{
    const s=b.useRef(null),[i,a]=b.useState(null),choices=${JSON.stringify(choices)}.map(choice=>({...choice,previewUrl:new URL("timewarp-mascot-"+choice.name.toLowerCase()+".png",import.meta.url).href}));
    const o=b.useMemo(()=>t.kind==="upload"?URL.createObjectURL(t.file):null,[t]);
    b.useEffect(()=>()=>{o&&URL.revokeObjectURL(o)},[o]);
    const selected=t.kind==="mascot"?choices.find(choice=>choice.imageId===t.imageId):null;
    const upload=file=>{if(!file||e)return;const error=tU(file);if(error)return a(error);a(null);r({kind:"upload",file})};
    return h.jsxs("div",{className:"timewarp-agent-avatar",children:[
      h.jsx("div",{className:"timewarp-agent-avatar-preview",children:h.jsx(Tp,{avatar:o?{type:"upload",url:o}:selected?{type:"native",url:selected.previewUrl}:null,displayName:n.trim()||"Agent",className:"size-full"})}),
      h.jsx("span",{className:"text-sm font-medium",children:"Choose mascot"}),
      h.jsx("div",{role:"group","aria-label":"Choose mascot",className:"timewarp-mascot-options",children:choices.map(choice=>h.jsxs("button",{
        type:"button",disabled:e,"aria-label":"Choose "+choice.name,"aria-pressed":selected?.imageId===choice.imageId,
        className:"timewarp-mascot-option",onClick:()=>{a(null);r({kind:"mascot",imageId:choice.imageId})},
        children:[h.jsx("img",{src:choice.previewUrl,alt:"",className:"timewarp-mascot-image"}),h.jsx("span",{children:choice.name})]
      },choice.imageId))}),
      h.jsx("input",{ref:s,type:"file",accept:"image/jpeg,image/png,image/webp",className:"hidden",disabled:e,onChange:event=>{upload(event.target.files?.[0]);event.target.value=""}}),
      h.jsxs(ne,{type:"button",variant:"outline",size:"sm",disabled:e,onClick:()=>s.current?.click(),children:[h.jsx(Khe,{}),"Upload picture"]}),
      i&&h.jsx("p",{role:"alert",className:"text-sm text-destructive",children:i})
    ]});
  }`);
  return replaceOnce(source, 'h.jsx(St,{className:"sr-only",children:"New Assistant"})',
    'h.jsx(St,{className:"text-center text-lg font-semibold",children:"New Agent"})', 'creation heading');
}

module.exports = { renameAgentCopy, patchAgentCreation, patchAgentAvatarResolver };
