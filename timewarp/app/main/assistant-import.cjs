"use strict";
// What an assistant that keeps everything online (ChatGPT, Claude, Gemini and
// the like) knows about the user, for people with nothing on this computer to
// import. The user asks that assistant with PROMPT and pastes its reply here:
// memory and instructions go into the notes as one block per assistant
// (replaced when imported again), projects become agents, and scheduled tasks
// become automations, turned off so they don't run twice.
const fail = (status, message) => Object.assign(new Error(message), { status });
const TEXT_LIMIT = 200_000, NOTES_BLOCK = 30_000, MAX_ITEMS = 30, AGENT_NAME = 60, AUTOMATION_NAME = 80, INSTRUCTIONS = 20_000;
const SOURCES = { chatgpt: "ChatGPT", claude: "Claude", gemini: "Gemini", copilot: "Copilot", cursor: "Cursor", other: "another assistant" };
// Where each assistant is used on the web; Cursor is asked in its own chat.
// The prompt is copied for the user to paste there: in the address it would
// be too long for some browsers to open.
const SITES = { chatgpt: "https://chatgpt.com/", claude: "https://claude.ai/new", gemini: "https://gemini.google.com/app", copilot: "https://copilot.microsoft.com/" };

const PROMPT = `I'm moving to a new assistant, Timewarp, and want to bring along what you know about me. Write it all out in one code block, in exactly this format:

# Memory
- Everything you have saved or remembered about me, one item per line, in my own words where you can: my name, work, location, people, interests, goals, the tools I use, and what you've learned from our past chats.

# Instructions
How I want you to respond: my custom instructions and rules, tone, format and language, and anything I've asked you to always or never do.

# Project: <name>
The instructions and key context of one project, custom GPT, Gem or space I set up with you. Repeat this section for each one.

# Scheduled task: <name>
When: daily 08:00 | weekdays 08:00 | weekly mon,thu 08:00 | monthly 1 08:00 | hourly :15 | every 90 minutes | once 2026-11-02 08:00
Task: What you do each time it runs.
Repeat this section for each scheduled task or reminder.

Rules:
- Include only what you actually have. Don't guess, and leave out a section you have nothing for.
- Don't summarize or merge entries.
- Times use a 24-hour clock in my time zone.
- Leave out passwords, API keys, payment details and other secrets.`;

