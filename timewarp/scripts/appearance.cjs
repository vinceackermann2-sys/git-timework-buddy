"use strict";
const { presets, defaultAccent } = require("../shared/appearance.cjs");
const acorn = require("acorn");

function replaceOnce(source, before, after, name) {
  if (source.split(before).length !== 2) throw new Error("Appearance contract changed: " + name);
  return source.replace(before, after);
}

function patchAppearanceDefaults(source) {
  source = replaceOnce(source,
    'accent:{hue:214.36363636363637,saturation:.7857142857142857,lightness:.7254901960784313,tint:.3}',
    'accent:' + JSON.stringify(defaultAccent), "default accent");
  return replaceOnce(source, 'texture:{type:"dots",step:2}', 'texture:{type:"dots",step:0}', "smooth default backdrop");
}

function replaceInitializers(source, replacements) {
  const declarations = acorn.parse(source, { ecmaVersion: "latest", sourceType: "module" }).body
    .filter(node => node.type === "VariableDeclaration").flatMap(node => node.declarations);
  const edits = Object.entries(replacements).map(([name, replacement]) => {
    const matches = declarations.filter(node => node.id.name === name && node.init);
    if (matches.length !== 1) throw new Error("Appearance contract changed: " + name);
    return { start: matches[0].init.start, end: matches[0].init.end, replacement };
  });
  for (const edit of edits.sort((a, b) => b.start - a.start)) source = source.slice(0, edit.start) + edit.replacement + source.slice(edit.end);
  return source;
}

function patchSmoothBackdrop(source) {
  // All native backdrop and color previews share this generator. Ignore saved
  // texture strength too, so existing profiles immediately get a smooth theme.
  return replaceInitializers(source, { u8: '()=>"none"' });
}

function patchAppChrome(source) {
  source = replaceInitializers(source, { Pit: "()=>null", HCe: "()=>null", kcn: "()=>null", zoe: "()=>null", Scn: "()=>null" });
  return replaceOnce(source, 'footer:t?h.jsx(kcn,{}):h.jsx(HCe,{versionLabel:null}),', '', "settings footer");
}

function patchSmoothThemePicker(source) {
  const ast = acorn.parse(source, { ecmaVersion: "latest", sourceType: "module" });
  const matches = [];
  const visit = node => {
    if (!node || typeof node !== "object") return;
    if (node.type === "CallExpression" && node.arguments[1]?.type === "ObjectExpression" &&
      node.arguments[1].properties.some(property => property.key?.value === "aria-label" && property.value?.value === "Backdrop dots")) matches.push(node);
    for (const value of Object.values(node)) if (Array.isArray(value)) value.forEach(visit); else if (value && typeof value === "object") visit(value);
  };
  visit(ast);
  if (matches.length !== 1) throw new Error("Appearance contract changed: backdrop dots control");
  const control = matches[0];
  source = source.slice(0, control.start) + "null" + source.slice(control.end);
  return replaceOnce(source, 'Pick a color, radiance, and backdrop texture', 'Pick a color and radiance', "smooth theme description");
}

function patchRendererPalette(source) {
  source = replaceOnce(source,
    'c8=["#efe7e0","#e695b2","#966991","#e25e62","#f28253","#f3d25b","#5de18f","#82b1f0","#5b5c7c"].map(x3)',
    'c8=' + JSON.stringify(presets.map(preset => preset.hex)) + '.map(x3)', "preset colors");
  source = replaceOnce(source, 'g=f===0?0:f/(1-Math.abs(2*p-1))', 'g=f===0?0:Math.min(1,Math.max(0,f/(1-Math.abs(2*p-1))))', "native HSL bounds");
  return replaceOnce(source, '>.62?"#172033":"#fff"', '>.22?"#172033":"#fff"', "pastel button contrast");
}

