"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const cards = import("../app/renderer/src/cards.mjs");
const { WIDGETS } = require("../app/main/widget-instructions.cjs");

const placeholders = markdown => [...markdown.matchAll(/\uE000(\d+)\uE001/g)].map(match => Number(match[1]));

test("cards are taken out of the Markdown and replaced by placeholders", async () => {
  const { parseCards } = await cards;
  const text = 'I wrote the report.\n\n<file label="Launch report" path="C:\\Users\\me\\report.docx" action="created" />\n\nApprove it? <button label="Approve" prompt="I approve publishing the report." />';
  const { markdown, cards: list } = parseCards(text);
  assert.deepEqual(placeholders(markdown), [0, 1]);
  assert.match(markdown, /^I wrote the report\.\n\n\uE0000\uE001\n\nApprove it\? \uE0001\uE001$/);
  assert.equal(list[0].tag, "file");
  assert.equal(list[0].block, true);
  assert.deepEqual(list[0].attrs, { label: "Launch report", path: "C:\\Users\\me\\report.docx", action: "created" });
  assert.equal(list[1].tag, "button");
  assert.equal(list[1].block, false);
  assert.equal(list[1].attrs.prompt, "I approve publishing the report.");
});

test("tags in code blocks and code spans stay text", async () => {
  const { parseCards } = await cards;
  const text = 'Use `<file path="a.md" />` like this:\n\n```xml\n<select name="x">\n<option>A</option>\n</select>\n```\n\n~~~\n<button label="B" prompt="b" />\n~~~\n\\<file path="escaped.md" />';
  const { markdown, cards: list } = parseCards(text);
  assert.equal(list.length, 0);
  assert.equal(markdown, text);
});

test("selects, conversations, tabs and suggested tasks keep their parts", async () => {
  const { parseCards } = await cards;
  const { cards: list } = parseCards([
    '<select name="focus" multiple>',
    "  <option>Pricing &amp; plans</option>",
    '  <option value="comp">Competitors</option>',
    "  <option>Pricing &amp; plans</option>",
    "</select>",
    "",
    '<conversation mode="email" title="Re: Timeline" url="https://mail.example.com/t/1">',
    '  <message sender="Avery" from="avery@example.com" to="me@example.com" date="10:42 AM">',
    "    Can you send the timeline?",
    "",
    "    Thanks",
    "  </message>",
    '  <message-input from="me@example.com" to="avery@example.com; sam@example.com">',
    "    I'll send it this afternoon.",
    "  </message-input>",
    "</conversation>",
    "",
    "<tabs>",
    '  <tab label="Short"><message-input>Short one</message-input></tab>',
    '  <tab label="Detailed">**Longer** one</tab>',
    "</tabs>",
    "",
    "<widget-suggested-tasks>",
    '{"title":"Review feedback","description":"Review recent feedback and summarize it.","websites":["https://mail.google.com","javascript:alert(1)"]}',
    "not json",
    "</widget-suggested-tasks>",
  ].join("\n"));
  assert.deepEqual(list.map(item => item.tag), ["select", "conversation", "tabs", "suggested-tasks"]);
  assert.equal(list[0].attrs.multiple, "");
  assert.deepEqual(list[0].options, [{ label: "Pricing & plans", value: "Pricing & plans" }, { label: "Competitors", value: "comp" }]);
  assert.equal(list[1].attrs.mode, "email");
  assert.deepEqual(list[1].items.map(item => item.tag), ["message", "message-input"]);
  assert.equal(list[1].items[0].body, "Can you send the timeline?\n\nThanks");
  assert.equal(list[1].items[1].attrs.to, "avery@example.com; sam@example.com");
  assert.deepEqual(list[2].tabs.map(tab => tab.label), ["Short", "Detailed"]);
  assert.equal(list[2].tabs[0].body, "<message-input>Short one</message-input>");
  assert.deepEqual(list[3].tasks, [{ title: "Review feedback", description: "Review recent feedback and summarize it.", websites: ["https://mail.google.com"] }]);
});

test("each card is numbered among its kind, and aliases use the same names", async () => {
  const { parseCards } = await cards;
  const { cards: list } = parseCards('<widget-file path="a.md"/> <button label="A" prompt="a"/> <file path="b.md"></file> <button label="B" prompt="b"/> <widget-connector plugin-id="gmail" />');
  assert.deepEqual(list.map(item => `${item.tag}:${item.ordinal}`), ["file:0", "button:0", "file:1", "button:1", "connect-plugin:0"]);
});

