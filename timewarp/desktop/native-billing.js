"use strict";
// Personal billing in native Settings. Prices and balances come from the service.
window.timewarpMountBilling = host => {
  if (host.dataset.timewarpMounted) return;
  host.dataset.timewarpMounted = '1';
  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const number = value => Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 });
  const money = value => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: Number.isInteger(value) ? 0 : 2 }).format(value);
  const date = value => {
    if (!value) return null;
    const parsed = new Date(typeof value === 'number' ? value * 1000 : value);
    return Number.isFinite(parsed.getTime()) ? parsed.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : null;
  };
  const capitalized = value => String(value).replace(/^./, c => c.toUpperCase());
  const resetLabel = value => {
    if (!Number.isFinite(value)) return '';
    const reset = new Date(value * 1000); if (!Number.isFinite(reset.getTime())) return '';
    const today = new Date(), tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);
    const day = reset.toDateString() === today.toDateString() ? 'today' : reset.toDateString() === tomorrow.toDateString() ? 'tomorrow' : reset.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    return 'Resets ' + day + ' at ' + reset.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  };
  const icon = name => {
    const paths = { refresh: 'M20 7v5h-5M4 17v-5h5M6.1 7a7 7 0 0 1 11.55-2L20 8M4 16l2.35 3A7 7 0 0 0 17.9 17', check: 'm5 12 4 4L19 6', arrow: 'M7 17 17 7M7 7h10v10', bolt: 'm13 2-9 12h7l-1 8 10-12h-7l1-8Z', codex: 'm8 7-5 5 5 5m8-10 5 5-5 5m-3-12-2 14' };
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    for (const [key, value] of Object.entries({ viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.6', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })) svg.setAttribute(key, value);
    const path = document.createElementNS(svg.namespaceURI, 'path'); path.setAttribute('d', paths[name]); svg.append(path); return svg;
  };
  const view = el('div', 'tw-billing'); host.append(view);
  const header = el('header', 'tw-billing-header'), intro = el('div');
  intro.append(el('h1', 'font-display', 'Billing'), el('p', 'tw-muted', 'Your plan, AI credits, and usage.')); header.append(intro); view.append(header);
  const status = el('p', 'tw-notice'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite'); status.hidden = true; view.append(status);
  const content = el('div', 'tw-billing-content'); content.setAttribute('aria-busy', 'true'); view.append(content);
  const provider = el('section', 'tw-panel tw-provider'); provider.setAttribute('aria-label', 'Codex account'); view.append(provider);
  const request = input => window.timewarp.request('cloud', { route: '/billing/service', data: input });
  const notify = (text = '', error = false) => { status.textContent = text; status.hidden = !text; status.classList.toggle('tw-error', error); };
  const button = (label, action, variant = '', glyph) => {
    const node = el('button', 'tw-button' + (variant ? ' tw-button-' + variant : '')); node.type = 'button';
    if (glyph) node.append(icon(glyph)); node.append(el('span', '', label));
    node.onclick = async () => {
      node.disabled = true; node.setAttribute('aria-busy', 'true');
      try { await action(); } catch (error) { notify(error.message || 'Something went wrong. Please retry.', true); }
      finally { node.disabled = false; node.removeAttribute('aria-busy'); }
    }; return node;
  };
  const badge = (text, accent = false) => el('span', 'tw-badge' + (accent ? ' tw-badge-accent' : ''), text);
  const sectionHeading = (title, subtitle) => {
    const node = el('div', 'tw-section-heading'); node.append(el('h2', '', title));
    if (subtitle) node.append(el('p', 'tw-muted', subtitle)); return node;
  };
  const meter = (label, used, allowance) => {
    const percent = allowance > 0 ? Math.min(100, Math.max(0, used / allowance * 100)) : 0, node = el('div', 'tw-meter');
    node.setAttribute('role', 'progressbar'); node.setAttribute('aria-label', label); node.setAttribute('aria-valuemin', '0'); node.setAttribute('aria-valuemax', '100'); node.setAttribute('aria-valuenow', String(Math.round(percent))); node.setAttribute('aria-valuetext', number(used) + ' of ' + number(allowance) + ' used');
    const fill = el('div', 'tw-meter-fill'); fill.style.width = percent + '%'; node.append(fill); return node;
  };
  let providerTimer = null, billingTimer = null, pendingKey = null, currentPlan = null, loading = null, providerLoading = null, billingData = null;
  const selections = new Map();
  const stopTimers = () => { clearTimeout(providerTimer); clearTimeout(billingTimer); };
  const refreshOnFocus = () => {
    if (!host.isConnected) return;
    void load().catch(error => notify(error.message, true)); void loadProvider().catch(providerError);
  };
  const observer = new MutationObserver(() => { if (!host.isConnected) { stopTimers(); observer.disconnect(); window.removeEventListener('focus', refreshOnFocus); } });
  observer.observe(document.body, { childList: true, subtree: true }); window.addEventListener('focus', refreshOnFocus);
  header.append(button('Refresh', async () => { await Promise.all([load(), loadProvider()]); }, 'quiet', 'refresh'));
  for (let i = 0; i < 2; i++) { const skeleton = el('div', 'tw-skeleton'); skeleton.setAttribute('aria-hidden', 'true'); content.append(skeleton); }
  content.append(el('p', 'tw-muted tw-loading', 'Loading your plan and usage…')); provider.append(el('p', 'tw-muted', 'Loading Codex account…'));

  function loadProvider() {
    if (providerLoading) return providerLoading;
    providerLoading = renderProvider().finally(() => { providerLoading = null; }); return providerLoading;
  }
  function providerError() {
    if (!host.isConnected) return;
    clearTimeout(providerTimer); provider.replaceChildren(sectionHeading('Codex account', 'Account details are temporarily unavailable. Refresh to try again.'));
  }
  async function renderProvider() {
    const data = await window.timewarp.request('chatgptDetails'); if (!host.isConnected) return;
    clearTimeout(providerTimer); provider.replaceChildren();
    const allowed = data.funding.subscriptionAllowed, connected = data.status === 'available', waiting = data.login?.status === 'waiting_for_user';
    const titleRow = el('div', 'tw-provider-heading'), identity = el('div', 'tw-provider-identity'), mark = el('div', 'tw-provider-icon'); mark.append(icon('codex'));
    const account = el('div', 'tw-provider-details'), title = el('div', 'tw-provider-title');
    title.append(el('h2', '', 'Codex account'));
    if (connected && allowed) title.append(badge('Connected', true));
    if (connected && data.account?.planType) title.append(badge(capitalized(data.account.planType)));
    account.append(title, el('p', 'tw-muted tw-provider-account', data.account?.email || (waiting ? 'Waiting for browser approval' : allowed ? 'Use your ChatGPT subscription' : 'Available on the Free plan')));
    identity.append(mark, account); titleRow.append(identity);
    const connectionAction = (label, action, variant = '') => button(label, async () => {
      try { await action(); } catch { notify('Couldn’t update your Codex connection. Please try again.', true); }
    }, variant);
    if (waiting) titleRow.append(connectionAction('Cancel connection', async () => { await window.timewarp.request('cancelChatgpt'); await loadProvider(); }));
    else if (connected || !allowed && data.accounts?.length) titleRow.append(connectionAction('Disconnect Codex account', async () => { await window.timewarp.request('disconnectChatgpt'); await loadProvider(); }));
    else if (allowed) titleRow.append(connectionAction('Connect Codex account', async () => { await window.timewarp.request('connectChatgpt'); await loadProvider(); }, 'primary'));
    provider.append(titleRow);
    if (connected && allowed) {
      const limits = el('div', 'tw-allowances');
      for (const [key, fallback] of [['primary', 'Session usage'], ['secondary', 'Weekly usage']]) {
        const limit = data.rateLimits?.[key], minutes = limit?.windowDurationMins;
        const label = minutes === 10080 ? 'Weekly usage' : Number.isFinite(minutes) && minutes > 0 ? number(minutes >= 60 ? minutes / 60 : minutes) + (minutes >= 60 ? '-hour usage' : '-minute usage') : fallback;
        const known = Number.isFinite(limit?.usedPercent), used = known ? Math.min(100, Math.max(0, limit.usedPercent)) : null;
        const row = el('div', 'tw-allowance'), heading = el('div', 'tw-usage-label');
        heading.append(el('span', '', label), el('strong', '', known ? number(100 - used) + '% left' : 'Unavailable'));
        const progress = meter('Codex ' + label, known ? 100 - used : 0, 100);
        progress.setAttribute('aria-valuetext', known ? number(100 - used) + '% remaining' : 'Usage unavailable');
        if (!known) progress.removeAttribute('aria-valuenow');
        row.append(heading, progress, el('p', 'tw-muted', resetLabel(limit?.resetsAt) || (known ? 'Reset time unavailable' : 'Allowance is temporarily unavailable'))); limits.append(row);
      }
      provider.append(limits);
    }
    if (waiting) provider.append(el('p', 'tw-muted tw-provider-note', 'Finish connecting in your browser. This page updates automatically.'));
    else if (connected) provider.append(el('p', 'tw-muted tw-provider-note', allowed ? 'AI requests use your Codex allowance.' : 'Your current plan uses Timewarp credits.'));
    else if (!allowed) provider.append(el('p', 'tw-muted tw-provider-note', 'Your current plan uses Timewarp credits.'));
    else if (data.login?.status === 'error' || data.lastConnectionError || data.status === 'reauth_required' || data.planUsageDisabled) {
      const alert = el('p', 'tw-muted tw-provider-note', 'Your Codex account needs to be connected again.'); alert.setAttribute('role', 'alert'); provider.append(alert);
    }
    if (waiting) providerTimer = setTimeout(() => void loadProvider().catch(providerError), 1500);
  }
  async function openPayment(input) {
    const response = await request(input);
    if (response.url) {
      const link = new URL(response.url);
      if (link.protocol !== 'https:' || link.username || link.password || !['checkout.stripe.com', 'billing.stripe.com'].includes(link.hostname)) throw new Error('The billing service returned an invalid payment link.');
      if (response.sessionId && pendingKey) localStorage.setItem(pendingKey, JSON.stringify({ id: response.sessionId, createdAt: Date.now() }));
      await window.timewarp.request('openLink', { url: link.href }); notify('Stripe opened in your browser. Your balance updates after payment is confirmed.'); scheduleRefresh();
    } else if (response.updated) { await load(); notify('Monthly plan updated. Your usage refreshes after Stripe confirms the change.'); scheduleRefresh(); }
    else throw new Error('Stripe did not return a checkout or confirmed plan update.');
  }
  function scheduleRefresh() { clearTimeout(billingTimer); billingTimer = setTimeout(() => void load().catch(error => notify(error.message, true)), 10000); }
  function load() {
    if (loading) return loading;
    content.setAttribute('aria-busy', 'true'); loading = loadBilling().finally(() => { loading = null; content.setAttribute('aria-busy', 'false'); }); return loading;
  }
  async function reconcile() {
    if (!pendingKey) { const state = await window.timewarp.request('state'); if (state.user?.id) pendingKey = 'timewarp-checkout:' + state.user.id; }
    if (!pendingKey) return;
    let pending; try { pending = JSON.parse(localStorage.getItem(pendingKey) || 'null'); } catch { localStorage.removeItem(pendingKey); return; }
    if (!pending) return;
    if (Date.now() - pending.createdAt > 24 * 60 * 60 * 1000) { localStorage.removeItem(pendingKey); return; }
    const result = await request({ action: 'sync-checkout', sessionId: pending.id }); if (!result.pending) localStorage.removeItem(pendingKey);
  }
  function renderUsage() {
    const overview = content.querySelector('.tw-overview');
    if (!overview || !billingData) return;
    const data = billingData, allowance = data.includedCredits.allowance, included = data.includedCredits.balance;
    const used = Number.isFinite(allowance) ? Math.max(0, allowance - included) : null;
    const known = Number.isFinite(allowance) && allowance > 0;
    const percent = known ? Math.min(100, Math.max(0, used / allowance * 100)) : null;
    overview.replaceChildren();
    const heading = el('div', 'tw-panel-heading'), title = el('div');
    title.append(el('h2', '', 'Plan usage'), el('p', 'tw-muted', (data.plans.find(item => item.id === data.plan)?.name || capitalized(data.plan)) + ' · Monthly credits')); heading.append(title, el('strong', 'tw-usage-percent', known ? number(percent) + '%' : '—')); overview.append(heading);
    const progress = meter('Monthly plan credit usage', known ? percent : 0, 100);
    if (!known) { progress.removeAttribute('aria-valuenow'); progress.setAttribute('aria-valuetext', allowance === 0 ? 'No monthly credit allowance' : 'Usage unavailable'); }
    overview.append(progress);
    const details = el('div', 'tw-usage-label');
    details.append(el('span', 'tw-muted', known ? number(used) + ' of ' + number(allowance) + ' credits used' : allowance === 0 ? 'Free has no monthly credit allowance' : 'Usage unavailable'));
    if (known) details.append(el('span', 'tw-muted', number(included) + ' credits left'));
    overview.append(details);
    const reset = date(data.currentPeriodEnd || data.usage?.periodEnd);
    if (reset && (known || data.cancelAtPeriodEnd)) { const footer = el('div', 'tw-usage-footer'); footer.append(el('p', 'tw-muted', (data.cancelAtPeriodEnd ? 'Plan ends ' : 'Resets ') + reset)); overview.append(footer); }
  }
  function creditSelect(packs, label, key, optional = true) {
    const wrapper = el('label', 'tw-credit-select'), select = el('select', 'tw-select'); wrapper.append(el('span', 'tw-label', label));
    select.setAttribute('aria-label', label);
    if (optional) { const none = el('option', '', 'No extra credits'); none.value = '0'; select.append(none); }
    for (const pack of packs) { const option = el('option', '', '+' + number(pack.credits) + ' credits · ' + money(pack.usd)); option.value = String(pack.credits); select.append(option); }
    if (selections.has(key) && Array.from(select.options).some(option => option.value === selections.get(key))) select.value = selections.get(key);
    select.addEventListener('change', () => selections.set(key, select.value)); wrapper.append(select); return { wrapper, select };
  }
  async function loadBilling() {
    await reconcile(); const data = await request({ action: 'status' }); if (!host.isConnected) return;
    if (!Array.isArray(data.plans) || !data.plans.length || data.plans.some(plan => !Number.isFinite(plan.monthlyUsd) || !Number.isFinite(plan.monthlyCredits)) || !Number.isFinite(data.includedCredits?.balance) || !Number.isFinite(data.purchasedCredits?.balance)) throw new Error('Billing data is temporarily unavailable. Refresh to retry.');
    if (currentPlan && currentPlan !== data.plan) { await window.timewarp.request('refreshAiFunding').catch(() => {}); void loadProvider().catch(providerError); }
    currentPlan = data.plan; billingData = data; content.replaceChildren(); notify();
    const plan = data.plans.find(item => item.id === data.plan);
    const packs = (data.credits?.packs || []).filter(pack => Number.isFinite(pack.credits) && Number.isFinite(pack.usd) && pack.credits > 0 && pack.usd >= 0);
    const monthlyAddons = (data.monthlyCreditAddons || []).filter(addon => Number.isFinite(addon.credits) && addon.credits > 0 && Number.isFinite(addon.monthlyUsd) && addon.monthlyUsd >= 0);
    const overview = el('section', 'tw-overview'); overview.setAttribute('aria-label', 'Plan usage'); content.append(overview, provider); renderUsage();
    if (pendingKey && localStorage.getItem(pendingKey)) {
      const pending = el('div', 'tw-pending'); pending.append(el('p', 'tw-muted', 'Checkout is awaiting payment confirmation.'), button('Cancel pending checkout', async () => { const checkout = JSON.parse(localStorage.getItem(pendingKey)); await request({ action: 'cancel-checkout', sessionId: checkout.id }); localStorage.removeItem(pendingKey); clearTimeout(billingTimer); await load(); }, 'quiet')); content.append(pending);
    }
    const plans = el('section', 'tw-plans'); plans.setAttribute('aria-label', 'Your plan and other plans');
    const planHeading = el('div', 'tw-panel-heading'); planHeading.append(sectionHeading('Your plan', 'Compare plans. Prices in USD.'));
    if (data.canOpenPortal) planHeading.append(button('Manage subscription', () => openPayment({ action: 'portal' }), 'quiet', 'arrow')); plans.append(planHeading);
    const cards = el('div', 'tw-plan-grid');
    for (const item of data.plans) {
      const isCurrent = item.id === data.plan, card = el('article', 'tw-plan-card' + (isCurrent ? ' tw-plan-current' : '')); card.dataset.plan = item.id;
      const heading = el('div', 'tw-plan-heading'); heading.append(el('h3', '', item.name)); if (isCurrent) heading.append(badge('Your plan', true)); card.append(heading);
      const price = el('p', 'tw-plan-price'); price.append(el('strong', '', money(item.monthlyUsd)), el('span', 'tw-muted', '/ month')); card.append(price);
      const allowance = el('p', 'tw-plan-allowance'); card.append(allowance);
      const key='plan:'+item.id, savedExtra=isCurrent?data.monthlyExtraCredits||0:0;
      if (!selections.has(key)) selections.set(key,String(savedExtra));
      const picker = creditSelect(item.id==='free'?[]:monthlyAddons.map(addon=>({credits:addon.credits,usd:addon.monthlyUsd})), 'Monthly extra credits', key); picker.select.setAttribute('aria-label','Monthly extra credits for '+item.name); picker.wrapper.classList.add('tw-plan-addon'); card.append(picker.wrapper);
      for(const option of picker.select.options)if(option.value!=='0')option.textContent+=' / month';
      const addonDetail = el('p', 'tw-addon-detail tw-muted'); card.append(addonDetail);
      const selectedAddon = () => monthlyAddons.find(addon => String(addon.credits) === picker.select.value);
      let choose;
      const upgrade = item.monthlyUsd > (plan?.monthlyUsd ?? 0);
      choose = button('', async () => {
        const addon = selectedAddon(); picker.select.disabled = true;
        try {
          if (item.id === 'free') await openPayment({ action: 'portal' });
          else await openPayment({ action: 'checkout', plan: item.id, monthlyExtraCredits:addon?.credits||0 });
        } finally { picker.select.disabled = false; updateSelection(); }
      }, !isCurrent && upgrade ? 'primary' : '');
      const updateSelection = () => {
        const addon = selectedAddon(), extra=addon?.credits||0;
        price.querySelector('strong').textContent=money(isCurrent&&extra===savedExtra&&Number.isFinite(data.monthlyUsd)?data.monthlyUsd:item.monthlyUsd+(addon?.monthlyUsd||0));
        allowance.textContent=item.id==='free'?'Use your ChatGPT / Codex plan':number(item.monthlyCredits+extra)+' credits / month';
        choose.querySelector('span').textContent = isCurrent ? extra===savedExtra?'Current plan':'Update plan' : item.id === 'free' ? data.canOpenPortal ? 'Manage cancellation' : 'Free plan' : upgrade ? 'Upgrade' : 'Switch plan';
        choose.disabled = isCurrent&&extra===savedExtra||item.id==='free'&&!data.canOpenPortal;
        addonDetail.textContent = item.id==='free'?'Buy extra credits below':addon?money(addon.monthlyUsd)+' added each month':'Renews monthly';
      };
      picker.select.addEventListener('change', updateSelection); updateSelection(); picker.select.disabled = item.id==='free'||!monthlyAddons.length;
      card.append(choose); cards.append(card);
    }
    plans.append(cards); content.append(plans);
    const extra = el('section', 'tw-extra-credits'); extra.append(sectionHeading('Extra credits', 'One-time credits that carry over.'));
    const balance = el('div', 'tw-active-credits'), balanceLabel = el('div'); balanceLabel.append(el('p', 'tw-label', 'Active credits'), el('p', 'tw-muted', 'Ready to use whenever you need them.'));
    const amount = el('p', 'tw-active-credit-value'); amount.append(el('strong', '', number(data.purchasedCredits.balance)), el('span', 'tw-muted', 'credits')); balance.append(balanceLabel, amount); extra.append(balance);
    if (packs.length) {
      const picker = creditSelect(packs, 'Extra credits', 'extra', false), purchaseRow = el('div', 'tw-extra-purchase');
      const buy = button('Buy credits', async () => {
        const pack = packs.find(pack => String(pack.credits) === picker.select.value); if (!pack) return;
        picker.select.disabled = true; try { await openPayment({ action: 'buy-credits', packCredits: pack.credits }); } finally { picker.select.disabled = false; }
      }, 'primary'); purchaseRow.append(picker.wrapper, buy); extra.append(purchaseRow);
    } else extra.append(el('p', 'tw-muted', 'Credit packs are temporarily unavailable. Refresh to retry.')); content.append(extra);
    const activity = el('details', 'tw-activity'); activity.append(el('summary', '', 'Recent activity'));
    const activityBody = el('div', 'tw-panel tw-activity-body'); activityBody.append(el('p', 'tw-muted tw-empty', 'Loading credit activity…')); activity.append(activityBody); content.append(activity); void loadActivity(activityBody);
    clearTimeout(billingTimer); if (pendingKey && localStorage.getItem(pendingKey)) scheduleRefresh();
  }
  async function loadActivity(body) {
    try {
      const history = await window.timewarp.request('cloud', { route: '/billing/history', data: {} }); if (!body.isConnected) return;
      if (!Array.isArray(history.events)) throw new Error('Credit activity is temporarily unavailable.'); body.replaceChildren();
      if (!history.events.length) { body.append(el('p', 'tw-empty', 'No credit activity yet.'), el('p', 'tw-muted tw-empty-detail', 'Your purchases and AI usage will appear here.')); return; }
      const scroll = el('div', 'tw-table-scroll'), table = el('table', 'tw-table'); table.append(el('caption', 'tw-sr-only', 'Recent AI credit activity'));
      const head = el('thead'), labels = el('tr'); for (const label of ['Activity', 'Date', 'Credits']) { const th = el('th', '', label); th.scope = 'col'; labels.append(th); } head.append(labels); table.append(head); const rows = el('tbody');
      for (const event of history.events.slice(0, 10)) {
        const row = el('tr'), detail = el('td'), delta = Number(event.delta_credits); detail.append(el('span', 'tw-activity-name', delta < 0 ? 'AI usage' : capitalized(String(event.kind || 'Credit adjustment').replace(/_/g, ' '))));
        if (event.model) detail.append(el('span', 'tw-muted tw-activity-model', String(event.model).replace(/^openai\//, '')));
        const time = el('time', '', date(event.occurred_at) || 'Unavailable'); if (date(event.occurred_at)) { time.dateTime = new Date(event.occurred_at).toISOString(); time.title = new Date(event.occurred_at).toLocaleString(); } const timestamp = el('td', 'tw-muted'); timestamp.append(time);
        const amount = el('td', 'tw-credit-delta' + (delta > 0 ? ' tw-credit-positive' : ''), Number.isFinite(delta) ? (delta > 0 ? '+' : delta < 0 ? '−' : '') + Math.abs(delta).toLocaleString(undefined, { maximumFractionDigits: 4 }) : 'Unavailable'); row.append(detail, timestamp, amount); rows.append(row);
      }
      table.append(rows); scroll.append(table); body.append(scroll); if (history.events.length > 10) body.append(el('p', 'tw-footnote tw-activity-footer', 'Showing the 10 most recent entries.'));
    } catch { if (!body.isConnected) return; body.replaceChildren(el('p', 'tw-muted tw-empty', 'Credit activity is temporarily unavailable.'), button('Retry activity', () => loadActivity(body), 'quiet')); }
  }
  void load().catch(error => {
    if (!host.isConnected) return; notify(error.message, true); const fallback = el('div', 'tw-panel tw-load-error'); fallback.append(sectionHeading('Couldn’t load billing', 'Refresh to load your plan, prices, and balances.'), button('Retry billing', load)); content.replaceChildren(fallback, provider);
  });
  void loadProvider().catch(providerError);
};
