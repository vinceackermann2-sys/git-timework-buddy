"use strict";
// The composer's @ and $ references and large pastes (mentions.mjs).
const test = require("node:test");
const assert = require("node:assert/strict");
const mentions = import("../app/renderer/src/mentions.mjs");

const file = { type: "file", name: "report.pdf", path: "docs/report.pdf", contentType: "application/pdf" };
const skill = { type: "skill", name: "pdf", path: "C:\\Users\\me\\.codex\\skills\\pdf\\SKILL.md" };
const person = { type: "person", userId: "user-2", name: "Ada Lovelace", email: "ada@example.com", imageUrl: null };

test("@ and $ open the menu at the start or after a space, with what was typed after them", async () => {
  const { mentionQuery } = await mentions;
  assert.deepEqual(mentionQuery("Read @rep", 9), { trigger: "@", query: "rep", from: 5, to: 9 });
  assert.deepEqual(mentionQuery("$pd", 3), { trigger: "$", query: "pd", from: 0, to: 3 });
  assert.deepEqual(mentionQuery("Hi @", 4), { trigger: "@", query: "", from: 3, to: 4 });
  assert.equal(mentionQuery("mail me@example.com", 19), null, "Not inside a word");
  assert.equal(mentionQuery("Read @rep now", 13), null, "Not once a space follows");
  assert.deepEqual(mentionQuery("Read @rep now", 9), { trigger: "@", query: "rep", from: 5, to: 9 }, "The caret decides");
});

test("a choice replaces what was typed with its token, and only tokens still in the text count", async () => {
  const { insertMention, presentMentions, removeMention, addMention } = await mentions;
  const picked = insertMention("Read @rep please", { from: 5, to: 9 }, file);
  assert.deepEqual(picked, { text: "Read @report.pdf please", caret: 17 }, "After the space that follows");
  assert.equal(insertMention("Use $p", { from: 4, to: 6 }, skill).text, "Use $pdf ");
  const list = addMention(addMention([], file), { ...file });
  assert.equal(list.length, 1, "The same file once");
  assert.deepEqual(presentMentions(picked.text, [file, skill]), [file]);
  assert.deepEqual(presentMentions("Read @report.pdfs", [file]), [], "A longer word isn't the token");
  assert.equal(removeMention(picked.text, file), "Read please");
});

test("a message carries files and people as <ref>s and skills as $name with the skill attached", async () => {
  const { composeMessage, skillChips } = await mentions;
  const typed = "Ask @Ada Lovelace to check @report.pdf with $pdf";
  const { text, skills } = composeMessage(typed, [file, skill, person], [{ id: "c1", text: "line 1\nline 2" }]);
  assert.equal(text, 'Ask <ref type="person" user-id="user-2" name="Ada Lovelace" email="ada@example.com"></ref> to check <ref type="file" name="report.pdf" path="docs/report.pdf" content-type="application/pdf"></ref> with $pdf\n\nline 1\nline 2');
  assert.deepEqual(skills, [{ name: "pdf", path: skill.path }]);
  // Removed from the text: not sent.
  assert.deepEqual(composeMessage("Just text", [file, skill]), { text: "Just text", skills: [] });
  // Shown in the chat: the skill's token as its chip.
  assert.equal(skillChips("Use $pdf here", [{ name: "pdf", path: "C:\\s\\SKILL.md" }]), 'Use <ref type="skill" name="pdf" path="C:\\s\\SKILL.md"></ref> here');
  // Attribute values are escaped.
  assert.match(composeMessage('@a"b.md', [{ type: "file", name: 'a"b.md', path: 'x/a"b.md', contentType: "text/markdown" }]).text, /name="a&quot;b\.md"/);
});

test("suggestions: $ lists skills, @ lists people, skills and (once typed) files, at most 8 each", async () => {
  const { mentionGroups } = await mentions;
  const skills = Array.from({ length: 10 }, (_value, index) => ({ name: "skill-" + index, path: `/s/${index}/SKILL.md`, description: "Does " + index }));
  const members = [{ userId: "user-2", name: "Ada Lovelace", email: "ada@example.com" }, { userId: "user-3", name: "", email: "grace@example.com" }];
  const files = [{ name: "report.pdf", path: "docs/report.pdf", type: "file" }, { name: "docs", path: "docs", type: "dir" }];
  const dollar = mentionGroups({ trigger: "$", query: "", skills, files, members });
  assert.deepEqual(dollar.map(group => [group.label, group.items.length]), [["Skills", 8]]);
  const empty = mentionGroups({ trigger: "@", query: "", skills, files, members });
  assert.deepEqual(empty.map(group => group.label), ["People", "Skills", "Files"]);
  assert.equal(empty.find(group => group.id === "files").items.length, 0, "Files wait for a query");
  assert.equal(empty[0].items[1].title, "grace@example.com", "A person without a name shows the address");
  const typed = mentionGroups({ trigger: "@", query: "rep", skills, files, members });
  assert.deepEqual(typed.map(group => group.label), ["Files"], "Groups without matches are left out, except Files");
  assert.deepEqual(typed[0].items[0].reference, { type: "file", name: "report.pdf", path: "docs/report.pdf", contentType: "application/pdf" });
  assert.equal(mentionGroups({ trigger: "@", query: "ada", skills, files, members })[0].items[0].reference.email, "ada@example.com");
});

test("a paste of more than 10 lines or 1,000 characters becomes a Clipboard chip", async () => {
  const { largePaste, clipboardLabel, lineCount } = await mentions;
  assert.equal(lineCount("a\nb\n"), 2);
  assert.equal(largePaste("a\n".repeat(10)), false);
  assert.equal(largePaste("a\n".repeat(11)), true);
  assert.equal(largePaste("x".repeat(1001)), true);
  assert.equal(clipboardLabel("a\n".repeat(12)), "Clipboard (12 lines)");
  assert.equal(clipboardLabel("x".repeat(1200)), "Clipboard (1 line)");
});
