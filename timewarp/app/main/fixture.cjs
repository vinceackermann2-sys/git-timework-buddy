"use strict";
// Preview mode for development builds only (build.json "fixture": true): a
// signed-in sample account and organization with credits, and a scripted
// model. Real Codex runs the agents and tools. Release builds refuse it.
const crypto = require("node:crypto");

const FIRST = { id: "00000000-0000-4000-8000-00000000f1a7", email: "preview@timewarp.invalid", name: "Preview" };
// A second account, signed in to with its email (or from the start with
// TIMEWARP_FIXTURE_USER=second), for checking that accounts keep their own data.
const SECOND = { id: "00000000-0000-4000-8000-0000000002b7", email: "second@timewarp.invalid", name: "Second" };
let USER = process.env.TIMEWARP_FIXTURE_USER === "second" ? SECOND : FIRST;
const ORGANIZATION = { id: "00000000-0000-4000-8000-0000000001a6", name: "Preview Studio", logo: null, role: "owner" };

const sse = events => events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join("");
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });

function outputText(output) {
  const value = output?.content ?? output;
  if (Array.isArray(value)) return value.map(part => typeof part === "string" ? part : part?.text || "").join("");
  return typeof value === "string" ? value : JSON.stringify(value ?? "");
}
// The user's messages, and the task a worker receives from its parent agent.
const isRequest = item => (item.type === "message" && item.role === "user") || item.type === "agent_message";
function textOf(input) {
  return (input || []).filter(isRequest)
    .flatMap(item => (item.content || []).map(part => part.text || part.encrypted_content || "")).join("\n");
}

