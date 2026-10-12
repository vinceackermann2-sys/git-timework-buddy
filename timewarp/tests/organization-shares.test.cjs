"use strict";
// Share invites between members of an organization: the database rules
// (20261012150000_organization_shares.sql) in PGlite, reached through the
// workspace service's real actions and the account adapter.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {stripTypeScriptTypes}=require('node:module'),{PGlite}=require('@electric-sql/pglite');
const root=path.resolve(__dirname,'..');
const uid=n=>`${String(n).padStart(8,'0')}-2222-4222-8222-222222222222`;
const sender=uid(1),colleague=uid(2),other=uid(3),outsider=uid(4),org=uid(10),otherOrg=uid(11);
const migration=()=>fs.readFileSync(path.join(root,'supabase/migrations/20261012150000_organization_shares.sql'),'utf8');
function moduleOf(file,bindings={}){const source=stripTypeScriptTypes(fs.readFileSync(path.join(root,file),'utf8'),{mode:'strip'}).replace(/^import[^\n]*\n/gm,'').replace(/export /g,'');const ctx=vm.createContext({crypto:globalThis.crypto,TextEncoder,Response,Request,Date,AbortSignal,console,...bindings});vm.runInContext(source,ctx);return ctx;}
async function fixture(t){
  const db=new PGlite();t.after(()=>db.close());
  await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;
    create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create table auth.users(id uuid primary key,email text);
    insert into auth.users(id,email) values('${sender}','sender@example.invalid'),('${colleague}','colleague@example.invalid'),('${other}','other@example.invalid'),('${outsider}','outside@example.invalid');
    create table timewarp_workspaces(id uuid primary key,name text,settings jsonb default '{}',created_by uuid references auth.users);
    create table timewarp_workspace_members(id uuid primary key default gen_random_uuid(),workspace_id uuid references timewarp_workspaces on delete cascade,user_id uuid references auth.users,email text,name text,role text check(role in ('owner','admin','lead')),status text default 'active' check(status in ('active','removed')),joined_at timestamptz default now(),unique(workspace_id,user_id));
    insert into timewarp_workspaces(id,name,created_by) values('${org}','Acme','${sender}'),('${otherOrg}','Other','${outsider}');
    insert into timewarp_workspace_members(workspace_id,user_id,email,name,role) values('${org}','${sender}','sender@example.invalid','Sam Sender','owner'),('${org}','${colleague}','colleague@example.invalid','Cam Colleague','lead'),('${org}','${other}','other@example.invalid','Oli Other','lead'),('${otherOrg}','${outsider}','outside@example.invalid','Out Sider','owner'),('${otherOrg}','${colleague}','colleague@example.invalid','Cam Colleague','lead');
    grant usage on schema public,auth to anon,authenticated,service_role;`);
  await db.exec(migration());
  // The service client's rpc(), as PostgREST calls it: named arguments.
  const admin={rpc:async(name,args)=>{const keys=Object.keys(args);try{const r=await db.query(`select public.${name}(${keys.map((k,i)=>`${k} => $${i+1}`).join(',')}) as result`,keys.map(k=>args[k]));return{data:r.rows[0].result,error:null};}catch(error){return{data:null,error:{code:error.code,message:error.message}};}}};
  const rpc=async(name,args)=>(await admin.rpc(name,args)).data;
  const create=(from,recipients,fields={})=>rpc('timewarp_create_shares',{p_sender:from,p_workspace_id:fields.workspace||org,p_kind:fields.kind||'chat',p_recipients:recipients,p_title:fields.title??'Launch plan',p_summary:fields.summary||{messages:2},p_payload:fields.payload||{version:1,messages:[{role:'user',text:'Hi'}]}});
  const list=user=>rpc('timewarp_list_shares',{p_user:user});
  const open=(user,id)=>rpc('timewarp_open_share',{p_user:user,p_share_id:id});
  const respond=(user,id,action)=>rpc('timewarp_respond_share',{p_user:user,p_share_id:id,p_action:action});
  const actor=async(user,role,fn)=>{await db.query("select set_config('request.jwt.claim.sub',$1,false)",[user]);await db.exec('set role '+role);try{return await fn();}finally{await db.exec('reset role');}};
  return{db,admin,create,list,open,respond,actor};
}

test('shares go only to active members of the sender\'s organization',async t=>{
  const{create,db}=await fixture(t);
  const sent=await create(sender,[colleague,other,colleague,sender]);
  assert.equal(sent.status,'ok');
  assert.equal(sent.ids.length,2,'Duplicates and the sender are left out.');
  assert.equal((await create(sender,[outsider])).status,'not_member');
  assert.equal((await create(outsider,[colleague])).status,'forbidden','Outsiders cannot send into an organization.');
  assert.equal((await create(sender,[colleague],{workspace:otherOrg})).status,'forbidden');
  assert.equal((await create(sender,[sender])).status,'invalid');
  assert.equal((await create(sender,[colleague],{kind:'vault'})).status,'invalid');
  assert.equal((await create(sender,[colleague],{title:'  '})).status,'invalid');
  assert.equal((await create(sender,[colleague],{payload:{text:'x'.repeat(1_950_000)}})).status,'too_large');
  assert.equal((await create(sender,Array.from({length:21},(_,i)=>uid(100+i)))).status,'invalid');
  await db.query("update timewarp_workspace_members set status='removed' where user_id=$1 and workspace_id=$2",[other,org]);
  assert.equal((await create(sender,[other])).status,'not_member','Removed members get no new shares.');
});

test('each person sees only their own waiting shares, without content',async t=>{
  const{create,list}=await fixture(t);
  const{ids:[id]}=await create(sender,[colleague],{title:'Q3 plan',summary:{messages:3}});
  const received=await list(colleague);
  assert.equal(received.incoming.length,1);
  assert.equal(received.incoming[0].id,id);
  assert.equal(received.incoming[0].sender.name,'Sam Sender');
  assert.equal(received.incoming[0].organizationName,'Acme');
  assert.equal(received.incoming[0].payload,undefined,'Listing never carries the content.');
  assert.equal((await list(sender)).outgoing[0].recipient.email,'colleague@example.invalid');
  for(const user of [other,outsider]){const value=await list(user);assert.deepEqual([value.incoming.length,value.outgoing.length],[0,0]);}
});

test('only the recipient opens a share, and answering clears its content',async t=>{
  const{create,open,respond,db}=await fixture(t);
  const{ids:[id]}=await create(sender,[colleague]);
  for(const user of [sender,other,outsider])assert.equal((await open(user,id)).status,'not_found');
  const opened=await open(colleague,id);
  assert.equal(opened.status,'ok');
  assert.deepEqual(opened.share.payload.messages[0],{role:'user',text:'Hi'});
  assert.equal(await respond(other,id,'accept'),'not_found','Another member cannot accept it.');
  assert.equal(await respond(colleague,id,'cancel'),'not_found','Only the sender cancels.');
  assert.equal(await respond(colleague,id,'accept'),'ok');
  assert.equal(await respond(colleague,id,'accept'),'not_found','A share is answered once.');
  const row=(await db.query('select status,payload,responded_at from timewarp_shares where id=$1',[id])).rows[0];
  assert.equal(row.status,'accepted');assert.equal(row.payload,null);assert.ok(row.responded_at);
  assert.equal((await open(colleague,id)).status,'not_found');
});

test('declines, cancels, expiry and leaving the organization end a share',async t=>{
  const{create,open,respond,list,db}=await fixture(t);
  const{ids:[declined]}=await create(sender,[colleague]);
  assert.equal(await respond(colleague,declined,'decline'),'ok');
  const{ids:[canceled]}=await create(sender,[colleague]);
  assert.equal(await respond(sender,canceled,'cancel'),'ok');
  assert.equal(await respond(colleague,canceled,'accept'),'not_found');
  const{ids:[expired]}=await create(sender,[colleague]);
  await db.query("update timewarp_shares set expires_at=now()-interval '1 second' where id=$1",[expired]);
  assert.equal((await open(colleague,expired)).status,'not_found');
  assert.equal(await respond(colleague,expired,'accept'),'not_found');
  await create(sender,[other]);
  assert.equal((await db.query('select payload from timewarp_shares where id=$1',[expired])).rows[0].payload,null,'Expired shares lose their content.');
  const{ids:[left]}=await create(sender,[colleague]);
  await db.query("update timewarp_workspace_members set status='removed' where user_id=$1 and workspace_id=$2",[sender,org]);
  assert.equal((await list(colleague)).incoming.length,0,'A share from someone who left is no longer offered.');
  assert.equal((await open(colleague,left)).status,'not_found');
  assert.equal(await respond(colleague,left,'accept'),'not_found');
});

test('browser and anonymous roles cannot reach shares or their functions',async t=>{
  const{create,actor,db}=await fixture(t);
  const{ids:[id]}=await create(sender,[colleague]);
  for(const role of ['authenticated','anon']){
    await actor(colleague,role,async()=>{
      await assert.rejects(db.query('select * from timewarp_shares'),/permission denied/);
      await assert.rejects(db.exec('truncate timewarp_shares'),/permission denied/);
      await assert.rejects(db.query('select timewarp_open_share($1,$2)',[colleague,id]),/permission denied/);
      await assert.rejects(db.query("select timewarp_respond_share($1,$2,'accept')",[colleague,id]),/permission denied/);
      await assert.rejects(db.query("select timewarp_create_shares($1,$2,'chat',array[$3]::uuid[],'x','{}','{}')",[colleague,org,sender]),/permission denied/);
    });
  }
});

// The workspace service's actions, against the same database.
async function service(t,user){
  const f=await fixture(t);
  let handler=null;
  const ctx=moduleOf('supabase/functions/timewarp-workspaces/index.ts',{
    Deno:{env:{get:name=>({SUPABASE_URL:'https://fixture.invalid',SUPABASE_SERVICE_ROLE_KEY:'service'})[name]||''},serve(fn){handler=fn;}},
    createClient:()=>f.admin,resolveUser:async()=>user,consumeRateLimit:async()=>({allowed:true}),envLimit:(_,fallback)=>fallback,rateLimitResponse:()=>new Response('{}',{status:429}),
  });
  const call=async body=>{const response=await handler(new Request('https://fixture.invalid/functions/v1/timewarp-workspaces',{method:'POST',headers:{authorization:'Bearer jwt'},body:JSON.stringify(body)}));return{status:response.status,body:await response.json()};};
  return{...f,ctx,call};
}
test('the workspace service creates, lists, opens and answers shares',async t=>{
  const s=await service(t,{id:sender,email:'sender@example.invalid'});
  const made=await s.call({action:'createShares',workspaceId:org,kind:'agent',recipientUserIds:[colleague],title:'Research Scout',summary:{workflows:[]},payload:{version:1,name:'Research Scout'}});
  assert.equal(made.status,200);assert.equal(made.body.ids.length,1);
  assert.deepEqual((await s.call({action:'createShares',workspaceId:org,kind:'agent',recipientUserIds:[outsider],title:'x',payload:{}})).body.error,'Choose people who are in this organization.');
  assert.equal((await s.call({action:'createShares',workspaceId:org,kind:'agent',recipientUserIds:[],title:'x',payload:{}})).status,400);
  assert.equal((await s.call({action:'listShares'})).body.outgoing.length,1);
  assert.equal((await s.call({action:'openShare',shareId:made.body.ids[0]})).status,404,'The sender cannot open what they sent.');
  assert.equal((await s.call({action:'respondShare',shareId:made.body.ids[0],response:'cancel'})).status,200);
  assert.equal((await s.call({action:'respondShare',shareId:made.body.ids[0],response:'cancel'})).status,404);
});
test('the workspace service refuses sharing while its database functions are missing',async t=>{
  const ctx=moduleOf('supabase/functions/timewarp-workspaces/index.ts',{Deno:{env:{get:()=>''},serve(){}},createClient(){}});
  const admin={rpc:async()=>({data:null,error:{code:'PGRST202',message:'missing'}})};
  await assert.rejects(vm.runInContext('shareRpc',ctx)(admin,'timewarp_list_shares',{p_user:sender}),error=>error.status===503);
});

const plain=value=>JSON.parse(JSON.stringify(value));
test('the account adapter sends shares to the chosen organization through the workspace service',async()=>{
  const calls=[];
  const ctx=moduleOf('cloud/nativeAccount.ts',{Deno:{env:{get:()=> 'https://fixture.invalid'}},fetch:async(_url,options)=>{const input=JSON.parse(options.body);calls.push(input);return Response.json(input.action==='createShares'?{ids:[uid(50)]}:input.action==='openShare'?{share:{id:uid(50),kind:'chat',payload:{}}}:{incoming:[],outgoing:[]});}});
  const user={id:sender,email:'sender@example.invalid'};
  assert.deepEqual(plain(await ctx.accountProduct({},user,'jwt','product.shares.create',{organizationId:org,kind:'chat',recipientUserIds:[colleague],title:'Plan',summary:{messages:1},payload:{version:1}})),{ids:[uid(50)]});
  assert.deepEqual(calls[0],{action:'createShares',workspaceId:org,kind:'chat',recipientUserIds:[colleague],title:'Plan',summary:{messages:1},payload:{version:1}});
  await assert.rejects(ctx.accountProduct({},user,'jwt','product.shares.create',{organizationId:org,kind:'vault',recipientUserIds:[colleague],payload:{}}),error=>error.status===400);
  await assert.rejects(ctx.accountProduct({},user,'jwt','product.shares.create',{organizationId:'not-an-id',kind:'chat',recipientUserIds:[colleague],payload:{}}),error=>error.status===400);
  await assert.rejects(ctx.accountProduct({},user,'jwt','product.shares.respond',{shareId:uid(50),response:'delete'}),error=>error.status===400);
  assert.equal((await ctx.accountProduct({},user,'jwt','product.shares.open',{shareId:uid(50)})).kind,'chat');
  assert.deepEqual(calls.at(-1),{action:'openShare',shareId:uid(50)});
});
