"use strict";
// Agent ID running locally: the real edge function (bundled from
// supabase/functions/agent-id) against the real migration in embedded
// Postgres (PGlite), behind a small stand-in for the Supabase client. The
// tests use it directly; `node scripts/agent-id-dev.cjs` serves it over HTTP
// for the website and the CLI.
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const esbuild = require("esbuild");
const { PGlite } = require("@electric-sql/pglite");

const root = path.resolve(__dirname, "..");
// Agent ID's migrations, in order.
const MIGRATIONS = fs.readdirSync(path.join(root, "supabase/migrations")).filter(name => /^\d{14}_agent_id.*\.sql$/.test(name)).sort().map(name => path.join(root, "supabase/migrations", name));

// A module of the function as CommonJS, its npm imports left out (index.ts
// holds the only one, and the harness passes its own client instead).
const bundles = new Map();
function loadModule(file = "app.ts") {
  if (bundles.has(file)) return bundles.get(file);
  const result = esbuild.buildSync({ entryPoints: [path.join(root, "supabase/functions/agent-id", file)], bundle: true, format: "cjs", platform: "neutral", target: "es2022", write: false, logLevel: "silent", external: ["npm:*"] });
  const module = { exports: {} };
  const context = vm.createContext({ module, exports: module.exports, console, crypto: globalThis.crypto, TextEncoder, TextDecoder, URL, URLSearchParams, Request, Response, Headers, AbortSignal, Blob, atob, btoa, setTimeout, clearTimeout, structuredClone });
  vm.runInContext(result.outputFiles[0].text, context, { filename: `agent-id/${file}` });
  bundles.set(file, module.exports);
  return module.exports;
}
const loadApp = () => loadModule("app.ts");

// What the rest of the Timewarp database looks like to Agent ID: accounts,
// organizations, plans, credits and rate limits, reduced to what it uses.
const FIXTURE = `
create role anon; create role authenticated; create role service_role;
create schema auth;
create schema storage;
create table storage.buckets(id text primary key, name text, public boolean);
create table auth.users(id uuid primary key, email text, created_at timestamptz default now());
create table public.timewarp_workspaces(id uuid primary key default gen_random_uuid(), name text not null, created_by uuid);
create table public.timewarp_workspace_members(id uuid primary key default gen_random_uuid(), workspace_id uuid references public.timewarp_workspaces on delete cascade, user_id uuid references auth.users, role text, status text default 'active', unique(workspace_id,user_id));
create table public.test_plans(user_id uuid primary key, plan text not null);
create table public.test_credits(user_id uuid primary key, credits numeric not null default 0);
create table public.test_reservations(id uuid primary key, user_id uuid, credits numeric, status text default 'reserved', model text, cost numeric);
create table public.test_rate_limits(user_id uuid, kind text, at timestamptz default now());
create function public.timewarp_ai_usage(p_user_id uuid, p_workspace_id uuid default null) returns jsonb language sql as $$
  select jsonb_build_object('plan', coalesce((select plan from public.test_plans where user_id=p_user_id),'free')) $$;
create function public.timewarp_reserve_agent_ai(p_id uuid, p_user_id uuid, p_credits numeric) returns boolean language plpgsql as $$
begin
  update public.test_credits set credits=credits-p_credits where user_id=p_user_id and credits>=p_credits;
  if not found then return false; end if;
  insert into public.test_reservations(id,user_id,credits) values(p_id,p_user_id,p_credits);
  return true;
end $$;
create function public.timewarp_energy_complete_ai(p_id uuid,p_user_id uuid,p_model text,p_input integer,p_output integer,p_cost numeric,p_outcome text) returns jsonb language plpgsql as $$
declare v public.test_reservations;
begin
  select * into v from public.test_reservations where id=p_id and user_id=p_user_id for update;
  if not found then raise exception 'Reservation not found'; end if;
  if p_cost*2.5/0.125 > v.credits then raise exception 'Invalid reserved usage'; end if;
  update public.test_credits set credits=credits+v.credits-(case when p_outcome='settled' then p_cost*2.5/0.125 else 0 end) where user_id=p_user_id;
  update public.test_reservations set status=p_outcome, model=p_model, cost=p_cost where id=p_id;
  return jsonb_build_object('ok',true);
end $$;
create function public.timewarp_consume_rate_limit(p_user_id uuid, p_kind text, p_max_per_minute integer, p_max_per_day integer) returns jsonb language plpgsql as $$
begin
  insert into public.test_rate_limits(user_id,kind) values(p_user_id,p_kind);
  if (select count(*) from public.test_rate_limits where user_id=p_user_id and kind=p_kind and at>now()-interval '1 minute')>p_max_per_minute then
    return jsonb_build_object('allowed',false,'limit','minute','retry_after_seconds',60);
  end if;
  return jsonb_build_object('allowed',true);
end $$;
-- Account data the app syncs (20261012160000_account_data_sync.sql, without its policies).
create table public.timewarp_energy_account_data_revisions(user_id uuid primary key references auth.users(id) on delete cascade, revision bigint not null);
create table public.timewarp_energy_account_data(user_id uuid not null references auth.users(id) on delete cascade, kind text not null, key text not null, value jsonb, revision bigint not null, updated_at timestamptz not null default now(), primary key (user_id,kind,key));
create function public.timewarp_energy_put_account_data(p_user uuid,p_items jsonb) returns jsonb language plpgsql as $$
declare item jsonb; results jsonb := '[]'::jsonb; current_revision bigint; stored record; existed boolean;
begin
  insert into public.timewarp_energy_account_data_revisions as counter(user_id,revision) values(p_user,0) on conflict(user_id) do update set revision=counter.revision returning counter.revision into current_revision;
  for item in select value from jsonb_array_elements(p_items) loop
    select d.revision,d.value into stored from public.timewarp_energy_account_data d where d.user_id=p_user and d.kind=item->>'kind' and d.key=item->>'key';
    existed := found;
    if existed and stored.revision<>coalesce((item->>'base')::bigint,0) then
      results := results || jsonb_build_array(jsonb_build_object('kind',item->>'kind','key',item->>'key','conflict',true,'revision',stored.revision,'value',stored.value));
      continue;
    end if;
    current_revision := current_revision+1;
    insert into public.timewarp_energy_account_data(user_id,kind,key,value,revision,updated_at) values(p_user,item->>'kind',item->>'key',case when jsonb_typeof(item->'value')='null' then null else item->'value' end,current_revision,now())
      on conflict(user_id,kind,key) do update set value=excluded.value,revision=excluded.revision,updated_at=excluded.updated_at;
    results := results || jsonb_build_array(jsonb_build_object('kind',item->>'kind','key',item->>'key','revision',current_revision));
  end loop;
  update public.timewarp_energy_account_data_revisions set revision=current_revision where user_id=p_user;
  return results;
end $$;
grant usage on schema public, auth to anon, authenticated, service_role;
`;

