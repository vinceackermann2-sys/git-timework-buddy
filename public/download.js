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

  // Every Mac browser reports "Intel Mac OS X", so the GPU tells the chips apart:
  // Apple Silicon reports "Apple M…", Intel Macs (OpenCore Legacy Patcher ones
  // included) Intel, AMD or NVIDIA graphics. Safari says "Apple GPU" on both; only
  // Apple Silicon GPUs offer ASTC textures, so that marks Apple Silicon there.
  // Anything else stays unknown and the visitor chooses.
  function detectMacChip(documentLike) {
    try {
      const gl = documentLike.createElement('canvas').getContext('webgl');
      if (!gl) return null;
      const info = gl.getExtension('WEBGL_debug_renderer_info');
      const renderer = String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER) || '');
      if (/Apple M\d/i.test(renderer)) return 'arm';
      if (/\b(Intel|AMD|ATI|Radeon|NVIDIA|GeForce)\b/i.test(renderer)) return 'intel';
      return gl.getExtension('WEBGL_compressed_texture_astc') ? 'arm' : null;
    } catch { return null; }
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
  const macChip = detected === 'mac' ? detectMacChip(document) : null;
  // With an Intel build, each Mac gets its own; without one, Intel Macs are told it needs Apple Silicon.
  const intelBuild = !!downloadURL('macIntel');
  const macURL = chip => chip === 'intel' ? downloadURL('macIntel') : downloadURL('mac');
  // app.js reads these for the #dl-mac row.
  window.TIMEWARP_MAC_CHIP = macChip;
  window.TIMEWARP_INTEL_MAC = macChip === 'intel';
  const dialog = document.getElementById('download-dialog');
  const title = document.getElementById('dialog-title');
  const message = document.getElementById('platform-message');
  const link = document.getElementById('platform-download');
  const altLink = document.getElementById('platform-download-alt');
  const options = [...document.querySelectorAll('[data-platform]')];

  function showAlt(url, text) {
    if (!altLink) return;
    altLink.hidden = !url;
    if (url) { altLink.href = url; altLink.textContent = text; } else altLink.removeAttribute('href');
  }
  function selectPlatform(platform) {
    options.forEach(option => option.setAttribute('aria-pressed', String(option.dataset.platform === platform)));
    showAlt(null);
    if (platform === 'mac' && intelBuild && downloadURL('mac')) {
      // Both builds: the one for this Mac first, the other beside it.
      const chip = macChip === 'intel' ? 'intel' : 'arm';
      title.textContent = 'Timewarp for macOS.';
      message.textContent = macChip === 'intel' ? 'For Intel Macs running macOS 12 or later, including ones on OpenCore Legacy Patcher.'
        : macChip === 'arm' ? 'For Apple Silicon Macs (M1 or later) running macOS 12 or later.'
        : 'Choose the build for your Mac. Both run on macOS 12 or later.';
      link.hidden = false;
      link.href = macURL(chip);
      link.textContent = chip === 'intel' ? 'Download for Intel' : 'Download for Apple Silicon';
      showAlt(macURL(chip === 'intel' ? 'arm' : 'intel'), chip === 'intel' ? 'Apple Silicon Mac? Download for Apple Silicon' : 'Intel Mac? Download for Intel');
      return;
    }
    const url = downloadURL(platform), intel = platform === 'mac' && macChip === 'intel';
    title.textContent = !url ? platformName(platform) + ' download coming soon.' : intel ? 'Timewarp needs an Apple Silicon Mac.' : 'Timewarp for ' + platformName(platform) + '.';
    message.textContent = !url ? 'The official download link isn’t live yet. Check back soon.'
      : intel ? 'This Mac appears to have an Intel processor. Timewarp for Mac runs on Apple Silicon (M1 or later) with macOS 12 or later, so Intel Macs, including ones running OpenCore Legacy Patcher, can’t run it.'
      : platform === 'mac' ? 'For Apple Silicon Macs (M1 or later) running macOS 12 or later. Intel Macs aren’t supported.' : 'Your installer is ready.';
    link.hidden = !url;
    // Keep the link on Intel too, in case the GPU check misread an Apple Silicon Mac.
    if (url) { link.href = url; link.textContent = intel ? 'Download anyway' : 'Download for ' + platformName(platform); } else link.removeAttribute('href');
  }
  function openChooser(platform) {
    if (platform) selectPlatform(platform);
    else {
      title.textContent = 'Choose your platform.';
      message.textContent = '';
      options.forEach(option => option.setAttribute('aria-pressed', 'false'));
      link.hidden = true;
      link.removeAttribute('href');
      showAlt(null);
    }
    dialog.showModal();
  }

  // The direct download for this computer, or null when the visitor should choose.
  function directURL(platform) {
    if (platform !== 'mac') return platform ? downloadURL(platform) : null;
    if (intelBuild) return macChip ? macURL(macChip) : null;
    return macChip === 'intel' ? null : downloadURL('mac');
  }
  document.querySelectorAll('.download-action').forEach(action => {
    action.querySelector('.download-label').textContent = detected ? 'Download for ' + platformName(detected) : 'Get Timewarp';
    const icon = action.querySelector('.os-icon');
    if (icon) icon.innerHTML = icons[detected || 'generic'];
    const url = directURL(detected);
    if (url) { action.href = url; return; }
    action.addEventListener('click', event => { event.preventDefault(); openChooser(detected); });
  });

  document.querySelectorAll('.alt-download').forEach(button => {
    const target = detected ? other(detected) : null;
    button.hidden = false;
    button.textContent = target ? 'Also for ' + platformName(target) : 'Windows & macOS';
    button.addEventListener('click', () => {
      // With two Mac builds, someone on another computer chooses theirs in the dialog.
      const url = target && !(target === 'mac' && intelBuild) && downloadURL(target);
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
    note.textContent = live.length ? 'Available for ' + live.map(platformName).join(' & ') + (live.includes('mac') ? (intelBuild ? '. Mac: Apple Silicon and Intel, macOS 12+.' : '. Mac: Apple Silicon, macOS 12+.') : '') : 'Download links coming soon';
  }
})();