function patchPresetPicker(source) {
  const before = 'h.jsx("div",{className:"grid w-full grid-cols-9 place-items-center gap-1 px-2.5 py-2.5",children:ELe.map((E,A)=>h.jsx("button",{type:"button","aria-label":`Use theme preset ${A+1}`,disabled:n,className:"aspect-square w-full max-w-[21px] cursor-pointer rounded-full border-2 border-black/10 shadow-xs transition-transform hover:scale-105 active:scale-95 disabled:pointer-events-none disabled:opacity-60",style:{background:w5(E)},onClick:()=>s({...t,accent:E})},A))})';
  const after = 'h.jsx("div",{className:"timewarp-palette",role:"group","aria-label":"Timewarp color themes",children:' + JSON.stringify(presets) + '.map((preset,A)=>h.jsxs("button",{type:"button","aria-label":`Use ${preset.name} theme ${preset.hex}`,title:`${preset.name} · ${preset.hex}`,"aria-pressed":w5(t.accent).toUpperCase()===preset.hex,disabled:n,className:"timewarp-preset",onClick:()=>s({...t,accent:ELe[A]}),children:[h.jsx("span",{className:"timewarp-preset-swatch","aria-hidden":true,style:{background:preset.hex}}),h.jsx("span",{className:"timewarp-preset-name",children:preset.name}),h.jsx("span",{className:"timewarp-preset-hex",children:preset.hex})]},preset.hex))})';
  return replaceOnce(source, before, after, "named preset picker");
}

function patchProfileLogo(source) {
  const before = 'className:"absolute -right-0.5 -bottom-0.5 inline-flex size-3 items-center justify-center rounded-full bg-foreground text-[8px] font-semibold leading-none text-background ring-1 ring-background",children:"E"';
  const after = 'className:"absolute -right-0.5 -bottom-0.5 inline-flex size-3.5 items-center justify-center rounded-full bg-background ring-1 ring-border",children:h.jsx("img",{src:"./timewarp-logo.svg",alt:"Timewarp",className:"size-full object-contain"})';
  return replaceOnce(source, before, after, "browser profile logo");
}

