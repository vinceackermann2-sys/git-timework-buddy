-- Run after the monthly-additions migration. Fixtures and charges are rolled back.
BEGIN;
DO $$
DECLARE owner_id uuid:=gen_random_uuid(); other_id uuid:=gen_random_uuid(); usage jsonb; reservation uuid; result jsonb;
BEGIN
  INSERT INTO auth.users(id,email,raw_user_meta_data,raw_app_meta_data,created_at,updated_at)
  VALUES(owner_id,'monthly-ledger-'||owner_id||'@example.invalid','{}','{}',now(),now()),
    (other_id,'monthly-ledger-'||other_id||'@example.invalid','{}','{}',now(),now());
  PERFORM public.timewarp_upsert_subscription(null,owner_id,'fixture-customer','fixture-monthly','pro','active',false,now()+interval '1 month',now());
  PERFORM public.timewarp_energy_sync_monthly_credits(owner_id,'fixture-monthly',100,40);
  usage:=public.timewarp_ai_usage(owner_id,null);
  IF (usage->>'included_allowance_credits')::numeric<>200 OR (usage->>'included_balance_credits')::numeric<>200 THEN RAISE EXCEPTION 'Pro + 100 must grant 200 monthly credits'; END IF;
  IF public.timewarp_energy_monthly_allowance('pro',other_id,null)<>100 THEN RAISE EXCEPTION 'Monthly credits leaked to another owner'; END IF;
  BEGIN
    PERFORM public.timewarp_energy_sync_monthly_credits(other_id,'fixture-monthly',100,40);
    RAISE EXCEPTION 'Ownership check failed';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'Monthly credit subscription ownership mismatch' THEN RAISE; END IF; END;
  reservation:=gen_random_uuid();
  IF public.timewarp_reserve_agent_ai(reservation,owner_id,150) IS DISTINCT FROM true THEN RAISE EXCEPTION 'Cannot reserve added monthly allowance'; END IF;
  result:=public.timewarp_energy_finish_ai(reservation,owner_id,'openai/gpt-5.6-sol',100,20,7.5,'settled');
  IF (result->>'purchasedCreditsUsed')::numeric<>0 THEN RAISE EXCEPTION 'Monthly additions incorrectly used purchased credits'; END IF;
  usage:=public.timewarp_ai_usage(owner_id,null);
  IF (usage->>'included_balance_credits')::numeric<>50 THEN RAISE EXCEPTION 'Monthly added credits did not settle'; END IF;
  PERFORM public.timewarp_energy_sync_monthly_credits(owner_id,'fixture-monthly',0,20);
  PERFORM public.timewarp_energy_sync_monthly_credits(owner_id,'fixture-monthly',100,40);
  usage:=public.timewarp_ai_usage(owner_id,null);
  IF (usage->>'included_balance_credits')::numeric<>50 THEN RAISE EXCEPTION 'Changing additions reset consumed usage'; END IF;
  PERFORM public.timewarp_grant_credits(null,owner_id,50,'purchase','monthly-separate-fixture',owner_id);
  UPDATE public.timewarp_ai_cost_events SET occurred_at=now()-interval '2 months' WHERE user_id=owner_id;
  usage:=public.timewarp_ai_usage(owner_id,null);
  IF (usage->>'included_balance_credits')::numeric<>200 OR (usage->>'purchased_balance_credits')::numeric<>50 THEN RAISE EXCEPTION 'Monthly reset or separate purchased balance is incorrect'; END IF;
  UPDATE public.timewarp_subscriptions SET subscription_status='past_due' WHERE owner_user_id=owner_id AND workspace_id IS NULL;
  IF public.timewarp_energy_monthly_allowance('pro',owner_id,null)<>100 THEN RAISE EXCEPTION 'Unpaid renewal still grants additional credits'; END IF;
  IF has_function_privilege('authenticated','public.timewarp_energy_sync_monthly_credits(uuid,text,integer,numeric)','EXECUTE') THEN RAISE EXCEPTION 'Client can grant monthly additions'; END IF;
END $$;
SELECT 'passed' AS monthly_credits_ledger_acceptance;
ROLLBACK;
