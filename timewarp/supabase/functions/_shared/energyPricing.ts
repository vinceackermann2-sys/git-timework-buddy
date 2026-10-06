// Fixed monthly USD pricing for the local Energy desktop. Existing subscriptions
// keep their price until their owner explicitly chooses another plan.
const cents:Record<string,number>={pro:2000,max:5000,ultra:10000};
export const MONTHLY_CREDIT_ADDONS = [0,50,100,200,300,500,750,1000].map(credits=>({credits,monthlyUsd:credits*0.2}));
export function monthlyExtraCredits(value:unknown):number {
  if(value===undefined)return 0;
  if(typeof value!=='number'||!MONTHLY_CREDIT_ADDONS.some(addon=>addon.credits===value))throw Error('Choose a valid monthly credit addition.');
  return value;
}
export function energySubscriptionExtras(subscription:any,plan:string):number {
  const price=subscription.items?.data?.[0]?.price,extra=Number(price?.metadata?.energy_monthly_extra_credits||0);
  if(!extra)return 0;
  const amount=cents[plan]+extra*20;
  if(!cents[plan]||!MONTHLY_CREDIT_ADDONS.some(addon=>addon.credits===extra)||subscription.items.data[0].quantity!==1||price.currency!=='usd'||price.unit_amount!==amount||price.tax_behavior!=='inclusive'||price.recurring?.interval!=='month'||price.recurring?.interval_count!==1||price.lookup_key!=='timewarp_energy_'+plan+'_'+amount+'_monthly_extra_'+extra+'_v1')throw Error('The monthly credit subscription price needs repair.');
  return extra;
}
export async function syncEnergyMonthlyCredits(admin:any,subscription:any,plan:string,userId:string,workspaceId:string|null){
  if(workspaceId)return;
  const extra=plan==='free'||subscription.status!=='active'?0:energySubscriptionExtras(subscription,plan);
  const {error}=await admin.rpc('timewarp_energy_sync_monthly_credits',{p_owner_user_id:userId,p_stripe_subscription_id:subscription.id,p_extra_credits:extra,p_monthly_usd:plan==='free'?null:Number(subscription.items?.data?.[0]?.price?.unit_amount||0)/100});
  if(error)throw Error('Could not synchronize monthly plan credits: '+error.message);
}
export async function energyPlanPrice(stripe:any,plan:string,configuredPrice:string,extraCredits:number=0){
  const extra=monthlyExtraCredits(extraCredits),amount=cents[plan]+extra*20;if(!cents[plan])throw Error('Choose a paid Timewarp plan.');
  const lookup=extra?'timewarp_energy_'+plan+'_'+amount+'_monthly_extra_'+extra+'_v1':'timewarp_energy_'+plan+'_'+amount+'_monthly_v1';
  const matches=await stripe.prices.list({lookup_keys:[lookup],active:true,limit:1});
  const valid=(price:any)=>price.active&&price.currency==='usd'&&price.unit_amount===amount&&price.recurring?.interval==='month'&&price.recurring?.interval_count===1&&price.tax_behavior==='inclusive'&&(!extra||Number(price.metadata?.energy_monthly_extra_credits)===extra);
  if(matches.data[0]){if(!valid(matches.data[0]))throw Error('The Timewarp price configuration needs repair.');return matches.data[0].id;}
  const original=configuredPrice?await stripe.prices.retrieve(configuredPrice):null;
  if(original&&valid(original))return original.id;
  // Explicit checkout may create a reusable corrected Price on the existing
  // product. Stable keys prevent duplicate catalog objects under concurrency.
  const product=original?.product||await stripe.products.create({name:'Timewarp '+plan[0].toUpperCase()+plan.slice(1),metadata:{plan}}, {idempotencyKey:'timewarp-energy-product-'+plan+'-v1'}).then((p:any)=>p.id);
  const price=await stripe.prices.create({product:typeof product==='string'?product:product.id,currency:'usd',unit_amount:amount,recurring:{interval:'month'},tax_behavior:'inclusive',lookup_key:lookup,metadata:{energy_monthly_extra_credits:String(extra),plan}},{idempotencyKey:lookup});
  if(!valid(price))throw Error('Stripe did not return the requested monthly price.');return price.id;
}
export async function energyCreditPackPrice(stripe:any,pack:any){
  const original=await stripe.prices.retrieve(pack.priceId);
  const valid=(p:any)=>p.active&&p.currency==='usd'&&p.unit_amount===pack.priceCents&&!p.recurring&&p.tax_behavior==='inclusive';
  if(valid(original))return original.id;
  const lookup='timewarp_energy_credits_'+pack.credits+'_'+pack.priceCents+'_v1';
  const matches=await stripe.prices.list({lookup_keys:[lookup],active:true,limit:1});
  if(matches.data[0]){if(!valid(matches.data[0]))throw Error('The credit pack price configuration needs repair.');return matches.data[0].id;}
  const product=typeof original.product==='string'?original.product:original.product.id;
  const price=await stripe.prices.create({product,currency:'usd',unit_amount:pack.priceCents,tax_behavior:'inclusive',lookup_key:lookup},{idempotencyKey:lookup});
  if(!valid(price))throw Error('Stripe did not return the requested credit pack price.');return price.id;
}
