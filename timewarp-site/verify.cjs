const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, 'dist/download.js'), 'utf8');

function render(navigatorLike, downloads = { windows:null, mac:null }, gpu = null) {
  class Element {
    constructor(dataset = {}) { this.dataset = dataset; this.attributes = {}; this.events = {}; this.textContent = ''; this.innerHTML = ''; this.hidden = false; this.children = {}; }
    setAttribute(key,value) { this.attributes[key] = value; }
    removeAttribute(key) { delete this.attributes[key]; if (key === 'href') delete this.href; }
    addEventListener(key,callback) { this.events[key] = callback; }
    querySelector(selector) { return this.children[selector]; }
    showModal() { this.open = true; }
    close() { this.open = false; }
    getBoundingClientRect() { return { left:0, right:100, top:0, bottom:100 }; }
  }
  const ids = new Map();
  const get = id => { if (!ids.has(id)) ids.set(id,new Element()); return ids.get(id); };
  const actions = [new Element(),new Element(),new Element()];
  actions.forEach(action => { action.children = { '.download-label':new Element(), '.os-icon':new Element() }; action.href = '#download'; });
  const alts = [new Element(),new Element()];
  alts.forEach(alt => { alt.hidden = true; });
  const platforms = ['windows','mac'].map(platform => new Element({platform}));
  const elements = { '.dialog-close':new Element(), '.availability-note':new Element() };
  const selectors = { '[data-platform]':platforms, '.download-action':actions, '.alt-download':alts };
  const location = { href:'about:blank' };
  // gpu: the renderer name, or { renderer, astc } for Safari's "Apple GPU" with or without ASTC textures.
  const renderer = typeof gpu === 'string' ? gpu : gpu && gpu.renderer, astc = !!(gpu && gpu.astc);
  const webgl = gpu && { RENDERER:0x1F01, getExtension:name => name === 'WEBGL_debug_renderer_info' ? { UNMASKED_RENDERER_WEBGL:0x9246 } : name === 'WEBGL_compressed_texture_astc' && astc ? {} : null, getParameter:key => key === 0x9246 ? renderer : 'WebKit WebGL' };
  const createElement = tag => ({ getContext:type => tag === 'canvas' && type === 'webgl' ? webgl : null });
  const window = { TIMEWARP_DOWNLOADS:downloads, location };
  const context = { navigator:navigatorLike, window, document:{ querySelector:selector => elements[selector], querySelectorAll:selector => selectors[selector] || [], getElementById:get, createElement }, URL };
  vm.runInNewContext(source,context);
  return { actions,alts,platforms,get,elements,location,window };
}

const windows = { platform:'Win32',userAgent:'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',maxTouchPoints:0 };
const mac = { platform:'MacIntel',userAgent:'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',maxTouchPoints:0 };
const cases = [
  [windows,'Download for Windows','Also for macOS'],
  [mac,'Download for macOS','Also for Windows'],
  [{userAgentData:{platform:'macOS'},userAgent:'',maxTouchPoints:0},'Download for macOS','Also for Windows'],
  [{userAgentData:{platform:'Windows'},userAgent:'',maxTouchPoints:0},'Download for Windows','Also for macOS'],
  [{platform:'MacIntel',userAgent:'Mozilla/5.0 (Macintosh)',maxTouchPoints:5},'Get Timewarp','Windows & macOS'],
  [{platform:'iPhone',userAgent:'Mozilla/5.0 (iPhone)',maxTouchPoints:5},'Get Timewarp','Windows & macOS'],
  [{platform:'Linux armv8l',userAgent:'Mozilla/5.0 (Linux; Android 14)',maxTouchPoints:5},'Get Timewarp','Windows & macOS'],
  [{platform:'Linux x86_64',userAgent:'Mozilla/5.0 (X11; Linux x86_64)',maxTouchPoints:0},'Get Timewarp','Windows & macOS'],
  [{platform:'',userAgent:'',maxTouchPoints:0},'Get Timewarp','Windows & macOS']
];
for (const [nav,label,alt] of cases) {
  const page = render(nav);
  page.actions.forEach(action => { assert.equal(action.querySelector('.download-label').textContent,label); assert.match(action.querySelector('.os-icon').innerHTML,/<svg/); });
  page.alts.forEach(button => { assert.equal(button.hidden,false); assert.equal(button.textContent,alt); });
  page.actions[0].events.click({preventDefault(){}});
  assert.equal(page.get('download-dialog').open,true);
  assert.equal(page.get('platform-download').hidden,true);
  assert.equal(page.elements['.availability-note'].textContent,'Download links coming soon');
}

