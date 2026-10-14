"use strict";
// Timewarp itself for agents: the user's plan and usage, their settings and
// how the app is doing, read without opening a screen. Nothing here reveals
// secrets (no vault values, sign-ins or keys), and credits stay credits,
// never money. Settings change only through a card in the chat that the user
// answers: Timewarp writes the card from the checked values, so an agent can't
// word it into something else, and applies the change only after Allow.
const fail = (status, message) => Object.assign(new Error(message), { status });

const DAY = 24 * 60 * 60 * 1000;
const THEMES = ["system", "light", "dark"];
const MEMORY_MODES = { enabled: "Enabled", read: "Read only", write: "Write only", none: "None" };
const THEME_LABELS = { system: "System", light: "Light", dark: "Dark" };
const onOff = value => value ? "On" : "Off";

const TOOLS = [
  ["get_usage", "The user's plan and AI usage: the credits left (credits are Timewarp's unit: never turn them into money), the plan's monthly credits and when they reset, or a connected ChatGPT plan's usage windows; and the tokens used in this chat and in the user's chats over the last 7 days.", {}, []],
  ["get_settings", "The user's Timewarp settings: theme, Privacy Mode, memory, reply notifications, how extra access is approved, the default model for new chats (with the models the plan offers) and this chat's model.", {}, []],
  ["get_status", "How Timewarp is doing: its version and updates, the agent runtime, the command sandbox, chat history sync and account sync.", {}, []],
  ["change_settings", "Ask to change the user's Timewarp settings. Timewarp shows the user a card in this chat listing each change and applies them only if they allow it; the result says what happened. Use it when the user asks for a change, or to suggest one that helps their task. Only these settings can change, each only with the user's OK.", {
    theme: { type: "string", enum: THEMES },
    privacyMode: { type: "boolean", description: "On pauses cloud chat history and account sync." },
    memory: { type: "string", enum: Object.keys(MEMORY_MODES), description: "enabled (read and write), read (read only), write (write only) or none." },
    replyNotifications: { type: "boolean", description: "Notifications when an agent replies while Timewarp isn't in front." },
    defaultModel: { type: "string", description: "A model id from get_settings' models, for new chats." },
    reasoningEffort: { type: "string", description: "With defaultModel: one of that model's efforts." },
    reason: { type: "string", description: "One short sentence for the user on why, shown on the card." },
  }, ["reason"]],
];

function toolSpecs() {
  return [{
    type: "namespace", name: "timewarp_app",
    description: "Timewarp itself: the user's plan and usage, settings and the app's state. Reading is free; settings change only when the user allows it on the card Timewarp shows. Billing, plans, credits, connected apps, the vault and sign-ins are the user's to change in Settings: link them there, for example [Billing](<timewarp://customize/billing>).",
    tools: TOOLS.map(([name, description, properties, required]) => ({ type: "function", name, description, inputSchema: { type: "object", properties, required, additionalProperties: false } })),
  }];
}

// Token totals of turns ({ input, cached, output, reasoning }).
const sum = turns => turns.reduce((total, turn) => ({ turns: total.turns + 1, inputTokens: total.inputTokens + turn.input, cachedInputTokens: total.cachedInputTokens + turn.cached, outputTokens: total.outputTokens + turn.output }), { turns: 0, inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 });
const credits = value => Number.isFinite(Number(value)) ? Math.floor(Number(value) * 100) / 100 : null;

