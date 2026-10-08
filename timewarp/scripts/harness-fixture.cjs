"use strict";
// Local-only acceptance target. Evidence comes from the button's POST, not the
// agent's completion text. Each run has a nonce the prompt does not disclose.
const http = require('node:http'), crypto = require('node:crypto');
const fs = require('node:fs'), path = require('node:path');
const nonce = crypto.randomBytes(8).toString('hex');
const report = path.join(__dirname, '../reports/harness-live-fixture.json');
const evidence = { startedAt: new Date().toISOString(), verified: false, visits: 0 };
const save = () => fs.writeFileSync(report, JSON.stringify(evidence, null, 2));
const server = http.createServer((req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'POST' && req.url === '/verify') {
    let body = ''; req.on('data', chunk => { body += chunk; if (body.length > 2048) req.destroy(); });
    req.on('end', () => {
      evidence.verified = body === nonce;
      evidence.verifiedAt = new Date().toISOString(); save();
      res.writeHead(evidence.verified ? 200 : 400, {'Content-Type':'text/plain'});
      res.end(evidence.verified ? 'VERIFIED ' + nonce : 'Incorrect code');
    }); return;
  }
  if (req.url !== '/') { res.writeHead(404).end(); return; }
  evidence.visits++; save();
  res.writeHead(200, {'Content-Type':'text/html; charset=utf-8'});
  res.end(`<!doctype html><title>Timewarp harness acceptance</title><style>body{font:22px system-ui;padding:60px;background:#f5f1ff}input,button{font:inherit;padding:12px;margin:12px}output{display:block;margin-top:24px}</style><h1>Timewarp harness acceptance</h1><p>Copy this code into the field: <strong>${nonce}</strong></p><label>Verification code <input aria-label="Verification code"></label><button>Verify task</button><output role="status">Waiting for verification</output><script>document.querySelector('button').onclick=async()=>{const r=await fetch('/verify',{method:'POST',body:document.querySelector('input').value});document.querySelector('output').textContent=await r.text()}</script>`);
});
fs.mkdirSync(path.dirname(report), {recursive:true});
server.listen(0, '127.0.0.1', () => {
  evidence.url = 'http://127.0.0.1:' + server.address().port; save();
  console.log(evidence.url);
});
setTimeout(() => server.close(), 30 * 60 * 1000).unref();