// Scripted Responses API: "run" asks for a shell command, everything else gets
// a markdown reply that names what the user wrote.
let dumped = 0;
// A long Markdown reply ("long reply"), for measuring how the chat streams.
function longReply() {
  const sections = [];
  for (let index = 1; index <= 8; index++) {
    sections.push(`## Part ${index}\n\nThis paragraph explains step ${index} in **detail**, with a [link](https://example.com/${index}) and \`inline code\`. It goes on for a while so the reply is as long as a real one, covering the reasons, the trade-offs and what to check afterwards.\n\n- First point of part ${index}\n- Second point, with *emphasis*\n- Third point\n\n\`\`\`js\nfunction part${index}(items) {\n  return items.filter(item => item.ready).map(item => ({ id: item.id, total: item.count * ${index} }));\n}\n\`\`\`\n\n| Column | Value |\n| --- | --- |\n| Part | ${index} |\n| Status | ready |`);
  }
  return sections.join("\n\n");
}
function scriptedResponse(body) {
  const id = "resp_" + crypto.randomUUID(), message = "msg_" + crypto.randomUUID();
  const usage = { input_tokens: 40, input_tokens_details: { cached_tokens: 0 }, output_tokens: 30, output_tokens_details: { reasoning_tokens: 0 }, total_tokens: 70 };
  // Tool results of the current turn only: those after the latest user message.
  const inputs = body.input || [];
  const lastUser = inputs.findLastIndex(isRequest);
  const outputs = inputs.slice(lastUser + 1).filter(item => item.type === "function_call_output" || item.type === "custom_tool_call_output");
  const latest = textOf(body.input).split("\n").filter(Boolean).at(-1) || "";
  const tool = (body.tools || []).find(item => item.type === "function" && item.name === "exec_command");
  // Code mode exposes the tools through one "exec" JavaScript tool.
  const codeMode = (body.input || []).filter(item => item.type === "additional_tools").flatMap(item => item.tools || [])
    .flatMap(item => item.type === "namespace" ? item.tools || [] : [item]).some(item => item.type === "custom" && item.name === "exec");
  // "%n" in the dump path numbers each request.
  if (process.env.TIMEWARP_FIXTURE_DUMP) require("node:fs").writeFileSync(process.env.TIMEWARP_FIXTURE_DUMP.replace("%n", String(++dumped)), JSON.stringify(body, null, 1));
  // described: which of Timewarp's tool servers the request describes anywhere (its
  // tools or code mode's text), so ones left for tool search can be told apart.
  const whole = process.env.TIMEWARP_FIXTURE_LOG ? JSON.stringify(body) : "";
  const described = ["timewarp_browser", "timewarp_vault", "timewarp_app", "timewarp_agent_id", "tool_search"].filter(name => whole.includes(name));
  if (process.env.TIMEWARP_FIXTURE_LOG) console.error("[timewarp] fixture request", JSON.stringify({ latest, codeMode, tools: (body.tools || []).map(item => item.name || item.type), described, inputs: (body.input || []).map(item => item.type + ":" + (item.role || "")), outputs: outputs.length }));
  // TIMEWARP_FIXTURE_DUMP: the latest request as the model would get it, in that file.
  if (process.env.TIMEWARP_FIXTURE_DUMP) try { require("node:fs").writeFileSync(process.env.TIMEWARP_FIXTURE_DUMP, JSON.stringify(body, null, 1)); } catch {}
  const events = [{ type: "response.created", response: { id } }];
  // Background jobs (memory-writer.cjs) answer in JSON: a title from the
  // first words of the chat, and nothing new to remember.
  // Codex sends base instructions as instructions or a developer message, by model.
  const job = /<timewarp_background task=\\?"(\w+)\\?">/.exec(JSON.stringify([body.instructions || "", ...inputs.filter(item => item.role === "developer")]))?.[1];
  if (job) {
    const words = (/User: ([^\n]*)/.exec(textOf(inputs))?.[1] || "Preview chat").replace(/[^\p{L}\p{N} ]+/gu, " ").trim().split(/\s+/).slice(0, 5).join(" ");
    const text = JSON.stringify(job === "title" ? { title: words || "Preview chat" } : { notes: null, log: null, summary: null });
    events.push({ type: "response.output_item.done", output_index: 0, item: { type: "message", role: "assistant", id: message, content: [{ type: "output_text", text }] } }, { type: "response.completed", response: { id, usage } });
    return new Response(sse(events), { status: 200, headers: { "content-type": "text/event-stream" } });
  }
  // Codex's automatic approval reviewer asks for a JSON verdict. The preview
  // allows ordinary commands and denies deleting files.
  const reviewing = body.text?.format?.name === "codex_output_schema" && /APPROVAL REQUEST START/.test(textOf(body.input));
  const risky = /\brisky\b/i.test(latest);
  const command = risky
    ? (process.platform === "win32" ? "Remove-Item -Recurse -Force 'C:\\timewarp-preview-nothing-here'" : "rm -rf /tmp/timewarp-preview-nothing-here")
    : process.platform === "win32" ? "Write-Output 'Hello from the Timewarp preview'" : "echo 'Hello from the Timewarp preview'";
  const browse = !reviewing && /\bbrowse\b/i.test(latest), runCommand = !reviewing && /\brun\b/i.test(latest);
  // Tests drive any tool through the code tool: a message with an ```exec
  // block runs that script, and the reply quotes its output.
  const script = !reviewing && lastUser >= 0 ? /```exec\n([\s\S]*?)```/.exec(textOf([inputs[lastUser]]))?.[1] : null;
  // "spawn a worker" starts a worker through the collaboration tools. An
  // ```exec block in the same message becomes the worker's script.
  const request = lastUser >= 0 ? textOf([inputs[lastUser]]) : "";
  const spawn = !reviewing && /\bspawn a worker\b/i.test(request);
  if (spawn && !outputs.length) {
    const assignment = /```exec\n[\s\S]*?```/.exec(request)?.[0];
    const call = { type: "function_call", id: "fc_" + crypto.randomUUID(), call_id: "call_" + crypto.randomUUID(), name: "spawn_agent", namespace: "collaboration", arguments: JSON.stringify({ task_name: "helper", message: assignment ? "Run this script:\n" + assignment : "Say hello from the worker", fork_turns: "none" }) };
    events.push({ type: "response.output_item.added", output_index: 0, item: { ...call, arguments: "" } }, { type: "response.output_item.done", output_index: 0, item: call });
  } else if (codeMode && script && !outputs.length) {
    const call = { type: "custom_tool_call", id: "ctc_" + crypto.randomUUID(), call_id: "call_" + crypto.randomUUID(), name: "exec", input: script };
    events.push({ type: "response.output_item.added", output_index: 0, item: { ...call, input: "" } }, { type: "response.output_item.done", output_index: 0, item: call });
  } else if (codeMode && browse && !outputs.length) {
    // "browse and click <url>" also clicks the first control on the page.
    const url = /https?:\/\/\S+/.exec(latest)?.[0] || "https://example.com/";
    const click = /\bclick\b/i.test(latest)
      ? `\nconst ref = (out(outline).match(/\\[ref=(e\\d+)\\]/) || [])[1];\nconst clicked = ref ? await tools.mcp__timewarp_browser__click({ ref }) : "Nothing to click.";\ntext(out(clicked));`
      : "";
    // The browser tools are MCP tools; out() reads a result's text.
    const script = `const out = r => typeof r === "string" ? r : (r?.content || []).map(c => c.text || "").join("\\n");\nconst opened = await tools.mcp__timewarp_browser__open({ url: ${JSON.stringify(url)} });\nconst outline = await tools.mcp__timewarp_browser__snapshot({});\ntext(out(opened) + "\\n" + out(outline).slice(0, 600));${click}`;
    const call = { type: "custom_tool_call", id: "ctc_" + crypto.randomUUID(), call_id: "call_" + crypto.randomUUID(), name: "exec", input: script };
    events.push({ type: "response.output_item.added", output_index: 0, item: { ...call, input: "" } }, { type: "response.output_item.done", output_index: 0, item: call });
  } else if ((tool || codeMode) && runCommand && !outputs.length) {
    // The command asks to run outside the sandbox, so it is reviewed (or the
    // user is asked) whether or not the command sandbox is set up.
    const callId = "call_" + crypto.randomUUID(), args = { cmd: command, sandbox_permissions: "require_escalated", justification: "Preview check" };
    const call = codeMode
      ? { type: "custom_tool_call", id: "ctc_" + crypto.randomUUID(), call_id: callId, name: "exec", input: `const result = await tools.exec_command(${JSON.stringify(args)});\ntext(typeof result === "string" ? result : JSON.stringify(result));` }
      : { type: "function_call", id: "fc_" + crypto.randomUUID(), call_id: callId, name: "exec_command", arguments: JSON.stringify(args) };
    events.push({ type: "response.output_item.added", output_index: 0, item: codeMode ? { ...call, input: "" } : { ...call, arguments: "" } }, { type: "response.output_item.done", output_index: 0, item: call });
  } else {
    const plan = reviewing ? textOf([inputs[lastUser]]) : "";
    const text = reviewing
      ? JSON.stringify(/Remove-Item|rm -rf/.test(plan) ? { risk_level: "high", user_authorization: "unknown", outcome: "deny", rationale: "Deleting files isn't part of the task." } : { outcome: "allow" })
      : outputs.length
      ? spawn ? "Started a worker:\n\n```\n" + outputText(outputs.at(-1).output).slice(0, 2000) + "\n```" : script ? "Script output:\n\n```\n" + outputText(outputs.at(-1).output).slice(0, 6000) + "\n```" : (browse ? "I opened the page in the browser. Here is what it shows:\n\n```\n" : "The command finished. Here is what it printed:\n\n```\n") + outputText(outputs.at(-1).output).slice(0, 700) + "\n```"
      : /\blong reply\b/i.test(latest) ? longReply()
      : `**Preview reply.** You wrote: “${latest.slice(0, 200)}”.\n\n- Streaming, markdown and code work\n- Ask me to *run* something to see a tool call\n\n\`\`\`js\nconsole.log("Timewarp");\n\`\`\``;
    events.push({ type: "response.output_item.added", output_index: 0, item: { type: "message", role: "assistant", id: message, content: [] } });
    for (const chunk of text.match(/[\s\S]{1,24}/g)) events.push({ type: "response.output_text.delta", item_id: message, output_index: 0, content_index: 0, delta: chunk });
    events.push({ type: "response.output_item.done", output_index: 0, item: { type: "message", role: "assistant", id: message, content: [{ type: "output_text", text }] } });
  }
  events.push({ type: "response.completed", response: { id, usage } });
  // Release events gradually so streaming is visible.
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const spacing = /^\d+$/.test(process.env.TIMEWARP_FIXTURE_STREAM_MS || "") ? Number(process.env.TIMEWARP_FIXTURE_STREAM_MS) : 35;
      for (const event of events) { controller.enqueue(encoder.encode(sse([event]))); await new Promise(resolve => setTimeout(resolve, spacing)); }
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });
}

