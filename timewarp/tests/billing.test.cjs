"use strict";
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{stripTypeScriptTypes}=require('node:module');
function moduleOf(file,bindings={}){const source=stripTypeScriptTypes(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),{mode:'strip'}).replace(/^import[^\n]*\n/gm,'').replace(/export /g,'');const ctx=vm.createContext(bindings);vm.runInContext(source,ctx);return ctx;}
test('every offered plan and credit pack preserves margin at full redemption under conservative tax and fees',()=>{
  const ctx=moduleOf('cloud/nativeBilling.ts');
  const values=vm.runInContext('({plans:PLANS,markup:AI_COST_MARKUP,usdPerCredit:USD_PER_CREDIT})',ctx);
  assert.deepEqual(Array.from(values.plans,p=>p.monthlyUsd),[0,20,50,100]);
  const margin=(usd,credits)=>{const net=usd/1.25-usd*0.04-0.30;return(net-credits*values.usdPerCredit/values.markup)/net;};
  for(const p of values.plans.filter(p=>p.monthlyUsd))assert.ok(margin(p.monthlyUsd,p.monthlyCredits)>=0.65,p.id);
  for(const [credits,usd] of [[50,15],[100,30],[200,45],[300,60],[500,75],[750,100],[1000,125]])assert.ok(margin(usd,credits)>=0.47,String(credits));
});
test('checkout corrects mismatched live price and verifies the actual Stripe amount and recurrence',async()=>{
  const ctx=moduleOf('supabase/functions/_shared/energyPricing.ts'),created=[];
  const stripe={prices:{list:async()=>({data:[]}),retrieve:async()=>({id:'old',product:'prod-max',active:true,currency:'usd',unit_amount:3000,recurring:{interval:'month',interval_count:1}}),create:async(params,options)=>{created.push({params,options});return{id:'correct',active:true,...params,recurring:{...params.recurring,interval_count:1}};}}};
  assert.equal(await ctx.energyPlanPrice(stripe,'max','old'),'correct');assert.equal(created[0].params.unit_amount,5000);assert.equal(created[0].params.product,'prod-max');assert.equal(created[0].params.tax_behavior,'inclusive');assert.equal(created[0].options.idempotencyKey,created[0].params.lookup_key);
  stripe.prices.list=async()=>({data:[{id:'wrong',active:true,currency:'eur',unit_amount:5000,recurring:{interval:'month',interval_count:1},tax_behavior:'inclusive'}]});await assert.rejects(ctx.energyPlanPrice(stripe,'max','old'),/needs repair/);
});
test('billing always uses the personal scope and never accepts a client price or credit balance as entitlement',async()=>{
  const calls=[],ctx=moduleOf('cloud/nativeBilling.ts',{productionService:async(...args)=>{calls.push(args);return{plan:'free',credits:{packs:[]}};}});
  const result=await ctx.nativeBilling('jwt',{action:'status',workspaceId:'foreign',surface:'web'});
  assert.equal(calls[0][2].workspaceId,null);assert.equal(calls[0][2].surface,'energy');assert.equal(result.plans.length,4);assert.equal(result.credits.markup,2.5);
  await assert.rejects(ctx.nativeBilling('jwt',{action:'grant',credits:1000}),/Invalid billing action/);
});
test('model accounting uses current Luna rates, applies long-context cost, and refuses unpriced models',()=>{const ctx=moduleOf('cloud/aiCost.ts'),cost=vm.runInContext('computeCostUsd',ctx);assert.ok(Math.abs(cost('openai/gpt-5.6-luna',100000,10000)-0.032)<1e-9);assert.ok(Math.abs(cost('openai/gpt-5.6-sol',300000,10000)-2.7)<1e-9);assert.throws(()=>cost('openai/unpriced-expensive',10,10),/verified pricing/);});

test('monthly credit additions use a recurring combined price and reject unknown amounts',async()=>{
  const ctx=moduleOf('supabase/functions/_shared/energyPricing.ts'),created=[];
  const stripe={prices:{list:async()=>({data:[]}),retrieve:async()=>({id:'base',product:'pro-product',active:true,currency:'usd',unit_amount:2000,recurring:{interval:'month',interval_count:1},tax_behavior:'inclusive'}),create:async(params)=>{created.push(params);return{active:true,id:'combined',...params,recurring:{...params.recurring,interval_count:1}};}}};
  assert.equal(await ctx.energyPlanPrice(stripe,'pro','base',100),'combined');
  assert.equal(created[0].unit_amount,4000);assert.equal(created[0].recurring.interval,'month');assert.equal(created[0].metadata.energy_monthly_extra_credits,'100');
  const subscription={status:'active',id:'sub-fixture',items:{data:[{quantity:1,price:{...created[0],recurring:{interval:'month',interval_count:1}}}]}};
  assert.equal(ctx.energySubscriptionExtras(subscription,'pro'),100);
  assert.throws(()=>ctx.monthlyExtraCredits(123),/valid monthly/);assert.throws(()=>ctx.monthlyExtraCredits('100'),/valid monthly/);
  subscription.items.data[0].price.unit_amount=2000;assert.throws(()=>ctx.energySubscriptionExtras(subscription,'pro'),/needs repair/);
});

