import { productionService } from './nativeAccount.ts';
export const AI_COST_MARKUP = 2.5;
export const USD_PER_CREDIT = 0.125;
export const PLANS = [
  { id: 'free', name: 'Free', monthlyUsd: 0, monthlyCredits: 0 },
  { id: 'pro', name: 'Pro', monthlyUsd: 20, monthlyCredits: 100 },
  { id: 'max', name: 'Max', monthlyUsd: 50, monthlyCredits: 250 },
  { id: 'ultra', name: 'Ultra', monthlyUsd: 100, monthlyCredits: 500 },
];
export async function nativeBilling(token:string,input:any) {
  if(!['status','checkout','buy-credits','portal','sync-checkout','cancel-checkout'].includes(input.action))throw Object.assign(Error('Invalid billing action.'),{status:400});
  // The original service performs membership checks, customer ownership,
  // Stripe checkout, portal and idempotent webhook/return reconciliation.
  let result;try{result=await productionService(token,'stripe-billing',{...input,workspaceId:null,surface:'energy'});}catch(error){if(input.action==='sync-checkout'&&(error as any)?.status===409)return{pending:true};throw error;}
  if(input.action!=='status')return result;
  return {...result,plans:PLANS,credits:{...result.credits,markup:AI_COST_MARKUP,usdPerCredit:USD_PER_CREDIT}};
}
