"use strict";
// What a chat asks the user for (Approval.jsx with renderer/src/requests.mjs):
// an app's form, the agent's questions and a page to open, with their
// required answers; and the app log's content-free line for each request.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const { openStore } = require("../app/main/store.cjs");
const { createHarness } = require("../app/main/harness.cjs");
const requests = import("../app/renderer/src/requests.mjs");

const SCHEMA = {
  type: "object",
  properties: {
    full_name: { type: "string", title: "Full name", minLength: 2 },
    email: { type: "string", format: "email", description: "Where the receipt goes" },
    guests: { type: "integer", minimum: 1, maximum: 8, default: 2 },
    budget: { type: "number" },
    newsletter: { type: "boolean" },
    room: { type: "string", oneOf: [{ const: "single", title: "Single room" }, { const: "double", title: "Double room" }] },
    size: { type: "string", enum: ["s", "m"], enumNames: ["Small", "Medium"] },
    extras: { type: "array", items: { anyOf: [{ const: "breakfast", title: "Breakfast" }, { const: "parking", title: "Parking" }] }, minItems: 1 },
    arrival: { type: "string", format: "date-time" },
    nested: { type: "object", properties: {} },
  },
  required: ["full_name", "email", "guests", "room", "extras"],
};

test("a form's fields come from its schema, with labels, kinds, options and defaults", async () => {
  const { formFields, initialValues } = await requests;
  const { fields, unsupported } = formFields(SCHEMA);
  assert.equal(unsupported, false, "an optional field Timewarp can't show is left out");
  assert.deepEqual(fields.map(field => [field.key, field.kind, field.required]), [
    ["full_name", "text", true], ["email", "email", true], ["guests", "integer", true], ["room", "choice", true], ["extras", "choices", true],
    ["budget", "number", false], ["newsletter", "boolean", false], ["size", "choice", false], ["arrival", "datetime", false],
  ]);
  // Codex sends the properties sorted by name: the required list still gives the app's order.
  const sorted = { ...SCHEMA, properties: Object.fromEntries(Object.entries(SCHEMA.properties).sort(([a], [b]) => a.localeCompare(b))) };
  assert.deepEqual(formFields(sorted).fields.map(field => field.key), ["full_name", "email", "guests", "room", "extras", "arrival", "budget", "newsletter", "size"]);
  const byKey = Object.fromEntries(fields.map(field => [field.key, field]));
  assert.equal(byKey.full_name.label, "Full name");
  assert.equal(byKey.budget.label, "Budget", "a key without a title becomes a label");
  assert.equal(byKey.email.description, "Where the receipt goes");
  assert.deepEqual(byKey.room.options, [{ value: "single", label: "Single room" }, { value: "double", label: "Double room" }]);
  assert.deepEqual(byKey.size.options, [{ value: "s", label: "Small" }, { value: "m", label: "Medium" }]);
  assert.deepEqual(byKey.extras.options.map(option => option.label), ["Breakfast", "Parking"]);
  assert.deepEqual(initialValues(fields), { full_name: "", email: "", guests: "2", budget: "", newsletter: false, room: "", size: "", extras: [], arrival: "" });
});

test("a form with a required field Timewarp can't show is unsupported", async () => {
  const { formFields, labelFrom } = await requests;
  assert.equal(formFields({ type: "object", properties: { address: { type: "object" } }, required: ["address"] }).unsupported, true);
  assert.equal(formFields({ type: "object", properties: {}, required: ["missing"] }).unsupported, true);
  assert.deepEqual(formFields(null), { fields: [], unsupported: false });
  assert.deepEqual(formFields({ type: "object", properties: {} }), { fields: [], unsupported: false });
  assert.equal(labelFrom("startDate"), "Start date");
  assert.equal(labelFrom("first_name"), "First name");
});

test("required and invalid answers are named field by field, in the form's order", async () => {
  const { formFields, formErrors, initialValues } = await requests;
  const { fields } = formFields(SCHEMA);
  const empty = formErrors(fields, initialValues(fields));
  assert.deepEqual(Object.keys(empty), ["full_name", "email", "room", "extras"], "only required fields, and guests has its default");
  assert.equal(empty.full_name, "Required.");
  assert.equal(empty.room, "Choose one.");
  assert.equal(empty.extras, "Choose at least one.");
  const wrong = formErrors(fields, { ...initialValues(fields), full_name: "A", email: "nope", guests: "9", budget: "lots", room: "single", extras: ["parking"], arrival: "soon" });
  assert.deepEqual(wrong, {
    full_name: "Enter at least 2 characters.", email: "Enter an email address.", guests: "Enter a number from 1 to 8.", budget: "Enter a number.", arrival: "Enter a date and time.",
  });
  assert.equal(formErrors(fields, { ...initialValues(fields), guests: "2.5" }).guests, "Enter a whole number.");
});

