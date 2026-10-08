"use strict";
const acorn = require("acorn");

// Tokenizing leaves identifiers, protocol names, regular expressions and
// third-party license comments intact. UI text and prompt text get the brand.
function rebrandJavaScript(source) {
  const tokens = acorn.tokenizer(source, { ecmaVersion: "latest", sourceType: "module", allowReturnOutsideFunction: true });
  const changes = [];
  for (const token of tokens) {
    if (!["string", "template"].includes(token.type.label) || typeof token.value !== "string") continue;
    if (!/\bEnergy\b/.test(token.value) || /copyright|licensed under/i.test(token.value)) continue;
    const raw = source.slice(token.start, token.end);
    const value = token.type.label === "string"
      ? JSON.stringify(token.value.replace(/\bEnergy\b/g, "Timewarp"))
      : raw.replace(/(^|\\[rnt]|\b)Energy\b/g, "$1Timewarp");
    changes.push({ start: token.start, end: token.end, value });
  }
  for (const item of changes.reverse()) source = source.slice(0, item.start) + item.value + source.slice(item.end);
  return source;
}
function rebrandAssistantLogo(source, svg) {
  // The renderer exports this specific animated Energy assistant asset as $.
  const ast = acorn.parse(source, { ecmaVersion: "latest", sourceType: "module" });
  const exported = ast.body.filter(node => node.type === "ExportNamedDeclaration").flatMap(node => node.specifiers).find(node => node.exported.name === "$");
  if (!exported) throw new Error("Assistant logo export contract changed.");
  let asset = null;
  const visit = node => {
    if (!node || typeof node !== "object") return;
    if (node.type === "VariableDeclarator" && node.id.name === exported.local.name) asset = node.init;
    for (const value of Object.values(node)) if (Array.isArray(value)) value.forEach(visit); else if (value && typeof value === "object") visit(value);
  };
  visit(ast);
  if (!asset || asset.type !== "Literal" || !String(asset.value).startsWith("data:image/svg+xml,")) throw new Error("Assistant logo asset contract changed.");
  return source.slice(0, asset.start) + JSON.stringify("data:image/svg+xml," + encodeURIComponent(svg)) + source.slice(asset.end);
}
// Timewarp leads; the upstream notice is kept verbatim because rebranding does
// not convey a license.
const COPYRIGHT = "Copyright © 2026 Timewarp. Portions Copyright © 2026 Energy.";
const MAC_INSTALL_CHECK = 't(n.app,n.dialog,n.shell,process.execPath,process.platform,"0.8.20",()=>a("/Applications/Energy.app"))';
function rebrandBootstrap(source) {
  // Started from the DMG, upstream compares itself with /Applications/Energy.app
  // and opens that app when it is current, launching Energy instead of
  // Timewarp. Compare with this bundle's own name and version instead.
  if (source.split(MAC_INSTALL_CHECK).length !== 2) throw new Error("Bundle contract changed: macOS Applications check");
  const installed = 'require("node:path").join("/Applications",require("node:path").basename(require("node:path").resolve(process.execPath,"../../..")))';
  return rebrandJavaScript(source.replace(MAC_INSTALL_CHECK, `t(n.app,n.dialog,n.shell,process.execPath,process.platform,n.app.getVersion(),()=>a(${installed}))`));
}
module.exports = { rebrandJavaScript, rebrandAssistantLogo, rebrandBootstrap, COPYRIGHT };
