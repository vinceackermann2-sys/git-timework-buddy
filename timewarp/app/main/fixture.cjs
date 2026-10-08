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
function textOf(input) {
  return (input || []).filter(item => item.type === "message" && item.role === "user")
    .flatMap(item => (item.content || []).map(part => part.text || "")).join("\n");
}

// Scripted Responses API: "run" asks for a shell command, everything else gets
// a markdown reply that names what the user wrote.
function scriptedResponse(body) {
  const id = "resp_" + crypto.randomUUID(), message = "msg_" + crypto.randomUUID();
  const usage = { input_tokens: 40, input_tokens_details: { cached_tokens: 0 }, output_tokens: 30, output_tokens_details: { reasoning_tokens: 0 }, total_tokens: 70 };
  const outputs = (body.input || []).filter(item => item.type === "function_call_output" || item.type === "custom_tool_call_output");
  const latest = textOf(body.input).split("\n").filter(Boolean).at(-1) || "";
  const tool = (body.tools || []).find(item => item.type === "function" && item.name === "exec_command");
  // Code mode exposes the tools through one "exec" JavaScript tool.
  const codeMode = (body.input || []).filter(item => item.type === "additional_tools").flatMap(item => item.tools || [])
    .flatMap(item => item.type === "namespace" ? item.tools || [] : [item]).some(item => item.type === "custom" && item.name === "exec");
  if (process.env.TIMEWARP_FIXTURE_DUMP) require("node:fs").writeFileSync(process.env.TIMEWARP_FIXTURE_DUMP, JSON.stringify(body, null, 1));
  if (process.env.TIMEWARP_FIXTURE_LOG) console.error("[timewarp] fixture request", JSON.stringify({ latest, codeMode, tools: (body.tools || []).map(item => item.name || item.type), inputs: (body.input || []).map(item => item.type + ":" + (item.role || "")), outputs: outputs.length }));
  const events = [{ type: "response.created", response: { id } }];
  const command = process.platform === "win32" ? "Write-Output 'Hello from the Timewarp preview'" : "echo 'Hello from the Timewarp preview'";
  const browse = /\bbrowse\b/i.test(latest), runCommand = /\brun\b/i.test(latest);
  if (codeMode && browse && !outputs.length) {
    const script = `const opened = await tools.timewarp_browser__open({ url: "https://example.com/" });\nconst outline = await tools.timewarp_browser__snapshot({});\ntext(String(opened) + "\\n" + String(outline).slice(0, 600));`;
    const call = { type: "custom_tool_call", id: "ctc_" + crypto.randomUUID(), call_id: "call_" + crypto.randomUUID(), name: "exec", input: script };
    events.push({ type: "response.output_item.added", output_index: 0, item: { ...call, input: "" } }, { type: "response.output_item.done", output_index: 0, item: call });
  } else if ((tool || codeMode) && runCommand && !outputs.length) {
    const callId = "call_" + crypto.randomUUID();
    const call = codeMode
      ? { type: "custom_tool_call", id: "ctc_" + crypto.randomUUID(), call_id: callId, name: "exec", input: `const result = await tools.exec_command({ cmd: ${JSON.stringify(command)} });\ntext(typeof result === "string" ? result : JSON.stringify(result));` }
      : { type: "function_call", id: "fc_" + crypto.randomUUID(), call_id: callId, name: "exec_command", arguments: JSON.stringify({ cmd: command }) };
    events.push({ type: "response.output_item.added", output_index: 0, item: codeMode ? { ...call, input: "" } : { ...call, arguments: "" } }, { type: "response.output_item.done", output_index: 0, item: call });
  } else {
    const text = outputs.length
      ? (browse ? "I opened the page in the browser. Here is what it shows:\n\n```\n" : "The command finished. Here is what it printed:\n\n```\n") + outputText(outputs.at(-1).output).slice(0, 700) + "\n```"
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
  const plans = [["free", "Free", 0, 0], ["pro", "Pro", 20, 100], ["max", "Max", 50, 250], ["ultra", "Ultra", 100, 500]]
    .map(([id, name, monthlyUsd, monthlyCredits]) => ({ id, name, monthlyUsd, monthlyCredits, available: true }));
  return {
    plan: "pro", workspaceId: null, role: "owner", canManage: true, isPersonal: true, subscriptionStatus: "active", cancelAtPeriodEnd: false,
    currentPeriodEnd: new Date(Date.now() + 20 * 86400000).toISOString(), hasSubscription: true,
    monthlyCreditAddons: [0, 50, 100, 200].map(credits => ({ credits, monthlyUsd: credits * 0.2 })), monthlyExtraCredits: 0, monthlyUsd: 20, canOpenPortal: false,
    includedCredits: { allowance: 100, balance: 72 }, purchasedCredits: { balance: 20 }, credits: { balance: 92 },
    usage: { plan: "pro", periodStart: new Date(Date.now() - 10 * 86400000).toISOString() }, plans,
    creditPacks: [{ id: "pack-50", credits: 50, priceUsd: 15 }, { id: "pack-100", credits: 100, priceUsd: 30 }],
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
  async function cloud(route, payload) {
    if (!signedIn) return json({ error: "Sign in to Timewarp." }, 401);
    if (route === "/v1/responses") return scriptedResponse(payload || {});
    if (route === "/v1/models") return json({ object: "list", data: [{ id: "openai/gpt-5.6-sol", object: "model" }, { id: "openai/gpt-5.6-luna", object: "model" }] });
    if (route === "/account") return json({ image: null, activeOrganization: { ...ORGANIZATION }, organizations: [{ ...ORGANIZATION }] });
    if (route === "/billing") return json({ plan: "pro", included: 72, purchased: 20, monthlyIncluded: 100, renewsAt: new Date(Date.now() + 20 * 86400000).toISOString() });
    if (route === "/billing/service") return json(billingStatus());
    if (route === "/billing/history") return json({ events: [{ id: "e1", kind: "usage", description: "AI usage", credits: -3.2, createdAt: new Date(Date.now() - 3600000).toISOString() }, { id: "e2", kind: "purchase", description: "Extra credits", credits: 20, createdAt: new Date(Date.now() - 86400000).toISOString() }] });
    if (route === "/history") return json(payload?.operation === "list" ? { protocol: 2, manifest: [], nextOffset: null } : payload?.operation === "get" ? { chats: [] } : { saved: true });
    if (route === "/native/rpc") return json(rpc(payload.rpc, payload.input || {}));
    if (route === "/connectors") return json(payload?.action === "catalog" ? { apps: [] } : { ok: true });
    return json({ error: "Unavailable in preview mode." }, 404);
  }
  return { auth, cloud, user: USER };
}

module.exports = { createFixture, scriptedResponse };