test("streaming hides a card that hasn't finished arriving; finished text keeps an unclosed one as text", async () => {
  const { parseCards } = await cards;
  assert.equal(parseCards('Pick one:\n\n<select name="x">\n<option>A</option>', { streaming: true }).markdown, "Pick one:\n\n");
  assert.equal(parseCards("Pick one:\n\n<sel", { streaming: true }).markdown, "Pick one:\n\n");
  assert.equal(parseCards('Saved <file path="C:\\a', { streaming: true }).markdown, "Saved ");
  assert.equal(parseCards("a < b and 2<3", { streaming: true }).markdown, "a < b and 2<3");
  const done = parseCards('Pick one:\n\n<select name="x">\n<option>A</option>');
  assert.equal(done.cards.length, 0);
  assert.equal(done.markdown, 'Pick one:\n\n<select name="x">\n<option>A</option>');
  // A card without content needs no closing tag.
  assert.equal(parseCards('<file path="a.md" action="updated">', { streaming: true }).cards[0].attrs.action, "updated");
});

test("attributes: quotes, entities, bare names and '>' inside values", async () => {
  const { readTag, parseCards } = await cards;
  const tag = readTag('<widget-secret env="SECRET_X" label=\'Key "A"\' reason="Needed > now &amp; later" required data-x=plain>', 0);
  assert.deepEqual(tag.attrs, { env: "SECRET_X", label: 'Key "A"', reason: "Needed > now & later", required: "", "data-x": "plain" });
  assert.equal(parseCards("<file path=>").cards.length, 0);
  assert.equal(parseCards('<FILE PATH="x.md"/>').cards[0].attrs.path, "x.md");
  // Placeholders in the agent's own text can't be confused with cards.
  assert.equal(parseCards("a\uE0000\uE001b").markdown, "a0b");
});

test("old onboarding steps are removed; other tags stay text", async () => {
  const { parseCards } = await cards;
  const result = parseCards('Hi <theme-picker></theme-picker><browser-connection /> <div>x</div> <option>y</option>');
  assert.equal(result.cards.length, 0);
  assert.equal(result.markdown, "Hi  <div>x</div> <option>y</option>");
});

test("links resolve to pages, files, tabs, workers and app pages", async () => {
  const { resolveLink } = await cards;
  assert.deepEqual(resolveLink("https://example.com/a"), { type: "url", url: "https://example.com/a" });
  assert.deepEqual(resolveLink("//example.com"), { type: "url", url: "https://example.com" });
  assert.deepEqual(resolveLink("timewarp://conversation/c1/browser/t2"), { type: "tab", conversationId: "c1", tabId: "t2" });
  assert.deepEqual(resolveLink("energy://conversation/c1/browser/t2"), { type: "tab", conversationId: "c1", tabId: "t2" });
  assert.deepEqual(resolveLink("energy://conversation/c1"), { type: "conversation", conversationId: "c1" });
  assert.deepEqual(resolveLink("timewarp://subagents/019a-b"), { type: "subagent", threadId: "019a-b" });
  assert.deepEqual(resolveLink("timewarp://customize/tools"), { type: "app", route: "/customize/tools" });
  assert.deepEqual(resolveLink("file:///C:/Users/me/My%20report.md"), { type: "file", path: "C:\\Users\\me\\My report.md" });
  assert.deepEqual(resolveLink("file:///home/me/a.md"), { type: "file", path: "/home/me/a.md" });
  // markdown-it encodes link destinations.
  assert.deepEqual(resolveLink("C:%5CUsers%5Cme%5Creport.md"), { type: "file", path: "C:\\Users\\me\\report.md" });
  assert.deepEqual(resolveLink("/abs/path%20with%20space.md:12:3"), { type: "file", path: "/abs/path with space.md" });
  assert.deepEqual(resolveLink("notes/today.md"), { type: "file", path: "notes/today.md" });
  // Files on other computers aren't links: looking one up would send the
  // user's Windows sign-in to that computer.
  assert.deepEqual(resolveLink("file://attacker.example/share/a.png"), { type: "none" });
  assert.deepEqual(resolveLink("file:////attacker.example/share/a.png"), { type: "none" });
  assert.deepEqual(resolveLink("\\\\attacker.example\\share\\a.png"), { type: "none" });
  assert.deepEqual(resolveLink("%5C%5Cattacker.example%5Cshare%5Ca.png"), { type: "none" });
  assert.deepEqual(resolveLink("file://localhost/C:/Users/me/a.md"), { type: "file", path: "C:\\Users\\me\\a.md" });
  assert.deepEqual(resolveLink("javascript:alert(1)"), { type: "none" });
  assert.deepEqual(resolveLink("ftp://example.com/conversation/c1"), { type: "none" });
  assert.deepEqual(resolveLink("#top"), { type: "none" });
});

