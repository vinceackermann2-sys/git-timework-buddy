// Cookie consent. Lovable's hosting adds its own analytics to every page (~flock.js sets a
// session-id cookie; the __l5e events SDK sends page views). This file loads first, without
// defer, and holds that cookie and those requests until the visitor accepts analytics. Held
// requests stay in memory: they are sent on Accept and dropped on Reject.
// Add data-banner="off" to the script tag to keep the guard without showing the banner.
(() => {
  'use strict';
  const KEY = 'timewarp-consent';
  const VERSION = 1;
  const MAX_AGE = 365 * 864e5; // ask again after 12 months
  const PATHS = ['/~api/analytics', '/__l5e/'];
  const COOKIE = 'session-id';
  const script = document.currentScript;

  function read() {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY));
      if (saved && saved.v === VERSION && Date.now() - Date.parse(saved.at) < MAX_AGE) return saved;
    } catch {}
    return null;
  }
  let choice = read();
  // Global Privacy Control counts as a refusal until the visitor opts in under Cookie settings.
  if (!choice && navigator.globalPrivacyControl === true) choice = { analytics: false, gpc: true };
  const allowed = () => !!(choice && choice.analytics);

  const held = [];
  let heldCookie = null;
  const hold = send => { if (!choice && held.length < 50) held.push(send); };
  const isAnalytics = url => {
    try {
      const target = new URL(url, location.href);
      return target.origin === location.origin && PATHS.some(path => target.pathname.startsWith(path));
    } catch { return false; }
  };

  const cookie = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie');
  const setCookie = value => cookie.set.call(document, value);
  Object.defineProperty(document, 'cookie', {
    configurable: true,
    get() { return cookie.get.call(document); },
    set(value) {
      if (allowed() || !String(value).trim().startsWith(COOKIE + '=')) setCookie(value);
      else if (!choice) heldCookie = value;
    }
  });

  const nativeFetch = window.fetch && window.fetch.bind(window);
  if (nativeFetch) window.fetch = (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    if (allowed() || !isAnalytics(url)) return nativeFetch(input, init);
    const { signal, ...rest } = init || {};
    hold(() => nativeFetch(input instanceof Request ? input.clone() : url, rest));
    return Promise.resolve(new Response(null, { status: 202 }));
  };

  const nativeBeacon = navigator.sendBeacon && navigator.sendBeacon.bind(navigator);
  if (nativeBeacon) navigator.sendBeacon = (url, data) => {
    if (allowed() || !isAnalytics(url)) return nativeBeacon(url, data);
    hold(() => nativeBeacon(url, data));
    return true;
  };

  const xhr = XMLHttpRequest.prototype;
  const { open, send, setRequestHeader } = xhr;
  xhr.open = function (method, url) {
    this.twHeld = isAnalytics(url) ? { method, url: String(url), headers: {} } : null;
    return open.apply(this, arguments);
  };
  xhr.setRequestHeader = function (name, value) {
    if (this.twHeld) this.twHeld.headers[name] = value;
    return setRequestHeader.apply(this, arguments);
  };
  xhr.send = function (body) {
    const request = this.twHeld;
    if (!request || allowed()) return send.apply(this, arguments);
    hold(() => nativeFetch && nativeFetch(request.url, { method: request.method, headers: request.headers, body }));
  };

  function save(analytics) {
    choice = { v: VERSION, analytics, at: new Date().toISOString() };
    try { localStorage.setItem(KEY, JSON.stringify(choice)); } catch {}
    const queued = held.splice(0);
    if (analytics) {
      if (heldCookie) setCookie(heldCookie);
      queued.forEach(run => { try { run(); } catch {} });
    } else {
      setCookie(COOKIE + '=; Max-Age=0; path=/; secure');
    }
    heldCookie = null;
    hide();
  }

  let banner = null;
  let opener = null;
  function render() {
    banner = document.createElement('section');
    banner.className = 'consent';
    banner.setAttribute('role', 'region');
    banner.setAttribute('aria-labelledby', 'consent-title');
    banner.innerHTML =
      '<p class="consent-title" id="consent-title">Cookies</p>' +
      '<p>We use essential cookies to run this site. With your OK, we also use an analytics cookie to count visits and see which pages work. <a href="/legal/cookie-policy">Cookie policy</a></p>' +
      '<p class="consent-state" hidden></p>' +
      '<div class="consent-actions">' +
        '<button type="button" class="btn btn-sm btn-out" data-consent="reject">Reject</button>' +
        '<button type="button" class="btn btn-sm btn-out" data-consent="accept">Accept</button>' +
      '</div>';
    banner.addEventListener('click', event => {
      const button = event.target.closest('[data-consent]');
      if (button) save(button.dataset.consent === 'accept');
    });
    document.body.appendChild(banner);
  }
  function show(focus) {
    if (!banner) render();
    const state = banner.querySelector('.consent-state');
    state.hidden = !choice;
    if (choice) state.textContent = 'Analytics is ' + (choice.analytics ? 'on.' : choice.gpc ? 'off because your browser sends Global Privacy Control.' : 'off.');
    banner.hidden = false;
    if (focus) banner.querySelector('[data-consent="' + (allowed() ? 'accept' : 'reject') + '"]').focus();
  }
  function hide() {
    if (!banner) return;
    banner.hidden = true;
    if (opener && document.contains(opener)) opener.focus();
    opener = null;
  }

  document.addEventListener('click', event => {
    const trigger = event.target.closest('[data-cookie-settings]');
    if (!trigger) return;
    event.preventDefault();
    opener = trigger;
    show(true);
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && opener && banner && !banner.hidden) hide();
  });
  if (!choice && !(script && script.dataset.banner === 'off')) {
    if (document.body) show(false);
    else document.addEventListener('DOMContentLoaded', () => show(false));
  }
})();
