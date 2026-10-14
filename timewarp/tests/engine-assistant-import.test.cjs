"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createAssistantImport, parseExport, scheduleOf, PROMPT } = require("../app/main/assistant-import.cjs");
const { createKnowledge } = require("../app/main/knowledge.cjs");
const { normalizeSchedule } = require("../app/main/automations.cjs");

const NOW = new Date(2026, 9, 14, 12, 0);
const REPLY = [
  "Here's everything I have saved about you:",
  "",
  "```markdown",
  "# Memory",
  "- Name is Sam; runs a small design studio in Malmö.",
  "- Prefers Figma and Notion.",
  "",
  "# Instructions",
  "Keep replies short. Use British spelling.",
  "Instructions: never use emoji.",
  "",
  "# Project: Studio website",
  "Help me rewrite the studio's website copy in a warm, plain tone.",
  "",
  "# Project: <name>",
  "Repeat this section for each one.",
  "",
  "# Scheduled task: Morning brief",
  "When: weekdays 08:00",
  "Task: Summarize design news and my calendar for today.",
  "",
  "# Scheduled task: Invoice reminder",
  "When: sometime early in the month",
  "Task: Remind me to send invoices.",
  "```",
  "",
  "That's the complete set.",
].join("\n");

function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tw-assistant-import-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const runtimeDir = path.join(root, "runtime"), codexHome = path.join(runtimeDir, "codex");
  fs.mkdirSync(codexHome, { recursive: true });
  const knowledge = createKnowledge({ runtimeDir, codexHome, home: path.join(root, "home"), env: {} });
  const agentList = [{ id: "main", name: "Orbit" }], automationList = [];
  const agents = { list: () => agentList, create: ({ name, instructions }) => { const agent = { id: "agent-" + agentList.length, name, instructions }; agentList.push(agent); return agent; } };
  // Automations get the schedule checks the real ones do.
  const automations = { list: () => automationList, create: input => { const automation = { id: "automation-" + automationList.length, ...input, schedule: normalizeSchedule(input.schedule, NOW) }; automationList.push(automation); return automation; } };
  return { knowledge, agentList, automationList, importer: createAssistantImport({ knowledge, agents, automations, clock: () => NOW }) };
}

test("a reply in the prompt's format becomes memory, instructions, projects and tasks", () => {
  const found = parseExport(REPLY, NOW);
  assert.equal(found.memory, "- Name is Sam; runs a small design studio in Malmö.\n- Prefers Figma and Notion.");
  assert.equal(found.instructions, "Keep replies short. Use British spelling.\nInstructions: never use emoji.");
  assert.deepEqual(found.projects, [{ name: "Studio website", instructions: "Help me rewrite the studio's website copy in a warm, plain tone." }]);
  assert.equal(found.tasks.length, 2);
  assert.deepEqual(found.tasks[0], { name: "Morning brief", when: "weekdays 08:00", schedule: { kind: "weekdays", time: "08:00" }, unclear: false, instructions: "Summarize design news and my calendar for today." });
  assert.equal(found.tasks[1].unclear, true);
  assert.equal(found.tasks[1].instructions, "Remind me to send invoices.");
});

test("text without the prompt's sections is kept as memory", () => {
  const found = parseExport("You like hiking.\nYou work in finance.", NOW);
  assert.equal(found.memory, "You like hiking.\nYou work in finance.");
  assert.deepEqual([found.instructions, found.projects, found.tasks], ["", [], []]);
});

test("headings assistants write differently are understood", () => {
  const found = parseExport([
    "**Saved memories:**", "- Lives in Oslo", "",
    "## Projects", "### Thesis", "Help with my master's thesis on fjords.", "",
    "## Scheduled tasks", "### Weekly review", "- **When:** every Friday at 4pm", "- **Task:** Ask what I finished this week.",
  ].join("\n"), NOW);
  assert.equal(found.memory, "- Lives in Oslo");
  assert.deepEqual(found.projects.map(project => project.name), ["Thesis"]);
  assert.deepEqual(found.tasks[0].schedule, { kind: "weekly", days: [5], time: "16:00" });
  assert.equal(found.tasks[0].instructions, "Ask what I finished this week.");
});