test("citations, answers and drafts", async () => {
  const { citationSources, selectAnswer, draftMessage, fileKind, messageKey } = await cards;
  assert.deepEqual(citationSources(encodeURIComponent(JSON.stringify([{ url: "https://a.example/x" }, { url: "ftp://b" }]))), ["https://a.example/x"]);
  assert.deepEqual(citationSources("https://a.example, https://b.example https://a.example"), ["https://a.example", "https://b.example"]);
  const options = [{ label: "Pricing", value: "p" }, { label: "Competitors", value: "c" }];
  assert.equal(selectAnswer(options, { selections: ["c", "p"], customAnswer: " Both " }), "Competitors, Pricing, Both");
  assert.equal(selectAnswer(options, { skipped: true }), "Skipped");
  assert.equal(draftMessage({ mode: "email", title: "Re: Timeline", from: "me@example.com", to: "a@example.com; b@example.com", cc: "", body: " Hi \n" }),
    "Send this email:\nFrom: me@example.com\nTo: a@example.com, b@example.com\nSubject: Re: Timeline\n\nHi");
  assert.equal(draftMessage({ body: "On my way" }), "Send this message:\n\nOn my way");
  assert.equal(fileKind("Plan.DOCX"), "Word document");
  assert.equal(fileKind("data.json"), "JSON file");
  assert.equal(messageKey("abc"), messageKey("abc"));
  assert.notEqual(messageKey("abc"), messageKey("abd"));
});

test("old user messages with a card's answer read as its summary", async () => {
  const { userMessageText } = await cards;
  assert.equal(userMessageText('<widget-interaction source-message="m1" index="0" tag="select" summary="Competitors &amp; pricing">\n{\n  "selections": ["c"]\n}\n</widget-interaction>'), "Competitors & pricing");
  assert.equal(userMessageText("Hi <b>there</b>"), "Hi <b>there</b>");
});

test("the agent instructions describe the cards in a stable block", () => {
  assert.match(WIDGETS, /^<timewarp_chat_widgets>\n[\s\S]+\n<\/timewarp_chat_widgets>$/);
  for (const tag of ["<file ", "<connect-plugin ", "<widget-mcp-connection ", "<select ", "<button ", "<conversation", "<message-input", "<tabs>", "<widget-secret ", "timewarp://subagents/"]) assert.ok(WIDGETS.includes(tag), tag);
  assert.ok(!/energy/i.test(WIDGETS));
  assert.ok(WIDGETS.length < 6000);
});

test("models' citation marks are left out, a half-written one too", async () => {
  const { stripCitations, parseCards } = await cards;
  assert.equal(stripCitations("Rates roseciteturn1search1 again citeturn0news2."), "Rates rose again.");
  assert.equal(stripCitations("Rates rose citetur"), "Rates rose");
  assert.equal(parseCards("See citeturn2view0 <ref type=\"file\" name=\"a.md\" path=\"a.md\"></ref>").markdown, "See 0");
});

test("a user's message draws only its references and answers; other tags stay text", async () => {
  const { parseCards } = await cards;
  const text = 'Use <ref type="skill" name="pdf" path="/s/SKILL.md"></ref> and <button label="Go" prompt="go" /> <theme-picker></theme-picker>';
  const { markdown, cards: list } = parseCards(text, { only: new Set(["ref", "widget-interaction"]) });
  assert.deepEqual(list.map(card => card.tag), ["ref"]);
  assert.equal(markdown, 'Use 0 and <button label="Go" prompt="go" /> ');
});

test("a copied message leaves out its cards; references keep their names", async () => {
  const { copyText, refMarkup } = await cards;
  const text = 'Done.\n\n<file path="out/report.docx" action="created" />\n\nSee <ref type="skill" name="docs:pdf" path="/s/SKILL.md"></ref> and <citation sources="https://a.test"></citation>.\n\n<select><option>Yes</option></select>\n\n```\n<button label="kept" />\n```';
  assert.equal(copyText(text), 'Done.\n\nSee pdf and .\n\n```\n<button label="kept" />\n```');
  assert.equal(refMarkup({ type: "file", name: 'a"<b>.md', path: "x/a.md", contentType: "text/markdown" }), '<ref type="file" name="a&quot;&lt;b&gt;.md" path="x/a.md" content-type="text/markdown"></ref>');
  assert.equal(refMarkup({ type: "person", userId: "u2", name: "Ada", email: "ada@example.com", imageUrl: null }), '<ref type="person" user-id="u2" name="Ada" email="ada@example.com"></ref>');
});
