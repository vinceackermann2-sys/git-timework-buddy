"use strict";
// Any kind of AI with an Agent ID, where each action came from, and tracing
// what agents make back to them.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { startLocal, loadModule } = require("../scripts/agent-id-local.cjs");

async function setup(t, env = {}) {
  const local = await startLocal({ env });
  t.after(() => local.close());
  const ok = async (method, url, init) => {
    const response = await local.call(method, url, init);
    assert.ok(response.status < 300, `${method} ${url} → ${response.status} ${JSON.stringify(response.body)}`);
    return response.body;
  };
  const terms = (await ok("GET", "/v1/config")).legal.termsVersion;
  const user = async () => { const u = await local.user(); await ok("POST", "/v1/account/terms", { token: u.session, body: { version: terms } }); return u; };
  const agent = async (owner, body) => { const created = await ok("POST", "/v1/agents", { token: owner.session, body }); return { ...created.agent, key: created.secret }; };
  return { local, ok, user, agent };
}

test("any kind of AI: the owner says what it is, passports carry it, and actions record where they came from", async t => {
  const { local, ok, user, agent } = await setup(t);
  const alice = await user();
  const coder = await agent(alice, { name: "Coder" });
  assert.deepEqual(coder.model, { kind: "agent", label: "AI agent", provider: null, name: null });
  const painter = await agent(alice, { name: "Painter", model: { kind: "image", provider: "Google", name: "Imagen 4" } });
  assert.deepEqual(painter.model, { kind: "image", label: "Image model", provider: "Google", name: "Imagen 4" });
  const bad = await local.call("POST", "/v1/agents", { token: alice.session, body: { name: "X", model: { kind: "toaster" } } });
  assert.deepEqual([bad.status, bad.body.error.code], [400, "invalid"]);
  const constructor = await local.call("POST", "/v1/agents", { token: alice.session, body: { name: "X", model: { kind: "constructor" } } });
  assert.equal(constructor.status, 400, "Only the kinds listed.");

  // Changed later, one field at a time.
  const voice = await ok("PATCH", `/v1/agents/${coder.id}`, { token: alice.session, body: { model: { kind: "voice", provider: "ElevenLabs" } } });
  assert.deepEqual(voice.agent.model, { kind: "voice", label: "Voice and audio model", provider: "ElevenLabs", name: null });
  const cleared = await ok("PATCH", `/v1/agents/${coder.id}`, { token: alice.session, body: { model: { provider: "" } } });
  assert.equal(cleared.agent.model.provider, null);

  // Services see it in the passport and the online check.
  // Where an agent acted from: its network address, and the computer the CLI names.
  const where = { "x-forwarded-for": "203.0.113.7, 10.0.0.1", "timewarp-device": "alice-laptop<script>" };
  const { passport, claims } = await ok("POST", "/v1/me/passport", { token: painter.key, body: { audience: "https://api.example.com" }, headers: where });
  assert.deepEqual(claims.agent.model, { kind: "image", provider: "Google", name: "Imagen 4" });
  const checked = await ok("POST", "/v1/verify", { body: { passport, audience: "https://api.example.com" } });
  assert.deepEqual(checked.agent.model, { kind: "image", provider: "Google", name: "Imagen 4" });

  const audit = (await ok("GET", `/v1/audit?agent=${painter.id}`, { token: alice.session })).entries;
  const issued = audit.find(e => e.action === "passport.issue");
  assert.deepEqual(issued.detail.where, { ip: "203.0.113.7", device: "alice-laptopscript" });
  // The owner's own actions don't carry it.
  const create = audit.find(e => e.action === "agent.create");
  assert.equal(create.detail.where, undefined);
});

