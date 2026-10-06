"use strict";
// The upstream picker offers fixed Lite/Auto/Pro modes that map to models
// Timewarp does not serve. Show only the live catalog for the current plan:
// Sol and Luna on Timewarp credits, or the connected Codex catalog on Free.
function replaceOnce(text, from, to, name) {
  if (text.split(from).length !== 2) throw new Error(`Bundle contract changed: ${name}`);
  return text.replace(from, to);
}
function patchModelPicker(source) {
  // A chat saved with a model outside this plan's catalog runs on the model
  // codex-funding routes it to (same id, unprefixed Codex id, else featured).
  // Display that model instead of the stale id.
  source = replaceOnce(source, 'l=i.find(T=>T.id===r.name)', 'l=i.find(T=>T.id===r.name)||i.find(T=>T.id===r.name.replace(/^openai\\//,""))||i.find(T=>T.featured)||i[0]', 'picker resolves the routed model');
  source = replaceOnce(source, 'd=m$.find(T=>T.id===r.name),f=!d', 'd=void 0,f=!0', 'picker has no upstream modes');
  source = replaceOnce(source, 'children:g?h.jsx(acn,{', 'children:!0?h.jsx(acn,{', 'picker always lists the catalog');
  source = replaceOnce(source, 'modelId:r.name,models:i', 'modelId:l?.id??r.name,models:i', 'picker selects the routed model');
  source = replaceOnce(source, 'h.jsx("div",{className:"-mx-1 my-1 h-px bg-border"}),h.jsx(BCe,{checked:!0,disabled:n,onCheckedChange:i})', 'null', 'no switch back to upstream modes');
  return replaceOnce(source, '_=d?.label??ucn(l?.displayName??r.name,c)', '_=ucn(l?.displayName??(/-sol$/.test(r.name)?"Sol":/-luna$/.test(r.name)?"Luna":r.name.replace(/^openai\\//,"")),c)', 'picker label while the catalog loads');
}
module.exports = { patchModelPicker };