test("the answer is typed as the schema says, without empty optional fields", async () => {
  const { formFields, formContent, formErrors, initialValues } = await requests;
  const { fields } = formFields(SCHEMA);
  const values = { ...initialValues(fields), full_name: "  Ada Lovelace ", email: "ada@example.com", guests: "3", room: "double", extras: ["breakfast", "parking"], arrival: "2026-11-02T09:30" };
  assert.deepEqual(formErrors(fields, values), {});
  assert.deepEqual(formContent(fields, values), {
    full_name: "Ada Lovelace", email: "ada@example.com", guests: 3, newsletter: false, room: "double", extras: ["breakfast", "parking"], arrival: new Date("2026-11-02T09:30").toISOString(),
  });
});

test("each of the agent's questions needs an answer; secrets go as typed", async () => {
  const { questionAnswers, questionErrors } = await requests;
  const questions = [
    { id: "q1", header: "Plan", question: "Which plan?", isOther: false, isSecret: false, options: [{ label: "Pro", description: "" }] },
    { id: "q2", header: "", question: "Anything else?", isOther: true, isSecret: false, options: [{ label: "No", description: "" }] },
    { id: "q3", header: "", question: "Code?", isOther: false, isSecret: true, options: null },
  ];
  assert.deepEqual(questionErrors(questions, { q2: "  " }), { q1: "Choose an answer.", q2: "Choose an answer or type your own.", q3: "Type an answer." });
  assert.deepEqual(questionErrors(questions, { q1: "Pro", q2: "Late check-out", q3: " 12 " }), {});
  assert.deepEqual(questionAnswers(questions, { q1: "Pro", q2: " Late check-out ", q3: " 12 " }), {
    q1: { answers: ["Pro"] }, q2: { answers: ["Late check-out"] }, q3: { answers: [" 12 "] },
  });
});

test("only secure pages, or a local app in development, can be opened", async () => {
  const { pageLink } = await requests;
  assert.deepEqual(pageLink("https://id.example.com/approve/a1?x=1"), { href: "https://id.example.com/approve/a1?x=1", host: "id.example.com" });
  assert.deepEqual(pageLink("http://localhost:8093/approve"), { href: "http://localhost:8093/approve", host: "localhost:8093" });
  assert.equal(pageLink("http://example.com/approve"), null);
  assert.equal(pageLink("https://user:pass@example.com/"), null);
  assert.equal(pageLink("javascript:alert(1)"), null);
  assert.equal(pageLink("file:///C:/Windows"), null);
  assert.equal(pageLink(undefined), null);
});

function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tw-requests-"));
  const store = openStore(path.join(root, "timewarp.sqlite"));
  t.after(() => { store.close(); fs.rmSync(root, { recursive: true, force: true }); });
  store.agents.create({ id: "agent-1", ownerId: "user-1", name: "Orbit", workspace: path.join(root, "orbit") });
  const client = new EventEmitter(), answered = [], refused = [], lines = [];
  let turns = 0, threads = 0;
  client.request = async method => method === "thread/start" ? { thread: { id: "thread-" + ++threads } } : method === "turn/start" ? { turn: { id: "turn-" + ++turns } } : {};
  client.respond = (id, response) => answered.push({ id, response });
  client.respondError = id => refused.push(id);
  const harness = createHarness({ store, client, userId: () => "user-1", modelSettings: () => ({ name: "m" }), instructionsFor: () => "", record: (level, message, facts) => lines.push({ level, message, ...facts }) });
  const chat = harness.conversations.create({ agentId: "agent-1" });
  return { harness, client, chat, answered, refused, lines };
}
const settle = () => new Promise(resolve => setImmediate(resolve));