const quote = name => { if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error("Bad identifier " + name); return `"${name}"`; };
// A filter column, with PostgREST's JSON paths: data->bank->>transfer.
const columnSql = name => {
  const match = /^([a-z_][a-z0-9_]*)((?:->[a-z_][a-z0-9_]*)*)(->>[a-z_][a-z0-9_]*)?$/.exec(name);
  if (!match) throw new Error("Bad column " + name);
  return quote(match[1]) + match[2].split("->").filter(Boolean).map(key => `->'${key}'`).join("") + (match[3] ? `->>'${match[3].slice(3)}'` : "");
};
const plain = value => value instanceof Date ? value.toISOString() : typeof value === "bigint" ? Number(value) : value;
const row = record => Object.fromEntries(Object.entries(record).map(([key, value]) => [key, plain(value)]));
const param = value => value !== null && typeof value === "object" && !Array.isArray(value) && !(value instanceof Date) ? JSON.stringify(value) : value;

// The part of supabase-js's query builder Agent ID uses, as SQL.
class Query {
  constructor(db, table) { Object.assign(this, { db, table, op: "select", columns: "*", filters: [], orders: [], limitTo: null, returning: null, mode: null }); }
  select(columns = "*") { if (this.op === "select") this.columns = columns; else this.returning = columns; return this; }
  insert(rows) { this.op = "insert"; this.rows = Array.isArray(rows) ? rows : [rows]; return this; }
  upsert(rows, options = {}) { this.op = "upsert"; this.rows = Array.isArray(rows) ? rows : [rows]; this.conflict = options.onConflict; return this; }
  update(patch) { this.op = "update"; this.patch = patch; return this; }
  delete() { this.op = "delete"; return this; }
  filter(column, operator, value) { this.filters.push([column, operator, value]); return this; }
  eq(c, v) { return this.filter(c, "=", v); } neq(c, v) { return this.filter(c, "<>", v); }
  gt(c, v) { return this.filter(c, ">", v); } gte(c, v) { return this.filter(c, ">=", v); }
  lt(c, v) { return this.filter(c, "<", v); } lte(c, v) { return this.filter(c, "<=", v); }
  is(c, v) { return this.filter(c, v === null ? "is null" : "is", v); }
  not(c, op, v) { if (op !== "is" || v !== null) throw new Error("Unsupported not() " + op); return this.filter(c, "is not null", null); }
  in(c, v) { return this.filter(c, "in", v); }
  ilike(c, v) { return this.filter(c, "ilike", v); }
  // PostgREST's or(): "column.operator.value,…" with eq and ilike.
  or(expression) { this.filters.push([null, "or", expression]); return this; }
  order(column, options = {}) { this.orders.push(`${quote(column)} ${options.ascending === false ? "desc" : "asc"}`); return this; }
  limit(n) { this.limitTo = n; return this; }
  single() { this.mode = "single"; return this; }
  maybeSingle() { this.mode = "maybe"; return this; }
  then(resolve, reject) { return this.run().then(resolve, reject); }
  where(values) {
    if (!this.filters.length) return "";
    return " where " + this.filters.map(([column, operator, value]) => {
      if (operator === "is null" || operator === "is not null") return `${columnSql(column)} ${operator}`;
      if (operator === "in") { values.push(value); return `${columnSql(column)} = any($${values.length})`; }
      if (operator === "or") return "(" + value.split(",").map(part => {
        const [col, op, ...rest] = part.split(".");
        if (!["eq", "ilike"].includes(op)) throw new Error("Unsupported or() operator " + op);
        values.push(rest.join("."));
        return `${quote(col)} ${op === "eq" ? "=" : "ilike"} $${values.length}`;
      }).join(" or ") + ")";
      values.push(param(value));
      return `${columnSql(column)} ${operator} $${values.length}`;
    }).join(" and ");
  }
  columnsSql(columns) { return columns === "*" ? "*" : columns.split(",").map(c => quote(c.trim())).join(","); }
  async run() {
    const values = [];
    let sql;
    const table = `public.${quote(this.table)}`;
    if (this.op === "select") sql = `select ${this.columnsSql(this.columns)} from ${table}${this.where(values)}${this.orders.length ? " order by " + this.orders.join(",") : ""}${this.limitTo ? " limit " + Number(this.limitTo) : ""}`;
    else if (this.op === "insert" || this.op === "upsert") {
      const keys = [...new Set(this.rows.flatMap(r => Object.keys(r)))];
      const tuples = this.rows.map(r => "(" + keys.map(k => { values.push(param(r[k] === undefined ? null : r[k])); return `$${values.length}`; }).join(",") + ")");
      sql = `insert into ${table}(${keys.map(quote).join(",")}) values ${tuples.join(",")}`;
      if (this.op === "upsert") sql += ` on conflict (${this.conflict.split(",").map(c => quote(c.trim())).join(",")}) do update set ${keys.map(k => `${quote(k)}=excluded.${quote(k)}`).join(",")}`;
      sql += ` returning ${this.columnsSql(this.returning || "*")}`;
    } else if (this.op === "update") {
      const sets = Object.entries(this.patch).map(([k, v]) => { values.push(param(v)); return `${quote(k)}=$${values.length}`; });
      sql = `update ${table} set ${sets.join(",")}${this.where(values)} returning ${this.columnsSql(this.returning || "*")}`;
    } else sql = `delete from ${table}${this.where(values)} returning ${this.columnsSql(this.returning || "*")}`;
    try {
      const rows = (await this.db.query(sql, values)).rows.map(row);
      const data = this.op === "select" || this.returning ? rows : null;
      if (this.mode === "single") return rows.length === 1 ? { data: rows[0], error: null } : { data: null, error: { code: "PGRST116", message: `Expected one row, got ${rows.length}` } };
      if (this.mode === "maybe") return rows.length <= 1 ? { data: rows[0] || null, error: null } : { data: null, error: { code: "PGRST116", message: "More than one row" } };
      return { data, error: null };
    } catch (error) {
      return { data: null, error: { code: error.code, message: error.message } };
    }
  }
}