// usage(): { funding, planUsage, chatgpt } as the sidebar shows it.
// settings: { read(), write(key, value) } as Settings → General uses them.
// models: { choices(), choose(choices, wanted), select(choices) }.
// status(): the app's state. confirm(conversationId, card): the user's answer.
function createAppTools({ store, harness, userId, usage, settings, models, status, confirm, now = () => Date.now() }) {
  const text = value => ({ contentItems: [{ type: "inputText", text: typeof value === "string" ? value : JSON.stringify(value) }], success: true });
  const owner = () => { const value = userId(); if (!value) throw fail(401, "Sign in to Timewarp."); return value; };

  async function usageNow(conversationId) {
    const account = owner();
    const { funding, planUsage, chatgpt } = await usage();
    const result = { plan: funding.plan, aiPaidWith: funding.source === "chatgpt" ? "the user's ChatGPT plan" : "Timewarp credits" };
    if (funding.source === "chatgpt") {
      const windows = [["current window", chatgpt?.rateLimits?.primary], ["weekly window", chatgpt?.rateLimits?.secondary]]
        .filter(([, limit]) => limit && Number.isFinite(Number(limit.usedPercent)))
        .map(([name, limit]) => ({ window: name, percentLeft: Math.max(0, Math.round(100 - Number(limit.usedPercent))), ...(limit.resetsAt ? { resetsAt: new Date(Number(limit.resetsAt) * 1000).toISOString() } : {}) }));
      result.chatgpt = { plan: chatgpt?.account?.planType || null, connection: chatgpt?.status || null, windows };
    } else {
      result.credits = { left: credits(funding.timewarpCredits), unit: "credits" };
      if (planUsage) result.credits.monthly = { plan: planUsage.name, included: credits(planUsage.allowance), left: credits(planUsage.left), percentLeft: Math.round(Math.min(100, Math.max(0, planUsage.left / planUsage.allowance * 100))), resetsAt: planUsage.resetsAt };
      result.canRunAI = funding.canFundUsage !== false;
    }
    // Token use from this computer's records (what each turn reported).
    const since = new Date(now() - 7 * DAY).toISOString();
    const chats = store.conversations.list(account).filter(conversation => conversation.lastActivityAt >= since)
      .map(conversation => ({ conversation, turns: store.turnUsage.list(conversation.id).filter(turn => !turn.updatedAt || turn.updatedAt >= since) }))
      .filter(entry => entry.turns.length);
    const names = new Map(store.agents.list(account).map(agent => [agent.id, agent.name]));
    result.tokens = {
      thisChat: sum(store.turnUsage.list(conversationId)),
      last7Days: { chats: chats.length, ...sum(chats.flatMap(entry => entry.turns)) },
      busiestChats: chats.map(entry => ({ conversationId: entry.conversation.id, title: entry.conversation.title || "New conversation", agent: names.get(entry.conversation.agentId) || null, ...sum(entry.turns) }))
        .sort((a, b) => (b.inputTokens + b.outputTokens) - (a.inputTokens + a.outputTokens)).slice(0, 5),
      note: "Token counts are from this computer. Credits used per chat aren't recorded here; Billing shows the account's usage.",
    };
    return result;
  }

  async function settingsNow(conversationId) {
    owner();
    const value = settings.read();
    let choices = [], modelError = null;
    try { choices = await models.choices(); } catch (error) { modelError = error.message || "Models unavailable."; }
    const label = name => choices.find(choice => choice.id === name)?.displayName || name || null;
    const chat = conversationId ? store.conversations.get(conversationId) : null;
    return {
      theme: value.appearance?.scheme || "system",
      privacyMode: value.privacy?.mode === "private",
      memory: value.memory?.mode || "enabled",
      replyNotifications: value.notifications?.replies !== false,
      approvals: value.preferences?.approvals === "ask" ? "the user is asked for each request for extra access" : "an automatic reviewer decides requests for extra access",
      defaultModel: value.modelSettings ? { model: value.modelSettings.name, name: label(value.modelSettings.name), reasoningEffort: value.modelSettings.reasoningEffort || null, speed: value.modelSettings.serviceTier ? "Fast" : "Standard" } : null,
      thisChatModel: chat?.modelSettings?.name ? { model: chat.modelSettings.name, name: label(chat.modelSettings.name), reasoningEffort: chat.modelSettings.reasoningEffort || null } : null,
      models: choices.map(choice => ({ model: choice.id, name: choice.displayName, efforts: (choice.supportedReasoningEfforts || []).map(effort => effort.reasoningEffort) })),
      ...(modelError ? { modelsUnavailable: modelError } : {}),
    };
  }

  // The checked changes as the card lists them: [{ key, label, from, to, apply }].
  async function plan(input) {
    const current = settings.read(), changes = [];
    const add = (key, label, from, to, apply) => { if (from !== to) changes.push({ key, label, from, to, apply }); };
    if (input.theme !== undefined) {
      if (!THEMES.includes(input.theme)) throw fail(400, "theme is system, light or dark.");
      const appearance = current.appearance || {};
      add("theme", "Theme", THEME_LABELS[appearance.scheme || "system"], THEME_LABELS[input.theme], () => settings.write("appearance", { ...settings.read().appearance, scheme: input.theme }));
    }
    if (input.privacyMode !== undefined) {
      const on = input.privacyMode === true;
      add("privacyMode", "Privacy Mode", onOff(current.privacy?.mode === "private"), onOff(on), () => settings.write("privacy", { ...settings.read().privacy, mode: on ? "private" : "standard" }));
    }
    if (input.memory !== undefined) {
      if (!MEMORY_MODES[input.memory]) throw fail(400, "memory is enabled, read, write or none.");
      add("memory", "Memory", MEMORY_MODES[current.memory?.mode || "enabled"] || "Enabled", MEMORY_MODES[input.memory], () => settings.write("memory", { ...settings.read().memory, mode: input.memory }));
    }
    if (input.replyNotifications !== undefined) {
      const on = input.replyNotifications === true;
      add("replyNotifications", "Reply notifications", onOff(current.notifications?.replies !== false), onOff(on), () => settings.write("notifications", { ...settings.read().notifications, replies: on }));
    }
    if (input.defaultModel !== undefined || input.reasoningEffort !== undefined) {
      const choices = await models.choices();
      const was = current.modelSettings || {};
      const wanted = models.choose(choices, { name: input.defaultModel ?? was.name, reasoningEffort: input.reasoningEffort ?? (input.defaultModel ? undefined : was.reasoningEffort), serviceTier: input.defaultModel && input.defaultModel !== was.name ? undefined : was.serviceTier });
      const describe = value => value?.name ? [choices.find(choice => choice.id === value.name)?.displayName || value.name, value.reasoningEffort].filter(Boolean).join(", ") : "Not set";
      add("defaultModel", "Model for new chats", describe(was), describe(wanted), async () => { settings.write("modelSettings", wanted); await models.select(choices); });
    }
    return changes;
  }

  return {
    specs: toolSpecs,
    async call(conversationId, params, agent) {
      const input = params.arguments || {};
      switch (params.tool) {
        case "get_usage": return text(await usageNow(conversationId));
        case "get_settings": return text(await settingsNow(conversationId));
        case "get_status": owner(); return text(await status());
        case "change_settings": {
          owner();
          const reason = String(input.reason || "").replace(/\s+/g, " ").trim().slice(0, 300);
          if (!reason) throw fail(400, "Give a short reason for the user.");
          const changes = await plan(input);
          if (!changes.length) return text("Nothing to change: the settings are already like that.");
          const answer = await confirm(conversationId, {
            kind: "settings", title: changes.length === 1 ? `Change ${changes[0].label.toLowerCase()}?` : "Change these settings?",
            agent: agent?.name || "Your agent", reason, changes: changes.map(({ key, label, from, to }) => ({ key, label, from, to })),
          });
          if (answer.decision !== "accept") {
            const why = answer.decision === "timeout" ? "The user didn't answer the card in time" : answer.decision === "cancel" ? "The card was closed when this reply stopped" : "The user didn't allow it";
            return { contentItems: [{ type: "inputText", text: `${why}: nothing changed. Don't ask again unless the user brings it up.` }], success: false };
          }
          // The values are checked again: another window may have changed them meanwhile.
          const applied = [];
          for (const change of await plan(input)) { await change.apply(); applied.push(`${change.label}: ${change.from} → ${change.to}`); }
          harness?.discardSpares?.();
          return text(applied.length ? "The user allowed it. Changed:\n" + applied.join("\n") : "The user allowed it; the settings were already like that.");
        }
        default: throw fail(404, "Unknown app tool: " + params.tool);
      }
    },
  };
}

module.exports = { createAppTools, toolSpecs };
