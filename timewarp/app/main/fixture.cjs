"use strict";
// Preview mode for development builds only (build.json "fixture": true): a
// signed-in sample account and organization with credits, and a scripted
// model. Real Codex runs the agents and tools. Release builds refuse it.
const crypto = require("node:crypto");

const USER = { id: "00000000-0000-4000-8000-00000000f1a7", email: "preview@timewarp.invalid", name: "Preview" };
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
  if (process.env.TIMEWARP_FIXTURE_LOG) console.error("[timewarp] fixture request", JSON.stringify({ latest, codeMode, tools: (body.tools || []).map(item => item.name || item.type), inputs: (body.input || []).map(item => item.type + ":" + (item.role || "")), outputs: outputs.length }));
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
    const callId = "call_" + crypto.randomUUID();
    const call = codeMode
      ? { type: "custom_tool_call", id: "ctc_" + crypto.randomUUID(), call_id: callId, name: "exec", input: `const result = await tools.exec_command({ cmd: ${JSON.stringify(command)} });\ntext(typeof result === "string" ? result : JSON.stringify(result));` }
      : { type: "function_call", id: "fc_" + crypto.randomUUID(), call_id: callId, name: "exec_command", arguments: JSON.stringify({ cmd: command }) };
    events.push({ type: "response.output_item.added", output_index: 0, item: codeMode ? { ...call, input: "" } : { ...call, arguments: "" } }, { type: "response.output_item.done", output_index: 0, item: call });
  } else {
    const plan = reviewing ? textOf([inputs[lastUser]]) : "";
    const text = reviewing
      ? JSON.stringify(/Remove-Item|rm -rf/.test(plan) ? { risk_level: "high", user_authorization: "unknown", outcome: "deny", rationale: "Deleting files isn't part of the task." } : { outcome: "allow" })
      : outputs.length
      ? spawn ? "Started a worker:\n\n```\n" + outputText(outputs.at(-1).output).slice(0, 2000) + "\n```" : script ? "Script output:\n\n```\n" + outputText(outputs.at(-1).output).slice(0, 6000) + "\n```" : (browse ? "I opened the page in the browser. Here is what it shows:\n\n```\n" : "The command finished. Here is what it printed:\n\n```\n") + outputText(outputs.at(-1).output).slice(0, 700) + "\n```"
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
      for (const event of events) { controller.enqueue(encoder.encode(sse([event]))); await new Promise(resolve => setTimeout(resolve, 35)); }
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

function createFixture() {
  let signedIn = true, onChange = async () => {};
  const members = [{ id: "member-1", userId: USER.id, email: USER.email, name: USER.name, image: null, roles: ["owner"], createdAt: "2026-01-01T00:00:00.000Z" }];
  const invites = [];
  const auth = {
    bind(handler) { onChange = handler; },
    init: async () => {},
    user: () => signedIn ? { ...USER } : null,
    userId: () => signedIn ? USER.id : null,
    accessToken: async () => { if (!signedIn) throw Object.assign(new Error("Sign in to Timewarp."), { status: 401 }); return "fixture-token"; },
    capability: () => "fixture-capability", expiresAt: () => Math.floor(Date.now() / 1000) + 3600,
    hasPendingFlow: () => false, passwordRecovery: () => false,
    providers: async () => ({ google: true, email: true, signup: true }),
    signIn: async () => { signedIn = true; await onChange({ signedIn: true, changedUser: true }); return { user: { ...USER } }; },
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
    if (name === "product.images.beginUpload") throw Object.assign(new Error("Pictures can't be uploaded in preview mode."), { status: 400 });
    return null;
  };
  // Live evaluations (scripts/eval-engine.cjs) answer with a real model: model
  // requests go to a proxy on this computer that holds a test account's
  // sign-in. Everything else stays preview data.
  const liveModel = /^http:\/\/127\.0\.0\.1:\d+\/v1$/.test(process.env.TIMEWARP_FIXTURE_MODEL_URL || "") ? process.env.TIMEWARP_FIXTURE_MODEL_URL : null;
  async function cloud(route, payload, method = "POST") {
    if (!signedIn) return json({ error: "Sign in to Timewarp." }, 401);
    if (liveModel && /^\/v1\/(responses|models)$/.test(route)) {
      return fetch(liveModel + route.slice(3), { method, headers: { "content-type": "application/json" }, ...(payload === undefined || method === "GET" ? {} : { body: JSON.stringify(payload) }) });
    }
    if (route === "/v1/responses") return scriptedResponse(payload || {});
    if (route === "/v1/models") return json({ object: "list", data: [{ id: "openai/gpt-5.6-sol", object: "model" }, { id: "openai/gpt-5.6-luna", object: "model" }] });
    if (route === "/account") return json({ image: null, activeOrganization: { ...ORGANIZATION }, organizations: [{ ...ORGANIZATION }] });
    if (route === "/billing") return json({ plan: "max", included: 504, purchased: 20, monthlyIncluded: 700, renewsAt: new Date(Date.now() + 20 * 86400000).toISOString() });
    if (route === "/billing/service") return json(billingStatus());
    if (route === "/billing/history") return json({ events: [{ id: "e1", kind: "usage", description: "AI usage", credits: -3.2, createdAt: new Date(Date.now() - 3600000).toISOString() }, { id: "e2", kind: "purchase", description: "Extra credits", credits: 20, createdAt: new Date(Date.now() - 86400000).toISOString() }] });
    if (route === "/history") return json(payload?.operation === "list" ? { protocol: 2, manifest: [], nextOffset: null } : payload?.operation === "get" ? { chats: [] } : { saved: true });
    if (route === "/native/rpc") return json(rpc(payload.rpc, payload.input || {}));
    if (route === "/v1/transcriptions") return json({ text: `Preview dictation (${payload?.length || 0} bytes of audio).` });
    if (route === "/connectors") {
      if (payload?.action === "list-apps") return json({ apps: [
        { toolkitSlug: "gmail", name: "Gmail", description: "Read and send email.", logo: null, accounts: [{ connectionId: "conn-gmail-1", label: "Preview inbox", email: "inbox@preview.invalid", status: "ACTIVE" }] },
        { toolkitSlug: "slack", name: "Slack", description: "Read and post messages.", logo: null, authConfigId: "ac_preview_slack", accounts: [] },
      ] });
      if (payload?.action === "initiate-connection") return json({ redirectUrl: "https://example.com/?timewarp-connect=1", connectionId: "conn-new-" + crypto.randomUUID() });
      return json(payload?.action === "catalog" ? { apps: [] } : { ok: true });
    }
    return json({ error: "Unavailable in preview mode." }, 404);
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
  return { auth, cloud, user: USER, sampleHome };
}

module.exports = { createFixture, scriptedResponse };
