"use strict";
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {stripTypeScriptTypes}=require('node:module'),{PGlite}=require('@electric-sql/pglite');
const root=path.resolve(__dirname,'..');
const uid=n=>`${String(n).padStart(8,'0')}-1111-4111-8111-111111111111`;
const owner=uid(1),adminUser=uid(2),member=uid(3),outsider=uid(4),org=uid(10),otherOrg=uid(11);
const migration=()=>fs.readFileSync(path.join(root,'supabase/migrations/20261008133105_organization_membership_security.sql'),'utf8');
function moduleOf(file,bindings={}){const source=stripTypeScriptTypes(fs.readFileSync(path.join(root,file),'utf8'),{mode:'strip'}).replace(/^import[^\n]*\n/gm,'').replace(/export /g,'');const ctx=vm.createContext({crypto:globalThis.crypto,TextEncoder,Response,Date,AbortSignal,console,...bindings});vm.runInContext(source,ctx);return ctx;}
async function fixture(t){
  const db=new PGlite();t.after(()=>db.close());
  // Minimum production schema and the deployed 8 October grants/policies.
  await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;
    create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}');
    create function auth.jwt() returns jsonb language sql as $$select jsonb_build_object('email',(select email from auth.users where id=auth.uid()))$$;
    grant select on auth.users to authenticated;
    insert into auth.users(id,email,email_confirmed_at) values('${owner}','owner@example.invalid',now()),('${adminUser}','admin@example.invalid',now()),('${member}','member@example.invalid',now()),('${outsider}','outside@example.invalid',now());
    create table timewarp_workspaces(id uuid primary key,name text,settings jsonb default '{}',created_by uuid references auth.users);
    create table timewarp_workspace_members(id uuid primary key default gen_random_uuid(),workspace_id uuid references timewarp_workspaces on delete cascade,user_id uuid references auth.users,email text,name text,role text check(role in ('owner','admin','lead')),status text default 'active',joined_at timestamptz default now(),unique(workspace_id,user_id));
    create table timewarp_workspace_invites(id uuid primary key default gen_random_uuid(),workspace_id uuid references timewarp_workspaces on delete cascade,email text,role text,token_hash text unique,invited_by uuid,invited_by_email text,status text default 'pending',expires_at timestamptz default now()+interval '14 days',accepted_by uuid,accepted_at timestamptz);
    insert into timewarp_workspaces(id,name,created_by) values('${org}','Audit','${owner}'),('${otherOrg}','Other','${outsider}');
    insert into timewarp_workspace_members(id,workspace_id,user_id,email,name,role) values('${uid(21)}','${org}','${owner}','owner@example.invalid','Owner','owner'),('${uid(22)}','${org}','${adminUser}','admin@example.invalid','Admin','admin'),('${uid(23)}','${org}','${member}','member@example.invalid','Member','lead'),('${uid(24)}','${otherOrg}','${outsider}','outside@example.invalid','Outside','owner');
    create function timewarp_is_workspace_member(uuid) returns boolean language sql security definer as $$select exists(select 1 from timewarp_workspace_members where workspace_id=$1 and user_id=auth.uid() and status='active')$$;
    create function timewarp_can_manage_workspace(uuid) returns boolean language sql security definer as $$select exists(select 1 from timewarp_workspace_members where workspace_id=$1 and user_id=auth.uid() and status='active' and role in ('owner','admin'))$$;
    alter table timewarp_workspaces enable row level security;alter table timewarp_workspace_members enable row level security;alter table timewarp_workspace_invites enable row level security;
    create policy "Workspace members view workspaces" on timewarp_workspaces for select to authenticated using(timewarp_is_workspace_member(id));
    create policy "Workspace managers update workspaces" on timewarp_workspaces for update to authenticated using(timewarp_can_manage_workspace(id)) with check(timewarp_can_manage_workspace(id));
    create policy "Workspace members view members" on timewarp_workspace_members for select to authenticated using(timewarp_is_workspace_member(workspace_id));
    create policy "Workspace managers update members" on timewarp_workspace_members for update to authenticated using(timewarp_can_manage_workspace(workspace_id)) with check(timewarp_can_manage_workspace(workspace_id));
    create policy "Workspace managers insert members" on timewarp_workspace_members for insert to authenticated with check(timewarp_can_manage_workspace(workspace_id));
    create policy "Workspace managers delete members" on timewarp_workspace_members for delete to authenticated using(timewarp_can_manage_workspace(workspace_id));
    create policy "Workspace members view invites" on timewarp_workspace_invites for select to authenticated using(timewarp_is_workspace_member(workspace_id));
    create policy "Workspace managers insert invites" on timewarp_workspace_invites for insert to authenticated with check(timewarp_can_manage_workspace(workspace_id));
    create policy "Workspace managers update invites" on timewarp_workspace_invites for update to authenticated using(timewarp_can_manage_workspace(workspace_id)) with check(timewarp_can_manage_workspace(workspace_id));
    grant usage on schema public,auth to anon,authenticated,service_role;grant all on timewarp_workspaces,timewarp_workspace_members,timewarp_workspace_invites to anon,authenticated,service_role;
    create function enforce_slots() returns trigger language plpgsql as $$begin
      if new.status='active' and (tg_op='INSERT' or old.status<>'active') then
        perform pg_advisory_xact_lock(hashtext('timewarp_team_workspace_limit'),hashtext(new.user_id::text));
        if (select count(*) from timewarp_workspace_members where user_id=new.user_id and status='active' and workspace_id<>new.workspace_id)>=3 then raise exception 'TIMEWARP_TEAM_WORKSPACE_LIMIT_REACHED';end if;
      end if;return new;end$$;
    create trigger enforce_slots before insert or update of status on timewarp_workspace_members for each row execute function enforce_slots();`);
  const actor=async(user,role,fn)=>{await db.query("select set_config('request.jwt.claim.sub',$1,false)",[user]);await db.exec('set role '+role);try{return await fn();}finally{await db.exec('reset role');}};
  const roleOf=async user=>(await db.query('select role,status from timewarp_workspace_members where workspace_id=$1 and user_id=$2',[org,user])).rows[0];
  const change=async(user,target,action,newRole=null,workspace=org)=>(await db.query('select timewarp_change_member_guarded($1,$2,$3,$4,$5) result',[user,workspace,target,action,newRole])).rows[0].result;
  const invite=async(email='outside@example.invalid',role='lead',fields={})=>{const id=crypto.randomUUID(),hash=crypto.randomUUID();await db.query('insert into timewarp_workspace_invites(id,workspace_id,email,role,token_hash,invited_by,status,expires_at) values($1,$2,$3,$4,$5,$6,$7,$8)',[id,org,email,role,hash,owner,fields.status||'pending',fields.expires||new Date(Date.now()+86400000)]);return{id,hash};};
  const accept=async(user,inv,byToken=false)=>(await db.query('select timewarp_accept_workspace_invite($1,$2,$3) result',[user,byToken?null:inv.id,byToken?inv.hash:null])).rows[0].result;
  return{db,actor,roleOf,change,invite,accept};
}
test('the deployed grants reproduced admin privilege escalation and anonymous TRUNCATE in isolated PostgreSQL',async t=>{
  const{db,actor,roleOf}=await fixture(t);
  await actor(adminUser,'authenticated',()=>db.query("update timewarp_workspace_members set role='owner' where user_id=$1",[adminUser]));
  assert.equal((await roleOf(adminUser)).role,'owner');
  await actor(adminUser,'authenticated',()=>db.query("update timewarp_workspace_members set role='lead' where user_id=$1",[owner]));
  assert.equal((await roleOf(owner)).role,'lead');
  await actor(outsider,'anon',()=>db.exec('truncate timewarp_workspace_invites'));
});
test('organization migration closes direct database mutation paths and retains scoped reads',async t=>{
  const{db,actor}=await fixture(t);await db.exec(migration());
  for(const table of ['timewarp_workspaces','timewarp_workspace_members','timewarp_workspace_invites']){
    for(const operation of [`truncate ${table}`,`delete from ${table}`])await actor(adminUser,'authenticated',()=>assert.rejects(db.exec(operation),/permission denied/));
    await actor(outsider,'anon',()=>assert.rejects(db.exec('truncate '+table),/permission denied/));
  }
  await actor(adminUser,'authenticated',()=>assert.rejects(db.exec("update timewarp_workspace_members set role='owner'"),/permission denied/));
  await actor(adminUser,'authenticated',()=>assert.rejects(db.exec("insert into timewarp_workspace_invites(workspace_id,email,role) values('"+org+"','attack@example.invalid','owner')"),/permission denied/));
  const own=await actor(member,'authenticated',()=>db.query('select * from timewarp_workspace_members'));assert.equal(own.rows.length,3);
  const foreign=await actor(outsider,'authenticated',()=>db.query('select * from timewarp_workspace_members where workspace_id=$1',[org]));assert.equal(foreign.rows.length,0);
});
test('member changes recheck the actor and protect owners inside the transaction',async t=>{
  const{db,change,roleOf,actor}=await fixture(t);await db.exec(migration());
  await t.test('members and outsiders cannot change another member',async()=>{assert.equal(await change(member,uid(22),'set_role','owner'),'forbidden');assert.equal(await change(outsider,uid(22),'remove'),'forbidden');});
  await t.test('admins cannot promote owners or demote/remove owners',async()=>{assert.equal(await change(adminUser,uid(22),'set_role','owner'),'forbidden');assert.equal(await change(adminUser,uid(21),'set_role','lead'),'forbidden');assert.equal(await change(adminUser,uid(21),'remove'),'forbidden');});
  await t.test('last owner cannot leave or demote themselves',async()=>{assert.equal(await change(owner,uid(21),'remove'),'last_owner');assert.equal(await change(owner,uid(21),'set_role','admin'),'last_owner');});
  await t.test('only owners can appoint owners, and one must remain',async()=>{assert.equal(await change(owner,uid(22),'set_role','owner'),'ok');const results=await Promise.all([change(owner,uid(21),'set_role','lead'),change(adminUser,uid(22),'remove')]);assert.deepEqual(results,['ok','last_owner']);assert.equal((await roleOf(adminUser)).role,'owner');});
  await t.test('removed and demoted actors lose manager authority',async()=>{assert.equal(await change(owner,uid(23),'set_role','admin'),'forbidden');assert.equal(await change(adminUser,uid(23),'set_role','admin'),'ok');assert.equal(await change(adminUser,uid(23),'remove'),'ok');assert.equal(await change(member,uid(22),'remove'),'forbidden');});
  await t.test('members can leave and targets cannot cross organizations',async()=>{assert.equal(await change(owner,uid(21),'remove'),'ok');assert.equal(await change(adminUser,uid(24),'remove'),'not_found');});
  await t.test('guard RPCs are unavailable to browser and anonymous roles',async()=>{for(const role of ['authenticated','anon'])await actor(outsider,role,()=>assert.rejects(change(outsider,uid(22),'remove'),/permission denied/));});
});
test('invitation acceptance is atomic, email-bound, and cannot overwrite an active role',async t=>{
  const{db,invite,accept,roleOf,actor}=await fixture(t);await db.exec(migration());
  await t.test('wrong recipients, expired and revoked invitations cannot join',async()=>{const a=await invite();assert.equal((await accept(member,a)).status,'not_found');for(const fields of [{status:'revoked'},{expires:new Date(Date.now()-1000)}])assert.equal((await accept(outsider,await invite('outside@example.invalid','lead',fields))).status,'not_found');});
  await t.test('unconfirmed emails do not establish membership',async()=>{await db.query('update auth.users set email_confirmed_at=null where id=$1',[outsider]);assert.equal((await accept(outsider,await invite())).status,'unconfirmed');await db.query('update auth.users set email_confirmed_at=now() where id=$1',[outsider]);});
  await t.test('existing owners keep their role and original join time',async()=>{const before=(await db.query('select joined_at from timewarp_workspace_members where user_id=$1',[owner])).rows[0].joined_at;const a=await invite('owner@example.invalid','lead');assert.equal((await accept(owner,a)).status,'ok');assert.equal((await roleOf(owner)).role,'owner');assert.equal((await db.query('select joined_at from timewarp_workspace_members where user_id=$1',[owner])).rows[0].joined_at.getTime(),before.getTime());});
  await t.test('token and in-app acceptance consume the same invitation exactly once',async()=>{const a=await invite();const results=await Promise.all([accept(outsider,a,true),accept(outsider,a)]);assert.deepEqual(results.map(r=>r.status),['ok','not_found']);assert.equal((await roleOf(outsider)).role,'lead');assert.equal((await db.query('select status,accepted_by from timewarp_workspace_invites where id=$1',[a.id])).rows[0].accepted_by,outsider);});
  await t.test('failure while consuming the invitation rolls membership back',async()=>{await db.query("update timewarp_workspace_members set status='removed' where workspace_id=$1 and user_id=$2",[org,outsider]);await db.exec("create function reject_accept() returns trigger language plpgsql as $$begin if new.status='accepted' then raise exception 'Simulated invite write failure';end if;return new;end$$;create trigger reject_accept before update on timewarp_workspace_invites for each row execute function reject_accept();");const a=await invite();await assert.rejects(accept(outsider,a),/Simulated/);assert.equal((await roleOf(outsider)).status,'removed');assert.equal((await db.query('select status from timewarp_workspace_invites where id=$1',[a.id])).rows[0].status,'pending');await db.exec('drop trigger reject_accept on timewarp_workspace_invites');});
  await t.test('workspace limit failures leave both membership and invite unchanged',async()=>{for(let i=40;i<42;i++){await db.query('insert into timewarp_workspaces(id,name) values($1,$2)',[uid(i),'Limit']);await db.query("insert into timewarp_workspace_members(workspace_id,user_id,email,role) values($1,$2,'outside@example.invalid','owner')",[uid(i),outsider]);}const a=await invite();await assert.rejects(accept(outsider,a),/TIMEWARP_TEAM_WORKSPACE_LIMIT_REACHED/);assert.equal((await roleOf(outsider)).status,'removed');assert.equal((await db.query('select status from timewarp_workspace_invites where id=$1',[a.id])).rows[0].status,'pending');});
  await t.test('acceptance RPC cannot be called directly by browser roles',async()=>{const a=await invite();await actor(outsider,'authenticated',()=>assert.rejects(accept(outsider,a),/permission denied/));});
});
test('in-app acceptance preserves emailed tokens and delegates validation to the workspace service',async()=>{
  const calls=[];
  let table,updates=0;
  const query={select(){return this},eq(){return this},gt(){return this},update(){updates++;return this},then(resolve){return Promise.resolve({data:null,error:null}).then(resolve)},maybeSingle:async()=>({data:table==='timewarp_workspace_invites'?{id:uid(30),workspace_id:org}:null,error:null})};
  const admin={from:name=>{table=name;return query},rpc:async()=>({data:{plan:'free'},error:null})};
  const ctx=moduleOf('cloud/nativeAccount.ts',{Deno:{env:{get:()=> 'https://fixture.invalid'}},fetch:async(_url,options)=>{const input=JSON.parse(options.body);calls.push(input);return Response.json(input.action==='list'?{workspaces:[]}:{workspace:{id:org}});}});
  await ctx.accountProduct(admin,{id:outsider,email:'outside@example.invalid'},'jwt','product.organizations.invitations.accept',{invitationId:uid(30)});
  assert.equal(updates,0,'Acceptance must not invalidate an emailed invitation token.');
  assert.deepEqual(calls[1],{action:'acceptInvite',invitationId:uid(30)});
});
test('workspace mutation refuses an unavailable database guard rather than falling back to separate writes',async()=>{
  const ctx=moduleOf('supabase/functions/timewarp-workspaces/index.ts',{Deno:{env:{get:()=>''},serve(){}},createClient(){}});
  const admin={rpc:async()=>({error:{code:'PGRST202',message:'timewarp_change_member_guarded missing'}})};
  await assert.rejects(vm.runInContext('guardedMemberUpdate',ctx)(admin,owner,org,uid(21),'remove'),error=>error.status===503);
});
test('ordinary members receive the member directory without unrelated invitation details',async()=>{
  for(const role of ['lead','admin']){
    const calls=[];
    const admin={from(table){calls.push(table);const value=table==='timewarp_workspaces'?{id:org,name:'Organization'}:table==='timewarp_workspace_invites'?[{email:'future@example.invalid'}]:{id:uid(23),role};return{select(){return this},eq(){return this},order(){return this},maybeSingle:async()=>({data:value,error:null}),then(resolve){return Promise.resolve({data:Array.isArray(value)?value:[value],error:null}).then(resolve)}}}};
    const ctx=moduleOf('supabase/functions/timewarp-workspaces/index.ts',{Deno:{env:{get:()=>''},serve(){}},createClient(){}});
    const result=await vm.runInContext('loadWorkspaceDetails',ctx)(admin,member,org);
    assert.equal(result.members.length,1);
    assert.equal(result.invites.length,role==='admin'?1:0);
    assert.equal(calls.includes('timewarp_workspace_invites'),role==='admin');
  }
});
