"use strict";
// Background work on a small model: chat titles and the memory writer.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { openStore } = require("../app/main/store.cjs");
const { createKnowledge } = require("../app/main/knowledge.cjs");
const { titleFrom } = require("../app/main/harness.cjs");
const { createBackgroundRunner, createTitles, createMemoryWriter, cleanTitle, dailyLogText, BACKGROUND_MODEL, TITLE_INSTRUCTIONS } = require("../app/main/memory-writer.cjs");
const { CodexClient } = require("../app/main/codex-client.cjs");
const { codexExecutable, codexEnv, vendorRoot } = require("../app/main/codex-paths.cjs");
const { scriptedResponse } = require("../app/main/fixture.cjs");

function setup(t, settings = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tw-memory-writer-"));
  const store = openStore(path.join(root, "timewarp.sqlite"));
  t.after(() => { store.close(); fs.rmSync(root, { recursive: true, force: true }); });
  const runtimeDir = path.join(root, "runtime");
  const knowledge = createKnowledge({ runtimeDir, codexHome: path.join(runtimeDir, "codex"), home: root, env: {} });
  store.agents.create({ id: "agent-1", ownerId: "user-1", name: "Orbit", workspace: path.join(root, "orbit") });
  const conversation = store.conversations.create({ ownerId: "user-1", agentId: "agent-1", title: "Rome trip" });
  const jobs = [];
  let answer = { notes: null, log: null, summary: null };
  const runner = { run: async job => { jobs.push(job); return typeof answer === "function" ? answer(job) : answer; } };
  const state = { mode: "enabled", private: false, ...settings };
  const writer = createMemoryWriter({
    store, knowledge, runner, userId: () => "user-1", memoryMode: () => state.mode, privateMode: () => state.private,
    idleMs: 20, now: () => new Date(2026, 9, 10, 15), log: () => {},
  });
  t.after(() => writer.stop());
  const say = (author, text) => store.messages.append({ conversationId: conversation.id, authorId: author, text });
  return { root, runtimeDir, store, knowledge, writer, jobs, state, id: conversation.id, say, answer: value => { answer = value; } };
}

test("the memory writer updates the notes and today's log from what it hasn't seen", async t => {
  const { knowledge, writer, jobs, id, say, answer } = setup(t);
  knowledge.saveNotes("# User\n\n- Lives in Lisbon (2026-09-01).\n\n<!-- timewarp:onboarding-name -->\nPreferred name: \"Vi\".\n<!-- /timewarp:onboarding-name -->");
  say("user-1", "Plan my Rome trip, I prefer trains.");
  say("agent-1", "Booked the 8:10 train.");
  answer({ notes: "# User\n\n- Lives in Lisbon (2026-09-01).\n- Prefers trains over flights (2026-10-10).", log: "- Planned the Rome trip; booked the 8:10 train.", summary: "Planned the Rome trip." });
  assert.deepEqual(await writer.write(id), { notes: true, log: true });
  const job = jobs[0];
  assert.equal(job.purpose, "memory");
  assert.match(job.prompt, /Today is 2026-10-10\./);
  assert.match(job.prompt, /User \(.*\): Plan my Rome trip, I prefer trains\.\n\nOrbit \(.*\): Booked the 8:10 train\./);
  const notes = knowledge.read().notes;
  assert.match(notes, /Prefers trains over flights/);
  assert.match(notes, /<!-- timewarp:onboarding-name -->\nPreferred name: "Vi"\.\n<!-- \/timewarp:onboarding-name -->/, "Setup's block survives the rewrite");
  assert.equal(knowledge.dailyLog("2026-10-10").text, "---\nsummary: \"Planned the Rome trip.\"\n---\n# 2026-10-10\n\n- Planned the Rome trip; booked the 8:10 train.\n");
  assert.deepEqual(await writer.write(id), { skipped: true }, "Nothing new");
  say("user-1", "Also book a hotel.");
  answer({ notes: null, log: "- Asked for a hotel near the station.", summary: "Planned the Rome trip and a hotel." });
  await writer.write(id);
  const chat = /<chat[^>]*>\n([\s\S]*)\n<\/chat>/.exec(jobs[1].prompt)[1];
  assert.equal(chat.replace(/\(.*?\)/, "()"), "User (): Also book a hotel.", "Only the messages it hasn't seen");
  assert.match(jobs[1].prompt, /<todays_log>\n---\nsummary/);
  assert.equal(knowledge.dailyLog("2026-10-10").text, "---\nsummary: \"Planned the Rome trip and a hotel.\"\n---\n# 2026-10-10\n\n- Planned the Rome trip; booked the 8:10 train.\n- Asked for a hotel near the station.\n");
});

