"use strict";
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{stripTypeScriptTypes}=require('node:module');
function moduleOf(file,bindings={},ctx=vm.createContext(bindings)){const source=stripTypeScriptTypes(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),{mode:'strip'}).replace(/^import[^\n]*\n/gm,'').replace(/export /g,'');vm.runInContext(source,ctx);return ctx;}
// timewarpPricing.ts imports the plan rate from plans.ts.
const pricingModule=()=>moduleOf('supabase/functions/_shared/timewarpPricing.ts',{},moduleOf('supabase/functions/_shared/plans.ts'));
const value=(ctx,expression)=>vm.runInContext(expression,ctx);
// Full redemption under conservative assumptions: prices include 25% VAT, and
// card fees are 4% plus $0.30 per charge. A monthly addition is billed with its
// plan, so it carries no fixed fee of its own.
const net=(usd,fixedFee=0.30)=>usd/1.25-usd*0.04-fixedFee;
const margin=(usd,credits,fixedFee)=>(net(usd,fixedFee)-credits*0.05)/net(usd,fixedFee);

test('every offered plan, addition and pack is level and never loses money when fully used',()=>{
  const cloud=moduleOf('cloud/nativeBilling.ts'),pricing=pricingModule(),credits=moduleOf('supabase/functions/_shared/credits.ts');
  const {plans,retired,markup,usdPerCredit}=value(cloud,'({plans:PLANS,retired:RETIRED_PLANS,markup:AI_COST_MARKUP,usdPerCredit:USD_PER_CREDIT})');
  assert.equal(usdPerCredit/markup,0.05,'one credit redeems $0.05 of provider cost');
  assert.deepEqual(Array.from(plans,p=>p.id),['free','max','ultra']);assert.deepEqual(Array.from(plans,p=>p.monthlyUsd),[0,50,100]);
  for(const p of [...plans,...retired].filter(p=>p.monthlyUsd)){assert.equal(p.monthlyCredits,p.monthlyUsd*14,p.id+' is level');assert.ok(margin(p.monthlyUsd,p.monthlyCredits)>=0.05,p.id);}
  for(const addon of value(pricing,'MONTHLY_CREDIT_ADDONS').filter(a=>a.monthlyUsd)){assert.equal(addon.credits,addon.monthlyUsd*14,'addition is level');assert.ok(margin(addon.monthlyUsd,addon.credits,0)>=0.05,String(addon.credits));}
  const packs=value(credits,'CREDIT_PACKS');assert.equal(packs.length,7);
  for(const pack of packs){assert.equal(pack.credits,pack.priceUsd*12,'pack is level');assert.equal(pack.priceCents,pack.priceUsd*100);assert.ok(margin(pack.priceUsd,pack.credits)>=0.15,String(pack.credits));}
});

test('plan allowances agree between the desktop catalog, the billing service and the database',()=>{
  const cloud=moduleOf('cloud/nativeBilling.ts'),budgets=value(moduleOf('supabase/functions/_shared/plans.ts'),'PLAN_BUDGETS');
  for(const p of value(cloud,'[...PLANS,...RETIRED_PLANS]'))assert.equal(budgets[p.id].monthlyCredits,p.monthlyCredits,p.id);
  const dir=path.join(__dirname,'../supabase/migrations'),latest=fs.readdirSync(dir).filter(f=>fs.readFileSync(path.join(dir,f),'utf8').includes('FUNCTION public.timewarp_energy_monthly_allowance')).sort().at(-1);
  const sql=fs.readFileSync(path.join(dir,latest),'utf8');
  assert.match(sql,new RegExp(`WHEN 'pro' THEN ${budgets.pro.monthlyCredits} WHEN 'max' THEN ${budgets.max.monthlyCredits} WHEN 'ultra' THEN ${budgets.ultra.monthlyCredits} ELSE 0`));
  const allowed=sql.match(/energy_monthly_extra_credits IN \(([\d,]+)\)/)[1].split(',').map(Number);
  for(const addon of value(pricingModule(),'MONTHLY_CREDIT_ADDONS'))assert.ok(allowed.includes(addon.credits),'database accepts '+addon.credits);
  for(const legacy of [50,100,200,300,500,750,1000])assert.ok(allowed.includes(legacy),'existing additions stay valid: '+legacy);
});