// Same shape as the billing service's status response, with sample values.
function billingStatus() {
  const plans = [["free", "Free", 0, 0], ["max", "Max", 50, 700], ["ultra", "Ultra", 100, 1400]]
    .map(([id, name, monthlyUsd, monthlyCredits]) => ({ id, name, monthlyUsd, monthlyCredits, available: true }));
  return {
    plan: "max", workspaceId: null, role: "owner", canManage: true, isPersonal: true, subscriptionStatus: "active", cancelAtPeriodEnd: false,
    currentPeriodEnd: new Date(Date.now() + 20 * 86400000).toISOString(), hasSubscription: true,
    monthlyCreditAddons: [0, 15, 30, 45].map(monthlyUsd => ({ credits: monthlyUsd * 14, monthlyUsd })), monthlyExtraCredits: 0, monthlyUsd: 50, canOpenPortal: false,
    includedCredits: { allowance: 700, balance: 504 }, purchasedCredits: { balance: 20 }, credits: { balance: 92 },
    usage: { plan: "max", periodStart: new Date(Date.now() - 10 * 86400000).toISOString() }, plans,
    creditPacks: [{ id: "pack-180", credits: 180, priceUsd: 15 }, { id: "pack-360", credits: 360, priceUsd: 30 }],
  };
}

// The cloud's account data (cloud/accountData.ts and its SQL function: a
// revision per account, writes refused when the item changed meanwhile,
// removals kept) and, with a file, its chat history. Two preview builds given
// the same TIMEWARP_FIXTURE_CLOUD_FILE act as two computers of one account.
function fixtureCloudStore(file) {
  const fs = require("node:fs");
  const empty = () => ({ accountData: {}, revisions: {}, history: {} });
  let kept = empty();
  const load = () => { if (!file) return kept; try { return { ...empty(), ...JSON.parse(fs.readFileSync(file, "utf8")) }; } catch { return empty(); } };
  const save = data => { if (!file) { kept = data; return; } const temporary = `${file}.${process.pid}.tmp`; fs.writeFileSync(temporary, JSON.stringify(data)); fs.renameSync(temporary, file); };
  return {
    file,
    accountData(user, input) {
      const data = load(), rows = data.accountData[user] ||= {};
      if (input.operation === "changes") {
        const after = Number(input.after) || 0;
        const changed = Object.values(rows).filter(row => row.revision > after).sort((a, b) => a.revision - b.revision);
        const items = changed.slice(0, 50);
        return { items, cursor: items.length ? items[items.length - 1].revision : after, more: changed.length > items.length };
      }
      if (input.operation !== "put" || !Array.isArray(input.items) || !input.items.length || input.items.length > 25) throw new Error("Invalid account data.");
      const results = input.items.map(({ kind, key, value, base }) => {
        const id = kind + "\0" + key, stored = rows[id];
        if (stored && stored.revision !== (Number(base) || 0)) return { kind, key, conflict: true, revision: stored.revision, value: stored.value };
        const revision = data.revisions[user] = (data.revisions[user] || 0) + 1;
        rows[id] = { kind, key, revision, value: value ?? null };
        return { kind, key, revision };
      });
      save(data);
      return { results };
    },
    history(user, input) {
      const data = load(), chats = data.history[user] ||= {};
      if (input.operation === "list") return { protocol: 2, manifest: Object.values(chats).map(chat => ({ id: chat.conversation.id, version: chat.version })), nextOffset: null };
      if (input.operation === "get") return { protocol: 2, chats: (input.ids || []).map(id => chats[id]).filter(Boolean) };
      const { conversation, agents, entries } = input.snapshot;
      // As the cloud (cloud/nativeHistory.ts), only ids that are UUIDs.
      const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
      if (![conversation.id, ...agents.map(agent => agent.id), ...entries.map(entry => entry.id)].every(id => uuid.test(id))) throw Object.assign(new Error("Invalid chat identifier."), { status: 400 });
      const before = chats[conversation.id], merged = new Map((before?.entries || []).map(entry => [entry.id, entry]));
      for (const entry of entries) merged.set(entry.id, entry);
      chats[conversation.id] = {
        conversation: !before || conversation.updatedAt >= before.conversation.updatedAt ? conversation : before.conversation, agents,
        entries: [...merged.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)),
        version: new Date().toISOString() + "#" + crypto.randomUUID().slice(0, 8),
      };
      save(data);
      return { saved: true };
    },
  };
}