test("the memory writer keeps notes that would lose most of their content", async t => {
  const { knowledge, writer, id, say, answer } = setup(t);
  const long = "# User\n\n" + Array.from({ length: 30 }, (_, index) => `- Fact ${index} about the user's work.`).join("\n");
  knowledge.saveNotes(long);
  say("user-1", "Hi");
  answer({ notes: "# User\n\n- Says hi.", log: null, summary: null });
  assert.deepEqual(await writer.write(id), { notes: false, log: false });
  assert.equal(knowledge.read().notes, long + "\n");
});

test("the memory writer stays off in Privacy Mode and while memory can't be written", async t => {
  for (const settings of [{ private: true }, { mode: "read" }, { mode: "none" }]) {
    const { writer, jobs, id, say } = setup(t, settings);
    say("user-1", "Remember that I like tea.");
    assert.deepEqual(await writer.write(id), { skipped: true });
    writer.observe("conversation.event", { conversationId: id, method: "turn/completed", params: {} });
    await new Promise(resolve => setTimeout(resolve, 80));
    assert.equal(jobs.length, 0, JSON.stringify(settings));
  }
});

test("the memory writer runs once a chat has been quiet, not while it works", async t => {
  const { writer, jobs, id, say } = setup(t);
  say("user-1", "Remember that I like tea.");
  writer.observe("conversation.event", { conversationId: id, method: "turn/completed", params: {} });
  writer.observe("conversation.event", { conversationId: id, method: "turn/started", params: {} });
  await new Promise(resolve => setTimeout(resolve, 80));
  assert.equal(jobs.length, 0, "A new turn started: the chat isn't quiet");
  writer.observe("conversation.event", { conversationId: id, method: "turn/completed", params: { subAgent: true } });
  await new Promise(resolve => setTimeout(resolve, 80));
  assert.equal(jobs.length, 0, "A worker's turn doesn't count");
  writer.observe("conversation.event", { conversationId: id, method: "turn/completed", params: {} });
  await new Promise(resolve => setTimeout(resolve, 120));
  assert.equal(jobs.length, 1);
});

test("a new chat gets a short title unless the user renamed it", async t => {
  const { store, jobs } = setup(t);
  const fresh = store.conversations.create({ ownerId: "user-1", agentId: "agent-1", title: titleFrom("> earlier reply\n\nCan you plan a weekend in Rome for two in May?") });
  store.messages.append({ conversationId: fresh.id, authorId: "user-1", text: "> earlier reply\n\nCan you plan a weekend in Rome for two in May?" });
  store.messages.append({ conversationId: fresh.id, authorId: "agent-1", text: "Sure, here's a plan." });
  const runner = { run: async job => { jobs.push(job); return { title: "\"**Weekend in Rome.**\"" }; } };
  const notified = [];
  const titles = createTitles({ store, runner, autoTitle: titleFrom, notify: (name, payload) => notified.push({ name, ...payload }) });
  titles.observe("conversation.event", { conversationId: fresh.id, method: "turn/completed", params: {} });
  for (let index = 0; index < 50 && store.conversations.get(fresh.id).title !== "Weekend in Rome"; index++) await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(store.conversations.get(fresh.id).title, "Weekend in Rome");
  assert.equal(notified[0]?.method, "thread/name/updated");
  assert.match(jobs[0].prompt, /User: > earlier reply[\s\S]*Agent: Sure/);
  assert.equal(jobs[0].instructions, TITLE_INSTRUCTIONS);
  // Renamed by the user: left alone.
  const renamed = store.conversations.create({ ownerId: "user-1", agentId: "agent-1", title: "My own name" });
  store.messages.append({ conversationId: renamed.id, authorId: "user-1", text: "Plan a trip" });
  titles.observe("conversation.event", { conversationId: renamed.id, method: "turn/completed", params: {} });
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(jobs.length, 1);
});