// "# Memory", "## Project: Launch", "**Scheduled task: Brief**" and the same
// without the markdown, as assistants vary it. Without the markdown, only a
// bare "Memory" or a "Project: <name>" line is a heading, so a line such as
// "Instructions: be brief" stays text. A bare "Projects" or "Scheduled tasks"
// heading starts a list whose items are the headings under it.
const HEADING = /^\s*(#{1,6}\s*|\*\*)?\s*(memory|memories|saved memories|instructions|custom instructions|projects?|scheduled tasks?)\s*(?::\s*(.*?))?\s*(?:\*\*)?\s*:?\s*$/i;
const MARKED = /^\s*(?:#{1,6}|\*\*)/;
const SUBHEADING = /^\s*(?:#{1,6}\s+(.+?)|\*\*(.+?)\*\*:?)\s*$/;
const KINDS = { memory: "memory", memories: "memory", "saved memories": "memory", instructions: "instructions", "custom instructions": "instructions", project: "project", projects: "project", "scheduled task": "task", "scheduled tasks": "task" };
const DAYS = [/\bsun(?:day)?s?\b/, /\bmon(?:day)?s?\b/, /\btue(?:s|sday)?s?\b/, /\bwed(?:nesday)?s?\b/, /\bthu(?:r|rs|rsday)?s?\b/, /\bfri(?:day)?s?\b/, /\bsat(?:urday)?s?\b/];
const pad = value => String(value).padStart(2, "0");
const clean = value => String(value || "").replace(/\*\*/g, "").replace(/\s+/g, " ").trim();
const placeholder = name => !name || /^<.*>$/.test(name);
const body = lines => lines.join("\n").replace(/^\s*\n+|\s+$/g, "");

// The reply's code block when there is one with a section in it (the reply
// may have been copied whole), else all of it.
function exported(text) {
  const blocks = [...String(text).matchAll(/```[^\n]*\n([\s\S]*?)(?:```|$)/g)].map(match => match[1]).filter(block => block.split("\n").some(line => MARKED.test(line) && HEADING.test(line)));
  return blocks.length ? blocks.sort((a, b) => b.length - a.length)[0] : String(text).replace(/^\s*```.*$/gm, "");
}

// A time in a schedule, as "HH:MM": 08:00, 8:00 pm, 8pm.
function timeOf(text) {
  let match = /\b(\d{1,2}):(\d{2})\s*([ap])?\.?m?\.?(?![\w])/i.exec(text) || /\b(\d{1,2})\s*([ap])\.?m\.?(?![\w])/i.exec(text);
  if (!match) return null;
  const minute = match.length === 4 ? Number(match[2]) : 0, half = (match.length === 4 ? match[3] : match[2])?.toLowerCase();
  let hour = Number(match[1]);
  if (half) { if (hour < 1 || hour > 12) return null; hour = hour % 12 + (half === "p" ? 12 : 0); }
  return hour <= 23 && minute <= 59 ? pad(hour) + ":" + pad(minute) : null;
}

// A schedule (automations.cjs) from the "When:" line PROMPT asks for, or the
// plain English assistants sometimes write instead. Null when it isn't clear.
function scheduleOf(when, now = new Date()) {
  const text = clean(when).toLowerCase();
  if (!text) return null;
  const time = timeOf(text);
  let match;
  if (/\bonce\b/.test(text) || /^(?:on\s+)?\d{4}-\d{2}-\d{2}/.test(text)) {
    match = /(\d{4})-(\d{2})-(\d{2})/.exec(text);
    if (!match) return null;
    const [hour, minute] = (time || "09:00").split(":").map(Number), at = new Date(+match[1], +match[2] - 1, +match[3], hour, minute);
    return at.getMonth() === +match[2] - 1 && at > now ? { kind: "once", at: at.toISOString() } : null;
  }
  if ((match = /\bevery\s+(\d+)\s*(minutes?|mins?|m|hours?|hrs?|h)\b/.exec(text))) {
    const minutes = Number(match[1]) * (match[2].startsWith("h") ? 60 : 1);
    return minutes >= 15 && minutes <= 10080 ? { kind: "interval", minutes } : null;
  }
  if (/\bhourly\b|\bevery hour\b/.test(text)) {
    const minute = /:(\d{2})\b/.exec(text);
    return { kind: "hourly", minute: minute ? Math.min(59, Number(minute[1])) : 0 };
  }
  if (!time) return null;
  if (/\bweekdays?\b|\bmon(?:day)?\s*(?:-|–|to|through)\s*fri(?:day)?\b/.test(text)) return { kind: "weekdays", time };
  if (/\bmonthly\b|\bevery month\b|\beach month\b/.test(text)) {
    match = /\b(\d{1,2})(?:st|nd|rd|th)?\b(?!\s*[:.]\d)(?!\s*[ap]\.?m)/.exec(text.replace(/\b\d{1,2}:\d{2}\b/g, ""));
    const day = match ? Number(match[1]) : 1;
    return day >= 1 && day <= 31 ? { kind: "monthly", day, time } : null;
  }
  const days = DAYS.map((day, index) => day.test(text) ? index : -1).filter(day => day >= 0);
  if (/\b(?:daily|every day|each day|every morning|every evening|every night)\b/.test(text) || days.length === 7) return { kind: "daily", time };
  if (days.length) return { kind: "weekly", days, time };
  return null;
}

function describeSchedule(schedule) {
  if (schedule.kind === "once") return "Once on " + new Date(schedule.at).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", hourCycle: "h23" });
  if (schedule.kind === "interval") return schedule.minutes % 60 ? `Every ${schedule.minutes} minutes` : `Every ${schedule.minutes / 60} hour${schedule.minutes === 60 ? "" : "s"}`;
  if (schedule.kind === "hourly") return `Every hour at :${pad(schedule.minute)}`;
  if (schedule.kind === "daily") return `Daily at ${schedule.time}`;
  if (schedule.kind === "weekdays") return `Weekdays at ${schedule.time}`;
  if (schedule.kind === "monthly") return `Monthly on day ${schedule.day} at ${schedule.time}`;
  const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return `${schedule.days.map(day => names[day]).join(", ")} at ${schedule.time}`;
}

// The reply in parts. Text without any of PROMPT's sections is all memory.
function parseExport(text, now = new Date()) {
  const lines = exported(text).replace(/\r\n?/g, "\n").split("\n");
  const sections = [];
  let current = null, list = null, preamble = [];
  for (const line of lines) {
    const heading = HEADING.exec(line), kind = heading && KINDS[heading[2].toLowerCase()], name = heading ? clean(heading[3]) : "";
    if (heading && (heading[1] || !name || kind === "project" || kind === "task")) {
      list = kind === "project" || kind === "task" ? kind : null;
      // "# Instructions: be brief": the text after the heading is the section's first line.
      current = list && !name ? null : { kind, name: list ? name : "", lines: list || !name ? [] : [name] };
      if (current) sections.push(current);
      continue;
    }
    const sub = list && SUBHEADING.exec(line);
    if (sub) { current = { kind: list, name: clean(sub[1] || sub[2]), lines: [] }; sections.push(current); continue; }
    if (current) current.lines.push(line); else if (!sections.length) preamble.push(line);
  }
  if (!sections.length) sections.push({ kind: "memory", name: "", lines: preamble });
  const join = kind => sections.filter(section => section.kind === kind).map(section => body(section.lines)).filter(Boolean).join("\n\n");
  const memory = join("memory"), instructions = join("instructions");
  const projects = sections.filter(section => section.kind === "project" && !placeholder(section.name))
    .map(section => ({ name: section.name.slice(0, AGENT_NAME), instructions: body(section.lines).slice(0, INSTRUCTIONS) })).slice(0, MAX_ITEMS);
  const tasks = sections.filter(section => section.kind === "task" && !placeholder(section.name)).map(section => {
    let when = "", task = null;
    const rest = [];
    for (const line of section.lines) {
      const field = /^\s*[-*]?\s*(?:\*\*)?(when|schedule|task|prompt|instructions)(?:\*\*)?\s*:\s*(?:\*\*)?\s*(.*)$/i.exec(line);
      if (field && /^(when|schedule)$/i.test(field[1]) && !when) when = clean(field[2]);
      else if (field && task === null) task = [field[2]];
      else (task || rest).push(line);
    }
    const schedule = scheduleOf(when, now);
    return { name: section.name.slice(0, AUTOMATION_NAME), when, schedule, unclear: !schedule, instructions: body(task || rest).slice(0, INSTRUCTIONS) };
  }).filter(task => task.instructions).slice(0, MAX_ITEMS);
  return { memory, instructions, projects, tasks };
}

// The notes block for one assistant's memory and instructions.
function notesBlock(label, { memory, instructions }, now = new Date()) {
  const parts = [`## From ${label} (imported ${now.toISOString().slice(0, 10)})`];
  if (memory) parts.push("### Memory", memory);
  if (instructions) parts.push("### How I want replies", instructions);
  // Comment markers would end Timewarp's block in the notes early.
  const text = parts.join("\n\n").replace(/<!--|-->/g, "");
  return text.length > NOTES_BLOCK ? text.slice(0, NOTES_BLOCK) + "\n…" : text;
}

function createAssistantImport({ knowledge, agents, automations, clock = () => new Date() }) {
  const source = value => { if (!SOURCES[value]) throw fail(400, "Choose the assistant you're importing from."); return value; };
  const read = text => {
    if (typeof text !== "string" || !text.trim()) throw fail(400, "Paste the assistant's reply first.");
    if (text.length > TEXT_LIMIT) throw fail(413, "That reply is too long. Paste only the code block.");
    return parseExport(text, clock());
  };
  const taken = (list, key) => new Set(list.map(item => String(item[key] || "").trim().toLowerCase()));
  return {
    prompt: () => ({ text: PROMPT, sources: Object.entries(SOURCES).map(([id, label]) => ({ id, label, url: SITES[id] || null })) }),
    // What a reply holds, for the user to choose from before anything is saved.
    preview(text) {
      const found = read(text), agentNames = taken(agents.list(), "name"), automationNames = taken(automations.list(), "name");
      return {
        memory: found.memory ? { items: found.memory.split("\n").filter(line => line.trim()).length, text: found.memory.slice(0, 4000) } : null,
        instructions: found.instructions ? { text: found.instructions.slice(0, 2000) } : null,
        projects: found.projects.map((project, index) => ({ index, name: project.name, summary: project.instructions.slice(0, 300), exists: agentNames.has(project.name.toLowerCase()) })),
        tasks: found.tasks.map((task, index) => ({ index, name: task.name, when: task.when, schedule: describeSchedule(task.schedule || { kind: "daily", time: "09:00" }), unclear: task.unclear, summary: task.instructions.slice(0, 300), exists: automationNames.has(task.name.toLowerCase()) })),
      };
    },
    // Saves what the user kept. Projects and tasks are chosen by their index in
    // preview(); ones Timewarp already has by name are skipped. Tasks run with
    // agentId, else the first agent; a task whose time wasn't clear runs daily
    // at 09:00 until the user changes it.
    apply({ source: from, text, memory = true, projects = [], tasks = [], agentId = null } = {}) {
      const id = source(from), found = read(text), now = clock();
      const pick = (list, chosen) => [...new Set(Array.isArray(chosen) ? chosen : [])].filter(index => Number.isInteger(index) && list[index]).map(index => list[index]);
      const result = { notes: false, agents: [], automations: [], skipped: [] };
      if (memory && (found.memory || found.instructions)) { knowledge.saveNotesBlock("assistant:" + id, notesBlock(SOURCES[id], found, now)); result.notes = true; }
      const agentNames = taken(agents.list(), "name");
      for (const project of pick(found.projects, projects)) {
        if (agentNames.has(project.name.toLowerCase())) { result.skipped.push(project.name); continue; }
        const agent = agents.create({ name: project.name, instructions: project.instructions });
        agentNames.add(project.name.toLowerCase());
        result.agents.push({ id: agent.id, name: agent.name });
      }
      const chosen = pick(found.tasks, tasks);
      if (chosen.length) {
        const owner = (agentId && agents.list().find(agent => agent.id === agentId)) || agents.list()[0];
        if (!owner) throw fail(409, "Create an agent first, then import scheduled tasks.");
        const automationNames = taken(automations.list(), "name");
        for (const task of chosen) {
          if (automationNames.has(task.name.toLowerCase())) { result.skipped.push(task.name); continue; }
          const automation = automations.create({ name: task.name, instructions: task.instructions, agentId: owner.id, schedule: task.schedule || { kind: "daily", time: "09:00" }, enabled: false });
          automationNames.add(task.name.toLowerCase());
          result.automations.push({ id: automation.id, name: automation.name, unclear: task.unclear });
        }
      }
      return result;
    },
  };
}

module.exports = { createAssistantImport, parseExport, scheduleOf, describeSchedule, PROMPT, SOURCES };
