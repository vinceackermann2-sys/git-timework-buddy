"use strict";
// Who may write which scope (20261014120000_owner_scope_and_profile_columns.sql),
// in PGlite. The tables and their earlier rules are as the earlier migrations
// left them in production; requests run as PostgREST runs them, as the
// signed-in person's role.
const { test } = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path");
const { PGlite } = require("@electric-sql/pglite");
const uid = n => `${String(n).padStart(8, "0")}-3333-4333-8333-333333333333`;
const me = uid(1), victim = uid(2), outsider = uid(3), org = uid(10);
const migration = () => fs.readFileSync(path.join(__dirname, "..", "supabase/migrations/20261014120000_owner_scope_and_profile_columns.sql"), "utf8");

const SCOPED = ["timewarp_operations", "timewarp_operation_runs", "timewarp_chat_sessions", "timewarp_cloud_snapshots", "timewarp_memory_facts", "timewarp_memory_episodes"];
// The rules before this migration (20260809120000_workspace_member_isolation_agent_sharing.sql).
const member = "public.timewarp_is_workspace_member(workspace_id)";
const memberScope = "scope_key = 'workspace:' || workspace_id::text || ':member:' || auth.uid()::text";
const memoryScope = "scope_key = 'workspace:' || workspace_id::text || ':memory'";
const EARLIER = {
  timewarp_operations: ["Users manage private workspace operations", `auth.uid() = user_id AND (workspace_id IS NULL OR ${member})`],
  timewarp_operation_runs: ["Users manage private workspace operation runs", `auth.uid() = user_id AND (workspace_id IS NULL OR ${member})`],
  timewarp_chat_sessions: ["Users manage private workspace chats", `auth.uid() = user_id AND (workspace_id IS NULL OR (${member} AND ${memberScope}))`],
  timewarp_cloud_snapshots: ["Users manage isolated cloud snapshots", `(workspace_id IS NULL AND auth.uid() = user_id) OR (workspace_id IS NOT NULL AND ${member} AND ((auth.uid() = user_id AND ${memberScope}) OR ${memoryScope}))`],
  timewarp_memory_facts: ["Members manage shared workspace memory facts", `(workspace_id IS NULL AND auth.uid() = user_id) OR (workspace_id IS NOT NULL AND ${member} AND ${memoryScope})`],
  timewarp_memory_episodes: ["Members manage shared workspace memory episodes", `(workspace_id IS NULL AND auth.uid() = user_id) OR (workspace_id IS NOT NULL AND ${member} AND ${memoryScope})`],
};

