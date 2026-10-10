import { productionService } from './nativeAccount.ts';
export const AI_COST_MARKUP = 2.5;
export const USD_PER_CREDIT = 0.125;
// Every paid plan gives 14 credits per dollar (_shared/plans.ts). Pro is no
// longer sold; only someone already on it sees it, so their plan still shows.
export const PLANS = [
  { id: 'free', name: 'Free', monthlyUsd: 0, monthlyCredits: 0 },
  { id: 'max', name: 'Max', monthlyUsd: 50, monthlyCredits: 700 },
  { id: 'ultra', name: 'Ultra', monthlyUsd: 100, monthlyCredits: 1400 },
];
export const RETIRED_PLANS = [
  { id: 'pro', name: 'Pro', monthlyUsd: 20, monthlyCredits: 280, retired: true },
];
const plansFor = (current: unknown) => {
  const retired = RETIRED_PLANS.find(plan => plan.id === current);
  return retired ? [PLANS[0], retired, ...PLANS.slice(1)] : PLANS;
};
export async function nativeBilling(token:string,input:any) {
  if(!['status','checkout','buy-credits','portal','sync-checkout','cancel-checkout'].includes(input.action))throw Object.assign(Error('Invalid billing action.'),{status:400});
  // The original service performs membership checks, customer ownership,
  // Stripe checkout, portal and idempotent webhook/return reconciliation.
  let result;try{result=await productionService(token,'stripe-billing',{...input,workspaceId:null,surface:'energy'});}catch(error){if(input.action==='sync-checkout'&&(error as any)?.status===409)return{pending:true};throw error;}
  if(input.action!=='status')return result;
  return {...result,plans:plansFor(result.plan),credits:{...result.credits,markup:AI_COST_MARKUP,usdPerCredit:USD_PER_CREDIT}};
}