test("the app log names each request and how it ended, never its text or answers", async t => {
  const { harness, client, chat, answered, lines } = setup(t);
  await harness.send(chat.id, { text: "Book it" });
  const threadId = harness.conversations.get(chat.id).codexThreadId;
  client.emit("request", { id: 41, method: "mcpServer/elicitation/request", params: { threadId, turnId: "turn-1", serverName: "booking", mode: "form", message: "Your passport number, please", requestedSchema: SCHEMA, _meta: null } });
  await settle();
  harness.respond(41, { action: "accept", content: { full_name: "Ada Lovelace", email: "ada@example.com" }, _meta: null });
  assert.deepEqual(answered, [{ id: 41, response: { action: "accept", content: { full_name: "Ada Lovelace", email: "ada@example.com" }, _meta: null } }]);
  const [shown, done] = lines;
  assert.deepEqual(shown, { level: "info", message: "Request shown", kind: "form", chat: chat.id.slice(0, 8), thread: threadId.slice(0, 8), server: "booking", fields: 10, required: 5 });
  assert.equal(done.message, "Request answered");
  assert.equal(done.outcome, "accept");
  assert.ok(Number.isInteger(done.waitedMs) && done.waitedMs >= 0);
  assert.doesNotMatch(JSON.stringify(lines), /passport|Ada|example\.com/, "no request text and no answers");

  client.emit("request", { id: 42, method: "mcpServer/elicitation/request", params: { threadId, turnId: "turn-1", serverName: "agent_id", mode: "url", message: "Approve", url: "https://id.example.com/a/1", elicitationId: "e1", _meta: null } });
  client.emit("request", { id: 43, method: "item/tool/requestUserInput", params: { threadId, turnId: "turn-1", itemId: "i", questions: [{ id: "q" }, { id: "r" }], isBlocking: true } });
  await settle();
  harness.respond(43, { answers: { q: { answers: ["secret words"] } } });
  client.emit("notification", { method: "serverRequest/resolved", params: { threadId, requestId: 42 } });
  assert.deepEqual(lines.slice(2).map(line => [line.message, line.kind, line.outcome, line.questions]), [
    ["Request shown", "page", undefined, undefined], ["Request shown", "question", undefined, 2],
    ["Request answered", "question", "answered", 2], ["Request closed by Codex", "page", undefined, undefined],
  ]);
  assert.doesNotMatch(JSON.stringify(lines), /secret words|id\.example\.com/);
});

test("decisions, Timewarp's own questions, and requests that end without an answer are logged", async t => {
  const { harness, client, chat, refused, lines } = setup(t);
  await harness.send(chat.id, { text: "Go" });
  const threadId = harness.conversations.get(chat.id).codexThreadId;
  client.emit("request", { id: 51, method: "item/commandExecution/requestApproval", params: { threadId, turnId: "turn-1", itemId: "c", command: "rm -rf build" } });
  client.emit("request", { id: 52, method: "item/permissions/requestApproval", params: { threadId, turnId: "turn-1", itemId: "p", permissions: { network: {} } } });
  await settle();
  harness.respond(51, { decision: "acceptForSession" });
  harness.respond(52, { permissions: {}, scope: "turn" });
  const asked = harness.confirm(chat.id, { kind: "settings", title: "Change theme?" });
  harness.respond(harness.pendingApprovals()[0].id, { decision: "accept" });
  await asked;
  await harness.confirm(chat.id, { kind: "settings" }, { timeoutMs: 10 });
  client.emit("request", { id: 53, method: "item/fileChange/requestApproval", params: { threadId, turnId: "turn-1", itemId: "f" } });
  await settle();
  client.emit("status", { status: "failed" });
  client.emit("request", { id: 54, method: "account/chatgptAuthTokens/refresh", params: {} });
  client.emit("request", { id: 55, method: "item/tool/requestUserInput", params: { threadId: "stranger", questions: [] } });
  await settle();
  assert.deepEqual(refused, [54, 55]);
  const ends = lines.filter(line => line.message !== "Request shown").map(line => [line.level, line.message, line.kind, line.outcome ?? line.method ?? null]);
  assert.deepEqual(ends, [
    ["info", "Request answered", "command", "acceptForSession"],
    ["info", "Request answered", "extra access", "decline"],
    ["info", "Request answered", "confirmation", "accept"],
    ["info", "Request timed out", "confirmation", null],
    ["warn", "Request dropped: Codex stopped", "file change", null],
    ["warn", "Request not supported", undefined, "account/chatgptAuthTokens/refresh"],
    ["warn", "Request had no chat to show it in", "question", null],
  ]);
  assert.doesNotMatch(JSON.stringify(lines), /rm -rf|Change theme/);
  assert.equal(lines.find(line => line.kind === "confirmation").about, "settings");
});