test('monthly credit synchronization grants only server-verified active subscriptions',async()=>{
  const calls=[],ctx=moduleOf('supabase/functions/_shared/energyPricing.ts');
  const admin={rpc:async(name,input)=>{calls.push({name,input});return{};}};
  const sub={id:'sub-fixture',status:'active',items:{data:[{quantity:1,price:{unit_amount:4000,currency:'usd',tax_behavior:'inclusive',recurring:{interval:'month',interval_count:1},metadata:{energy_monthly_extra_credits:'100'},lookup_key:'timewarp_energy_pro_4000_monthly_extra_100_v1'}}]}};
  await ctx.syncEnergyMonthlyCredits(admin,sub,'pro','owner',null);assert.equal(calls[0].input.p_extra_credits,100);assert.equal(calls[0].input.p_monthly_usd,40);
  await ctx.syncEnergyMonthlyCredits(admin,{...sub,status:'past_due'},'pro','owner',null);assert.equal(calls[1].input.p_extra_credits,0);
  await ctx.syncEnergyMonthlyCredits(admin,sub,'free','owner',null);assert.equal(calls[2].input.p_extra_credits,0);
  await ctx.syncEnergyMonthlyCredits(admin,sub,'pro','owner','workspace');assert.equal(calls.length,3);
});

test('changing monthly credits updates the existing subscription and keeps payment failure from creating a second subscription',async()=>{
  const pricing=moduleOf('supabase/functions/_shared/energyPricing.ts'),updates=[];let handler,fail=false,checkouts=0;
  const existing={id:'sub-fixture',status:'active',cancel_at_period_end:false,metadata:{plan:'pro'},items:{data:[{id:'item-fixture',quantity:1,price:{unit_amount:2000,metadata:{}}}]}};
  const stripe={prices:{list:async()=>({data:[]}),retrieve:async()=>({id:'base',product:'product',active:true,currency:'usd',unit_amount:2000,recurring:{interval:'month',interval_count:1},tax_behavior:'inclusive'}),create:async(params)=>({id:'extra-price',active:true,...params,recurring:{interval:'month',interval_count:1}})},subscriptions:{retrieve:async()=>existing,update:async(id,input)=>{updates.push({id,input});if(fail)throw Error('Payment declined');return existing;}},checkout:{sessions:{create:async()=>{checkouts++;throw Error('Unexpected new subscription');}}}};
  const admin={from:table=>{const query={select:()=>query,is:()=>query,eq:()=>query,maybeSingle:async()=>({data:table==='timewarp_subscriptions'?{owner_user_id:'owner',plan:'pro',stripe_subscription_id:existing.id}:{stripe_customer_id:'customer'}})};return query;}};
  const source=stripTypeScriptTypes(fs.readFileSync(path.join(__dirname,'../supabase/functions/stripe-billing/index.ts'),'utf8'),{mode:'strip'}).replace(/^import[\s\S]*?from ['"][^'"]+['"];?\r?\n/gm,'');
  const ctx=vm.createContext({Request,Response,Date,Error,console:{error(){}},Deno:{serve:callback=>{handler=callback;},env:{get:()=> 'fixture'}},createClient:()=>admin,authenticateRequest:async()=>({user:{id:'owner'}}),isPlanId:plan=>['free','pro','max','ultra'].includes(plan),canManageBilling:()=>true,getPlanPriceId:()=> 'base',getStripe:()=>stripe,getSiteUrl:()=> 'https://fixture.invalid',corsHeaders:{},jsonResponse:(data,status=200)=>Response.json(data,{status}),energyPlanPrice:pricing.energyPlanPrice,monthlyExtraCredits:pricing.monthlyExtraCredits,energySubscriptionExtras:pricing.energySubscriptionExtras});
  vm.runInContext(source,ctx);
  const send=()=>handler(new Request('https://fixture.invalid/billing',{method:'POST',body:JSON.stringify({action:'checkout',surface:'energy',plan:'pro',monthlyExtraCredits:100})}));
  let response=await send();assert.equal(response.status,200);assert.equal((await response.json()).updated,true);
  assert.equal(updates[0].id,existing.id);assert.equal(updates[0].input.items[0].id,'item-fixture');assert.equal(updates[0].input.items[0].quantity,1);assert.equal(updates[0].input.proration_behavior,'always_invoice');assert.equal(updates[0].input.payment_behavior,'error_if_incomplete');
  fail=true;response=await send();assert.equal(response.status,500);assert.match((await response.json()).error,/Payment declined/);assert.equal(checkouts,0);
});