// Supabase Storage, in memory: upload, download, remove.
function storageClient(store) {
  return {
    from: bucket => ({
      async upload(path, bytes, options = {}) {
        const key = `${bucket}/${path}`;
        if (store.has(key) && !options.upsert) return { data: null, error: { message: "The resource already exists" } };
        store.set(key, { bytes: new Uint8Array(bytes), contentType: options.contentType || "application/octet-stream" });
        return { data: { path }, error: null };
      },
      async download(path) {
        const file = store.get(`${bucket}/${path}`);
        return file ? { data: new Blob([file.bytes], { type: file.contentType }), error: null } : { data: null, error: { message: "Object not found" } };
      },
      async remove(paths) { for (const path of paths) store.delete(`${bucket}/${path}`); return { data: paths, error: null }; },
    }),
  };
}

function adminClient(db, users, files) {
  return {
    from: table => new Query(db, table),
    storage: storageClient(files),
    async rpc(name, args = {}) {
      const keys = Object.keys(args);
      try {
        const result = await db.query(`select public.${quote(name)}(${keys.map((k, i) => `${quote(k)} => $${i + 1}`).join(",")}) as result`, keys.map(k => param(args[k])));
        return { data: plain(result.rows[0].result), error: null };
      } catch (error) { return { data: null, error: { code: error.code, message: error.message } }; }
    },
    auth: {
      // A session token here is "session:<user id>".
      async getUser(token) {
        const user = String(token || "").startsWith("session:") ? users.get(token.slice(8)) : null;
        return user ? { data: { user }, error: null } : { data: { user: null }, error: { message: "invalid" } };
      },
      admin: {
        async getUserById(id) { const user = users.get(id); return { data: { user: user || null }, error: user ? null : { message: "not found" } }; },
        // A new confirmed account, as Supabase Auth makes one.
        async createUser({ email }) {
          if ([...users.values()].some(u => u.email === email)) return { data: { user: null }, error: { message: "A user with this email address has already been registered" } };
          const id = uuid(++counter);
          users.set(id, { id, email });
          await db.query("insert into auth.users(id,email) values($1,$2)", [id, email]);
          return { data: { user: { id, email } }, error: null };
        },
      },
    },
  };
}

