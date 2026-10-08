"use strict";
const acorn = require('acorn');
const { createModelPicker } = require('../desktop/model-picker.cjs');
function patchReasoningSchema(source) {
  const before = '["none","minimal","low","medium","high","xhigh","max"]';
  if (source.split(before).length !== 2) throw new Error('Native reasoning schema contract changed.');
  const main = source.includes('o.z.enum(' + before + ')');
  const enumCall = main ? 'o.z.enum' : 'Vi';
  const stringCall = main ? 'o.z.string()' : 'Ca()';
  const effort = enumCall + '(' + before + ')';
  if (!source.includes(effort)) throw new Error('Native reasoning constructor contract changed.');
  source = source.replace(effort, stringCall + '.min(1).max(100)');
  // Provider tiers are opaque ids (for example priority), not the UI label fast.
  const tier = enumCall + '(["fast","flex"])';
  if (source.split(tier).length !== 2) throw new Error('Native service tier schema contract changed.');
  return source.replace(tier, stringCall + '.min(1).max(100)');
}
function patchModelPicker(source) {
  const ast = acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'module' });
  const matches = ast.body.filter(node => node.type === 'VariableDeclaration')
    .flatMap(node => node.declarations).filter(node => node.id.name === 'zCe');
  if (matches.length !== 1 || !source.slice(matches[0].start, matches[0].end).includes('le.product.models.list.useQuery()')) throw new Error('Native model picker contract changed.');
  const component = `(${createModelPicker.toString()})({React:b,jsx:h,Popover:tc,Trigger:Lu,Content:nc,Button:ne,ChevronDown:Na,ChevronRight:j2,Check:Dn,useModels:()=>le.product.models.list.useQuery()})`;
  const composer = ast.body.filter(node => node.type === 'VariableDeclaration').flatMap(node => node.declarations).filter(node => node.id.name === 'nyn');
  if (composer.length !== 1) throw new Error('Native composer model trigger contract changed.');
  const trigger = `({label,modelLabel,effortLabel,speedLabel,custom,className,...props})=>h.jsxs(ne,{type:"button",variant:"ghost",size:"sm",...props,title:label,"aria-label":"Model and thinking: "+label,className:"timewarp-model-trigger"+(className?" "+className:""),children:[h.jsx("span",{className:"timewarp-model-name",children:modelLabel}),h.jsx("span",{className:"timewarp-model-effort",children:effortLabel}),speedLabel&&h.jsx("span",{className:"timewarp-model-speed",children:speedLabel}),h.jsx(Na,{"aria-hidden":true})]})`;
  const edits = [{node:matches[0].init,value:component},{node:composer[0].init,value:trigger}].sort((a,b)=>b.node.start-a.node.start);
  for(const edit of edits) source = source.slice(0,edit.node.start)+edit.value+source.slice(edit.node.end);
  return source;
}
module.exports = { patchModelPicker, patchReasoningSchema };