// A picture with gradients, shapes and noise, like a real one.
function picture(width, height, seed = 1) {
  let state = seed;
  const random = () => ((state = (state * 1664525 + 1013904223) >>> 0) / 4294967296);
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4, circle = (x - width * 0.6) ** 2 + (y - height * 0.4) ** 2 < (width * 0.18) ** 2;
    const noise = (random() - 0.5) * 18;
    data[i] = (circle ? 230 : 40 + (x / width) * 150) + noise;
    data[i + 1] = (circle ? 190 : 60 + (y / height) * 120) + noise;
    data[i + 2] = (y > height * 0.7 ? 70 : 150 + Math.sin(x / 9) * 40) + noise;
    data[i + 3] = 255;
  }
  return { width, height, data };
}
// Seconds of something like music: chords that come and go, and a little noise.
function music(seconds = 6, rate = 44100) {
  const samples = new Float32Array(seconds * rate);
  let state = 7;
  const random = () => ((state = (state * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < samples.length; i++) {
    const t = i / rate, beat = 0.55 + 0.45 * Math.sin(Math.PI * t * 2) ** 2;
    samples[i] = beat * (0.25 * Math.sin(2 * Math.PI * 220 * t) + 0.18 * Math.sin(2 * Math.PI * 277 * t) + 0.12 * Math.sin(2 * Math.PI * 330 * t)) + (random() - 0.5) * 0.02;
  }
  return { sampleRate: rate, channels: [samples] };
}

const ESSAY = "The harbour was quiet that morning. Fishing boats came in one by one, their engines slow and low, and the gulls followed them all the way to the pier. Anna counted the crates as they came off, wrote the numbers in her notebook, and called the market before nine. Prices were good this week, better than the last, and she smiled for the first time in days.";
const CODE = "export function total(items) {\n  let sum = 0;\n  for (const item of items) {\n    if (item.price > 0) sum += item.price * item.quantity;\n  }\n  return Math.round(sum * 100) / 100;\n}\n\nexport function cheapest(items) {\n  return items.reduce((best, item) => (item.price < best.price ? item : best));\n}\n";
const INVISIBLE = /[​‌‍⁠﻿]/g;

test("tracing: agents mark what they make, anyone checks it, and what Agent ID sends is traced", async t => {
  const { local, ok, user, agent } = await setup(t);
  const { encodePng, decodePng } = loadModule("trace/png.ts");
  const { encodeWav, decodeWav } = loadModule("trace/wav.ts");
  const alice = await user();
  const painter = await agent(alice, { name: "Poster Studio", model: { kind: "image", provider: "Google", name: "Imagen 4" } });
  const writer = await agent(alice, { name: "Writer" });
  const friend = await agent(alice, { name: "Friend" });
  const check = async (body, type) => (await local.call("POST", "/v1/trace/check", { raw: body, headers: { "content-type": type } })).body;
  const bytesOf = async (key, id) => new Uint8Array(await (await local.fetch("GET", `/v1/me/files/${id}`, { token: key })).arrayBuffer());
  const config = await ok("GET", "/v1/config");
  assert.match(config.trace.audience, /\/agent-id\/trace$/);

  // Text: an invisible mark, found as it is, without its mark, and edited.
  const text = await ok("POST", "/v1/me/trace", { token: writer.key, body: { text: ESSAY } });
  assert.equal(text.marked, "mark");
  assert.match(text.trace.id, /^tr_[0-9a-f]{16}$/);
  assert.notEqual(text.text, ESSAY);
  assert.equal(text.text.replace(INVISIBLE, ""), ESSAY, "Only invisible characters are added.");
  const marked = await check(text.text, "text/plain; charset=utf-8");
  assert.deepEqual([marked.found, marked.match, marked.trace.id, marked.trace.agent.name], [true, "mark", text.trace.id, "Writer"]);
  assert.deepEqual([marked.trace.owner.verified, marked.trace.owner.name], [false, null], "A person is never named.");
  assert.equal((await check(ESSAY, "text/plain")).match, "exact");
  const edited = await check(ESSAY.replace("quiet", "still").replace("smiled", "laughed").replace(/\s+/g, "  "), "text/plain");
  assert.deepEqual([edited.found, edited.match, edited.trace.id], [true, "fingerprint", text.trace.id]);
  assert.ok(edited.similarity >= 0.5, String(edited.similarity));
  assert.deepEqual(await check("Totally unrelated words about mountains, trains and the price of coffee in winter, written by someone else entirely for another reason.", "text/plain"), { found: false, kind: "text" });

  // Code is left exactly as it is, and found by its fingerprint when reformatted.
  const code = await ok("POST", "/v1/me/trace", { token: writer.key, body: { text: CODE, kind: "code" } });
  assert.deepEqual([code.marked, code.text, code.trace.kind], ["fingerprint", CODE, "code"]);
  const reformatted = await check(CODE.replace(/  /g, "\t").replace("sum += item.price * item.quantity", "sum = sum + item.price * item.quantity"), "text/plain");
  assert.deepEqual([reformatted.found, reformatted.trace.id], [true, code.trace.id]);

  // A picture: a marked copy, found as it is and after it's re-saved brighter.
  const png = await encodePng(picture(320, 240));
  const upload = await ok("POST", "/v1/me/files", { token: painter.key, raw: png, headers: { "content-type": "image/png", "x-filename": "poster.png" } });
  const image = await ok("POST", "/v1/me/trace", { token: painter.key, body: { fileId: upload.file.id } });
  assert.deepEqual([image.marked, image.trace.kind, image.trace.agent.model.label], ["mark", "image", "Image model"]);
  assert.notEqual(image.file.id, upload.file.id);
  const copy = await bytesOf(painter.key, image.file.id);
  assert.equal((await check(copy, "image/png")).match, "exact");
  const decoded = await decodePng(copy);
  for (let i = 0; i < decoded.data.length; i += 4) for (let c = 0; c < 3; c++) decoded.data[i + c] = Math.min(255, decoded.data[i + c] * 1.06);
  const brighter = await check(await encodePng(decoded), "image/png");
  assert.deepEqual([brighter.found, brighter.match, brighter.trace.id, brighter.trace.agent.model.name], [true, "mark", image.trace.id, "Imagen 4"]);
  assert.deepEqual(await check(await encodePng(picture(320, 240, 99)), "image/png"), { found: false, kind: "image" });
  assert.equal((await local.call("POST", "/v1/trace/check", { raw: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]), headers: { "content-type": "image/jpeg" } })).status, 415);

  // Sound: the same, found again at half the volume.
  const sound = await ok("POST", "/v1/me/files", { token: painter.key, raw: encodeWav(music(10)), headers: { "content-type": "audio/wav", "x-filename": "jingle.wav" } });
  const audio = await ok("POST", "/v1/me/trace", { token: painter.key, body: { fileId: sound.file.id } });
  assert.deepEqual([audio.marked, audio.trace.kind], ["mark", "audio"]);
  const heard = decodeWav(await bytesOf(painter.key, audio.file.id));
  heard.channels = heard.channels.map(channel => channel.map(v => v * 0.5));
  const quieter = await check(encodeWav(heard), "audio/wav");
  assert.deepEqual([quieter.found, quieter.match, quieter.trace.id], [true, "mark", audio.trace.id]);

  // A model maker marks for the agent that gave it a passport for tracing.
  const { passport } = await ok("POST", "/v1/me/passport", { token: painter.key, body: { audience: config.trace.audience } });
  const made = await local.fetch("POST", "/v1/trace/mark?provider=Acme%20Images&model=acme-img-2", { raw: await encodePng(picture(200, 160, 5)), headers: { "content-type": "image/png", "agent-passport": passport } });
  assert.equal(made.status, 200);
  const traceId = made.headers.get("agent-trace");
  assert.equal(made.headers.get("agent-trace-marked"), "mark");
  const byProvider = await check(new Uint8Array(await made.arrayBuffer()), "image/png");
  assert.deepEqual([byProvider.trace.id, byProvider.trace.provider, byProvider.trace.model], [traceId, "Acme Images", "acme-img-2"]);
  const elsewhere = (await ok("POST", "/v1/me/passport", { token: painter.key, body: { audience: "https://api.example.com" } })).passport;
  assert.equal((await local.call("POST", "/v1/trace/mark", { raw: "hello", headers: { "content-type": "text/plain", "agent-passport": elsewhere } })).status, 401, "Only passports for tracing.");
  assert.equal((await ok("GET", `/v1/trace/${traceId}`)).trace.agent.name, "Poster Studio");
  assert.equal((await local.call("GET", "/v1/trace/tr_0000000000000000")).status, 404);

  // Mail goes out traced: the text by its fingerprint (sent as written), and
  // a marked copy of a picture attached.
  for (const a of [writer, friend]) await ok("POST", `/v1/agents/${a.id}/resources`, { token: alice.session, body: { kind: "mail" } });
  await local.settle();
  const friendMail = (await ok("GET", `/v1/agents/${friend.id}`, { token: alice.session })).agent.resources.mail.address;
  const attachment = await ok("POST", "/v1/me/files", { token: writer.key, raw: await encodePng(picture(160, 120, 3)), headers: { "content-type": "image/png", "x-filename": "chart.png" } });
  const letter = "Hello Bob. Here is the chart we talked about on Monday, with the numbers for every week of the quarter. Call me when you have looked at it, and we can plan the next steps together.";
  await ok("POST", "/v1/me/mail", { token: writer.key, body: { to: friendMail, subject: "The chart", text: letter, attachments: [attachment.file.id] } });
  const inbox = (await ok("GET", "/v1/me/mail?folder=inbox", { token: friend.key })).messages.find(m => m.subject === "The chart");
  const received = (await ok("GET", `/v1/me/mail/${inbox.id}`, { token: friend.key })).message;
  assert.match(received.data.trace, /^tr_/);
  assert.equal(received.text, letter, "Mail text is sent as written.");
  assert.equal((await check(letter, "text/plain")).trace.agent.name, "Writer");
  const chart = await check(await bytesOf(friend.key, received.attachments[0].id), "image/png");
  assert.deepEqual([chart.found, chart.trace.agent.name, chart.trace.via], [true, "Writer", "mail"]);

  // The agent checks what it received; MCP lists both tools.
  const rpc = body => local.call("POST", "/mcp", { token: friend.key, body: { jsonrpc: "2.0", ...body } });
  const tools = (await rpc({ id: 1, method: "tools/list" })).body.result.tools.map(tool => tool.name);
  assert.ok(tools.includes("trace_mark") && tools.includes("trace_check") && tools.includes("file_upload"), tools.join(", "));
  const viaMcp = await rpc({ id: 2, method: "tools/call", params: { name: "trace_check", arguments: { file_id: received.attachments[0].id } } });
  assert.equal(JSON.parse(viaMcp.body.result.content[0].text).trace.agent.name, "Writer");
  const markedByMcp = JSON.parse((await rpc({ id: 3, method: "tools/call", params: { name: "trace_mark", arguments: { text: ESSAY.replace("Anna", "Maria"), model: "claude-opus-5-5" } } })).body.result.content[0].text);
  assert.equal((await check(markedByMcp.text, "text/plain")).trace.agent.name, "Friend");
  assert.equal((await ok("GET", `/v1/trace/${markedByMcp.trace.id}`)).trace.model, "claude-opus-5-5");

  // The owner sees each mark; a revoked agent's work still traces back to it.
  const audit = (await ok("GET", `/v1/audit?agent=${painter.id}`, { token: alice.session })).entries;
  assert.ok(audit.some(e => e.action === "trace.mark" && e.detail.kind === "image"));
  await ok("DELETE", `/v1/agents/${painter.id}`, { token: alice.session });
  const after = await check(copy, "image/png");
  assert.deepEqual([after.found, after.trace.agent.status], [true, "revoked"]);
});
