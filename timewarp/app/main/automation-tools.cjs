"use strict";
// Automation tools for agents: schedule work for the agent itself, as the
// previous app's "Add automation" asked agents to do. An automation an agent
// creates runs in the chat it was asked in, while Timewarp is open (see automations.cjs).
const fail = (status, message) => Object.assign(new Error(message), { status });

const schedule = {
  type: "object",
  description: "When it runs. kind: hourly (minute), daily or weekdays (time), weekly (days 0-6 with 0 = Sunday, and time), monthly (day 1-31 and time; a short month uses its last day), interval (minutes, 15 to 10080) or once (at, an ISO date and time). time is 24-hour HH:MM in tz. Optional: tz (IANA time zone, defaults to this computer's), until (last date YYYY-MM-DD, or an ISO date and time), count (stop after this many runs, 1 to 1000). For a temporary check, set until or count to how long the result stays useful.",
  properties: {
    kind: { type: "string", enum: ["hourly", "daily", "weekdays", "weekly", "monthly", "interval", "once"] },
    time: { type: "string" }, minute: { type: "integer" }, minutes: { type: "integer" }, day: { type: "integer" },
    days: { type: "array", items: { type: "integer" } }, at: { type: "string" },
    tz: { type: "string" }, until: { type: "string", description: "Empty to remove." }, count: { type: "integer", description: "0 to remove." },
  },
  required: ["kind"],
};
const id = { type: "string", description: "Automation id from the list tool." };
const TOOLS = [
  ["list", "List your automations with their schedules, whether they are on, and when they last and next run.", {}, []],
  ["create", "Create an automation for this chat: each run sends its instructions to you here, and you reply here. Schedules only: for something that should react to an event, such as a new email, check on an interval instead.", {
    name: { type: "string", description: "Short name, for example Morning inbox summary." },
    instructions: { type: "string", description: "What to do on each run, written as a request to yourself. Say when the user wants to hear back, for example only when something changes." },
    schedule, enabled: { type: "boolean", description: "Defaults to true." },
  }, ["name", "instructions", "schedule"]],
  ["update", "Change an automation's name, instructions, schedule, or turn it on or off.", { id, name: { type: "string" }, instructions: { type: "string" }, schedule, enabled: { type: "boolean" } }, ["id"]],
  ["delete", "Delete an automation and stop its runs.", { id }, ["id"]],
  ["run_now", "Run an automation once now, in its chat. If that chat is replying, the run starts when the reply ends.", { id }, ["id"]],
  ["nothing_to_report", "Use during a scheduled run when it found nothing the user needs to know: the chat isn't marked unread and no notification is shown. End with one short line after calling it.", {}, []],
];

function toolSpecs() {
  return [{
    type: "namespace", name: "timewarp_automations",
    description: "Scheduled work for you (this agent) in Timewarp. Automations run while Timewarp is open; a run missed while it was closed happens once when it opens.",
    tools: TOOLS.map(([name, description, properties, required]) => ({ type: "function", name, description, inputSchema: { type: "object", properties, required, additionalProperties: false } })),
  }];
}

const when = value => value ? new Date(value).toLocaleString() : "—";
const describe = item => `${item.id} | ${item.name} | ${item.enabled ? "on" : "off"} | ${JSON.stringify(item.schedule)} | last ${when(item.lastRunAt)} | next ${when(item.nextRunAt)}\n  ${item.instructions.replace(/\s+/g, " ").slice(0, 300)}`;

function createAutomationTools({ automations }) {
  const text = value => ({ contentItems: [{ type: "inputText", text: String(value) }], success: true });
  // An agent sees and changes only its own automations.
  const own = (agent, automationId) => {
    const item = automations.get(String(automationId || ""));
    if (item.agentId !== agent?.id) throw fail(404, "That automation belongs to another agent.");
    return item;
  };
  return {
    specs: toolSpecs,
    async call(conversationId, params, agent) {
      const input = params.arguments || {};
      if (!agent?.id) throw fail(400, "No agent for this chat.");
      switch (params.tool) {
        case "list": {
          const mine = automations.list().filter(item => item.agentId === agent.id);
          return text(mine.length ? mine.map(describe).join("\n") : "You have no automations.");
        }
        case "create": {
          const made = automations.create({ agentId: agent.id, conversationId, name: input.name, instructions: input.instructions, schedule: input.schedule, enabled: input.enabled !== false });
          const where = made.conversationId === conversationId ? "Its runs post in this chat." : "Its runs post in its own chat.";
          return text("Created:\n" + describe(made) + "\n" + where + " The user can see and change it in the Agent page of the chat's pane.");
        }
        case "update": {
          own(agent, input.id);
          const patch = Object.fromEntries(["name", "instructions", "schedule", "enabled"].filter(key => input[key] !== undefined).map(key => [key, input[key]]));
          return text("Updated:\n" + describe(automations.update(input.id, patch)));
        }
        case "delete": { own(agent, input.id); automations.remove(input.id); return text("Deleted."); }
        case "run_now": {
          own(agent, input.id);
          const record = await automations.runNow(input.id);
          if (record?.status === "queued") return text("That chat is replying (perhaps this reply); the run starts when the reply ends.");
          return text(record?.status === "failed" ? "The run didn't start: " + (record.error || "unknown error") : "Started a run in the automation's chat.");
        }
        case "nothing_to_report":
          return text(automations.quiet(conversationId)
            ? "Noted: this run won't mark the chat unread or notify the user. End with one short line."
            : "This turn isn't a scheduled run, so reply to the user as usual.");
        default: throw fail(404, "Unknown automation tool: " + params.tool);
      }
    },
  };
}

module.exports = { createAutomationTools, toolSpecs };
