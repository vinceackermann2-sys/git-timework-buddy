"use strict";
// Isolated UI verification. The renderer uses fixtures; no checkout or account is changed.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..'), reports = path.join(root, 'reports');
if (process.versions.electron) {
  const { app, BrowserWindow } = require('electron');
  app.setPath('userData', path.join(root, 'backups/billing-ui-verification-profile'));
  app.whenReady().then(async () => {
    const window = new BrowserWindow({ width: 1100, height: 1050, show: false, webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false } });
    const evaluate = (code, userGesture = false) => window.webContents.executeJavaScript(code, userGesture), checks = [];
    const waitFor = async expression => { for (let i = 0; i < 100; i++) { if (await evaluate(expression)) return; await new Promise(resolve => setTimeout(resolve, 25)); } throw Error('Timed out: ' + expression); };
    const mount = async options => { await evaluate('window.billingFixture.mount(' + JSON.stringify(options) + ')'); await waitFor("!document.querySelector('.tw-billing-content[aria-busy=true]')"); };
    const click = label => evaluate("Array.from(document.querySelectorAll('button')).find(x=>x.textContent===" + JSON.stringify(label) + ").click()");
    try {
      await window.loadFile(path.join(reports, 'billing-ui-preview.html'));
      for (const scheme of ['light', 'dark']) {
        for (const plan of ['free', 'pro', 'max', 'ultra']) {
          await mount({ plan, scheme });
          const result = await evaluate(`(() => ({cards:document.querySelectorAll('.tw-plan-card').length,current:document.querySelector('.tw-plan-current').dataset.plan,prices:Array.from(document.querySelectorAll('.tw-plan-price strong'),x=>x.textContent),packs:document.querySelector('.tw-extra-credits select').options.length,usage:document.querySelector('.tw-overview').innerText,active:document.querySelector('.tw-active-credit-value strong').textContent,percent:document.querySelector('.tw-usage-percent').textContent,progress:document.querySelector('.tw-overview [role=progressbar]')?.getAttribute('aria-valuenow'),connect:Array.from(document.querySelectorAll('button')).some(x=>x.textContent==='Connect Codex account'),overflow:document.documentElement.scrollWidth>innerWidth}))()`);
          assert.equal(result.cards, plan === 'pro' ? 4 : 3); assert.equal(result.current, plan); assert.deepEqual(result.prices, plan === 'pro' ? ['$0', '$20', '$50', '$100'] : ['$0', '$50', '$100']); assert.equal(result.packs, 7); assert.equal(result.connect, plan === 'free'); assert.equal(result.overflow, false);
          const allowance = { free: 0, pro: 280, max: 700, ultra: 1400 }[plan];
          if (plan === 'pro') assert.deepEqual(await evaluate("(()=>{const card=document.querySelector('[data-plan=pro]');return {disabled:card.querySelector('select').disabled,detail:card.querySelector('.tw-addon-detail').textContent}})()"), { disabled: true, detail: 'No longer offered to new subscribers' });
          assert.equal(result.active, '25'); assert.ok(!result.usage.includes('extra credits'));
          if (plan !== 'free') { assert.equal(result.progress, '40'); assert.equal(result.percent,'40%'); } else { assert.equal(result.percent,'—'); assert.ok(result.usage.includes('no monthly credit allowance')); }
          assert.equal(await evaluate("window.billingFixture.calls.some(x=>x.input.route==='/billing/history')"), false);
          await evaluate("document.querySelector('.tw-activity').open=true");
          await waitFor("document.querySelectorAll('.tw-table tbody tr').length===2");
          checks.push({ scheme, plan, ...result });
        }
        await mount({ plan: 'max', scheme });
        const controlStyles = await evaluate(`(() => {
          const select = document.querySelector('.tw-extra-credits select');
          const trigger = getComputedStyle(select), picker = getComputedStyle(select, '::picker(select)');
          return { supported: CSS.supports('appearance', 'base-select'), trigger: trigger.appearance, picker: picker.appearance, radius: picker.borderRadius, background: picker.backgroundColor, selected: getComputedStyle(select.selectedOptions[0]).backgroundColor, disabled: document.querySelector('[data-plan=free] select').disabled };
        })()`);
        assert.equal(controlStyles.supported, true); assert.equal(controlStyles.trigger, 'base-select'); assert.equal(controlStyles.picker, 'base-select'); assert.equal(controlStyles.radius, '10px'); assert.notEqual(controlStyles.selected, 'rgba(0, 0, 0, 0)'); assert.equal(controlStyles.disabled, true);
        const sharedControls = await evaluate(`(() => {
          const sample=document.createElement('section');sample.innerHTML='<button>Plain button</button><button class="timewarp-button" disabled>Connection control</button><input type="submit" value="Submit"><input type="file"><select><option>Shared dropdown</option></select>';document.body.append(sample);
          const controls=[...sample.querySelectorAll('button,input')].map(node=>{const style=getComputedStyle(node,node.type==='file'?'::file-selector-button':null);return {radius:style.borderRadius,background:style.backgroundColor,opacity:style.opacity};});
          const appearance=getComputedStyle(sample.querySelector('select')).appearance;sample.remove();return {controls,appearance};
        })()`);
        assert.ok(sharedControls.controls.every(control=>control.radius==='8px')); assert.equal(sharedControls.controls[1].opacity,'0.6'); assert.equal(sharedControls.appearance,'base-select');
        await evaluate("document.querySelector('.tw-extra-credits select').scrollIntoView({block:'center'})");
        const selectPoint = await evaluate("(() => {const rect=document.querySelector('.tw-extra-credits select').getBoundingClientRect();return {x:Math.round(rect.x+rect.width/2),y:Math.round(rect.y+rect.height/2)};})()");
        window.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...selectPoint});
        window.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...selectPoint});
        await waitFor("document.querySelector('.tw-extra-credits select').matches(':open')");
        await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
        const hoverContrast = await evaluate(`(() => {
          const style=getComputedStyle(document.querySelector('.tw-extra-credits select'));
          const luminance=color=>{const canvas=document.createElement('canvas');canvas.width=canvas.height=1;const ctx=canvas.getContext('2d');ctx.fillStyle=color;ctx.fillRect(0,0,1,1);return [...ctx.getImageData(0,0,1,1).data].slice(0,3).map(n=>n/255).map(n=>n<=.04045?n/12.92:((n+.055)/1.055)**2.4).reduce((sum,n,i)=>sum+n*[.2126,.7152,.0722][i],0);};
          const foreground=luminance(style.color),background=luminance(style.backgroundColor);return (Math.max(foreground,background)+.05)/(Math.min(foreground,background)+.05);
        })()`);
        assert.ok(hoverContrast>=4.5, scheme+' hovered dropdown contrast');
        fs.writeFileSync(path.join(reports, 'billing-dropdown-' + scheme + '.png'), (await window.webContents.capturePage()).toPNG());
        window.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'}); window.webContents.sendInputEvent({type:'keyUp',keyCode:'Escape'});
        await waitFor("!document.querySelector('.tw-extra-credits select').matches(':open')");
        assert.equal(await evaluate("document.querySelector('.tw-extra-credits select').value"), '180');
        // Use the real keyboard path, so a styled picker also proves event routing.
        await evaluate("document.querySelector('.tw-extra-credits select').focus()");
        window.webContents.sendInputEvent({type:'keyDown',keyCode:'Down',modifiers:['alt']}); window.webContents.sendInputEvent({type:'keyUp',keyCode:'Down',modifiers:['alt']});
        await waitFor("document.querySelector('.tw-extra-credits select').matches(':open')");
        window.webContents.sendInputEvent({type:'keyDown',keyCode:'Down'}); window.webContents.sendInputEvent({type:'keyUp',keyCode:'Down'});
        window.webContents.sendInputEvent({type:'keyDown',keyCode:'Return'}); window.webContents.sendInputEvent({type:'keyUp',keyCode:'Return'});
        await waitFor("!document.querySelector('.tw-extra-credits select').matches(':open')");
        assert.equal(await evaluate("document.querySelector('.tw-extra-credits select').value"), '360');
        await click('Buy credits'); await waitFor("window.billingFixture.calls.some(x=>x.action==='cloud'&&x.input.data.action==='buy-credits'&&x.input.data.packCredits===360)");
        checks.push({scheme, brandedControls: controlStyles, sharedControls, hoverContrast, mousePicker: true, escapeDismissal: true, keyboardSelection: true});
        await mount({ plan: 'max', scheme });
        await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
        fs.writeFileSync(path.join(reports, 'billing-ui-' + scheme + '.png'), (await window.webContents.capturePage()).toPNG());
        await mount({ plan: 'free', scheme, connected: true });
        await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
        fs.writeFileSync(path.join(reports, 'billing-codex-' + scheme + '.png'), (await window.webContents.capturePage()).toPNG());
      }
      for (const width of [390, 640, 820]) {
        window.setContentSize(width, 1050); await mount({ plan: 'free', connected: true, scheme: 'light', email: 'long.account.email.for.responsive.verification@example.com' });
        await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
        assert.equal(await evaluate('document.documentElement.scrollWidth>innerWidth'), false, 'overflow at ' + width); checks.push({ width, overflow: false });
        await evaluate("document.querySelector('.tw-extra-credits select').scrollIntoView({block:'center'}); document.querySelector('.tw-extra-credits select').showPicker()", true);
        await waitFor("document.querySelector('.tw-extra-credits select').matches(':open')");
        assert.equal(await evaluate("(()=>{const bounds=document.querySelector('.tw-extra-credits option').getBoundingClientRect();return bounds.left>=0&&bounds.right<=innerWidth&&bounds.top>=0&&bounds.bottom<=innerHeight;})()"), true, 'picker outside viewport at ' + width);
        window.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'}); window.webContents.sendInputEvent({type:'keyUp',keyCode:'Escape'});
      }
      window.setContentSize(1100, 1050);
      await mount({ plan: 'free', providerError: true }); assert.equal(await evaluate("document.querySelectorAll('.tw-plan-card').length"), 3);
      await evaluate('window.billingFixture.options.providerError=false'); await click('Refresh'); await waitFor("document.querySelector('.tw-provider button')?.textContent==='Connect Codex account'");
      await mount({ plan: 'free', historyError: true }); await evaluate("document.querySelector('.tw-activity').open=true"); await waitFor("document.body.innerText.includes('Credit activity is temporarily unavailable.')");
      await evaluate('window.billingFixture.options.historyError=false'); await click('Retry activity'); await waitFor("document.querySelectorAll('.tw-table tbody tr').length===2");
      await mount({ plan: 'free', statusError: true }); assert.equal(await evaluate("document.querySelectorAll('.tw-plan-card').length"), 0);
      await evaluate('window.billingFixture.options.statusError=false'); await click('Retry billing'); await waitFor("document.querySelectorAll('.tw-plan-card').length===3");
      await mount({ plan: 'free' }); await evaluate("document.querySelector('[data-plan=max] button').click()"); await waitFor('window.billingFixture.calls.some(x=>x.action===\'openLink\')');
      let calls = await evaluate('window.billingFixture.calls'); assert.ok(calls.some(x => x.action === 'cloud' && x.input.data.action === 'checkout' && x.input.data.plan === 'max'));
      await mount({ plan: 'free' }); await click('Buy credits'); await waitFor('window.billingFixture.calls.some(x=>x.action===\'openLink\')');
      calls = await evaluate('window.billingFixture.calls'); assert.ok(calls.some(x => x.action === 'cloud' && x.input.data.action === 'buy-credits' && x.input.data.packCredits === 180));
      await mount({ plan: 'max' }); await click('Manage subscription'); await waitFor('window.billingFixture.calls.some(x=>x.action===\'openLink\')');
      calls = await evaluate('window.billingFixture.calls'); assert.ok(calls.some(x => x.action === 'cloud' && x.input.data.action === 'portal'));
      await mount({ plan: 'free', invalidPayment: true }); await evaluate("document.querySelector('[data-plan=max] button').click()"); await waitFor("document.body.innerText.includes('invalid payment link')"); assert.equal(await evaluate("window.billingFixture.calls.some(x=>x.action==='openLink')"), false);
      await mount({ plan: 'free', connected: true, requestError: true }); await waitFor("document.querySelectorAll('.tw-provider [role=progressbar]').length===2"); assert.equal(await evaluate("document.querySelector('.tw-provider [role=progressbar]').getAttribute('aria-valuenow')"), '75');
      assert.equal(await evaluate("document.querySelector('.tw-usage-percent').textContent"),'—');
      assert.equal(await evaluate("Array.from(document.querySelectorAll('.tw-provider button'),x=>x.textContent).join(',')"), 'Disconnect Codex account');
      assert.ok(await evaluate("document.querySelector('.tw-provider-account').textContent==='alex@example.com' && document.querySelector('.tw-provider').innerText.includes('Weekly usage') && !document.querySelector('.tw-provider').innerText.includes('invalid_request_error')"));
      await click('Disconnect Codex account'); await waitFor("document.querySelector('.tw-provider button')?.textContent==='Connect Codex account'");
      assert.equal(await evaluate("document.querySelectorAll('.tw-provider [role=progressbar]').length"),0);
      await click('Connect Codex account'); await waitFor("document.querySelector('.tw-provider button')?.textContent==='Cancel connection'");
      await click('Cancel connection'); await waitFor("document.querySelector('.tw-provider button')?.textContent==='Connect Codex account'");
      calls=await evaluate('window.billingFixture.calls'); assert.ok(calls.some(x=>x.action==='connectChatgpt')&&calls.some(x=>x.action==='disconnectChatgpt')&&calls.some(x=>x.action==='cancelChatgpt')&&!calls.some(x=>x.action==='verifyChatgpt'));
      await mount({ plan: 'free', connected: true, limitsUnavailable: true });
      assert.equal(await evaluate("document.querySelectorAll('.tw-provider [role=progressbar]:not([aria-valuenow])').length"), 2);
      await mount({ plan: 'free', reauth: true }); assert.equal(await evaluate("document.querySelectorAll('.tw-provider [role=alert]').length"),1);
      assert.equal(await evaluate("document.querySelector('.tw-provider button').textContent"),'Connect Codex account');
      await mount({ plan: 'max', connected: true }); assert.equal(await evaluate("document.querySelector('.tw-usage-percent').textContent"),'40%'); assert.equal(await evaluate("document.querySelectorAll('.tw-provider [role=progressbar]').length"),0);
      await mount({ plan: 'free', purchased: 0 }); assert.equal(await evaluate("document.querySelector('.tw-active-credit-value strong').textContent"),'0');
      await mount({plan:'free'}); await evaluate("(()=>{const select=document.querySelector('[data-plan=max] select');select.value='420';select.dispatchEvent(new Event('change'))})()");
      assert.equal(await evaluate("document.querySelector('[data-plan=max] .tw-plan-price strong').textContent"),'$80');
      assert.equal(await evaluate("document.querySelector('[data-plan=max] .tw-plan-allowance').textContent===(1120).toLocaleString()+' credits / month'"),true);
      await evaluate("document.querySelector('[data-plan=max] button').click()"); await waitFor("window.billingFixture.calls.some(x=>x.action==='openLink')");
      calls=await evaluate('window.billingFixture.calls');assert.ok(calls.some(x=>x.action==='cloud'&&x.input.data.action==='checkout'&&x.input.data.monthlyExtraCredits===420&&!Object.hasOwn(x.input.data,'packCredits')));
      await mount({plan:'max',monthlyExtraCredits:420});assert.equal(await evaluate("document.querySelector('[data-plan=max] select').value"),'420');assert.equal(await evaluate("document.querySelector('[data-plan=max] .tw-plan-price strong').textContent"),'$80');
      await evaluate("(()=>{const select=document.querySelector('[data-plan=max] select');select.value='0';select.dispatchEvent(new Event('change'))})()");await click('Update plan');await waitFor("window.billingFixture.calls.some(x=>x.action==='openLink')");
      calls=await evaluate('window.billingFixture.calls');assert.ok(calls.some(x=>x.action==='cloud'&&x.input.data.action==='checkout'&&x.input.data.monthlyExtraCredits===0));
      await mount({plan:'free'});await evaluate("(()=>{const select=document.querySelector('.tw-extra-credits select');select.value='360';select.dispatchEvent(new Event('change'))})()");await click('Buy credits');await waitFor("window.billingFixture.calls.some(x=>x.action==='openLink')");
      calls=await evaluate('window.billingFixture.calls');assert.ok(calls.some(x=>x.action==='cloud'&&x.input.data.action==='buy-credits'&&x.input.data.packCredits===360&&!Object.hasOwn(x.input.data,'monthlyExtraCredits')));
      await mount({ plan: 'max', cancelAtPeriodEnd: true }); assert.ok(await evaluate("document.querySelector('.tw-overview').innerText.includes('Plan ends ') && document.querySelector('.tw-overview').innerText.includes('2026')"));
      await evaluate("document.getElementById('billing-host').remove()"); await new Promise(resolve => setTimeout(resolve, 50));
      checks.push({ independentFailures: true, retryRecovery: true, checkoutRouting: true, packRouting: true, portalRouting: true, invalidPaymentRejected: true, providerUsage: true, simpleConnectionActions: true, connectionRouting: true, planUsageSeparateFromCodex: true, activeExtraCredits: true, unavailableAllowances: true, cancellationDate: true,monthlyPricing: true,monthlyAddonRouting: true,monthlyAddonRemoval: true,separateOneTimePurchase:true });
      fs.writeFileSync(path.join(reports, 'billing-ui-verification.json'), JSON.stringify({ verifiedAt: new Date().toISOString(), passed: true, checks }, null, 2));
      console.log('Verified billing cards, live-shaped balances and usage, light/dark themes, responsive layout, failure recovery, provider limits, and payment routing using isolated fixtures.'); app.exit(0);
    } catch (error) { console.error(error); app.exit(1); }
  });
} else {
  const { pathToFileURL } = require('node:url'), cp = require('node:child_process');
  const renderer = path.join(root, 'build/app/out/renderer');
  const stylePaths = [path.join(renderer, 'assets/index-CgqM7Ghz.css'), path.join(renderer, 'assets/mermaid-GHXKKRXX-Cl4CJFD3.css'), path.join(root, 'desktop/appearance.css'), path.join(root, 'desktop/billing.css'), path.join(root, 'desktop/controls.css')];
  const styles = stylePaths.map(file => '<link rel="stylesheet" href="' + pathToFileURL(file).href + '">').join('');
  const fixture = `window.billingFixture={options:{},calls:[],mount(options){this.options=options;this.calls=[];localStorage.clear();document.documentElement.classList.toggle('dark',options.scheme==='dark');document.getElementById('billing-host')?.remove();const host=document.createElement('main');host.id='billing-host';document.body.append(host);window.timewarpMountBilling(host);}};
  window.timewarp={request:async(action,input={})=>{const f=window.billingFixture,o=f.options;f.calls.push({action,input});
    if(action==='state')return{user:{id:'billing-ui-fixture'}};
    if(action==='connectChatgpt'){o.waiting=true;return{};}
    if(action==='cancelChatgpt'){o.waiting=false;return{};}
    if(action==='disconnectChatgpt'){o.connected=false;return{};}
    if(action==='chatgptDetails'){if(o.providerError)throw Error('Provider unavailable');return{funding:{plan:o.plan,subscriptionAllowed:o.plan==='free'},accounts:o.connected||o.reauth?[{id:'fixture',email:o.email||'alex@example.com',selected:true}]:[],account:o.connected?{email:o.email||'alex@example.com',planType:'plus'}:null,status:o.connected?'available':o.reauth?'reauth_required':'disconnected',login:{status:o.waiting?'waiting_for_user':'idle'},lastRequestError:o.requestError?{message:'{ "type": "invalid_request_error", "param": "tools" }'}:null,usageUrl:'https://chatgpt.com',usage:o.connected?{since:'2026-10-01',requests:42,inputTokens:18000,outputTokens:4200}:null,rateLimits:o.connected&&!o.limitsUnavailable?{primary:{usedPercent:25,windowDurationMins:300,resetsAt:1791216000},secondary:{usedPercent:60,windowDurationMins:10080,resetsAt:1791820800}}:null};}
    if(action==='cloud'&&input.route==='/billing/history'){if(o.historyError)throw Error('History unavailable');return{events:[{id:'1',kind:'usage',model:'openai/gpt-5.6-sol',occurred_at:'2026-10-05T10:30:00Z',delta_credits:-1.2345},{id:'2',kind:'purchase',occurred_at:'2026-10-04T12:00:00Z',delta_credits:50}]};}
    if(action==='cloud'&&input.data.action==='status'){if(o.statusError)throw Error('Billing unavailable');const plans=[{id:'free',name:'Free',monthlyUsd:0,monthlyCredits:0},...(o.plan==='pro'?[{id:'pro',name:'Pro',monthlyUsd:20,monthlyCredits:280,retired:true}]:[]),{id:'max',name:'Max',monthlyUsd:50,monthlyCredits:700},{id:'ultra',name:'Ultra',monthlyUsd:100,monthlyCredits:1400}],addons=[0,15,30,45,60,75,100,125].map(usd=>({credits:usd*14,monthlyUsd:usd})),plan=plans.find(p=>p.id===o.plan),allowance=plan.monthlyCredits+(o.monthlyExtraCredits||0);return{plan:o.plan,plans,monthlyExtraCredits:o.monthlyExtraCredits||0,monthlyUsd:plan.monthlyUsd+(addons.find(a=>a.credits===o.monthlyExtraCredits)?.monthlyUsd||0),monthlyCreditAddons:addons,subscriptionStatus:o.plan==='free'?null:'active',canOpenPortal:o.plan!=='free',cancelAtPeriodEnd:o.cancelAtPeriodEnd,currentPeriodEnd:o.plan==='free'?null:'2026-11-05T00:00:00Z',includedCredits:{allowance,balance:allowance*.6},purchasedCredits:{balance:o.purchased??25},usage:{periodStart:'2026-10-05T00:00:00Z',periodEnd:'2026-11-05T00:00:00Z'},credits:{usedThisPeriod:5,packs:[15,30,45,60,75,100,125].map(usd=>({credits:usd*12,usd}))}};}
    if(action==='cloud')return{url:o.invalidPayment?'https://example.com/payment':input.data.action==='portal'?'https://billing.stripe.com/p/session/fixture':'https://checkout.stripe.com/c/pay/fixture'};
    return{};
  }};`;
  fs.writeFileSync(path.join(reports, 'billing-ui-preview.html'), '<!doctype html><html lang="en"><head><meta charset="utf-8">' + styles + '<title>Billing UI verification</title></head><body class="bg-background text-foreground"><script>' + fixture + '</script><script src="' + pathToFileURL(path.join(root, 'desktop/native-billing.js')).href + '"></script></body></html>');
  const dependencyRoot = path.resolve(__dirname,'..'), env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const result = cp.spawnSync(require(require.resolve('electron', { paths: [dependencyRoot] })), [__filename], { env, windowsHide: true, encoding: 'utf8', timeout: 45000 });
  if (result.stdout) process.stdout.write(result.stdout); if (result.status !== 0) { if (result.stderr) process.stderr.write(result.stderr); process.exitCode = 1; }
}
