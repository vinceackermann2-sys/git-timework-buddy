"use strict";
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const before=JSON.parse(fs.readFileSync(path.join(root,'reports/accounting-before.json'),'utf8'));
const original=before.rows.find(r=>r.proname==='timewarp_settle_ai_cost').definition;
let settle=original.replace('public.timewarp_settle_ai_cost(', 'public.timewarp_energy_settle_ai_cost(')
  .replace('COALESCE(p_cost_usd, 0) * 1.33 / 0.125','COALESCE(p_cost_usd, 0) * 2.5 / 0.125')
  .replace('v_included_credits * 0.125 / 1.33','v_included_credits * 0.125 / 2.5')
  .replace('v_purchased_balance := v_credit_row.balance_credits - v_purchased_credits;',"v_purchased_balance := v_credit_row.balance_credits - v_purchased_credits;\n    IF v_purchased_balance < 0 THEN RAISE EXCEPTION 'Insufficient purchased credits at settlement'; END IF;");
const finish=`
CREATE OR REPLACE FUNCTION public.timewarp_energy_finish_ai(p_id uuid,p_user_id uuid,p_model text,p_input integer,p_output integer,p_cost numeric,p_outcome text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE v_row public.timewarp_agent_ai_reservations; v_result jsonb;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('personal:' || p_user_id::text,0));
  SELECT * INTO v_row FROM public.timewarp_agent_ai_reservations WHERE id=p_id AND user_id=p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Reservation not found'; END IF;
  IF v_row.status='settled' THEN RETURN v_row.settlement; END IF;
  IF v_row.status='released' THEN RETURN '{}'::jsonb; END IF;
  IF p_outcome='settled' THEN
    IF p_cost IS NULL OR p_cost<0 OR p_cost='NaN'::numeric OR p_input IS NULL OR p_output IS NULL OR p_input<0 OR p_output<0 OR p_cost*2.5/0.125>v_row.credits THEN RAISE EXCEPTION 'Usage exceeds its reserved bound'; END IF;
    v_result:=public.timewarp_energy_settle_ai_cost(p_user_id,null,p_model,p_input,p_output,p_cost);
    UPDATE public.timewarp_agent_ai_reservations SET status='settled',settlement=v_result,updated_at=now() WHERE id=p_id;
    RETURN v_result;
  END IF;
  IF p_outcome NOT IN ('released','uncertain') OR p_outcome IS NULL THEN RAISE EXCEPTION 'Invalid settlement outcome'; END IF;
  UPDATE public.timewarp_agent_ai_reservations SET status=p_outcome,updated_at=now() WHERE id=p_id;
  RETURN '{}'::jsonb;
END $$;
REVOKE ALL ON FUNCTION public.timewarp_energy_settle_ai_cost(uuid,uuid,text,integer,integer,numeric), public.timewarp_energy_finish_ai(uuid,uuid,text,integer,integer,numeric,text) FROM public,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.timewarp_energy_settle_ai_cost(uuid,uuid,text,integer,integer,numeric), public.timewarp_energy_finish_ai(uuid,uuid,text,integer,integer,numeric,text) TO service_role;

CREATE OR REPLACE FUNCTION public.timewarp_energy_patch_settings(p_user uuid,p_patch jsonb)
RETURNS void LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
  INSERT INTO public.timewarp_energy_settings(user_id,settings) VALUES(p_user,p_patch)
  ON CONFLICT(user_id) DO UPDATE SET settings=public.timewarp_energy_settings.settings||excluded.settings,updated_at=now();
$$;
REVOKE ALL ON FUNCTION public.timewarp_energy_patch_settings(uuid,jsonb) FROM public,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.timewarp_energy_patch_settings(uuid,jsonb) TO service_role;
`;
fs.writeFileSync(path.join(root,'supabase/migrations/20261005130000_energy_billing_and_account_persistence.sql'), '-- Energy AI calls redeem credits at 2.5x provider cost. Existing events and balances are preserved.\nBEGIN;\n'+settle.trim()+';\n'+finish+'\nCOMMIT;\n');