const officialURLs = {windows:'https://downloads.example.test/Timewarp.exe',mac:'https://downloads.example.test/Timewarp.dmg'};
for (const [nav,platform,otherPlatform] of [[windows,'windows','mac'],[mac,'mac','windows']]) {
  const page = render(nav,officialURLs);
  page.actions.forEach(action => { assert.equal(action.href,officialURLs[platform]); assert.equal(action.events.click,undefined); });
  page.alts[0].events.click();
  assert.equal(page.location.href,officialURLs[otherPlatform]);
  assert.equal(page.elements['.availability-note'].textContent,'Available for Windows & macOS. Mac: Apple Silicon, macOS 12+.');
}
for (const invalid of ['javascript:alert(1)','http://downloads.example.test/setup.exe','not-a-url',null]) {
  const page = render(windows,{windows:invalid});
  assert.equal(page.actions[0].href,'#download');
  page.actions[0].events.click({preventDefault(){}});
  assert.equal(page.get('platform-download').hidden,true);
}
// With an Apple Silicon build only: Intel GPUs get the explanatory dialog, with a fallback link.
const intelGPUs = ['ANGLE (Intel Inc., Intel(R) Iris(TM) Plus Graphics 655, OpenGL 4.1)','ANGLE (ATI Technologies Inc., AMD Radeon Pro 5500M OpenGL Engine, OpenGL 4.1)','ANGLE (NVIDIA Corporation, NVIDIA GeForce GT 750M OpenGL Engine, OpenGL 4.1)','Intel(R) HD Graphics 400, or similar'];
for (const gpu of intelGPUs) {
  const page = render(mac,officialURLs,gpu);
  assert.equal(page.window.TIMEWARP_INTEL_MAC,true,gpu);
  page.actions.forEach(action => { assert.equal(action.href,'#download'); assert.equal(action.querySelector('.download-label').textContent,'Download for macOS'); });
  page.actions[0].events.click({preventDefault(){}});
  assert.equal(page.get('download-dialog').open,true);
  assert.equal(page.get('dialog-title').textContent,'Timewarp needs an Apple Silicon Mac.');
  assert.match(page.get('platform-message').textContent,/Intel processor.*OpenCore Legacy Patcher/);
  assert.equal(page.get('platform-download').hidden,false);
  assert.equal(page.get('platform-download').href,officialURLs.mac);
  assert.equal(page.get('platform-download').textContent,'Download anyway');
}
for (const gpu of ['ANGLE (Apple, ANGLE Metal Renderer: Apple M1, Unspecified Version)','Apple M3 Pro','Apple GPU',null]) {
  const page = render(mac,officialURLs,gpu);
  assert.equal(page.window.TIMEWARP_INTEL_MAC,false,String(gpu));
  page.actions.forEach(action => assert.equal(action.href,officialURLs.mac));
}
const intelWindows = render(windows,officialURLs,intelGPUs[0]);
assert.equal(intelWindows.window.TIMEWARP_INTEL_MAC,false);
intelWindows.actions.forEach(action => assert.equal(action.href,officialURLs.windows));
const macChoice = render(windows,officialURLs);
macChoice.platforms[1].events.click();
assert.match(macChoice.get('platform-message').textContent,/Apple Silicon Macs \(M1 or later\).*Intel Macs aren’t supported/);

// With both Mac builds: each Mac gets its own; one whose chip is unknown chooses in the dialog.
const bothBuilds = {...officialURLs, macIntel:'https://downloads.example.test/Timewarp-x64.dmg'};
for (const gpu of intelGPUs) {
  const page = render(mac,bothBuilds,gpu);
  page.actions.forEach(action => assert.equal(action.href,bothBuilds.macIntel,gpu));
  assert.equal(page.elements['.availability-note'].textContent,'Available for Windows & macOS. Mac: Apple Silicon and Intel, macOS 12+.');
}
for (const gpu of ['ANGLE (Apple, ANGLE Metal Renderer: Apple M1, Unspecified Version)','Apple M3 Pro',{renderer:'Apple GPU',astc:true}]) {
  const page = render(mac,bothBuilds,gpu);
  page.actions.forEach(action => assert.equal(action.href,bothBuilds.mac,JSON.stringify(gpu)));
}
for (const gpu of [{renderer:'Apple GPU',astc:false},null]) {
  const page = render(mac,bothBuilds,gpu);
  page.actions.forEach(action => assert.equal(action.href,'#download'));
  page.actions[0].events.click({preventDefault(){}});
  assert.equal(page.get('dialog-title').textContent,'Timewarp for macOS.');
  assert.match(page.get('platform-message').textContent,/Choose the build for your Mac/);
  assert.equal(page.get('platform-download').href,bothBuilds.mac);
  assert.equal(page.get('platform-download').textContent,'Download for Apple Silicon');
  assert.equal(page.get('platform-download-alt').href,bothBuilds.macIntel);
  assert.equal(page.get('platform-download-alt').hidden,false);
}
const intelChoice = render(mac,bothBuilds,intelGPUs[0]);
intelChoice.platforms[1].events.click();
assert.equal(intelChoice.get('platform-download').href,bothBuilds.macIntel);
assert.equal(intelChoice.get('platform-download').textContent,'Download for Intel');
assert.equal(intelChoice.get('platform-download-alt').href,bothBuilds.mac);
const windowsToMac = render(windows,bothBuilds);
windowsToMac.alts[0].events.click();
assert.equal(windowsToMac.location.href,'about:blank','Someone on Windows chooses their Mac build in the dialog');
assert.equal(windowsToMac.get('download-dialog').open,true);

const mobilePage = render(cases[5][0],officialURLs);
mobilePage.actions[0].events.click({preventDefault(){}});
mobilePage.platforms[1].events.click();
assert.equal(mobilePage.get('platform-download').href,officialURLs.mac);
assert.equal(mobilePage.get('platform-download').hidden,false);

const html = fs.readFileSync(path.join(__dirname,'dist/index.html'),'utf8');
for (const [,url] of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
  if (url.startsWith('#')) { if (url.length > 1) assert.ok(html.includes('id="' + url.slice(1) + '"'), 'Missing anchor ' + url); continue; }
  if (/^https?:/.test(url)) continue;
  assert.ok(fs.existsSync(path.join(__dirname,'dist',url)), 'Missing asset ' + url);
}
console.log('Verified: 9 OS cases, alternate-platform links, configured Windows/Mac URLs, Intel vs Apple Silicon Mac detection, unavailable/unsafe URL handling, mobile platform selection, and local assets/anchors.');