test("schedules are read from the prompt's forms and plain English", () => {
  const cases = {
    "daily 08:00": { kind: "daily", time: "08:00" },
    "every day at 7am": { kind: "daily", time: "07:00" },
    "weekdays 8:30": { kind: "weekdays", time: "08:30" },
    "Monday to Friday at 7:15 pm": { kind: "weekdays", time: "19:15" },
    "weekly mon,thu 08:00": { kind: "weekly", days: [1, 4], time: "08:00" },
    "every Tuesday and Thursday at 12pm": { kind: "weekly", days: [2, 4], time: "12:00" },
    "monthly 1 08:00": { kind: "monthly", day: 1, time: "08:00" },
    "monthly on the 15th at 9am": { kind: "monthly", day: 15, time: "09:00" },
    "monthly 09:00": { kind: "monthly", day: 1, time: "09:00" },
    "hourly :15": { kind: "hourly", minute: 15 },
    "every hour": { kind: "hourly", minute: 0 },
    "every 90 minutes": { kind: "interval", minutes: 90 },
    "every 2 hours": { kind: "interval", minutes: 120 },
    "once 2026-11-02 08:00": { kind: "once", at: new Date(2026, 10, 2, 8, 0).toISOString() },
  };
  for (const [when, schedule] of Object.entries(cases)) {
    assert.deepEqual(scheduleOf(when, NOW), schedule, when);
    normalizeSchedule(schedule, NOW);
  }
  for (const when of ["once 2026-01-02 08:00", "every 5 minutes", "weekly 08:00", "sometimes", "every morning", ""]) assert.equal(scheduleOf(when, NOW), null, when);
});

test("importing writes one notes block per assistant, agents for projects and automations turned off", t => {
  const { knowledge, agentList, automationList, importer } = setup(t);
  knowledge.saveNotes("# User\n\n_No long-term memory has been saved yet._\n\n<!-- timewarp:onboarding-name -->\nPreferred name: \"Sam\".\n<!-- /timewarp:onboarding-name -->");
  const preview = importer.preview(REPLY);
  assert.equal(preview.memory.items, 2);
  assert.deepEqual(preview.projects.map(project => [project.name, project.exists]), [["Studio website", false]]);
  assert.deepEqual(preview.tasks.map(task => [task.name, task.schedule, task.unclear]), [["Morning brief", "Weekdays at 08:00", false], ["Invoice reminder", "Daily at 09:00", true]]);

  const result = importer.apply({ source: "chatgpt", text: REPLY, projects: [0], tasks: [0, 1], agentId: "main" });
  assert.equal(result.notes, true);
  assert.deepEqual(result.agents.map(agent => agent.name), ["Studio website"]);
  assert.deepEqual(result.automations.map(automation => [automation.name, automation.unclear]), [["Morning brief", false], ["Invoice reminder", true]]);
  assert.equal(agentList[1].instructions, "Help me rewrite the studio's website copy in a warm, plain tone.");
  assert.ok(automationList.every(automation => automation.enabled === false && automation.agentId === "main"));
  assert.equal(automationList[1].schedule.time, "09:00");

  const notes = knowledge.read().notes;
  assert.ok(!notes.includes("No long-term memory"));
  assert.ok(notes.includes("<!-- timewarp:onboarding-name -->"));
  assert.match(notes, /<!-- setup-import:assistant:chatgpt -->\n## From ChatGPT \(imported 2026-10-1\d\)\n\n### Memory\n\n- Name is Sam/);
  assert.ok(notes.includes("### How I want replies\n\nKeep replies short."));

  // Again: the block is replaced, and what Timewarp has by name is skipped.
  const again = importer.apply({ source: "chatgpt", text: REPLY.replace("Prefers Figma", "Prefers Sketch"), projects: [0], tasks: [0] });
  assert.deepEqual(again.skipped, ["Studio website", "Morning brief"]);
  const updated = knowledge.read().notes;
  assert.equal(updated.match(/setup-import:assistant:chatgpt -->/g).length, 2);
  assert.ok(updated.includes("Prefers Sketch") && !updated.includes("Prefers Figma"));
  assert.equal(importer.preview(REPLY).projects[0].exists, true);
  assert.equal(knowledge.context("enabled").includes("Name is Sam"), true);
});

test("imports check their input", t => {
  const { importer } = setup(t);
  assert.throws(() => importer.apply({ source: "myspace", text: REPLY }), /Choose the assistant/);
  assert.throws(() => importer.preview("   "), /Paste the assistant's reply/);
  assert.throws(() => importer.preview("x".repeat(200_001)), /too long/);
  assert.match(PROMPT, /one code block/);
  assert.deepEqual(importer.prompt().sources.map(source => source.id), ["chatgpt", "claude", "gemini", "copilot", "cursor", "other"]);
});
