(() => {
  'use strict';
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const $ = id => document.getElementById(id);
  const watch = (el, enter, leave, threshold = 0.4) => {
    if (!('IntersectionObserver' in window)) { enter(); return; }
    new IntersectionObserver(entries => entries.forEach(e => e.isIntersecting ? enter() : leave && leave()), { threshold }).observe(el);
  };

  /* Scroll reveal */
  const reveals = document.querySelectorAll('.reveal');
  if (reduced || !('IntersectionObserver' in window)) reveals.forEach(el => el.classList.add('in'));
  else {
    const io = new IntersectionObserver(entries => entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { threshold: 0.3 });
    reveals.forEach(el => io.observe(el));
  }

  /* Hero: the brief types itself into the app's composer */
  const brief = 'Write the Lumen Co. proposal from Tuesday’s call notes and draft the follow-up email.';
  const typed = $('typed'), send = $('send');
  if (reduced) { typed.textContent = brief; send.classList.add('ready'); }
  else {
    let i = 0;
    const type = () => {
      typed.textContent = brief.slice(0, ++i);
      if (i < brief.length) setTimeout(type, 28 + Math.random() * 40);
      else { send.classList.add('ready'); setTimeout(() => { i = 0; send.classList.remove('ready'); typed.textContent = ''; setTimeout(type, 600); }, 4200); }
    };
    setTimeout(type, 900);
  }

  /* The problem: the clock runs late while you do the chores */
  const clock = $('clock'), clockLine = clock.parentElement;
  const setClock = m => {
    clock.textContent = String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
    clockLine.classList.toggle('late', m >= 20 * 60);
  };
  if (reduced) setClock(21 * 60 + 48);
  else {
    let timer = null;
    watch($('chores'), () => {
      if (timer) return;
      let m = 17 * 60 + 30;
      setClock(m);
      timer = setInterval(() => { m += 4; setClock(m); if (m >= 21 * 60 + 48) { clearInterval(timer); setClock(21 * 60 + 48); } }, 45);
    }, null, 0.5);
  }

  /* How it works: the agent ticks off the same chores, then the result is ready */
  const ticks = [...$('ticks').children];
  const status = $('status'), result = $('result');
  const show = n => {
    ticks.forEach((li, j) => li.className = j < n ? 'done' : j === n ? 'active' : '');
    const done = n >= ticks.length;
    status.textContent = done ? 'Done' : 'Working…';
    status.classList.toggle('done', done);
    result.classList.toggle('ready', done);
  };
  if (reduced) show(ticks.length);
  else {
    let timers = [];
    show(-1);
    watch($('agent'), () => {
      if (timers.length) return;
      for (let n = 0; n <= ticks.length; n++) timers.push(setTimeout(() => show(n), 400 + n * 1100));
    }, null, 0.5);
  }

  $('year').textContent = new Date().getFullYear();
})();