function createFixture() {
  // plan: the account's plan; debug.plan changes it (Free offers Connect ChatGPT).
  let signedIn = true, plan = "max", onChange = async () => {};
  const shared = fixtureCloudStore(process.env.TIMEWARP_FIXTURE_CLOUD_FILE || null);
  const members = [{ id: "member-1", userId: USER.id, email: USER.email, name: USER.name, image: null, roles: ["owner"], createdAt: "2026-01-01T00:00:00.000Z" }];
  const invites = [];
  // TIMEWARP_FIXTURE_SHARES: a colleague in the organization who has shared a
  // conversation, an agent and an automation, for trying share invites.
  const shares = [];
  if (process.env.TIMEWARP_FIXTURE_SHARES) {
    const colleague = { userId: "00000000-0000-4000-8000-00000000a1e7", name: "Alex Rivera", email: "alex@preview.invalid" };
    members.push({ id: "member-2", ...colleague, image: null, roles: ["member"], createdAt: "2026-02-01T00:00:00.000Z" });
    const sent = new Date(Date.now() - 2 * 3600000).toISOString();
    const incoming = (kind, title, summary, payload) => ({ id: crypto.randomUUID(), workspaceId: ORGANIZATION.id, organizationName: ORGANIZATION.name, kind, title, summary, payload, createdAt: sent, sender: colleague, recipient: { userId: USER.id, name: USER.name, email: USER.email }, status: "pending" });
    shares.push(
      incoming("chat", "Q3 launch checklist", { agentName: "Orbit", messages: 2, omitted: 0, preview: "Draft a launch checklist for the Q3 release." }, { version: 1, title: "Q3 launch checklist", agentName: "Orbit", omitted: 0, messages: [
        { role: "user", text: "Draft a launch checklist for the Q3 release.", createdAt: new Date(Date.now() - 3 * 3600000).toISOString() },
        { role: "agent", text: "Here is a checklist:\n\n1. Freeze features\n2. Update the changelog\n3. Brief support", createdAt: new Date(Date.now() - 3 * 3600000 + 60000).toISOString() },
      ] }),
      incoming("agent", "Research Scout", { mascot: "Nova", description: "Finds and summarizes market research.", workflows: ["weekly-digest"] }, { version: 1, name: "Research Scout", responsibilities: "Finds and summarizes market research.", instructions: "Find and summarize market research. Cite every source.", avatar: { mascot: "Nova" }, workflows: [
        { name: "weekly-digest", files: [{ path: "SKILL.md", content: "---\nname: weekly-digest\ndescription: Summarize the week's research.\n---\n\nCollect the week's findings into five bullet points.\n" }] },
      ] }),
      incoming("automation", "Morning inbox summary", { agentName: "Orbit", schedule: { kind: "weekdays", time: "08:30" }, preview: "Summarize unread email from the last day." }, { version: 1, name: "Morning inbox summary", instructions: "Summarize unread email from the last day in five bullet points. Say nothing new when there is nothing new.", schedule: { kind: "weekdays", time: "08:30" }, agentName: "Orbit" }),
    );
  }
  const shareFail = () => { throw Object.assign(new Error("This share is no longer available."), { status: 404 }); };
  const auth = {
    bind(handler) { onChange = handler; },
    init: async () => {},
    user: () => signedIn ? { ...USER } : null,
    userId: () => signedIn ? USER.id : null,
    accessToken: async () => { if (!signedIn) throw Object.assign(new Error("Sign in to Timewarp."), { status: 401 }); return "fixture-token"; },
    capability: () => "fixture-capability", expiresAt: () => Math.floor(Date.now() / 1000) + 3600,
    hasPendingFlow: () => false, passwordRecovery: () => false,
    providers: async () => ({ google: true, email: true, signup: true }),
    signIn: async input => { USER = String(input?.email || "").toLowerCase() === SECOND.email ? SECOND : FIRST; members[0] = { ...members[0], userId: USER.id, email: USER.email, name: USER.name }; signedIn = true; await onChange({ signedIn: true, changedUser: true }); return { user: { ...USER } }; },
    signUp: async () => ({ confirmationRequired: true }),
    signOut: async () => { signedIn = false; await onChange({ signedIn: false, changedUser: true }); return { signedOut: true }; },
    sendOtp: async () => ({ sent: true }), resendConfirmation: async () => ({ sent: true }), sendRecovery: async () => ({ sent: true }),
    verifyOtp: async () => { signedIn = true; await onChange({ signedIn: true, changedUser: true }); return { user: { ...USER } }; },
    updatePassword: async () => ({ updated: true }), beginOAuth: async () => "https://timewarpdev.com/",
    completeOAuth: async () => ({ user: { ...USER } }), refreshUser: async () => ({ ...USER }),
    authorize: async token => token === "fixture-capability",
  };
  const rpc = (name, input) => {
    if (name === "product.organizations.members") return members;
    if (name === "product.organizations.invitations.list") return invites;
    if (name === "product.organizations.invitations.pending") return [];
    if (name === "product.organizations.invitations.create") { const invite = { id: crypto.randomUUID(), email: input.email, role: input.role, status: "pending" }; invites.push(invite); return invite; }
    if (name === "product.organizations.invitations.revoke") { invites.splice(invites.findIndex(item => item.id === input.invitationId), 1); return null; }
    if (name === "product.organizations.update") { ORGANIZATION.name = input.name; return null; }
    if (name === "product.profile.update") { if (input.name) USER.name = input.name; return null; }
    // TIMEWARP_FIXTURE_SETUP_DONE: the preview account finished setup on another computer.
    if (name === "product.onboarding.status") return { done: !!process.env.TIMEWARP_FIXTURE_SETUP_DONE };
    if (name === "product.shares.list") {
      const waiting = shares.filter(share => share.status === "pending");
      return {
        incoming: waiting.filter(share => share.recipient.userId === USER.id).map(({ payload, recipient, status, ...share }) => share),
        outgoing: waiting.filter(share => share.sender.userId === USER.id).map(({ payload, sender, summary, status, ...share }) => share),
      };
    }
    if (name === "product.shares.create") {
      const ids = input.recipientUserIds.map(userId => {
        const person = members.find(member => member.userId === userId);
        if (!person || userId === USER.id) throw Object.assign(new Error("Choose people who are in this organization."), { status: 404 });
        const id = crypto.randomUUID();
        shares.push({ id, workspaceId: input.organizationId, organizationName: ORGANIZATION.name, kind: input.kind, title: input.title, summary: input.summary, payload: input.payload, createdAt: new Date().toISOString(), sender: { userId: USER.id, name: USER.name, email: USER.email }, recipient: { userId, name: person.name, email: person.email }, status: "pending" });
        return id;
      });
      return { ids };
    }
    if (name === "product.shares.open") {
      const share = shares.find(item => item.id === input.shareId && item.status === "pending" && item.recipient.userId === USER.id) || shareFail();
      const { recipient, status, ...open } = share;
      return open;
    }
    if (name === "product.shares.respond") {
      const share = shares.find(item => item.id === input.shareId && item.status === "pending") || shareFail();
      if ((input.response === "cancel" ? share.sender : share.recipient).userId !== USER.id) shareFail();
      share.status = { accept: "accepted", decline: "declined", cancel: "canceled" }[input.response];
      share.payload = null;
      return null;
    }
    if (name === "product.images.beginUpload") throw Object.assign(new Error("Pictures can't be uploaded in preview mode."), { status: 400 });
    return null;
  };
  // Live evaluations (scripts/eval-engine.cjs) answer with a real model: model
  // requests go to a proxy on this computer that holds a test account's
  // sign-in. Everything else stays preview data.
  const liveModel = /^http:\/\/127\.0\.0\.1:\d+\/v1$/.test(process.env.TIMEWARP_FIXTURE_MODEL_URL || "") ? process.env.TIMEWARP_FIXTURE_MODEL_URL : null;
  // Speed measurements (scripts/perf-engine.cjs): each cloud call waits as
  // long as a round trip to the real cloud, and is logged by its route.
  const latency = Math.max(0, Number(process.env.TIMEWARP_FIXTURE_CLOUD_LATENCY_MS) || 0);
  let connectorAccounts = [
    { toolkit: "gmail", connectionId: "conn-gmail-1", label: "inbox@preview.invalid", name: "Preview inbox", email: "inbox@preview.invalid", status: "ACTIVE", active: true },
    { toolkit: "gmail", connectionId: "conn-gmail-abandoned", label: "Account ndoned", email: null, status: "INITIATED", active: false },
  ];
  async function cloud(route, payload, method = "POST") {
    if (process.env.TIMEWARP_FIXTURE_COUNT) console.error("[timewarp] fixture cloud " + route + (route === "/connectors" ? " " + (payload?.action || "") : ""));
    if (latency && !(liveModel && /^\/v1\//.test(route))) await new Promise(resolve => setTimeout(resolve, latency));
    return answer(route, payload, method);
  }
  async function answer(route, payload, method) {
    if (!signedIn) return json({ error: "Sign in to Timewarp." }, 401);
    if (liveModel && /^\/v1\/(responses|models)$/.test(route)) {
      return fetch(liveModel + route.slice(3), { method, headers: { "content-type": "application/json" }, ...(payload === undefined || method === "GET" ? {} : { body: JSON.stringify(payload) }) });
    }
    if (route === "/v1/responses") return scriptedResponse(payload || {});
    if (route === "/v1/models") return json({ object: "list", data: [{ id: "openai/gpt-5.6-sol", object: "model" }, { id: "openai/gpt-5.6-luna", object: "model" }] });
    if (route === "/account") return json({ image: null, activeOrganization: { ...ORGANIZATION }, organizations: [{ ...ORGANIZATION }] });
    if (route === "/billing") return json({ plan, included: 504, purchased: 20, monthlyIncluded: 700, renewsAt: new Date(Date.now() + 20 * 86400000).toISOString() });
    if (route === "/billing/service") return json(billingStatus());
    if (route === "/billing/history") return json({ events: [{ id: "e1", kind: "usage", description: "AI usage", credits: -3.2, createdAt: new Date(Date.now() - 3600000).toISOString() }, { id: "e2", kind: "purchase", description: "Extra credits", credits: 20, createdAt: new Date(Date.now() - 86400000).toISOString() }] });
    if (route === "/history") { try { return json(shared.file ? shared.history(USER.id, payload || {}) : payload?.operation === "list" ? { protocol: 2, manifest: [], nextOffset: null } : payload?.operation === "get" ? { chats: [] } : { saved: true }); } catch (error) { return json({ error: error.message }, error.status || 400); } }
    if (route === "/account-data") { try { return json(shared.accountData(USER.id, payload || {})); } catch (error) { return json({ error: error.message }, 400); } }
    if (route === "/native/rpc") return json(rpc(payload.rpc, payload.input || {}));
    if (route === "/v1/transcriptions") return json({ text: `Preview dictation (${payload?.length || 0} bytes of audio).` });
    if (route === "/connectors") {
      // As the cloud answers: a working account's label is its email, and each
      // Connect makes an account that stays started until its sign-in is done
      // (Gmail keeps an abandoned one).
      if (payload?.action === "list-apps") return json({ apps: [
        { toolkitSlug: "gmail", name: "Gmail", description: "Read and send email.", logo: null, accounts: connectorAccounts.filter(account => account.toolkit === "gmail") },
        { toolkitSlug: "slack", name: "Slack", description: "Read and post messages.", logo: null, authConfigId: "ac_preview_slack", accounts: connectorAccounts.filter(account => account.toolkit === "slack") },
      ] });
      if (payload?.action === "initiate-connection") {
        const connectionId = "conn-new-" + crypto.randomUUID();
        connectorAccounts.push({ toolkit: "slack", connectionId, label: "Account " + connectionId.slice(-6), email: null, status: "INITIATED", active: false });
        return json({ redirectUrl: "https://example.com/?timewarp-connect=1", connectionId });
      }
      // The sign-in returning to Timewarp finishes it.
      if (payload?.action === "connection-status") {
        const account = connectorAccounts.find(item => item.connectionId === payload.connectionId);
        if (!account) return json({ error: "Connection not found." }, 404);
        Object.assign(account, { status: "ACTIVE", active: true, label: "slack@preview.invalid", email: "slack@preview.invalid", name: "Preview Slack" });
        return json({ ...account, failed: false });
      }
      if (payload?.action === "disconnect") { connectorAccounts = connectorAccounts.filter(item => item.connectionId !== payload.connectionId); return json({ ok: true }); }
      return json(payload?.action === "catalog" ? { apps: [] } : { ok: true });
    }
    return json({ error: "Unavailable in preview mode." }, 404);
  }
  // Agent ID as its API answers the account (agent-id.cjs), kept in memory:
  // a new agent gets mail with two messages; a wallet needs a verified owner;
  // cards and numbers are applied for; verifying finishes a few seconds after
  // it starts. TIMEWARP_FIXTURE_AGENT_ID=offline: it can't be reached.
  const identities = [];
  let termsAccepted = false, verifiedAt = null;
  const AGENT_ID_CONFIG = { resources: {
    mail: { live: true, verificationRequired: false, paidPlanRequired: false }, wallet: { live: true, verificationRequired: true, paidPlanRequired: false },
    card: { live: false, waitlist: true, verificationRequired: true, paidPlanRequired: true }, vm: { live: true, verificationRequired: false, paidPlanRequired: false },
    phone: { live: false, waitlist: true, verificationRequired: false, paidPlanRequired: true },
  }, connectors: { available: true }, verification: { person: "stripe_identity" } };
  const agentIdFail = (status, message, code = null) => { throw Object.assign(new Error(message), { status, code }); };
  const ago = minutes => new Date(Date.now() - minutes * 60000).toISOString();
  const usd = amount => ({ amount, currency: "USD", display: `${(amount / 100).toFixed(2)} USD` });
  const event = (kind, fields) => ({ id: crypto.randomUUID(), kind, direction: "in", status: "completed", counterparty: null, subject: null, text: null, amount: null, thread: null, data: {}, read: false, ...fields });
  function giveResource(item, kind) {
    const address = kind === "mail" ? `${item.handle}@agents.timewarpdev.com` : kind === "wallet" ? "0x" + crypto.randomBytes(20).toString("hex") : null;
    item.resources[kind] = { id: crypto.randomUUID(), kind, mode: "live", provider: { mail: "resend", wallet: "privy", vm: "azure_sandbox" }[kind], status: "active", address, label: null, settings: {}, details: kind === "vm" ? { size: "small" } : {}, currency: kind === "wallet" ? "USD" : null, createdAt: new Date().toISOString() };
    if (kind === "mail") item.mail = [
      event("mail", { folder: "inbox", counterparty: "orders@example.com", subject: "Your order has shipped", text: "Hi,\n\nYour order #4821 is on its way and should arrive on Tuesday.\n\nThanks for shopping with us.", at: ago(42) }),
      event("mail", { folder: "inbox", counterparty: "alex@preview.invalid", subject: "Notes from today's call", text: "Here are the notes from today's call. Can you turn them into a short summary for the team?", read: true, at: ago(60 * 26), attachments: [{ id: crypto.randomUUID(), filename: "call-notes.pdf", contentType: "application/pdf", size: 48213 }] }),
    ];
    if (kind === "wallet") item.transactions = [
      event("wallet", { counterparty: "0x5f3a" + crypto.randomBytes(18).toString("hex"), amount: usd(2500), at: ago(60 * 5) }),
      event("wallet", { direction: "out", counterparty: "api.example.com", subject: "API credits", amount: usd(1260), at: ago(60 * 3) }),
    ];
    if (kind === "vm") { item.machine = "stopped"; item.commands = [event("vm", { direction: "none", subject: "python3 summarize.py notes.md", data: { exitCode: 0 }, at: ago(90) }), event("vm", { direction: "none", status: "exited", subject: "npm test", data: { exitCode: 1 }, at: ago(60 * 30) })]; }
  }
  // The tools Agent ID's MCP server describes (mcp.ts), as many as the preview answers.
  const AGENT_ID_TOOLS = [
    ["whoami", "Your Agent ID: your id, name, your owner's verification and everything you have.", true, {}],
    ["mail_list", "Messages in your mailbox, newest first.", true, { folder: { type: "string" } }],
    ["mail_send", "Send an email from your own address.", false, { to: { type: "string" }, subject: { type: "string" }, text: { type: "string" } }],
    ["wallet_get", "Your wallet: its address and its balance in US dollars.", true, {}],
    ["vm_get", "Your virtual machine and whether it is running.", true, {}],
    ["connectors_list", "The apps your owner connected and lets you use.", true, {}],
    ["automations_list", "The automations that run you on a schedule in Timewarp.", true, {}],
  ].map(([name, description, readOnly, properties]) => ({ name, description, inputSchema: { type: "object", properties, required: [], additionalProperties: false }, annotations: { readOnlyHint: readOnly, destructiveHint: false, openWorldHint: !readOnly } }));
  async function agentIdRoute(method, route, { body, query, agent } = {}) {
    const mine = () => identities.filter(item => item.ownerId === USER.id);
    const view = ({ ownerId, mail, transactions, machine, commands, applications, keys, automations, requests, vault, approvals, ...item }) => item;
    const person = () => verifiedAt === null ? { status: "unverified" } : Date.now() < verifiedAt ? { status: "pending", provider: "stripe_identity" } : { status: "verified", provider: "stripe_identity", verifiedAt: new Date(verifiedAt).toISOString() };
    const page = items => ({ items: items.filter(item => !query?.before || item.at < query.before).slice(0, 20) });
    if (method === "GET" && route === "/v1/agents") return { agents: mine().filter(item => item.status !== "revoked").map(view) };
    if (method === "GET" && route === "/v1/account") return { person: person(), config: AGENT_ID_CONFIG, terms: { accepted: termsAccepted, version: termsAccepted ? "2026-10-20" : null, current: "2026-10-20" } };
    if (method === "POST" && route === "/v1/account/terms") { termsAccepted = true; return { terms: { accepted: true, version: body.version, current: "2026-10-20" } }; }
    if (method === "POST" && route === "/v1/account/verification") {
      if (body?.consent !== true) agentIdFail(400, "Agree to the identity check first.", "consent_required");
      if (verifiedAt === null) verifiedAt = Date.now() + 4000;
      return { person: person() };
    }
    if (method === "POST" && route === "/v1/agents") {
      if (!termsAccepted) agentIdFail(403, "Accept the Agent ID Terms first.", "terms_required");
      const id = "agt_" + crypto.randomBytes(12).toString("hex");
      const handle = String(body.name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24) + "-" + id.slice(4, 8);
      const secret = "twa_preview_" + crypto.randomBytes(16).toString("hex");
      const item = { id, ownerId: USER.id, name: body.name, handle, mascot: "Cosmo", status: "active", runtime: "timewarp", desktopAgentId: body.desktopAgentId || null, createdAt: new Date().toISOString(),
        model: { kind: "agent", label: "AI agent", provider: null, name: null }, apps: [{ app: "timewarp", label: "Timewarp", model: null, models: [] }],
        resources: {}, applications: {}, keys: [secret], automations: [], requests: [], vault: null, approvals: [] };
      giveResource(item, "mail");
      identities.push(item);
      return { agent: view(item), key: { id: crypto.randomUUID(), name: body.keyName, prefix: "twa_prev" }, secret };
    }
    if (method === "DELETE" && /^\/v1\/agents\/[^/]+\/keys\/[^/]+$/.test(route)) return { revoked: true };
    const ownedAgent = id => mine().find(entry => entry.id === decodeURIComponent(id)) || agentIdFail(404, "This agent does not exist.", "not_found");
    const keyed = /^\/v1\/agents\/([^/]+)\/keys$/.exec(route);
    if (keyed && method === "POST") { const item = ownedAgent(keyed[1]), secret = "twa_preview_" + crypto.randomBytes(16).toString("hex"); item.keys.push(secret); return { key: { id: crypto.randomUUID(), name: body?.name, prefix: "twa_prev" }, secret }; }
    // Automations as Timewarp sends them, and the website's requests (automations.ts).
    const automations = /^\/v1\/agents\/([^/]+)\/automations$/.exec(route);
    if (automations) {
      const item = ownedAgent(automations[1]);
      if (method === "PUT") item.automations = (body.automations || []).map(entry => ({ ...entry, device: body.device || null, updatedAt: new Date().toISOString() }));
      return { automations: item.automations, pending: item.requests.filter(request => request.status === "pending") };
    }
    const asked = /^\/v1\/agents\/([^/]+)\/automations\/([^/]+)\/requests$/.exec(route);
    if (asked) { const item = ownedAgent(asked[1]), request = { id: crypto.randomUUID(), agentId: item.id, automationId: decodeURIComponent(asked[2]), action: body.action, status: "pending", createdAt: new Date().toISOString() }; item.requests.push(request); return { request }; }
    if (method === "GET" && route === "/v1/automation-requests") return { requests: mine().flatMap(item => item.requests.filter(request => request.status === "pending").map(request => ({ ...request, desktopAgentId: item.desktopAgentId }))) };
    const answered = /^\/v1\/automation-requests\/([^/]+)$/.exec(route);
    if (answered) { const request = mine().flatMap(item => item.requests).find(entry => entry.id === answered[1] && entry.status === "pending") || agentIdFail(404, "No waiting request with that id.", "not_found"); Object.assign(request, { status: body.status, error: body.error || null, doneAt: new Date().toISOString() }); return { request }; }
    // The vault, with a real key pair: items the app seals are opened here, as the agent's computer would.
    const vaultRoute = /^\/v1\/agents\/([^/]+)\/vault(?:\/(setup|items)(?:\/([^/]+))?)?$/.exec(route);
    if (vaultRoute) {
      const item = ownedAgent(vaultRoute[1]);
      const status = () => ({ vault: { computer: item.resources.vm ? "ready" : "none", ready: !!item.vault, publicKey: item.vault?.publicKey || null, test: true }, items: item.vault?.items || [] });
      if (vaultRoute[2] === "setup") {
        if (!item.resources.vm) giveResource(item, "vm");
        if (!item.vault) { const pair = crypto.generateKeyPairSync("rsa", { modulusLength: 2048, publicKeyEncoding: { type: "spki", format: "pem" }, privateKeyEncoding: { type: "pkcs8", format: "pem" } }); item.vault = { publicKey: pair.publicKey, privateKey: pair.privateKey, items: [] }; }
        return status();
      }
      if (vaultRoute[2] === "items" && method === "POST") {
        if (!item.vault) agentIdFail(409, "Set the vault up first.", "vault_not_ready");
        const { envelope } = body;
        let secret;
        try {
          const aes = crypto.privateDecrypt({ key: item.vault.privateKey, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" }, Buffer.from(envelope.key, "base64"));
          const data = Buffer.from(envelope.data, "base64"), decipher = crypto.createDecipheriv("aes-256-gcm", aes, Buffer.from(envelope.iv, "base64"));
          decipher.setAuthTag(data.subarray(data.length - 16));
          secret = JSON.parse(Buffer.concat([decipher.update(data.subarray(0, data.length - 16)), decipher.final()]).toString());
        } catch { agentIdFail(400, "This vault item couldn't be opened on the agent's computer.", "invalid"); }
        const saved = { id: "vlt_" + crypto.randomBytes(12).toString("hex"), kind: secret.kind, label: body.label, site: secret.site || null, hosts: secret.hosts || [], send: secret.send?.as || null, totp: !!secret.totp, savedBy: "owner", createdAt: new Date().toISOString(), lastUsedAt: null };
        item.vault.items.push(saved);
        return { item: saved };
      }
      if (vaultRoute[2] === "items" && method === "DELETE") { item.vault.items = item.vault.items.filter(entry => entry.id !== vaultRoute[3]); return { removed: true }; }
      return status();
    }
    if (method === "GET" && route === "/v1/approvals") return { approvals: mine().flatMap(item => item.approvals.filter(entry => entry.status === "pending")) };
    const decided = /^\/v1\/approvals\/([^/]+)$/.exec(route);
    if (decided) {
      const owner = mine().find(item => item.approvals.some(entry => entry.id === decided[1])) || agentIdFail(404, "No approval with that id.", "not_found");
      const approval = owner.approvals.find(entry => entry.id === decided[1]);
      approval.status = body.decision === "approve" ? "completed" : "denied";
      if (approval.status === "completed" && approval.mail) owner.mail.unshift(event("mail", { folder: "sent", direction: "out", status: "sent", read: true, at: new Date().toISOString(), ...approval.mail }));
      return { status: approval.status };
    }
    const events = /^\/v1\/agents\/([^/]+)\/events$/.exec(route);
    if (events) { const item = ownedAgent(events[1]); return { events: [...(item.mail || []), ...(item.transactions || []), ...(item.commands || [])].map(({ folder, attachments, ...entry }) => entry).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 20), more: false }; }
    const owned = /^\/v1\/agents\/([^/]+)\/(resources|card-application|phone-application)$/.exec(route);
    if (owned) {
      const item = ownedAgent(owned[1]);
      if (owned[2] === "resources") {
        if (item.resources[body.kind]) agentIdFail(409, "This agent already has one.", "already_has");
        if (AGENT_ID_CONFIG.resources[body.kind]?.verificationRequired && person().status !== "verified") agentIdFail(403, "Verify your identity first.", "verification_required");
        giveResource(item, body.kind);
        return { resource: item.resources[body.kind] };
      }
      const kind = owned[2].split("-")[0];
      if (method === "POST") item.applications[kind] = { status: "submitted", useCase: body.useCase, country: body.country, createdAt: new Date().toISOString(), ...(kind === "card" ? { monthlySpend: usd(body.monthlySpend) } : { uses: body.uses || ["sms", "calls"] }) };
      return { application: item.applications[kind] || null };
    }
    if (route.startsWith("/v1/me/")) {
      const item = mine().find(entry => entry.id === agent) || agentIdFail(403, "This endpoint acts as an agent.", "wrong_credential");
      const has = kind => item.resources[kind] || agentIdFail(404, `This agent doesn't have ${kind === "vm" ? "a machine" : "a " + kind} yet.`, `no_${kind}`);
      if (route === "/v1/me/mail/counts") { has("mail"); return { inbox: { total: item.mail.filter(m => m.folder === "inbox").length, unread: item.mail.filter(m => m.folder === "inbox" && !m.read).length }, sent: { total: item.mail.filter(m => m.folder === "sent").length }, trash: { total: 0 } }; }
      if (route === "/v1/me/mail" && method === "GET") { has("mail"); const { items } = page(item.mail.filter(m => m.folder === (query?.folder || "inbox"))); return { messages: items.map(({ text, ...m }) => ({ ...m, preview: text.replace(/\s+/g, " ").slice(0, 200), attachments: m.attachments || [] })), more: false }; }
      if (route === "/v1/me/mail" && method === "POST") {
        const mail = has("mail");
        if (!body?.to || !body?.subject || !body?.text) agentIdFail(400, "to, subject and text are required.", "invalid");
        const sent = event("mail", { folder: "sent", direction: "out", status: "sent", counterparty: body.to, subject: body.subject, text: body.text, read: true, at: new Date().toISOString(), data: { from: mail.address } });
        item.mail.unshift(sent);
        return { message: sent };
      }
      const message = /^\/v1\/me\/mail\/([^/]+)$/.exec(route);
      if (message) { has("mail"); return { message: { attachments: [], ...(item.mail.find(m => m.id === message[1]) || agentIdFail(404, "No message with that id.", "not_found")) } }; }
      if (route === "/v1/me/wallet") { const wallet = has("wallet"); return { wallet: { address: wallet.address, mode: "live", provider: "privy", network: "base", currency: "USD", balance: usd(1240), assets: [{ asset: "USDC", amount: usd(1240) }], limits: {}, sent: { last24Hours: usd(0), last30Days: usd(1260) } } }; }
      if (route === "/v1/me/wallet/transactions") { has("wallet"); return { transactions: page(item.transactions).items, more: false }; }
      if (route === "/v1/me/vm") { has("vm"); return { machine: { label: null, mode: "live", status: "active", state: item.machine, size: "small" } }; }
      if (route === "/v1/me/vm/start" || route === "/v1/me/vm/stop") { has("vm"); item.machine = route.endsWith("start") ? "running" : "stopped"; return { machine: { state: item.machine, ...(item.machine === "running" ? { note: "A running machine stops by itself after a minute without commands." } : {}) } }; }
      if (route === "/v1/me/vm/commands") { has("vm"); return { commands: page(item.commands).items, more: false }; }
      if (route === "/v1/me/automations") return { automations: item.automations };
      if (route === "/v1/me/card" || route === "/v1/me/card/transactions") has("card");
      if (route === "/v1/me/sms" || route === "/v1/me/calls") has("phone");
    }
    agentIdFail(404, "Unavailable in preview mode.", "not_found");
  }
  // The agent's MCP server, as its key reaches it (agent-id-tools.cjs): sending
  // mail waits for the owner's yes, as an action that asks first does.
  function agentIdMcp(item, message) {
    const result = value => ({ result: { content: [{ type: "text", text: JSON.stringify(value) }] } });
    if (message.method === "initialize") return { result: { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "timewarp-agent-id" } }, session: "mcs_" + crypto.randomBytes(12).toString("hex") };
    const { name, arguments: args = {} } = message.params || {};
    if (args.model) { const app = item.apps.find(entry => entry.app === "timewarp"); app.model = String(args.model); app.models = [...new Set([...(app.models || []), app.model])]; }
    if (name === "whoami") return result({ agent: { id: item.id, name: item.name, handle: item.handle }, resources: Object.keys(item.resources) });
    if (name === "mail_list") return result({ messages: (item.mail || []).filter(m => m.folder === (args.folder || "inbox")).map(({ text, ...m }) => m) });
    if (name === "mail_send") {
      const approval = { id: crypto.randomUUID(), agentId: item.id, agentName: item.name, kind: "action", request: { action: "mail.send", kind: "mail", summary: { to: args.to, subject: args.subject, text: args.text } }, status: "pending", createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 86400000).toISOString(), mail: { counterparty: args.to, subject: args.subject, text: args.text } };
      item.approvals.push(approval);
      return result({ status: "needs_approval", approval: approval.id, message: "Your owner asked to approve mail first. Tell them and check later with approval_status." });
    }
    if (name === "wallet_get") return result(item.resources.wallet ? { wallet: { address: item.resources.wallet.address, balance: usd(1240) } } : { error: "no_wallet" });
    if (name === "automations_list") return result({ automations: item.automations });
    return { result: { isError: true, content: [{ type: "text", text: `${name} isn't answered in preview mode.` }] } };
  }
  async function agentId(method, route, options = {}) {
    if (latency) await new Promise(resolve => setTimeout(resolve, latency));
    if (process.env.TIMEWARP_FIXTURE_AGENT_ID === "offline") agentIdFail(503, "Agent ID could not be reached.");
    const answer = value => options.withHeaders ? { value, headers: new Headers(value?.session ? { "mcp-session-id": value.session } : {}) } : value;
    if (method === "GET" && route === "/v1/mcp/tools") return answer({ tools: AGENT_ID_TOOLS });
    // An agent's own key: the MCP server acts as it.
    if (options.key) {
      const item = identities.find(entry => entry.keys?.includes(options.key)) || agentIdFail(401, "This key is not valid.", "invalid_key");
      if (route === "/mcp") return answer(agentIdMcp(item, options.body));
      return answer(await agentIdRoute(method, route, { ...options, agent: item.id }));
    }
    if (!signedIn) agentIdFail(401, "Your Timewarp session has expired. Sign in again.", "unauthenticated");
    return answer(await agentIdRoute(method, route, options));
  }
  // Sample files from other assistants, so previews never read the real home folder.
  function sampleHome(directory) {
    const fs = require("node:fs"), path = require("node:path");
    const write = (file, text) => { const target = path.join(directory, file); fs.mkdirSync(path.dirname(target), { recursive: true }); if (!fs.existsSync(target)) fs.writeFileSync(target, text); };
    write(".claude/CLAUDE.md", "# Preferences\n- Keep replies short.\n- Use metric units.\n");
    write(".claude/projects/launch/memory/notes.md", "The launch is planned for spring.\n");
    write(".claude/skills/summarize/SKILL.md", "---\nname: summarize\ndescription: Summarize long documents into five bullet points.\n---\n\nRead the document and return five bullets.\n");
    write(".codex/AGENTS.md", "Prefer TypeScript for new scripts.\n");
    write(".codex/skills/release-notes/SKILL.md", "---\nname: release-notes\ndescription: Draft release notes from a list of changes.\n---\n\nGroup changes by area.\n");
    return directory;
  }
  return { auth, cloud, agentId, get user() { return USER; }, sampleHome, setPlan: value => { plan = value; } };
}

module.exports = { createFixture, scriptedResponse, fixtureCloudStore };
