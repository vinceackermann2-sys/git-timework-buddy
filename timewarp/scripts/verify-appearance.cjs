"use strict";
// Render the packaged native theme picker with its real React component and CSS.
// This runs in a hidden, isolated Electron window and never opens a user profile.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const reports = path.join(root, 'reports');
const { presets, defaultAccent } = require('../shared/appearance.cjs');

if (process.versions.electron) {
  const { app, BrowserWindow } = require('electron');
  app.setPath('userData', path.join(root, 'backups/appearance-verification-profile'));
  app.whenReady().then(async () => {
    const window = new BrowserWindow({ width: 1040, height: 900, show: false, webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false } });
    try {
      await window.loadFile(path.join(reports, 'appearance-preview.html'));
      const evaluate = code => window.webContents.executeJavaScript(code);
      await new Promise(resolve => setTimeout(resolve, 350));
      assert.equal(await evaluate("document.querySelectorAll('.timewarp-preset').length"), 12);
      assert.equal(await evaluate("document.querySelector('[aria-label=\"Backdrop dots\"]')"), null);
      assert.equal(await evaluate("document.getElementById('chrome-check').childElementCount"), 0);
      assert.equal(await evaluate("getComputedStyle(document.querySelector('.theme-editor')).overflowX"), 'hidden');
      const checks = [];
      for (const scheme of ['light', 'dark']) {
        await evaluate(`window.timewarpAppearanceCheck.setScheme(${JSON.stringify(scheme)})`);
        for (let index = 0; index < presets.length; index++) {
          await evaluate(`document.querySelectorAll('.timewarp-preset')[${index}].click()`);
          await new Promise(resolve => setTimeout(resolve, 35));
          const value = await evaluate(`(() => {
            const style=getComputedStyle(document.documentElement), state=window.timewarpAppearanceCheck.get();
            const sample=document.getElementById('primary-sample'), button=getComputedStyle(sample);
            const rgb=color=>{const probe=document.createElement('canvas');probe.width=probe.height=1;const ctx=probe.getContext('2d');ctx.fillStyle=color;ctx.fillRect(0,0,1,1);return [...ctx.getImageData(0,0,1,1).data].slice(0,3)};
            const luminance=color=>rgb(color).map(n=>n/255).map(n=>n<=.04045?n/12.92:((n+.055)/1.055)**2.4).reduce((sum,n,i)=>sum+n*[.2126,.7152,.0722][i],0);
            const foreground=luminance(button.color),background=luminance(button.backgroundColor);
            return {accent:style.getPropertyValue('--theme-accent').trim().toUpperCase(),saturation:state.accent.saturation,contrast:(Math.max(foreground,background)+.05)/(Math.min(foreground,background)+.05),selected:document.querySelectorAll('.timewarp-preset[aria-pressed=true]').length,scheme:state.scheme,radiance:state.radiance,texture:state.texture.step,backgroundImages:[...document.querySelectorAll('[data-app-backdrop],.theme-canvas,#theme-swatch > span')].map(node=>getComputedStyle(node).backgroundImage),overflow:document.documentElement.scrollWidth>innerWidth};
          })()`);
          assert.equal(value.accent, presets[index].hex);
          assert.equal(value.selected, 1);
          assert.ok(value.saturation >= 0 && value.saturation <= 1);
          assert.equal(value.scheme, scheme);
          assert.equal(value.radiance, 0.2);
          assert.equal(value.texture, 16);
          assert.deepEqual(value.backgroundImages, ['none', 'none', 'none']);
          assert.ok(value.contrast >= 4.5, presets[index].name + ' button contrast');
          assert.equal(value.overflow, false);
          checks.push({ scheme, preset: presets[index].name, ...value });
        }
        await evaluate("document.querySelector('.timewarp-preset').click()");
        await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
        fs.writeFileSync(path.join(reports, `appearance-${scheme}.png`), (await window.webContents.capturePage()).toPNG());
      }
      fs.writeFileSync(path.join(reports, 'appearance-verification.json'), JSON.stringify({ verifiedAt: new Date().toISOString(), checks }, null, 2));
      console.log('Verified 12 native presets in light and dark mode, smooth backdrops and previews with saved dots at maximum strength, removed chrome and dots control, retained settings, no horizontal overflow, and button contrast >= 4.5:1.');
      app.exit(0);
    } catch (error) { console.error(error); app.exit(1); }
  });
} else {
  const acorn = require('acorn'), cp = require('node:child_process');
  const { pathToFileURL } = require('node:url');
  const dependencyRoot = path.dirname(path.dirname(require('../config.json').brandSource));
  const resolve = name => require.resolve(name, { paths: [dependencyRoot] });
  const renderer = path.join(root, 'build/app/out/renderer');
  const index = fs.readFileSync(path.join(renderer, 'assets/index-C6BbfH_v.js'), 'utf8');
  const ui = fs.readFileSync(path.join(renderer, 'assets/mermaid-GHXKKRXX-YWFhvrpV.js'), 'utf8');
  const declarations = source => acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'module' }).body.filter(node => node.type === 'VariableDeclaration').flatMap(node => node.declarations);
  const extract = (source, nodes, names) => names.map(name => {
    const matches = nodes.filter(node => node.id.name === name);
    assert.equal(matches.length, 1, 'Native appearance variable: ' + name);
    return `const ${source.slice(matches[0].start, matches[0].end)};`;
  }).join('\n');
  const variables = extract(index, declarations(index), ['lg','w3','x3','pl','T3','k3','O3','Yc','A3','C3','M3','r8','s8','R3','bw','z3','a8','o8','Sr','N3','wl','l8','u8','D3','j3','$3','c8','L3','I3','U3','B3','H3','F3','q3']);
  const picker = extract(ui, declarations(ui), ['Soe','Con','gCe','iqe','xcn','Pit','HCe','kcn','zoe','Scn']);
  const entry = `import * as b from ${JSON.stringify(resolve('react'))};
    import * as h from ${JSON.stringify(resolve('react/jsx-runtime'))};
    import {createRoot} from ${JSON.stringify(resolve('react-dom/client'))};
    ${variables}
    const SLe=a8,kQ=r8,i_=l8,a_=u8,w5=$3,ALe=z3,_Q=o8,CLe=s8,mI=Yc,Sy=pl,ELe=c8,vLe=L3,xLe=q3;
    const Hpe=b.createContext(null),$e={error:message=>{throw new Error(message)}};
    const te=(...values)=>values.filter(Boolean).join(' ');
    ${picker}
    function Preview(){const[value,setValue]=b.useState({scheme:'light',accent:${JSON.stringify(defaultAccent)},radiance:.2,texture:{type:'dots',step:16}});
      window.timewarpAppearanceCheck={get:()=>value,setScheme:scheme=>setValue(previous=>({...previous,scheme}))};
      return h.jsx(iqe,{appearance:value,disabled:false,saveAppearance:async next=>next,children:h.jsxs('main',{style:{display:'grid',gridTemplateColumns:'1fr 340px',gap:'64px',padding:'48px',alignItems:'center',minHeight:'100vh'},children:[h.jsxs('section',{children:[h.jsx('img',{src:${JSON.stringify(pathToFileURL(path.join(renderer,'timewarp-logo.svg')).href)},alt:'Timewarp',style:{width:'80px',height:'80px',marginBottom:'24px'}}),h.jsx('h1',{style:{fontSize:'36px',fontWeight:600,marginBottom:'16px'},children:'Make Timewarp yours.'}),h.jsx('p',{style:{fontSize:'16px',color:'var(--color-muted-foreground)',marginBottom:'32px'},children:'A little color for your everyday work. Choose from twelve soft pastel themes.'}),h.jsx('button',{id:'primary-sample',className:'bg-primary text-primary-foreground',style:{padding:'12px 24px',borderRadius:'10px',fontWeight:500},children:'Start a new task'}),h.jsx('p',{className:'text-primary',style:{marginTop:'24px'},children:'Ice blue · Soft lime · Warm cream · Pink lilac'}),h.jsx('div',{id:'theme-swatch',children:h.jsx(xcn,{appearance:value,resolvedScheme:value.scheme})}),h.jsxs('div',{id:'chrome-check',children:[h.jsx(Pit,{}),h.jsx(kcn,{}),h.jsx(HCe,{versionLabel:'Version 0.8.20 (beta)'}),h.jsx(zoe,{})]})]}),h.jsx(gCe,{value,resolvedScheme:value.scheme,disabled:false,onPreview:setValue,onCommit:setValue})]})});}
    createRoot(document.getElementById('preview')).render(h.jsx(Preview,{}));`;
  fs.mkdirSync(reports, { recursive: true });
  require(resolve('esbuild')).buildSync({ stdin: { contents: entry, resolveDir: dependencyRoot, loader: 'js' }, bundle: true, platform: 'browser', format: 'iife', outfile: path.join(reports, 'appearance-preview.js'), define: { 'process.env.NODE_ENV': '"production"' } });
  const styles = ['assets/index-CgqM7Ghz.css','assets/mermaid-GHXKKRXX-Cl4CJFD3.css','timewarp-appearance.css'].map(file => `<link rel="stylesheet" href="${pathToFileURL(path.join(renderer,file)).href}">`).join('');
  fs.writeFileSync(path.join(reports,'appearance-preview.html'), `<!doctype html><html><head><meta charset="utf-8">${styles}<title>Timewarp appearance preview</title></head><body class="bg-background text-foreground"><div id="preview"></div><script src="./appearance-preview.js"></script></body></html>`);
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const result = cp.spawnSync(require(resolve('electron')), [__filename], { env, windowsHide: true, encoding: 'utf8', timeout: 45000 });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.status !== 0) { if(result.stderr)process.stderr.write(result.stderr); process.exitCode=1; }
}
