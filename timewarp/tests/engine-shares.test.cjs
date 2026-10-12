"use strict";
// Share invites on the desktop (app/main/shares.cjs): two people on their own
// computers, one sharing a chat, an agent or an automation and the other
// accepting a personal copy. The cloud is a stand-in that keeps shares as the
// workspace service does, behind the same secret check every cloud call has.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { openStore } = require("../app/main/store.cjs");
const { createAgents } = require("../app/main/agents.cjs");
const { createAutomations, systemZone } = require("../app/main/automations.cjs");
const { createShares } = require("../app/main/shares.cjs");
const { assertCloudSafe } = require("../shared/privacy.cjs");

const ORG = "00000000-0000-4000-8000-0000000000a1";
const SAM = "00000000-0000-4000-8000-0000000000b1", CAM = "00000000-0000-4000-8000-0000000000c1";
const people = { [SAM]: { userId: SAM, name: "Sam", email: "sam@example.invalid" }, [CAM]: { userId: CAM, name: "Cam", email: "cam@example.invalid" } };
const fail = (status, message) => Object.assign(new Error(message), { status });

function createCloud() {
  const shares = [];
  let failNextAnswer = false;
  return {
    shares,
    failNextAnswer: () => { failNextAnswer = true; },
    async rpc(user, name, input = {}) {
      assertCloudSafe(input);
      const sent = JSON.parse(JSON.stringify(input));
      if (name === "product.shares.create") {
        assert.equal(sent.organizationId, ORG);
        return { ids: sent.recipientUserIds.map(recipient => {
          if (!people[recipient] || recipient === user) throw fail(404, "Choose people who are in this organization.");
          const id = require("node:crypto").randomUUID();
          shares.push({ id, kind: sent.kind, title: sent.title, summary: sent.summary, payload: sent.payload, sender: people[user], recipient: people[recipient], status: "pending", createdAt: new Date().toISOString() });
          return id;
        }) };
      }
      if (name === "product.shares.list") {
        const waiting = shares.filter(share => share.status === "pending");
        return { incoming: waiting.filter(share => share.recipient.userId === user).map(({ payload, ...share }) => share), outgoing: waiting.filter(share => share.sender.userId === user).map(({ payload, ...share }) => share) };
      }
      const share = shares.find(item => item.id === sent.shareId && item.status === "pending");
      if (name === "product.shares.open") {
        if (!share || share.recipient.userId !== user) throw fail(404, "This share is no longer available.");
        return JSON.parse(JSON.stringify(share));
      }
      if (name === "product.shares.respond") {
        if (failNextAnswer) { failNextAnswer = false; throw fail(502, "The network went away."); }
        if (!share || (sent.response === "cancel" ? share.sender : share.recipient).userId !== user) throw fail(404, "This share is no longer available.");
        share.status = { accept: "accepted", decline: "declined", cancel: "canceled" }[sent.response];
        share.payload = null;
        return null;
      }
      throw fail(410, "Unknown.");
    },
  };
}

// One person's computer: their own database, agents, automations and shares.
function computer(t, cloud, user) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tw-shares-"));
  const store = openStore(path.join(root, "timewarp.sqlite"));
  const agents = createAgents({ store, root: path.join(root, "agents"), userId: () => user });
  const owned = (record, what) => { if (!record || record.ownerId !== user || record.archivedAt) throw fail(404, `This ${what} is unavailable for this account.`); return record; };
  const harness = {
    agents: { get: id => owned(store.agents.get(id), "agent") },
    conversations: { get: id => owned(store.conversations.get(id), "conversation"), create: ({ agentId, title }) => store.conversations.create({ ownerId: user, agentId, title }) },
  };
  const automations = createAutomations({ store, harness, userId: () => user, clock: () => new Date(2026, 9, 12, 8, 0) });
  const shares = createShares({ store, agents, harness, automations, accountRpc: (name, input) => cloud.rpc(user, name, input), userId: () => user });
  t.after(async () => { await agents.settled(); store.close(); fs.rmSync(root, { recursive: true, force: true }); });
  return { root, store, agents, automations, shares };
}

