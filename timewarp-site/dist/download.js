(() => {
  'use strict';
  const icons = {
    windows: '<svg viewBox="0 0 24 24"><path fill="currentColor" stroke="none" d="M3 5.5 10.5 4.4v7.1H3zM11.5 4.3 21 3v8.5h-9.5zM3 12.5h7.5v7.1L3 18.5zM11.5 12.5H21V21l-9.5-1.3z"/></svg>',
    mac: '<svg viewBox="0 0 24 24"><path fill="currentColor" stroke="none" d="M16.4 12.6c0-2.4 2-3.5 2-3.6-1.1-1.6-2.8-1.8-3.4-1.8-1.4-.2-2.8.8-3.5.8-.7 0-1.8-.8-3-.8-1.5 0-3 .9-3.8 2.3-1.6 2.8-.4 7 1.2 9.3.8 1.1 1.7 2.4 2.9 2.3 1.2 0 1.6-.7 3-.7s1.8.7 3 .7c1.3 0 2.1-1.1 2.8-2.3.9-1.3 1.3-2.6 1.3-2.6s-2.5-1-2.5-3.6zM14.1 5.6c.6-.8 1.1-1.8 1-2.9-.9 0-2 .6-2.7 1.4-.6.7-1.1 1.8-1 2.8 1 .1 2-.5 2.7-1.3z"/></svg>',
    generic: '<svg viewBox="0 0 24 24"><path d="M12 3v12m-4-4 4 4 4-4M5 16v5h14v-5"/></svg>'
  };

  function detectPlatform(navigatorLike) {
    const ua = navigatorLike.userAgent || '';
    const platform = (navigatorLike.userAgentData && navigatorLike.userAgentData.platform) || navigatorLike.platform || '';
    if (/Android|iPhone|iPad|iPod/i.test(ua) || (/Mac/i.test(platform) && navigatorLike.maxTouchPoints > 1)) return null;
    if (/Windows|Win32|Win64/i.test(platform + ' ' + ua)) return 'windows';
    if (/Macintosh|MacIntel|Mac OS|macOS/i.test(platform + ' ' + ua)) return 'mac';
    return null;
  }

  const downloads = window.TIMEWARP_DOWNLOADS || {};
  function downloadURL(platform) {
    const candidate = downloads[platform];
    if (typeof candidate !== 'string' || !candidate.trim()) return null;
    try { const url = new URL(candidate); return url.protocol === 'https:' ? url.href : null; } catch { return null; }
  }
  const platformName = platform => platform === 'windows' ? 'Windows' : 'macOS';
  const other = platform => platform === 'windows' ? 'mac' : 'windows';

  const detected = detectPlatform(navigator);
  const dialog = document.getElementById('download-dialog');
  const title = document.getElementById('dialog-title');
  const message = document.getElementById('platform-message');
  const link = document.getElementById('platform-download');
  const options = [...document.querySelectorAll('[data-platform]')];

  function selectPlatform(platform) {
    options.forEach(option => option.setAttribute('aria-pressed', String(option.dataset.platform === platform)));
    const url = downloadURL(platform);
    title.textContent = url ? 'Timewarp for ' + platformName(platform) + '.' : platformName(platform) + ' download coming soon.';
    message.textContent = url ? 'Your installer is ready.' : 'The official download link isn’t live yet. Check back soon.';
    link.hidden = !url;
    if (url) { link.href = url; link.textContent = 'Download for ' + platformName(platform); } else link.removeAttribute('href');
  }
  function openChooser(platform) {
    if (platform) selectPlatform(platform);
    else {
      title.textContent = 'Choose your platform.';
      message.textContent = '';
      options.forEach(option => option.setAttribute('aria-pressed', 'false'));
      link.hidden = true;
      link.removeAttribute('href');
    }
    dialog.showModal();
  }

  document.querySelectorAll('.download-action').forEach(action => {
    action.querySelector('.download-label').textContent = detected ? 'Download for ' + platformName(detected) : 'Get Timewarp';
    const icon = action.querySelector('.os-icon');
    if (icon) icon.innerHTML = icons[detected || 'generic'];
    const url = detected && downloadURL(detected);
    if (url) { action.href = url; return; }
    action.addEventListener('click', event => { event.preventDefault(); openChooser(detected); });
  });

  document.querySelectorAll('.alt-download').forEach(button => {
    const target = detected ? other(detected) : null;
    button.hidden = false;
    button.textContent = target ? 'Also for ' + platformName(target) : 'Windows & macOS';
    button.addEventListener('click', () => {
      const url = target && downloadURL(target);
      if (url) { window.location.href = url; return; }
      openChooser(target);
    });
  });

  options.forEach(option => option.addEventListener('click', () => selectPlatform(option.dataset.platform)));
  document.querySelector('.dialog-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const b = dialog.getBoundingClientRect();
    if (event.clientX < b.left || event.clientX > b.right || event.clientY < b.top || event.clientY > b.bottom) dialog.close();
  });

  const note = document.querySelector('.availability-note');
  if (note) {
    const live = ['windows', 'mac'].filter(downloadURL);
    note.textContent = live.length ? 'Available for ' + live.map(platformName).join(' & ') : 'Download links coming soon';
  }
})();