test('Pro is no longer sold, but its subscribers still see their plan',async()=>{
  const status=plan=>moduleOf('cloud/nativeBilling.ts',{productionService:async()=>({plan,credits:{}})}).nativeBilling('jwt',{action:'status'});
  assert.deepEqual(Array.from((await status('free')).plans,p=>p.id),['free','max','ultra']);
  const pro=(await status('pro')).plans;assert.deepEqual(Array.from(pro,p=>p.id),['free','pro','max','ultra']);assert.equal(pro[1].retired,true);assert.equal(pro[1].monthlyCredits,280);
  const plans=moduleOf('supabase/functions/_shared/plans.ts');
  const offered=value(plans,'isOfferedPlan');assert.equal(offered('pro'),false);assert.equal(offered('max'),true);assert.equal(value(plans,'isPlanId')('pro'),true);
});

test('checkout corrects mismatched live price and verifies the actual Stripe amount and recurrence',async()=>{
  const ctx=pricingModule(),created=[];
  const stripe={prices:{list:async()=>({data:[]}),retrieve:async()=>({id:'old',product:'prod-max',active:true,currency:'usd',unit_amount:3000,recurring:{interval:'month',interval_count:1}}),create:async(params,options)=>{created.push({params,options});return{id:'correct',active:true,...params,recurring:{...params.recurring,interval_count:1}};}}};
  assert.equal(await ctx.monthlyPlanPrice(stripe,'max','old'),'correct');assert.equal(created[0].params.unit_amount,5000);assert.equal(created[0].params.product,'prod-max');assert.equal(created[0].params.tax_behavior,'inclusive');assert.equal(created[0].options.idempotencyKey,created[0].params.lookup_key);
  stripe.prices.list=async()=>({data:[{id:'wrong',active:true,currency:'eur',unit_amount:5000,recurring:{interval:'month',interval_count:1},tax_behavior:'inclusive'}]});await assert.rejects(ctx.monthlyPlanPrice(stripe,'max','old'),/needs repair/);
});
test('billing always uses the personal scope and never accepts a client price or credit balance as entitlement',async()=>{
  const calls=[],ctx=moduleOf('cloud/nativeBilling.ts',{productionService:async(...args)=>{calls.push(args);return{plan:'free',credits:{packs:[]}};}});
  const result=await ctx.nativeBilling('jwt',{action:'status',workspaceId:'foreign',surface:'web'});
  assert.equal(calls[0][2].workspaceId,null);assert.equal(calls[0][2].surface,'energy');assert.equal(result.plans.length,3);assert.equal(result.credits.markup,2.5);
  await assert.rejects(ctx.nativeBilling('jwt',{action:'grant',credits:1000}),/Invalid billing action/);
});
test('model accounting uses current Luna rates, applies long-context cost, and refuses unpriced models',()=>{const ctx=moduleOf('cloud/aiCost.ts'),cost=vm.runInContext('computeCostUsd',ctx);assert.ok(Math.abs(cost('openai/gpt-5.6-luna',100000,10000)-0.032)<1e-9);assert.ok(Math.abs(cost('openai/gpt-5.6-sol',300000,10000)-2.7)<1e-9);assert.throws(()=>cost('openai/unpriced-expensive',10,10),/verified pricing/);});

test('each credit pack gets its own named Stripe product, found again by lookup key',async()=>{
  const ctx=pricingModule(),products=[],prices=[];let listed=[];
  const stripe={products:{create:async(params,options)=>{products.push({params,options});return{id:'prod-1500'};}},prices:{list:async({lookup_keys})=>({data:listed.filter(p=>lookup_keys.includes(p.lookup_key))}),create:async(params,options)=>{prices.push({params,options});const price={id:'price-1500',active:true,...params};listed.push(price);return price;}}};
  const pack={credits:1500,priceUsd:125,priceCents:12500};
  assert.equal(await ctx.creditPackPrice(stripe,pack),'price-1500');
  assert.equal(products[0].params.name,'Timewarp 1,500 credits');assert.equal(prices[0].params.unit_amount,12500);assert.equal(prices[0].params.tax_behavior,'inclusive');assert.equal(prices[0].params.lookup_key,'timewarp_energy_credits_1500_12500_v1');assert.equal(prices[0].options.idempotencyKey,prices[0].params.lookup_key);
  assert.equal(await ctx.creditPackPrice(stripe,pack),'price-1500');assert.equal(products.length,1);assert.equal(prices.length,1);
  listed=[{id:'wrong',active:true,currency:'usd',unit_amount:100,tax_behavior:'inclusive',lookup_key:'timewarp_energy_credits_1500_12500_v1'}];await assert.rejects(ctx.creditPackPrice(stripe,pack),/needs repair/);
});

