"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { openStore } = require("../app/main/store.cjs");
const { importLegacyProfile } = require("../app/main/import-legacy.cjs");
const { createKnowledge, memoryMode } = require("../app/main/knowledge.cjs");
const shell = import("../app/renderer/src/shell.mjs");

const key = (value, extra = {}) => ({ key: value, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, target: { tagName: "BODY", isContentEditable: false }, ...extra });
const input = { tagName: "TEXTAREA", isContentEditable: false };

test("the previous app's shortcuts use Ctrl, or Cmd on macOS", async () => {
  const { shortcutFor } = await shell;
  const ctrl = value => key(value, { ctrlKey: true });
  assert.equal(shortcutFor(ctrl("k")), "search");
  assert.equal(shortcutFor(ctrl("K")), "search", "Caps lock doesn't matter");
  assert.equal(shortcutFor(ctrl("n")), "newTask");
  assert.equal(shortcutFor(ctrl("t")), "newTask");
  assert.equal(shortcutFor(ctrl("b")), "sidebar");
  assert.equal(shortcutFor(ctrl("j")), "pane");
  assert.equal(shortcutFor(ctrl("l")), "address");
  assert.equal(shortcutFor(ctrl(",")), "settings");
  assert.equal(shortcutFor(ctrl("[")), "back");
  assert.equal(shortcutFor(ctrl("]")), "forward");
  assert.equal(shortcutFor(ctrl("ArrowLeft")), "back");
  assert.equal(shortcutFor(key("ArrowRight", { altKey: true })), "forward");
  assert.equal(shortcutFor(key("ArrowLeft", { altKey: true })), "back");
  assert.equal(shortcutFor(key("k", { metaKey: true }), true), "search");
  assert.equal(shortcutFor(key("k", { metaKey: true })), null, "Cmd is for macOS");
  assert.equal(shortcutFor(ctrl("k"), true), null, "Ctrl isn't Cmd on macOS");
  assert.equal(shortcutFor(key("k")), null);
  assert.equal(shortcutFor(ctrl("f")), null, "Pages handle find themselves");
  assert.equal(shortcutFor(key("k", { ctrlKey: true, shiftKey: true })), null);
  assert.equal(shortcutFor(key("[", { ctrlKey: true, altKey: true })), null, "AltGr characters aren't shortcuts");
});

test("text fields keep their own keys for moving the cursor, but app shortcuts work there", async () => {
  const { shortcutFor } = await shell;
  assert.equal(shortcutFor(key("ArrowLeft", { ctrlKey: true, target: input })), null);
  assert.equal(shortcutFor(key("ArrowLeft", { altKey: true, target: input })), null);
  assert.equal(shortcutFor(key("[", { ctrlKey: true, target: { tagName: "DIV", isContentEditable: true } })), null);
  assert.equal(shortcutFor(key("k", { ctrlKey: true, target: input })), "search");
  assert.equal(shortcutFor(key("n", { ctrlKey: true, target: input })), "newTask");
  assert.equal(shortcutFor(key("b", { ctrlKey: true, target: input })), "sidebar");
});

test("a dragged agent lands after the one it is dropped on going down, before it going up", async () => {
  const { dropSide, moveId } = await shell;
  const ids = ["a", "b", "c", "d"];
  assert.deepEqual(moveId(ids, "a", "b"), ["b", "a", "c", "d"], "One place down");
  assert.deepEqual(moveId(ids, "a", "d"), ["b", "c", "d", "a"], "To the bottom");
  assert.deepEqual(moveId(ids, "b", "c"), ["a", "c", "b", "d"]);
  assert.deepEqual(moveId(ids, "d", "c"), ["a", "b", "d", "c"], "One place up");
  assert.deepEqual(moveId(ids, "d", "a"), ["d", "a", "b", "c"], "To the top");
  assert.deepEqual(moveId(ids, "b", "b"), ids);
  assert.deepEqual(moveId(ids, "x", "b"), ids);
  assert.equal(dropSide(ids, "a", "c"), "after");
  assert.equal(dropSide(ids, "c", "a"), "before");
});

test("Ctrl/Cmd+Alt+F sends feedback, as before", async () => {
  const { shortcutFor } = await shell;
  assert.equal(shortcutFor(key("f", { ctrlKey: true, altKey: true })), "feedback");
  assert.equal(shortcutFor(key("f", { metaKey: true, altKey: true }), true), "feedback");
  assert.equal(shortcutFor(key("ƒ", { ctrlKey: true, altKey: true })), null, "An AltGr character isn't the shortcut");
  assert.equal(shortcutFor(key("k", { ctrlKey: true, altKey: true })), null);
});

