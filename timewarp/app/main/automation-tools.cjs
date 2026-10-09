"use strict";
// Automation tools for agents: schedule work for the agent itself, as the
// previous app's "Add automation" asked agents to do. Each automation runs in
// its own chat while Timewarp is open (see automations.cjs).
const fail = (status, message) => Object.assign(new Error(message), { status });

const schedule = {
  type: "object",
  description: "When it runs. kind: hourly (minute), daily or weekdays (time), weekly (days 0-6 with 0 = Sunday, and time), monthly (day 1-31 and time), interval (minutes, 15 to 10080) or once (at, an ISO date and time). time is 24-hour HH:MM in the user's local time.",
  properties: {
    kind: { type: "string", enum: ["hourly", "daily", "weekdays", "weekly", "monthly", "interval", "once"] },
    time: { type: "string" }, minute: { type: "integer" }, minutes: { type: "integer" }, day: { type: "integer" },
    days: { type: "array", items: { type: "integer" } }, at: { type: "string" },
  },
  required: ["kind"],
};
const id = { type: "string", description: "Automation id from the list tool." };
const TOOLS = [
  ["list", "List your automations with their schedules, whether they are on, and when they last and next run.", {}, []],
  ["create", "Create an automation for yourself. Each run sends the instructions to you in the automation's own chat. Schedules only: for something that should react to an event, such as a new email, check on an interval instead. Confirm the details with the user first.", {
    name: { type: "string", description: "Short name, for example Morning inbox summary." },
    instructions: { type: "string", description: "What to do on each run, written as a request to yourself." },
    schedule, enabled: { type: "boolean", description: "Defaults to true." },
  }, ["name", "instructions", "schedule"]],
  ["update", "Change an automation's name, instructions, schedule, or turn it on or off.", { id, name: { type: "string" }, instructions: { type: "string" }, schedule, enabled: { type: "boolean" } }, ["id"]],
  ["delete", "Delete an automation. Ask the user first.", { id }, ["id"]],
  ["run_now", "Run an automation once now, in its own chat.", { id }, ["id"]],
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
          const made = automations.create({ agentId: agent.id, name: input.name, instructions: input.instructions, schedule: input.schedule, enabled: input.enabled !== false });
          return text("Created:\n" + describe(made) + "\nThe user can see and change it in the Agent page of the chat's pane.");
        }
        case "update": {
          own(agent, input.id);
          const patch = Object.fromEntries(["name", "instructions", "schedule", "enabled"].filter(key => input[key] !== undefined).map(key => [key, input[key]]));
          return text("Updated:\n" + describe(automations.update(input.id, patch)));
        }
        case "delete": { own(agent, input.id); automations.remove(input.id); return text("Deleted."); }
        case "run_now": { own(agent, input.id); const record = await automations.runNow(input.id); return text(`Started a run (${record?.status || "running"}) in the automation's chat.`); }
        default: throw fail(404, "Unknown automation tool: " + params.tool);
      }
    },
  };
}

module.exports = { createAutomationTools, toolSpecs };