// A P-256 key for passports, made once per process.
let signingKey = null;
async function passportKey() {
  if (signingKey) return signingKey;
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  signingKey = JSON.stringify({ ...(await crypto.subtle.exportKey("jwk", pair.privateKey)), kid: "local-1" });
  return signingKey;
}

let counter = 0;
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

// options.env: extra secrets; options.fetch: the providers' network.
async function startLocal(options = {}) {
  const db = new PGlite();
  await db.exec(FIXTURE);
  for (const file of MIGRATIONS) await db.exec(fs.readFileSync(file, "utf8"));
  const users = new Map();
  const files = new Map();
  const admin = adminClient(db, users, files);
  const env = { SUPABASE_URL: "http://127.0.0.1:54329", AGENT_ID_PUBLIC_URL: options.publicUrl || "http://127.0.0.1:54329/agent-id", AGENT_ID_SIGNING_KEY: await passportKey(), AGENT_ID_WEBHOOK_SECRET: "local-webhook-secret", AGENT_ID_AUTO_SETUP: "false", AGENT_ID_AUTO_GIVE: "none", AGENT_ID_AUTO_GIVE_PAID: "none", ...options.env };
  // Work a request leaves running (a new agent's resources); settle() waits for it.
  const pending = new Set();
  const background = work => { const tracked = Promise.resolve(work).catch(() => {}).finally(() => pending.delete(tracked)); pending.add(tracked); };
  let clock = options.now || null;
  const { createHandler } = loadApp();
  const make = () => createHandler({ admin, env: name => env[name] || "", fetch: options.fetch || (async () => { throw new Error("No network in the local harness."); }), now: () => clock ? clock() : Date.now(), sleep: options.sleep || (async () => {}), background, signIn: async email => { const user = [...users.values()].find(u => u.email === email); return user ? { access_token: `session:${user.id}`, refresh_token: "local-refresh", expires_in: 3600 } : null; } });
  let handler = make();
  const local = {
    db, admin, env, users, files,
    handle: request => handler(request),
    setEnv(changes) { Object.assign(env, changes); handler = make(); },
    setClock(fn) { clock = fn; },
    async settle() { while (pending.size) await Promise.all([...pending]); },
    async user({ email, plan, credits, name } = {}) {
      const id = uuid(++counter);
      const user = { id, email: email || `user${counter}@example.invalid` };
      users.set(id, user);
      await db.query("insert into auth.users(id,email) values($1,$2)", [id, user.email]);
      if (plan) await db.query("insert into public.test_plans values($1,$2)", [id, plan]);
      await db.query("insert into public.test_credits values($1,$2)", [id, credits ?? 0]);
      return { ...user, name, session: `session:${id}` };
    },
    async organization(name, members) {
      const { rows: [org] } = await db.query("insert into public.timewarp_workspaces(name) values($1) returning id", [name]);
      for (const [user, role] of members) await db.query("insert into public.timewarp_workspace_members(workspace_id,user_id,role) values($1,$2,$3)", [org.id, user.id, role]);
      return org.id;
    },
    // A JSON request as a client sends it; returns { status, body, headers }.
    async call(method, url, { token, body, headers = {}, raw } = {}) {
      const request = new Request(`http://127.0.0.1:54329/agent-id${url}`, {
        method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body !== undefined && !raw ? { "content-type": "application/json" } : {}), ...headers },
        ...(raw !== undefined ? { body: raw } : body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      const response = await handler(request);
      const text = await response.text();
      let parsed = text;
      try { parsed = JSON.parse(text); } catch { /* text responses */ }
      return { status: response.status, body: parsed, headers: response.headers };
    },
    // The response itself, for answers that aren't JSON (files, marked bytes).
    async fetch(method, url, { token, raw, headers = {} } = {}) {
      return handler(new Request(`http://127.0.0.1:54329/agent-id${url}`, { method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers }, ...(raw !== undefined ? { body: raw } : {}) }));
    },
    close: () => db.close(),
  };
  return local;
}

module.exports = { startLocal, loadApp, loadModule };
