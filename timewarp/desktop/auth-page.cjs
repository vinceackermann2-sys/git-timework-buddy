"use strict";
const escapeHtml=value=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));

// The callback server links its logo and stylesheet. A page with no server
// behind it (a sign-in window's) passes them inline: logo as a data URL, css.
// pending shows a spinner while a sign-in finishes.
function authPage({title,message,success=false,pending=false,hint,logo='/timewarp-logo.svg',css=null}){
  const icon=pending?'<span class="ring"></span>':`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${success?'<path d="m5 12 4 4L19 6"/>':'<path d="M12 7v6m0 4h.01"/><circle cx="12" cy="12" r="10"/>'}</svg>`;
  const note=hint??(pending?'':success?'You can close this tab.':'Start again from the Timewarp app.');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="theme-color" content="#B7D6FF"><title>${escapeHtml(title)} · Timewarp</title><link rel="icon" href="${escapeHtml(logo)}">${css==null?'<link rel="stylesheet" href="/timewarp-auth.css">':`<style>${css}</style>`}</head><body class="timewarp-auth-page"><div class="brand"><img src="${escapeHtml(logo)}" alt=""><span>Timewarp</span></div><main class="card" aria-labelledby="title"><div class="signal" aria-hidden="true">${icon}</div><h1 id="title">${escapeHtml(title)}</h1><p role="${pending||success?'status':'alert'}">${escapeHtml(message)}</p></main>${note?`<p class="hint">${escapeHtml(note)}</p>`:''}</body></html>`;
}
module.exports={authPage};