test("a shared chat arrives as the recipient's own copy under their agent", async t => {
  const cloud = createCloud(), sam = computer(t, cloud, SAM), cam = computer(t, cloud, CAM);
  const orbit = sam.agents.create({ name: "Orbit" });
  const chat = sam.store.conversations.create({ ownerId: SAM, agentId: orbit.id, title: "Q3 plan" });
  sam.store.messages.append({ conversationId: chat.id, authorId: SAM, text: "<agent-introduction>Introduce yourself.</agent-introduction>" });
  sam.store.messages.append({ conversationId: chat.id, authorId: SAM, text: "Draft the Q3 plan.", files: [path.join(sam.root, "report.pdf")], createdAt: "2026-10-10T09:00:00.000Z" });
  sam.store.messages.append({ conversationId: chat.id, authorId: orbit.id, text: "Here is the plan.", createdAt: "2026-10-10T09:01:00.000Z" });
  sam.store.messages.append({ conversationId: chat.id, authorId: SAM, text: "This one failed.", status: "failed" });

  assert.deepEqual(await sam.shares.send({ kind: "chat", id: chat.id, organizationId: ORG, recipientUserIds: [CAM] }), { sent: 1 });
  const sent = cloud.shares[0];
  assert.deepEqual(sent.payload.messages.map(item => [item.role, item.text]), [["user", "Draft the Q3 plan.\n\n(Attached: report.pdf)"], ["agent", "Here is the plan."]]);
  // What the sender's computer sends (the cloud adds who sent it).
  const wire = JSON.stringify([sent.title, sent.summary, sent.payload]);
  for (const personal of [SAM, orbit.id, sam.root, chat.id]) assert.ok(!wire.includes(personal), "A share carries no ids or paths from the sender's computer: " + personal);

  const nova = cam.agents.create({ name: "Nova" });
  const { incoming } = await cam.shares.list();
  assert.equal(incoming.length, 1);
  assert.equal(incoming[0].payload, undefined);
  const copy = await cam.shares.accept({ shareId: incoming[0].id, agentId: nova.id });
  assert.equal(copy.kind, "chat");
  const conversation = cam.store.conversations.get(copy.conversationId);
  assert.deepEqual([conversation.ownerId, conversation.agentId, conversation.title, conversation.read], [CAM, nova.id, "Q3 plan", false]);
  const messages = cam.store.messages.list(conversation.id);
  assert.deepEqual(messages.map(item => item.authorId), [CAM, nova.id], "Every message belongs to the recipient or their agent, as chat sync requires.");
  assert.equal(messages[0].createdAt, "2026-10-10T09:00:00.000Z");
  assert.deepEqual(cam.shares.chatInfo(conversation.id).from, people[SAM]);
  assert.equal(cam.shares.chatInfo(conversation.id).through, messages[1].id);
  assert.equal(sent.status, "accepted");
  assert.equal(sent.payload, null);
  assert.throws(() => sam.shares.chatInfo(conversation.id), /unavailable/, "The copy is only on the recipient's computer.");
  assert.deepEqual(await cam.shares.accept({ shareId: incoming[0].id, agentId: nova.id }), copy, "Accepting twice keeps one copy.");
  assert.equal(cam.store.conversations.list(CAM).length, 1);
});

test("a shared agent brings its instructions and workflows, never the sender's access", async t => {
  const cloud = createCloud(), sam = computer(t, cloud, SAM), cam = computer(t, cloud, CAM);
  const scout = sam.agents.create({ name: "Research Scout", instructions: "Finds market research.", avatar: { mascot: "Nova" } });
  sam.agents.update(scout.id, { vaultAccess: true });
  fs.writeFileSync(path.join(scout.workspace, "AGENTS.md"), "# Research Scout\n\nCite every source.\n");
  const skill = path.join(scout.workspace, ".agents", "skills", "digest");
  fs.mkdirSync(path.join(skill, "scripts"), { recursive: true });
  fs.writeFileSync(path.join(skill, "SKILL.md"), "---\nname: digest\n---\nSummarize the week.\n");
  fs.writeFileSync(path.join(skill, "scripts", "collect.py"), "print('collect')\n");
  fs.writeFileSync(path.join(skill, "logo.png"), Buffer.from([137, 80, 78, 71, 0, 0, 0]));
  fs.writeFileSync(path.join(scout.workspace, "notes.md"), "Private notes.\n");

  await sam.shares.send({ kind: "agent", id: scout.id, organizationId: ORG, recipientUserIds: [CAM] });
  const sent = cloud.shares[0];
  assert.deepEqual(Object.keys(sent.payload).sort(), ["avatar", "instructions", "name", "responsibilities", "version", "workflows"]);
  assert.deepEqual(sent.payload.workflows.map(item => item.files.map(file => file.path).sort()), [["SKILL.md", "scripts/collect.py"]], "Text files only");
  assert.ok(!JSON.stringify(sent).includes("Private notes"), "Workspace files other than workflows stay with the sender.");
  // A tampered share can't write outside the new agent's workflows.
  sent.payload.workflows.push({ name: "escape", files: [{ path: "SKILL.md", content: "x" }, { path: "../../outside.txt", content: "x" }] }, { name: "..", files: [{ path: "SKILL.md", content: "x" }] });

  const copy = await cam.shares.accept({ shareId: sent.id });
  const agent = cam.store.agents.get(copy.agentId);
  assert.deepEqual([agent.ownerId, agent.name, agent.instructions, agent.vaultAccess], [CAM, "Research Scout", "Finds market research.", false]);
  assert.match(agent.avatarUrl, /\/mascots\/nova\.png$/);
  assert.equal(fs.readFileSync(path.join(agent.workspace, "AGENTS.md"), "utf8"), "# Research Scout\n\nCite every source.\n");
  const skills = path.join(agent.workspace, ".agents", "skills");
  assert.equal(fs.readFileSync(path.join(skills, "digest", "scripts", "collect.py"), "utf8"), "print('collect')\n");
  assert.ok(!fs.existsSync(path.join(skills, "digest", "logo.png")));
  assert.ok(!fs.existsSync(path.join(skills, "outside.txt")) && !fs.existsSync(path.join(agent.workspace, ".agents", "outside.txt")));
  assert.deepEqual(fs.readdirSync(skills).sort(), ["digest", "escape"]);
  assert.ok(!fs.existsSync(path.join(agent.workspace, "notes.md")));
  assert.notEqual(agent.id, scout.id);
});