test("titles and logs are cleaned up", () => {
  assert.equal(cleanTitle("  \"## Weekend in **Rome**.\" "), "Weekend in **Rome**");
  assert.equal(cleanTitle("`Budget review`"), "Budget review");
  assert.equal(cleanTitle(""), null);
  assert.equal(cleanTitle("x".repeat(90)).length, 60);
  assert.equal(dailyLogText("2026-10-10", "", "- One.", "A day."), "---\nsummary: \"A day.\"\n---\n# 2026-10-10\n\n- One.\n");
  assert.equal(dailyLogText("2026-10-10", "# 2026-10-10\n\n- One.\n", "- Two.", null), "# 2026-10-10\n\n- One.\n- Two.\n");
});

let available = true;
try { codexExecutable(); } catch { available = false; }

test("a background job runs in a short-lived Codex thread and answers in JSON", { skip: !available && "Codex runtime is not installed", timeout: 120000 }, async t => {
  const bodies = [];
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", chunk => { raw += chunk; });
    req.on("end", async () => {
      if (!(req.method === "POST" && req.url.endsWith("/responses"))) { res.writeHead(404, { "content-type": "application/json" }); res.end("{}"); return; }
      const body = JSON.parse(raw);
      bodies.push(body);
      // The preview's scripted model answers background jobs as Timewarp asks.
      const response = scriptedResponse(body);
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.end(Buffer.from(await response.arrayBuffer()));
    });
  });
  const root = fs.mkdtempSync(path.join(os.homedir(), ".timewarp-engine-test-"));
  const cleanup = [() => fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })];
  t.after(async () => { for (const step of cleanup.reverse()) { try { await step(); } catch (error) { console.warn("cleanup:", error.message); } } });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  cleanup.push(() => { server.closeAllConnections(); server.close(); });
  const vendor = vendorRoot();
  fs.mkdirSync(path.join(root, "codex"), { recursive: true });
  const client = new CodexClient({
    executable: codexExecutable(vendor),
    args: ["-c", `model_providers.fake={name="Fake",base_url="http://127.0.0.1:${server.address().port}/v1",wire_api="responses",env_key="TIMEWARP_TEST_TOKEN"}`, "-c", 'model_provider="fake"', "-c", `model="${BACKGROUND_MODEL}"`],
    env: { CODEX_HOME: path.join(root, "codex"), TIMEWARP_TEST_TOKEN: "device-token", ...codexEnv(vendor) },
    clientInfo: { name: "timewarp", title: "Timewarp", version: "0.0.0-test" },
  });
  cleanup.push(() => client.stop());
  const logged = [];
  const runner = createBackgroundRunner({ client, cwd: root, log: (message, details) => logged.push({ message, ...details }) });
  const [first, second] = await Promise.all([
    runner.run({ purpose: "title", instructions: TITLE_INSTRUCTIONS, prompt: "<chat_start>\nUser: Plan a weekend in Rome please\n</chat_start>", schema: { type: "object", properties: { title: { type: "string" } }, required: ["title"], additionalProperties: false } }),
    runner.run({ purpose: "title", instructions: TITLE_INSTRUCTIONS, prompt: "<chat_start>\nUser: Budget review for October\n</chat_start>", schema: { type: "object", properties: { title: { type: "string" } }, required: ["title"], additionalProperties: false } }),
  ]);
  assert.deepEqual(first, { title: "Plan a weekend in Rome" });
  assert.deepEqual(second, { title: "Budget review for October" });
  assert.equal(bodies.length, 2, "One request per job");
  assert.equal(bodies[0].text?.format?.type, "json_schema", "The answer is constrained to the schema");
  const developer = bodies[0].input.filter(item => item.type === "message" && item.role === "developer").map(item => item.content.map(part => part.text).join(""));
  // Codex sends base instructions as the request's instructions or its first developer message, by model.
  assert.ok(bodies[0].instructions === TITLE_INSTRUCTIONS || developer[0] === TITLE_INSTRUCTIONS, "The job's instructions replace Codex's");
  assert.equal(logged.length, 2);
  assert.ok(logged.every(entry => entry.output === 30 && entry.input === 40), "What each job cost is logged");
  const listed = await client.request("thread/list", {});
  assert.equal((listed.data || []).length, 0, "Jobs leave no saved threads");
});