function patchSidebarAccount(source) {
  // The header keeps the Timewarp brand; the account menu docks full width at
  // the bottom of the sidebar, opens upward, and usage moves into a card above it.
  source = replaceOnce(source,
    'children:[t,h.jsx("div",{className:"min-w-0 flex-1"}),o&&',
    'children:[h.jsxs("div",{className:"timewarp-sidebar-brand",children:[h.jsx("img",{src:"./timewarp-logo.svg",alt:"","aria-hidden":!0}),h.jsx("span",{children:"Timewarp"})]}),h.jsx("div",{className:"min-w-0 flex-1"}),o&&',
    "sidebar brand");
  source = replaceOnce(source,
    's&&h.jsx(kit,{className:"mt-auto pt-0",children:s})',
    'h.jsxs("div",{className:"mt-auto flex shrink-0 flex-col",children:[s&&h.jsx(kit,{className:"pt-0",children:s}),t&&h.jsx("div",{className:"timewarp-account-dock",children:t})]})',
    "sidebar account dock");
  source = replaceOnce(source,
    'className:"min-w-0 shrink gap-3 px-2 text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground",children:[s?h.jsx(But,{organization:s,user:e.user}):h.jsx(bW,{className:"size-6",user:e.user}),h.jsx("span",{className:"min-w-0 truncate font-medium",children:i}),h.jsx(Na,{className:"text-muted-foreground"})]',
    'className:"timewarp-account-trigger gap-2.5 px-2 text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground data-[popup-open]:bg-sidebar-accent",children:[s?h.jsx(But,{organization:s,user:e.user}):h.jsx(bW,{className:"size-6",user:e.user}),h.jsxs("span",{className:"timewarp-account-label",children:[h.jsx("span",{className:"truncate font-medium",children:i}),h.jsx("span",{className:"truncate text-xs text-muted-foreground",children:e.user.email})]}),h.jsx(Na,{className:"timewarp-account-chevron text-muted-foreground"})]',
    "full-width account trigger");
  source = replaceOnce(source,
    'h.jsxs(C1,{className:"min-w-80 rounded-lg",side:"bottom",align:"start",sideOffset:4,children:[t,h.jsx(jg,{}),h.jsxs(l0,{onClick:()=>n()',
    'h.jsxs(C1,{className:"min-w-0 rounded-lg",side:"top",align:"start",sideOffset:6,children:[t,h.jsx(jg,{}),h.jsxs(l0,{onClick:()=>n()',
    "account dropup");
  // Usage moves into a card above the trigger. The dropup keeps the
  // organization switcher (switch, settings, create) and Invite members.
  source = replaceOnce(source,
    'return r?h.jsxs(h.Fragment,{children:[h.jsxs(Dut,{children:[c&&h.jsx(Fut,{activeOrganization:c,onCreateOrganization:t,onSwitchOrganization:u,session:r}),e&&h.jsxs(l0,{onClick:e,children:[h.jsx(afe,{}),"Invite members"]}),h.jsx(Mut,{}),h.jsx(jg,{}),h.jsxs(l0,{onClick:()=>l(!0),children:[h.jsx(o_,{}),"Profile"]}),',
    'return r?h.jsxs(h.Fragment,{children:[h.jsx(ur,{to:"/customize/billing","aria-label":"Usage — open Billing",className:"timewarp-usage-card rounded-md bg-background/50 dark:bg-input/50",children:h.jsx(Mut,{})}),h.jsxs(Dut,{children:[c&&h.jsx(Fut,{activeOrganization:c,onCreateOrganization:t,onSwitchOrganization:u,session:r}),e&&h.jsxs(l0,{onClick:e,children:[h.jsx(afe,{}),"Invite members"]}),c&&h.jsx(jg,{}),h.jsxs(l0,{onClick:()=>l(!0),children:[h.jsx(o_,{}),"Profile"]}),',
    "usage card and account dropup items");
  source = replaceOnce(source,
    '(m||r.isError||s.isError)&&h.jsx("div",{className:"px-1 py-2 text-xs text-muted-foreground",children:m?"Loading usage…":"Usage unavailable"})',
    'h.jsxs("div",{className:"px-1 pb-1 pt-1",children:[h.jsxs("div",{className:"flex min-w-0 items-center justify-between gap-4 text-xs text-muted-foreground",children:[h.jsx("span",{className:"truncate font-medium",children:"Usage"}),h.jsx("span",{className:"shrink-0",children:m?"Loading…":"Unavailable"})]}),h.jsx("div",{role:"progressbar","aria-label":"Usage remaining","aria-valuetext":m?"Loading":"Unavailable",className:"mt-1.5 h-1 overflow-hidden rounded-full bg-muted"})]})',
    "usage meter placeholder");
  // The usage card is only a meter: drop the ChatGPT connect and upgrade rows.
  const meter = source.indexOf('Mut=()=>{');
  const start = source.indexOf(',!u&&h.jsxs(Vte,', meter);
  const end = source.indexOf(',e.error&&h.jsx("p",{className:"px-1 pb-2 text-xs text-destructive"', start);
  const rows = source.slice(start, end);
  if (meter < 0 || start < 0 || end < 0 || end - start > 3000 || !rows.includes('"Use for free with"') || !rows.includes('"Upgrade to Pro"') || rows.split('h.jsxs(Vte,').length !== 3)
    throw new Error("Appearance contract changed: usage card actions");
  source = source.slice(0, start) + source.slice(end);
  return replaceOnce(source,
    'i=t.status==="reconnect_required"?"Reconnect required":s===null?"Unavailable"',
    'i=t.status==="reconnect_required"?"Reconnect required":t.status==="disconnected"?"Connect in Billing":s===null?"Unavailable"',
    "disconnected ChatGPT usage");
}

module.exports = { patchAppearanceDefaults, patchRendererPalette, patchPresetPicker, patchProfileLogo, patchSmoothBackdrop, patchAppChrome, patchSmoothThemePicker, patchSidebarAccount };