test('an auto-recharge saved with an old pack size still charges, never more than before',()=>{
  const ctx=moduleOf('supabase/functions/_shared/credits.ts'),recharge=size=>value(ctx,'rechargePack')(size);
  for(const [credits,usd] of [[50,15],[100,30],[200,45],[300,60],[500,75],[750,100],[1000,125]]){const pack=recharge(credits);assert.ok(pack.credits>=credits&&pack.priceUsd<=usd,String(credits));}
  assert.equal(recharge(180).credits,180);assert.equal(recharge(2000),null);assert.equal(recharge(0),null);
  assert.equal(value(ctx,'getCreditPack')(50),null,'old sizes are no longer sold');
});

test('monthly credit additions use a recurring combined price and reject unknown amounts',async()=>{
  const ctx=pricingModule(),created=[];
  const stripe={prices:{list:async()=>({data:[]}),retrieve:async()=>({id:'base',product:'max-product',active:true,currency:'usd',unit_amount:5000,recurring:{interval:'month',interval_count:1},tax_behavior:'inclusive'}),create:async(params)=>{created.push(params);return{active:true,id:'combined',...params,recurring:{...params.recurring,interval_count:1}};}}};
  assert.equal(await ctx.monthlyPlanPrice(stripe,'max','base',420),'combined');
  assert.equal(created[0].unit_amount,8000);assert.equal(created[0].recurring.interval,'month');assert.equal(created[0].metadata.energy_monthly_extra_credits,'420');
  const subscription={status:'active',id:'sub-fixture',items:{data:[{quantity:1,price:{...created[0],recurring:{interval:'month',interval_count:1}}}]}};
  assert.equal(ctx.planSubscriptionExtras(subscription,'max'),420);
  assert.throws(()=>ctx.monthlyExtraCredits(123),/valid monthly/);assert.throws(()=>ctx.monthlyExtraCredits('420'),/valid monthly/);assert.throws(()=>ctx.monthlyExtraCredits(100),/valid monthly/);
  subscription.items.data[0].price.unit_amount=5000;assert.throws(()=>ctx.planSubscriptionExtras(subscription,'max'),/needs repair/);
});

test('monthly additions sold before level pricing stay valid for their subscribers',()=>{
  const ctx=pricingModule(),price=(plan,extra,amount)=>({status:'active',items:{data:[{quantity:1,price:{unit_amount:amount,currency:'usd',tax_behavior:'inclusive',recurring:{interval:'month',interval_count:1},metadata:{energy_monthly_extra_credits:String(extra)},lookup_key:'timewarp_energy_'+plan+'_'+amount+'_monthly_extra_'+extra+'_v1'}}]}});
  assert.equal(ctx.planSubscriptionExtras(price('pro',100,4000),'pro'),100);assert.equal(ctx.planSubscriptionExtras(price('ultra',1000,30000),'ultra'),1000);
  assert.throws(()=>ctx.planSubscriptionExtras(price('pro',100,3000),'pro'),/needs repair/);
});

test('monthly credit synchronization grants only server-verified active subscriptions',async()=>{
  const calls=[],ctx=pricingModule();
  const admin={rpc:async(name,input)=>{calls.push({name,input});return{};}};
  const sub={id:'sub-fixture',status:'active',items:{data:[{quantity:1,price:{unit_amount:8000,currency:'usd',tax_behavior:'inclusive',recurring:{interval:'month',interval_count:1},metadata:{energy_monthly_extra_credits:'420'},lookup_key:'timewarp_energy_max_8000_monthly_extra_420_v1'}}]}};
  await ctx.syncMonthlyPlanCredits(admin,sub,'max','owner',null);assert.equal(calls[0].input.p_extra_credits,420);assert.equal(calls[0].input.p_monthly_usd,80);
  await ctx.syncMonthlyPlanCredits(admin,{...sub,status:'past_due'},'max','owner',null);assert.equal(calls[1].input.p_extra_credits,0);
  await ctx.syncMonthlyPlanCredits(admin,sub,'free','owner',null);assert.equal(calls[2].input.p_extra_credits,0);
  await ctx.syncMonthlyPlanCredits(admin,sub,'max','owner','workspace');assert.equal(calls.length,3);
});

