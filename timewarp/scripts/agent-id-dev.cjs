"use strict";
// A local Agent ID API for building the dashboard and the CLI without the
// cloud: the real service on embedded Postgres, test resources only.
//
//   node scripts/agent-id-dev.cjs [--port 54329]
//
// It prints a session token for each seeded account; the website's dev mode
// and the CLI use it as the Bearer token (owner), and agent keys come from
// creating agents as usual. Data lives in memory until the process ends.
const http = require("node:http");
const { startLocal } = require("./agent-id-local.cjs");

const port = Number(process.argv[process.argv.indexOf("--port") + 1]) || Number(process.env.AGENT_ID_DEV_PORT) || 54329;

// --demo: agents from different apps with mail, texts, calls, contacts,
// money and a machine, as an owner would see them after a few days.
async function demo(local, owner) {
  const call = async (method, url, token, body, headers = {}) => {
    const response = await local.call(method, url, { token, body, headers });
    if (response.status >= 300) throw new Error(`${method} ${url}: ${JSON.stringify(response.body)}`);
    return response.body;
  };
  const config = (await local.call("GET", "/v1/config", {})).body;
  await call("POST", "/v1/account/terms", owner.session, { version: config.legal.termsVersion });
  const make = async (name, app, detail, kinds) => {
    const created = await call("POST", "/v1/agents", owner.session, { name, origin: { app, detail } });
    for (const kind of kinds) await call("POST", `/v1/agents/${created.agent.id}/resources`, owner.session, { kind, ...(kind === "wallet" ? { settings: { approvalAbove: 2500, perTransfer: 20000, daily: 50000 } } : {}) });
    return { ...created.agent, key: created.secret };
  };
  const research = await make("Research Assistant", "claude-code", "project ~/market-study", ["mail", "phone", "wallet", "vm"]);
  const sales = await make("Sales Agent", "codex", "every project", ["mail", "phone", "wallet"]);
  await make("Site Builder", "cursor", "project ~/shop", ["mail", "vm"]);
  await make("Grok Scout", "grok", null, ["mail"]);
  const address = async agent => (await call("GET", `/v1/agents/${agent.id}`, owner.session)).agent.resources;
  const r = await address(research), s = await address(sales);
  const upload = async (agent, name, text) => (await (await local.handle(new Request("http://127.0.0.1/agent-id/v1/me/files", { method: "POST", body: text, headers: { authorization: `Bearer ${agent.key}`, "content-type": "text/csv", "x-filename": name } }))).json()).file;
  const file = await upload(research, "supplier-shortlist.csv", "supplier,price,lead time\nNordic Parts,12.50,5 days\nBaltic Supply,11.90,9 days\n");
  await call("POST", "/v1/me/mail", research.key, { to: s.mail.address, subject: "Supplier shortlist", text: "Hi,\n\nI compared six suppliers; the two best are in the attached sheet. Nordic Parts is fastest, Baltic Supply is cheapest.\n\nCan you ask both for a quote on 500 units?", attachments: [file.id] });
  await call("POST", "/v1/me/mail", sales.key, { to: r.mail.address, subject: "Quote request sent", text: "Done. Both promised an answer by Friday. I'll forward the quotes as they arrive." });
  await call("POST", "/v1/me/mail", sales.key, { to: r.mail.address, subject: "Customer question about delivery", text: "A customer asks whether we ship to Norway. Do we have numbers on delivery times there?" });
  await call("POST", "/v1/me/sms", research.key, { to: s.phone.address, text: "Quotes due Friday — can you chase Baltic Supply tomorrow?" });
  await call("POST", "/v1/me/sms", sales.key, { to: r.phone.address, text: "Will do. Calling them at 10." });
  await call("POST", "/v1/me/sms", sales.key, { to: r.phone.address, text: "They confirmed: quote on Thursday 👍" });
  await call("POST", "/v1/me/calls", sales.key, { to: r.phone.address, say: "Baltic Supply confirmed the quote for Thursday." });
  const phone = (await local.db.query("select id from agent_id_resources where agent_id=$1 and kind='phone'", [research.id])).rows[0].id;
  await local.admin.rpc("agent_id_record_event", { p_resource: phone, p_kind: "call", p_direction: "in", p_status: "missed", p_counterparty: "+46701234567", p_subject: null, p_body: null, p_amount: null, p_currency: null, p_provider_ref: "demo-missed", p_thread: null, p_data: {}, p_folder: null });
  for (const contact of [{ name: "Sales Agent", phone: s.phone.address, email: s.mail.address, wallet: sales.handle }, { name: "Nordic Parts", email: "orders@nordicparts.example", phone: "+46701234567" }, { name: "Baltic Supply", email: "sales@balticsupply.example" }]) await call("POST", "/v1/me/contacts", research.key, contact);
  await call("POST", `/v1/agents/${research.id}/wallet/test-funds`, owner.session, { amount: 100000 });
  await call("POST", "/v1/me/wallet/transfers", research.key, { to: sales.handle, value: "18.00", memo: "Data set from Sales" });
  await call("POST", "/v1/me/wallet/transfers", research.key, { to: sales.handle, value: "75.00", memo: "Deposit for supplier samples" });
  await call("POST", `/v1/agents/${sales.id}/card-application`, owner.session, { useCase: "Buy sample orders and software subscriptions", monthlySpend: 30000, country: "SE" });
  console.log("  Demo data: 4 agents (Claude Code, Codex, Cursor, Grok) with mail, texts, calls, contacts, money and an approval waiting.");
}

(async () => {
  const local = await startLocal({ publicUrl: `http://127.0.0.1:${port}/agent-id`, env: { SUPABASE_URL: `http://127.0.0.1:${port}`, AGENT_ID_SITE_URL: process.env.AGENT_ID_SITE_URL || "http://localhost:8080" } });
  const dev = await local.user({ email: "dev@timewarp.test", plan: "pro", credits: 100 });
  const teammate = await local.user({ email: "teammate@timewarp.test" });
  const org = await local.organization("Acme Robotics", [[dev, "owner"], [teammate, "lead"]]);
  local.setEnv({ AGENT_ID_REVIEWERS: dev.id });
  if (process.argv.includes("--demo")) await demo(local, dev);

  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks);
    try {
      const request = new Request(`http://127.0.0.1:${port}${req.url}`, { method: req.method, headers: Object.entries(req.headers).filter(([, v]) => typeof v === "string"), ...(body.length && !["GET", "HEAD"].includes(req.method) ? { body } : {}) });
      const response = await local.handle(request);
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch (error) {
      console.error(error);
      res.writeHead(500, { "content-type": "application/json", "access-control-allow-origin": "*" }).end(JSON.stringify({ error: { code: "internal", message: error.message } }));
    }
  });
  server.listen(port, "127.0.0.1", () => {
    console.log(`Agent ID dev API: http://127.0.0.1:${port}/agent-id`);
    console.log(`  dev@timewarp.test (Pro, reviewer, owner of Acme Robotics ${org}): ${dev.session}`);
    console.log(`  teammate@timewarp.test (Free, lead in Acme Robotics) :           ${teammate.session}`);
  });
})().catch(error => { console.error(error); process.exit(1); });
