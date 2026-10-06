"use strict";
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{stripTypeScriptTypes}=require('node:module');
const {PGlite}=require('@electric-sql/pglite');
const user='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
const file=name=>fs.readFileSync(path.join(__dirname,'..',name),'utf8');
function moduleOf(name,bindings){const source=stripTypeScriptTypes(file(name),{mode:'strip'}).replace(/^import[^\n]*\n/gm,'').replace(/export /g,'');const ctx=vm.createContext(bindings);vm.runInContext(source,ctx);return ctx;}
test('durable AI settlement migration preserves known usage and safely recovers it',async t=>{
  const db=new PGlite();t.after(()=>db.close());
  await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);insert into auth.users values('${user}'),('${other}');
    create table public.timewarp_agent_ai_reservations(id uuid primary key,user_id uuid references auth.users,credits numeric not null,status text default 'reserved',settlement jsonb,created_at timestamptz default now(),updated_at timestamptz default now());
    create table test_ledger(user_id uuid,cost numeric);create table test_fault(enabled boolean);insert into test_fault values(true);
    create function public.timewarp_energy_settle_ai_cost(uuid,uuid,text,integer,integer,numeric) returns jsonb language plpgsql as $$begin insert into test_ledger values($1,$6);if(select enabled from test_fault)then raise exception 'Simulated ledger outage';end if;return jsonb_build_object('settled',true);end$$;`);
  const baseline=file('supabase/migrations/20261005130000_energy_billing_and_account_persistence.sql');
  await db.exec(baseline.slice(baseline.indexOf('CREATE OR REPLACE FUNCTION public.timewarp_energy_finish_ai('),baseline.indexOf('REVOKE ALL ON FUNCTION public.timewarp_energy_settle_ai_cost')));
  await db.exec(file('supabase/migrations/20261006100000_desktop_ai_settlement_recovery.sql'));
  const reserve=async()=>{const id=crypto.randomUUID();await db.query('insert into timewarp_agent_ai_reservations(id,user_id,credits) values($1,$2,100)',[id,user]);return id;};
  const complete=async(id,outcome='settled',input=100,output=50,cost=0.02,owner=user)=>(await db.query('select public.timewarp_energy_complete_ai($1,$2,$3,$4,$5,$6,$7) result',[id,owner,'openai/gpt-5.6-luna',input,output,cost,outcome])).rows[0].result;
  const queue=async id=>(await db.query('select * from timewarp_desktop_ai_settlements where reservation_id=$1',[id])).rows[0];
  await t.test('ledger failure commits usage evidence and rolls back partial charges',async()=>{
    const id=await reserve();assert.equal((await complete(id)).reconciliationPending,true);const q=await queue(id);assert.equal(q.input_tokens,100);assert.equal(q.output_tokens,50);assert.equal(q.status,'pending');assert.equal((await db.query('select * from test_ledger')).rows.length,0);
    await db.exec('update test_fault set enabled=false;update timewarp_desktop_ai_settlements set next_attempt_at=now()');
    assert.equal((await db.query('select public.timewarp_energy_retry_ai_settlements(100) result')).rows[0].result.processed,1);assert.equal((await queue(id)).status,'done');assert.equal((await db.query('select * from test_ledger')).rows.length,1);
    await complete(id);await db.query('select public.timewarp_energy_retry_ai_settlements(100)');assert.equal((await db.query('select * from test_ledger')).rows.length,1);
  });
  await t.test('simultaneous completions debit once',async()=>{const id=await reserve();const before=(await db.query('select count(*)::int n from test_ledger')).rows[0].n;await Promise.all([complete(id),complete(id)]);assert.equal((await db.query('select count(*)::int n from test_ledger')).rows[0].n,before+1);});
  await t.test('unknown usage requires review and never auto releases or charges',async()=>{const id=await reserve();await complete(id,'uncertain',0,0,0);assert.equal((await queue(id)).status,'review');assert.equal((await db.query('select status from timewarp_agent_ai_reservations where id=$1',[id])).rows[0].status,'uncertain');await db.query('select public.timewarp_energy_retry_ai_settlements(100)');assert.equal((await queue(id)).status,'review');await complete(id);assert.equal((await queue(id)).status,'done');});
  await t.test('known usage cannot be downgraded or overwritten while pending',async()=>{await db.exec('update test_fault set enabled=true');const id=await reserve();await complete(id);await complete(id,'uncertain',0,0,0);assert.equal((await queue(id)).outcome,'settled');assert.equal((await queue(id)).input_tokens,100);await assert.rejects(complete(id,'settled',101,50,.02),/Conflicting/);await db.exec('update test_fault set enabled=false');});
  await t.test('foreign users, invalid bounds and browser roles cannot edit recovery records',async()=>{const id=await reserve();await assert.rejects(complete(id,'settled',100,50,.02,other),/not found/);await assert.rejects(complete(id,'settled',100,50,100),/Invalid/);await assert.rejects(complete(id,'uncertain',1,0,0),/known usage/);assert.equal(await queue(id),undefined);await db.exec('set role authenticated');await assert.rejects(db.query('select * from timewarp_desktop_ai_settlements'),/permission denied/);await assert.rejects(complete(id),/permission denied/);await db.exec('reset role');});
  await t.test('retry exhaustion becomes operator review and stale unrecorded reservations are visible',async()=>{const id=await reserve();await db.exec('update test_fault set enabled=true');await complete(id);await db.query("update timewarp_desktop_ai_settlements set attempts=11,next_attempt_at=now() where reservation_id=$1",[id]);await db.query('select public.timewarp_energy_retry_ai_settlements(100)');assert.equal((await queue(id)).status,'review');assert.equal((await queue(id)).attempts,12);await db.exec('update test_fault set enabled=false');await complete(id);assert.equal((await queue(id)).status,'done');const orphan=await reserve();await db.query("update timewarp_agent_ai_reservations set created_at=now()-interval '20 minutes' where id=$1",[orphan]);assert.ok((await db.query('select public.timewarp_energy_ai_reconciliation_status() result')).rows[0].result.unrecordedStale>0);await assert.rejects(db.query('select public.timewarp_energy_retry_ai_settlements(101)'),/Invalid/);});
});
test('the reservation helper retries database transport failure without discarding final usage',async()=>{
  const calls=[],logs=[];let failing=false;
  const ctx=moduleOf('cloud/agentAiReservation.ts',{TextEncoder,crypto,setTimeout:resolve=>resolve(),console:{error:(...args)=>logs.push(args)},computeCostUsd:()=>.02,AI_COST_MARKUP:2.5,USD_PER_CREDIT:.125});
  const admin={rpc:async(name,input)=>{calls.push({name,input});return name==='timewarp_reserve_agent_ai'?{data:true}:failing?{error:{message:'offline'}}:{data:{reconciliationPending:true}};}};
  const reservation=await ctx.reserveAgentAi(admin,user,'openai/gpt-5.6-luna',{});failing=true;await assert.rejects(reservation.finish('settled',100,50),/reconciliation/);failing=false;await reservation.finish('uncertain');
  for(const c of calls.filter(x=>x.name==='timewarp_energy_complete_ai')){assert.equal(c.input.p_outcome,'settled');assert.equal(c.input.p_input,100);assert.equal(c.input.p_output,50);assert.equal(c.input.p_id,reservation.id);}
  assert.equal(logs[0][1].inputTokens,100);assert.equal(logs[0][1].outputTokens,50);assert.equal(logs[0][1].outcome,'settled');assert.ok(!Object.keys(logs[0][1]).includes('body'));
});
test('stream metering reads a terminal event without a newline and preserves it after a stream failure',async()=>{
  for(const failAfter of [false,true]){const finishes=[];let settle,read=0;const terminal='data: '+JSON.stringify({type:'response.completed',response:{usage:{input_tokens:100,output_tokens:50}}});
    const stream=new ReadableStream({async pull(controller){if(read++===0)controller.enqueue(new TextEncoder().encode(terminal+(failAfter?'\n':'')));else if(failAfter){await new Promise(resolve=>setTimeout(resolve,20));controller.error(new Error('transport'));}else controller.close();}});
    const ctx=moduleOf('cloud/nativeResponses.ts',{TextEncoder,TextDecoder,Response,AbortSignal,console:{error(){}},EdgeRuntime:{waitUntil:value=>{settle=value;}},assertCloudSafe(){},azureLunaModel:()=> 'luna',azureSolKeys:()=>['fixture'],azureLunaKeys:()=>['fixture'],azureFoundryBase:()=> 'https://fixture.invalid',fetch:async()=>new Response(stream),reserveAgentAi:async()=>({id:'fixture',finish:async(...args)=>{finishes.push(args);return{};}})});
    const result=await ctx.nativeStream({},user,'sol',{},{});await result.text().catch(()=>{});await settle;assert.equal(finishes[0][0],'settled');assert.equal(finishes[0][1],100);assert.equal(finishes[0][2],50);
  }
});