test("a shared automation runs with the recipient's agent and time zone, off until turned on", async t => {
  const cloud = createCloud(), sam = computer(t, cloud, SAM), cam = computer(t, cloud, CAM);
  const orbit = sam.agents.create({ name: "Orbit" });
  const brief = sam.automations.create({ agentId: orbit.id, name: "Morning brief", instructions: "Summarize my inbox.", schedule: { kind: "daily", time: "09:00", tz: "Asia/Tokyo" } });
  await sam.shares.send({ kind: "automation", id: brief.id, organizationId: ORG, recipientUserIds: [CAM] });
  const sent = cloud.shares[0];
  assert.deepEqual(sent.payload.schedule, { kind: "daily", time: "09:00" }, "The sender's time zone stays behind.");

  const nova = cam.agents.create({ name: "Nova" });
  const copy = await cam.shares.accept({ shareId: sent.id, agentId: nova.id, enabled: false });
  const [automation] = cam.automations.list();
  assert.equal(automation.id, copy.automationId);
  assert.deepEqual([automation.agentId, automation.name, automation.instructions, automation.enabled, automation.nextRunAt], [nova.id, "Morning brief", "Summarize my inbox.", false, null]);
  assert.equal(automation.schedule.tz, systemZone() || undefined);
  assert.equal(cam.store.conversations.get(automation.conversationId).ownerId, CAM);
  // Only the recipient's own agents can take a copy.
  await sam.shares.send({ kind: "automation", id: brief.id, organizationId: ORG, recipientUserIds: [CAM] });
  await assert.rejects(cam.shares.accept({ shareId: cloud.shares[1].id, agentId: orbit.id }), /unavailable/);
  assert.equal(cam.automations.list().length, 1);
  assert.equal(cloud.shares[1].status, "pending");
});

test("accepting again after a lost answer makes no second copy", async t => {
  const cloud = createCloud(), sam = computer(t, cloud, SAM), cam = computer(t, cloud, CAM);
  const orbit = sam.agents.create({ name: "Orbit" });
  const chat = sam.store.conversations.create({ ownerId: SAM, agentId: orbit.id, title: "Notes" });
  sam.store.messages.append({ conversationId: chat.id, authorId: SAM, text: "Keep this." });
  await sam.shares.send({ kind: "chat", id: chat.id, organizationId: ORG, recipientUserIds: [CAM] });
  const nova = cam.agents.create({ name: "Nova" });
  const shareId = cloud.shares[0].id;
  cloud.failNextAnswer();
  await assert.rejects(cam.shares.accept({ shareId, agentId: nova.id }), /network/);
  const again = await cam.shares.accept({ shareId, agentId: nova.id });
  assert.equal(cam.store.conversations.list(CAM).length, 1);
  assert.equal(again.conversationId, cam.store.conversations.list(CAM)[0].id);
  assert.equal(cloud.shares[0].status, "accepted");
});

test("shares need people in the organization and keep secrets on the device", async t => {
  const cloud = createCloud(), sam = computer(t, cloud, SAM);
  const orbit = sam.agents.create({ name: "Orbit" });
  const chat = sam.store.conversations.create({ ownerId: SAM, agentId: orbit.id, title: "Card" });
  sam.store.messages.append({ conversationId: chat.id, authorId: SAM, text: "My card is 4242 4242 4242 4242." });
  await assert.rejects(sam.shares.send({ kind: "chat", id: chat.id, organizationId: ORG, recipientUserIds: [CAM] }), /stay on this device/);
  await assert.rejects(sam.shares.send({ kind: "chat", id: chat.id, organizationId: ORG, recipientUserIds: [] }), /who to share with/);
  await assert.rejects(sam.shares.send({ kind: "chat", id: chat.id, organizationId: null, recipientUserIds: [CAM] }), /organization/);
  await assert.rejects(sam.shares.send({ kind: "vault", id: chat.id, organizationId: ORG, recipientUserIds: [CAM] }), /Choose a chat/);
  const empty = sam.store.conversations.create({ ownerId: SAM, agentId: orbit.id, title: "Empty" });
  await assert.rejects(sam.shares.send({ kind: "chat", id: empty.id, organizationId: ORG, recipientUserIds: [CAM] }), /no messages/);
  assert.equal(cloud.shares.length, 0);
});