test("the activity feed puts unread and working chats under Priority, then days", async () => {
  const { activityGroups, dayLabel } = await shell;
  const now = new Date(2026, 9, 10, 15, 0);
  const at = (days, hour = 12) => new Date(2026, 9, 10 - days, hour).toISOString();
  const chats = [
    { id: "a", read: true, lastActivityAt: at(0, 9) },
    { id: "b", read: false, lastActivityAt: at(3) },
    { id: "c", read: true, lastActivityAt: at(1) },
    { id: "d", read: true, lastActivityAt: at(0, 14) },
    { id: "e", read: true, lastActivityAt: at(2) },
    { id: "f", read: true, lastActivityAt: at(40) },
    { id: "g", read: true, lastActivityAt: null },
  ];
  const groups = activityGroups(chats, { running: new Set(["e"]), now });
  assert.deepEqual(groups.map(group => [group.label, group.items.map(item => item.id)]), [
    ["Priority", ["e", "b"]], ["Today", ["d", "a"]], ["Yesterday", ["c"]], [dayLabel(at(40), now), ["f"]], ["Older", ["g"]],
  ]);
  assert.equal(dayLabel(at(3), now), new Date(at(3)).toLocaleDateString(undefined, { weekday: "long" }));
  assert.match(dayLabel(new Date(2025, 0, 2).toISOString(), now), /2025/);
  assert.deepEqual(activityGroups([chats[0]], { now }).map(group => group.label), ["Today"], "No Priority group when nothing is unread");
});

test("Show more reveals five more and always includes the open chat", async () => {
  const { shownCount } = await shell;
  const ids = Array.from({ length: 23 }, (_, index) => "c" + index);
  assert.equal(shownCount(ids, null), 5);
  assert.equal(shownCount(ids, "c3"), 5);
  assert.equal(shownCount(ids, "c5"), 10);
  assert.equal(shownCount(ids, "c12"), 15);
  assert.equal(shownCount(ids, "c2", 10), 10);
});

test("upcoming automations, durations, invitation addresses and sidebar widths", async () => {
  const { upcomingAutomations, durationText, splitEmails, sidebarWidth, sidebarCollapses } = await shell;
  const now = Date.parse("2026-10-10T12:00:00Z");
  const later = minutes => new Date(now + minutes * 60000).toISOString();
  const automations = [
    { id: "late", enabled: true, conversationId: "c1", nextRunAt: later(600) },
    { id: "soon", enabled: true, conversationId: "c1", nextRunAt: later(125) },
    { id: "off", enabled: false, conversationId: "c1", nextRunAt: later(5) },
    { id: "gone", enabled: true, conversationId: "archived", nextRunAt: later(6) },
    { id: "past", enabled: true, conversationId: "c1", nextRunAt: later(-6) },
    ...Array.from({ length: 6 }, (_, index) => ({ id: "n" + index, enabled: true, conversationId: "c1", nextRunAt: later(1000 + index) })),
  ];
  assert.deepEqual(upcomingAutomations(automations, [{ id: "c1" }], now).map(item => item.id), ["soon", "late", "n0", "n1", "n2"]);
  assert.equal(durationText(later(125), now), "2h 5m");
  assert.equal(durationText(later(0.5), now), "now");
  assert.equal(durationText(later(60 * 24 * 9 + 30), now), "1w 2d");
  assert.deepEqual(splitEmails("a@x.com, b@y.com\nc@z.com,,\n "), ["a@x.com", "b@y.com", "c@z.com"]);
  assert.equal(sidebarWidth(500), 360);
  assert.equal(sidebarWidth(100), 220);
  assert.equal(sidebarWidth("bad"), 288);
  assert.equal(sidebarWidth(null), 288);
  assert.equal(sidebarCollapses(109), true);
  assert.equal(sidebarCollapses(150), false);
});

test("the previous app's read-only and write-only memory modes are read and write", t => {
  assert.equal(memoryMode("read-only"), "read");
  assert.equal(memoryMode("write-only"), "write");
  assert.equal(memoryMode("disabled"), "none");
  assert.equal(memoryMode("none"), "none");
  assert.equal(memoryMode(undefined), "enabled");
  assert.equal(memoryMode("something"), "enabled");

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tw-shell-"));
  const runtimeDir = path.join(root, "runtime"), codexHome = path.join(runtimeDir, "codex");
  fs.mkdirSync(codexHome, { recursive: true });
  const store = openStore(path.join(root, "timewarp.sqlite"));
  t.after(() => { store.close(); fs.rmSync(root, { recursive: true, force: true }); });

  // An install that already imported the old value works too.
  const knowledge = createKnowledge({ runtimeDir, codexHome, home: path.join(root, "home"), env: {} });
  knowledge.saveNotes("Prefers metric units.");
  // The notes reach each message (knowledge.context), not the thread's instructions.
  assert.match(knowledge.instructions("read-only"), /don't change those files/);
  assert.match(knowledge.context("read-only"), /metric/);
  assert.match(knowledge.instructions("write-only"), /Don't read the file/);
  assert.doesNotMatch(knowledge.instructions("write-only"), /metric/);

  fs.writeFileSync(path.join(runtimeDir, "settings.json"), JSON.stringify({ memory: { mode: "write-only" } }));
  importLegacyProfile({ store, runtimeDir });
  assert.deepEqual(store.settings.get("memory"), { mode: "write" });
});