async function fixture(t) {
  const db = new PGlite(); t.after(() => db.close());
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls; create schema auth;
    create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create table public.timewarp_workspace_members(workspace_id uuid, user_id uuid, status text default 'active');
    insert into public.timewarp_workspace_members(workspace_id,user_id) values('${org}','${me}'),('${org}','${victim}');
    create function public.timewarp_is_workspace_member(p uuid) returns boolean language sql security definer as $$select exists(select 1 from public.timewarp_workspace_members where workspace_id=p and user_id=auth.uid() and status='active')$$;
    create table public.profiles(id uuid primary key default gen_random_uuid(), user_id uuid not null unique, email text, name text, interests text, storage_preference text,
      last_cloud_sync_at timestamptz, work_stack jsonb, onboarded boolean default false, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
    alter table public.profiles enable row level security;
    create policy "Users view own profile" on public.profiles for select to authenticated using (auth.uid() = user_id);
    create policy "Users insert own profile" on public.profiles for insert to authenticated with check (auth.uid() = user_id);
    create policy "Users update own profile" on public.profiles for update to authenticated using (auth.uid() = user_id);
    grant usage on schema public, auth to anon, authenticated, service_role;
    grant select, insert, update, delete on public.profiles to authenticated; grant all on public.profiles to service_role;
    insert into public.profiles(user_id, name, created_at) values('${me}', 'Me', '2026-09-01T00:00:00Z');`);
  for (const table of SCOPED) {
    const [name, rule] = EARLIER[table];
    await db.exec(`create table public.${table}(id uuid primary key default gen_random_uuid(), user_id uuid not null, workspace_id uuid, scope_key text not null, local_id text);
      alter table public.${table} enable row level security;
      create policy "${name}" on public.${table} for all to authenticated using (${rule}) with check (${rule});
      grant select, insert, update, delete on public.${table} to authenticated; grant all on public.${table} to service_role;`);
  }
  const as = async (user, role, sql, params = []) => {
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user || ""]);
    await db.exec("set role " + role);
    try { return await db.query(sql, params); } finally { await db.exec("reset role"); }
  };
  const allowed = (user, sql, params) => as(user, "authenticated", sql, params).then(() => true, error => { if (/row-level security|permission denied/.test(error.message)) return false; throw error; });
  const write = (table, user, workspace, scope) => allowed(user, `insert into public.${table}(user_id, workspace_id, scope_key, local_id) values($1,$2,$3,'x')`, [user, workspace, scope]);
  return { db, as, allowed, write };
}

test("a row filed under someone else's scope was accepted before and is refused now", async t => {
  const { db, write, allowed } = await fixture(t);
  // Before: ownership was checked, the scope wasn't.
  for (const table of SCOPED) {
    assert.equal(await write(table, me, null, "personal:" + victim), true, table + " took another person's personal scope before");
  }
  assert.equal(await allowed(me, "update public.profiles set created_at = now() + interval '1 day' where user_id = $1", [me]), true, "created_at was movable before");
  await db.exec(migration());
  for (const table of SCOPED) {
    assert.equal(await write(table, me, null, "personal:" + victim), false, table + ": another person's personal scope");
    assert.equal(await write(table, me, null, "workspace:" + org + ":memory"), false, table + ": a workspace scope on a personal row");
    assert.equal(await write(table, me, null, "personal:" + me), true, table + ": one's own personal scope");
  }
  for (const table of ["timewarp_operations", "timewarp_operation_runs", "timewarp_chat_sessions", "timewarp_cloud_snapshots"]) {
    assert.equal(await write(table, me, org, `workspace:${org}:member:${victim}`), false, table + ": another member's scope");
    assert.equal(await write(table, me, org, `workspace:${org}:member:${me}`), true, table + ": one's own member scope");
    assert.equal(await write(table, outsider, org, `workspace:${org}:member:${outsider}`), false, table + ": someone outside the workspace");
  }
  for (const table of ["timewarp_operations", "timewarp_operation_runs", "timewarp_chat_sessions"]) {
    assert.equal(await write(table, me, org, `workspace:${org}:memory`), false, table + ": private rows aren't shared memory");
  }
  // Shared workspace memory stays shared among members, as before.
  for (const table of ["timewarp_cloud_snapshots", "timewarp_memory_facts", "timewarp_memory_episodes"]) {
    assert.equal(await write(table, me, org, `workspace:${org}:memory`), true, table + ": shared memory");
    assert.equal(await write(table, outsider, org, `workspace:${org}:memory`), false, table + ": shared memory from outside");
  }
});

test("a row can't be moved into someone else's scope, and the server still writes any", async t => {
  const { db, as, allowed } = await fixture(t);
  await db.exec(migration());
  await as(me, "authenticated", `insert into public.timewarp_operations(user_id, scope_key, local_id) values($1, $2, 'mine')`, [me, "personal:" + me]);
  assert.equal(await allowed(me, "update public.timewarp_operations set scope_key = $1 where local_id = 'mine'", ["personal:" + victim]), false);
  assert.equal((await db.query("select scope_key from public.timewarp_operations where local_id = 'mine'")).rows[0].scope_key, "personal:" + me);
  // The cloud functions write with the service role.
  await as(null, "service_role", `insert into public.timewarp_operations(user_id, scope_key, local_id) values($1, $2, 'server')`, [victim, "personal:" + victim]);
  // Someone else's rows stay out of sight.
  assert.deepEqual((await as(me, "authenticated", "select local_id from public.timewarp_operations order by local_id")).rows.map(row => row.local_id), ["mine"]);
});

test("a profile's own answers stay editable while its start date stays with the server", async t => {
  const { db, as, allowed } = await fixture(t);
  await db.exec(migration());
  assert.equal(await allowed(me, "update public.profiles set created_at = now() + interval '1 day' where user_id = $1", [me]), false);
  assert.equal(await allowed(me, "update public.profiles set id = gen_random_uuid() where user_id = $1", [me]), false);
  // The previous app renames, and saves onboarding as an upsert on user_id.
  assert.equal(await allowed(me, "update public.profiles set name = 'Renamed' where user_id = $1", [me]), true);
  const upsert = `insert into public.profiles(user_id, email, name, interests, storage_preference, last_cloud_sync_at, work_stack, onboarded)
    values($1, 'me@example.invalid', 'Me', 'design', 'local', null, '["notion"]', true)
    on conflict (user_id) do update set user_id = excluded.user_id, email = excluded.email, name = excluded.name, interests = excluded.interests,
      storage_preference = excluded.storage_preference, last_cloud_sync_at = excluded.last_cloud_sync_at, work_stack = excluded.work_stack, onboarded = excluded.onboarded`;
  assert.equal(await allowed(me, upsert, [me]), true, "onboarding saves over an existing profile");
  assert.equal(await allowed(victim, upsert, [victim]), true, "onboarding creates a missing profile");
  const [row] = (await as(me, "authenticated", "select name, onboarded, created_at from public.profiles where user_id = $1", [me])).rows;
  assert.deepEqual([row.name, row.onboarded, row.created_at.toISOString()], ["Me", true, "2026-09-01T00:00:00.000Z"]);
  // Nobody writes another person's profile.
  assert.equal(await allowed(me, "update public.profiles set name = 'x' where user_id = $1 returning id", [victim]).then(async ok => ok && (await db.query("select name from public.profiles where user_id = $1", [victim])).rows[0].name === "x"), false);
});
