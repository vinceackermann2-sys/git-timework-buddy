(() => {
  'use strict';
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const $ = id => document.getElementById(id);

  /* ---------- Hero: Cosmo works in the app's built-in browser ---------- */
  const B = $('hb');
  const cursor = $('cursor'), omni = $('omni'), omniText = $('omni-text'), load = $('br-load');
  const tabList = $('tab-list'), newTab = $('br-new'), back = $('br-back');
  const steps = [...$('h-steps').children], state = $('h-state'), done = $('h-done');
  const scenes = Object.fromEntries([...B.querySelectorAll('[data-scene]')].map(s => [s.dataset.scene, s]));
  const results = [...B.querySelectorAll('.results .r')];
  const tiers = [...B.querySelectorAll('.tiers div')];
  const grid = $('grid'), save = $('sheet-save');
  const sites = [
    ['Brightline Studio', 'brightline-studio.com/pricing', '$1,200', '$2,900', '$5,500', 'B', '#ef8354'],
    ['Northpeak', 'northpeak.agency/plans', '$900', '$2,400', '$4,800', 'N', '#3f8f62'],
    ['Kestrel & Co', 'kestrelandco.com/services', '$1,500', '$3,200', '$6,000', 'K', '#5b7fd1']
  ];
  const query = 'agencies like Lumen Co. pricing';
  const icons = { newtab: '<svg><use href="#i-globe"/></svg>', search: '<svg><use href="#i-search"/></svg>' };

  let run = 0;
  const STOP = Symbol('stop');
  const sleep = (ms, id) => new Promise((ok, stop) => setTimeout(() => (id === run ? ok() : stop(STOP)), ms));

  // Tabs
  const tabs = [];
  let active = 0;
  function drawTabs() {
    tabList.innerHTML = '';
    tabs.forEach((t, i) => {
      const el = document.createElement('div');
      el.className = 'ctab' + (i === active ? ' on' : '');
      const fav = document.createElement('span');
      fav.className = 't-fav' + (t.loading ? ' loading' : '');
      if (t.letter) { fav.textContent = t.letter; fav.style.background = t.color; } else fav.innerHTML = icons[t.icon] || icons.newtab;
      const title = document.createElement('span'); title.className = 't-title'; title.textContent = t.title;
      const x = document.createElement('span'); x.className = 't-x'; x.textContent = '×';
      el.append(fav, title, x);
      if (t.fresh) t.fresh = false; else el.style.animation = 'none';
      tabList.append(el);
    });
  }
  const setTab = patch => { Object.assign(tabs[active], patch); drawTabs(); };

  // Address bar
  const setUrl = (text, focus) => {
    omniText.textContent = text || 'Search or enter a URL';
    omniText.classList.toggle('ph', !text);
    omni.classList.toggle('focus', !!focus);
  };
  const scene = name => Object.entries(scenes).forEach(([k, el]) => el.classList.toggle('on', k === name));

  // Cursor: positions come from the real element boxes, so every click lands on its target
  function point(el, fx = .5, fy = .5) {
    const r = el.getBoundingClientRect(), b = B.getBoundingClientRect();
    return [r.left - b.left + r.width * fx, r.top - b.top + r.height * fy];
  }
  function place(x, y, ms) {
    cursor.style.transitionDuration = ms + 'ms';
    cursor.style.transform = 'translate(' + (x - 5) + 'px,' + (y - 4) + 'px)';
  }
  async function moveTo(el, id, fx, fy, ms = 750) { const [x, y] = point(el, fx, fy); place(x, y, ms); await sleep(ms + 80, id); }
  async function click(el, id) {
    cursor.classList.add('press'); if (el) el.classList.add('pressed');
    await sleep(140, id);
    cursor.classList.remove('press', 'click'); void cursor.offsetWidth; cursor.classList.add('click');
    if (el) el.classList.remove('pressed');
    await sleep(160, id);
  }
  async function type(text, id, speed = 55) {
    for (let i = 1; i <= text.length; i++) { setUrl(text.slice(0, i), true); await sleep(speed, id); }
  }
  async function navigate(id, apply) {
    omni.classList.remove('focus');
    setTab({ loading: true });
    load.classList.remove('go'); void load.offsetWidth; load.classList.add('go');
    await sleep(650, id);
    apply();
    tabs[active].loading = false; drawTabs();
    load.classList.remove('go');
    await sleep(350, id);
  }
  const step = n => steps.forEach((li, i) => li.className = i < n ? 'done' : i === n ? 'active' : '');

  // Spreadsheet
  const head = ['Competitor', 'Starter', 'Growth', 'Scale'];
  function buildGrid() {
    grid.innerHTML = '';
    const add = (cls, text) => { const s = document.createElement('span'); if (cls) s.className = cls; if (text) s.textContent = text; grid.append(s); return s; };
    add('cl', ''); ['A', 'B', 'C', 'D'].forEach(l => add('cl', l));
    add('rn', '1'); head.forEach(h => add('h', h));
    const cells = [];
    sites.forEach((_, r) => { add('rn', String(r + 2)); for (let c = 0; c < 4; c++) cells.push(add('', '')); });
    return cells;
  }

  function reset() {
    tabs.length = 0; tabs.push({ title: 'New tab', icon: 'newtab' }); active = 0; drawTabs();
    setUrl(''); scene('newtab');
    scenes.site.classList.remove('captured');
    results.forEach(r => r.classList.remove('hover'));
    save.textContent = 'Save'; save.classList.remove('saved');
    step(-1); state.textContent = 'Working'; state.classList.remove('done'); done.classList.remove('show');
  }
  function finish() { step(4); state.textContent = 'Done'; state.classList.add('done'); done.classList.add('show'); }

  async function play(id) {
    reset();
    const [cx, cy] = point(scenes.newtab, .62, .62); place(cx, cy, 0);
    await sleep(900, id);

    // 1. Search from the address bar
    step(0);
    await moveTo(omni, id, .3, .5);
    await click(omni, id);
    setUrl('', true);
    await type(query, id);
    await sleep(300, id);
    await navigate(id, () => {
      setTab({ title: query, icon: 'search' }); setUrl('Search: ' + query);
      $('serp-q').textContent = query; scenes.search.classList.add('ready'); scene('search');
    });

    // 2. Open each competitor's pricing page
    step(1);
    for (let i = 0; i < sites.length; i++) {
      const s = sites[i];
      if (i > 0) {
        await moveTo(back, id, .5, .5, 650); await click(back, id);
        await navigate(id, () => { setTab({ title: query, icon: 'search', letter: null }); setUrl('Search: ' + query); scene('search'); });
      }
      const link = results[i].querySelector('b');
      await moveTo(link, id, .35, .55, 700);
      results[i].classList.add('hover');
      await click(link, id);
      await navigate(id, () => {
        results[i].classList.remove('hover');
        setTab({ title: s[0] + ' — Pricing', letter: s[5], color: s[6] }); setUrl(s[1]);
        $('site-name').textContent = s[0]; $('site-fav').textContent = s[5]; $('site-fav').style.background = s[6];
        $('p1').textContent = s[2]; $('p2').textContent = s[3]; $('p3').textContent = s[4];
        scenes.site.classList.remove('captured'); scene('site');
      });
      for (const t of tiers) await moveTo(t.querySelector('em'), id, .5, .5, 380);
      scenes.site.classList.add('captured');
      await sleep(450, id);
    }

    // 3. New tab, open the sheet and fill it
    step(2);
    await moveTo(newTab, id, .5, .5, 700); await click(newTab, id);
    tabs.push({ title: 'New tab', icon: 'newtab', fresh: true }); active = tabs.length - 1; drawTabs();
    setUrl(''); scene('newtab');
    await sleep(350, id);
    await moveTo(omni, id, .3, .5, 600); await click(omni, id);
    await type('Lumen Co. / competitors.xlsx', id, 38);
    let cells = [];
    await navigate(id, () => { setTab({ title: 'competitors.xlsx', letter: '▦', color: '#4f9d6d' }); setUrl('Lumen Co. / competitors.xlsx'); cells = buildGrid(); scene('sheet'); });
    for (let r = 0; r < sites.length; r++) {
      const values = [sites[r][0], sites[r][2], sites[r][3], sites[r][4]];
      for (let c = 0; c < 4; c++) {
        const cell = cells[r * 4 + c];
        await moveTo(cell, id, .3, .55, 260);
        cells.forEach(x => x.classList.remove('sel')); cell.classList.add('sel');
        cell.textContent = values[c];
        await sleep(90, id);
      }
    }
    cells.forEach(x => x.classList.remove('sel'));

    // 4. Save
    step(3);
    await moveTo(save, id, .5, .5, 650); await click(save, id);
    save.textContent = 'Saved'; save.classList.add('saved');
    finish();
    await sleep(4200, id);
  }

  // Plays forever. A newer loop (after a resize) stops the old one; any other error restarts the run.
  async function loop() {
    for (;;) {
      const id = ++run;
      try { await play(id); }
      catch (e) {
        if (e === STOP) return;
        console.error(e);
        await new Promise(r => setTimeout(r, 1000));
        if (id !== run) return;
      }
    }
  }
  function finalState() {
    reset();
    tabs.push({ title: 'competitors.xlsx', letter: '▦', color: '#4f9d6d' }); active = 1; drawTabs();
    setUrl('Lumen Co. / competitors.xlsx'); const cells = buildGrid(); scene('sheet');
    sites.forEach((s, r) => [s[0], s[2], s[3], s[4]].forEach((v, c) => { cells[r * 4 + c].textContent = v; }));
    save.textContent = 'Saved'; save.classList.add('saved'); finish();
    cursor.hidden = true;
  }
  if (reduced) finalState();
  else {
    loop();
    // Restart cleanly after a resize so the cursor keeps landing on its targets
    // Restart only when the width really changes (mobile scrolling fires resize too)
    let t, width = window.innerWidth;
    window.addEventListener('resize', () => {
      if (window.innerWidth === width) return;
      width = window.innerWidth;
      clearTimeout(t); t = setTimeout(loop, 300);
    });
  }

  /* ---------- Download rows: link straight to the official installers ---------- */
  /* (Intel Macs get the dialog instead: the Mac build is Apple Silicon only) */
  const links = window.TIMEWARP_DOWNLOADS || {};
  const safe = value => { try { const u = new URL(value); return u.protocol === 'https:' ? u.href : null; } catch { return null; } };
  [['windows', 'dl-windows'], ['mac', 'dl-mac']].forEach(([platform, id]) => {
    const row = $(id), href = typeof links[platform] === 'string' && !(platform === 'mac' && window.TIMEWARP_INTEL_MAC) && safe(links[platform]);
    if (href) { row.href = href; row.rel = 'noopener'; }
    else row.addEventListener('click', e => { e.preventDefault(); const opt = document.querySelector('[data-platform="' + platform + '"]'); $('download-dialog').showModal(); opt && opt.click(); });
  });

  /* ---------- Pricing tabs ---------- */
  const tabBtns = [...document.querySelectorAll('.tabs [role=tab]')];
  const select = btn => tabBtns.forEach(b => {
    const on = b === btn;
    b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1;
    $(b.getAttribute('aria-controls')).hidden = !on;
  });
  tabBtns.forEach((b, i) => {
    b.addEventListener('click', () => select(b));
    b.addEventListener('keydown', e => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      const next = tabBtns[(i + (e.key === 'ArrowRight' ? 1 : tabBtns.length - 1)) % tabBtns.length];
      next.focus(); select(next);
    });
  });

  $('year').textContent = new Date().getFullYear();
})();