function billingHandler(stripe,admin){
  const pricing=pricingModule(),plans=moduleOf('supabase/functions/_shared/plans.ts');let handler;
  const source=stripTypeScriptTypes(fs.readFileSync(path.join(__dirname,'../supabase/functions/stripe-billing/index.ts'),'utf8'),{mode:'strip'}).replace(/^import[\s\S]*?from ['"][^'"]+['"];?\r?\n/gm,'');
  const ctx=vm.createContext({Request,Response,Date,Error,console:{error(){}},Deno:{serve:callback=>{handler=callback;},env:{get:()=> 'fixture'}},createClient:()=>admin,authenticateRequest:async()=>({user:{id:'owner'}}),isPlanId:value(plans,'isPlanId'),isOfferedPlan:value(plans,'isOfferedPlan'),canManageBilling:()=>true,getPlanPriceId:()=> 'base',getStripe:()=>stripe,getSiteUrl:()=> 'https://fixture.invalid',corsHeaders:{},jsonResponse:(data,status=200)=>Response.json(data,{status}),monthlyPlanPrice:pricing.monthlyPlanPrice,monthlyExtraCredits:pricing.monthlyExtraCredits,planSubscriptionExtras:pricing.planSubscriptionExtras});
  vm.runInContext(source,ctx);
  return body=>handler(new Request('https://fixture.invalid/billing',{method:'POST',body:JSON.stringify(body)}));
}

test('changing monthly credits updates the existing subscription and keeps payment failure from creating a second subscription',async()=>{
  const updates=[];let fail=false,checkouts=0;
  const existing={id:'sub-fixture',status:'active',cancel_at_period_end:false,metadata:{plan:'max'},items:{data:[{id:'item-fixture',quantity:1,price:{unit_amount:5000,metadata:{}}}]}};
  const stripe={prices:{list:async()=>({data:[]}),retrieve:async()=>({id:'base',product:'product',active:true,currency:'usd',unit_amount:5000,recurring:{interval:'month',interval_count:1},tax_behavior:'inclusive'}),create:async(params)=>({id:'extra-price',active:true,...params,recurring:{interval:'month',interval_count:1}})},subscriptions:{retrieve:async()=>existing,update:async(id,input)=>{updates.push({id,input});if(fail)throw Error('Payment declined');return existing;}},checkout:{sessions:{create:async()=>{checkouts++;throw Error('Unexpected new subscription');}}}};
  const admin={from:table=>{const query={select:()=>query,is:()=>query,eq:()=>query,maybeSingle:async()=>({data:table==='timewarp_subscriptions'?{owner_user_id:'owner',plan:'max',stripe_subscription_id:existing.id}:{stripe_customer_id:'customer'}})};return query;}};
  const send=billingHandler(stripe,admin),body={action:'checkout',surface:'energy',plan:'max',monthlyExtraCredits:420};
  let response=await send(body);assert.equal(response.status,200);assert.equal((await response.json()).updated,true);
  assert.equal(updates[0].id,existing.id);assert.equal(updates[0].input.items[0].id,'item-fixture');assert.equal(updates[0].input.items[0].quantity,1);assert.equal(updates[0].input.proration_behavior,'always_invoice');assert.equal(updates[0].input.payment_behavior,'error_if_incomplete');
  fail=true;response=await send(body);assert.equal(response.status,500);assert.match((await response.json()).error,/Payment declined/);assert.equal(checkouts,0);
});

test('checking out Pro is refused before anything is charged',async()=>{
  let touched=0;const stripe=new Proxy({},{get:()=>{touched++;return{};}});
  const admin={from:()=>{const query={select:()=>query,is:()=>query,eq:()=>query,maybeSingle:async()=>({data:{owner_user_id:'owner',plan:'pro',stripe_subscription_id:'sub-pro'}})};return query;}};
  const response=await billingHandler(stripe,admin)({action:'checkout',surface:'energy',plan:'pro'});
  assert.equal(response.status,400);assert.match((await response.json()).error,/no longer offered/);assert.equal(touched,0);
});
