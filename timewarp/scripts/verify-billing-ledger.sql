-- Production accounting acceptance. All fixture data is rolled back.
BEGIN;
DO $$
DECLARE
  fixture_user uuid := gen_random_uuid();
  reservation uuid;
  result jsonb;
  usage jsonb;
  plan_name text;
  allowance numeric;
  saved_balance numeric;
BEGIN
  INSERT INTO auth.users(id,email,raw_user_meta_data,raw_app_meta_data,created_at,updated_at)
  VALUES(fixture_user,'timewarp-ledger-'||fixture_user::text||'@example.invalid','{}','{}',now(),now());
  FOREACH plan_name IN ARRAY ARRAY['pro','max','ultra'] LOOP
    allowance := CASE plan_name WHEN 'pro' THEN 100 WHEN 'max' THEN 250 ELSE 500 END;
    PERFORM public.timewarp_upsert_subscription(
      p_workspace_id=>null,p_owner_user_id=>fixture_user,
      p_stripe_customer_id=>'acceptance_'||fixture_user::text,
      p_stripe_subscription_id=>'acceptance_'||fixture_user::text,
      p_plan=>plan_name,p_subscription_status=>'active',p_cancel_at_period_end=>false,
      p_current_period_end=>now()+interval '1 month',p_plan_anchor_at=>now());
    usage := public.timewarp_ai_usage(fixture_user,null);
    IF (usage->>'included_balance_credits')::numeric <> allowance THEN RAISE EXCEPTION 'Incorrect allowance: %',plan_name; END IF;
    reservation := gen_random_uuid();
    IF public.timewarp_reserve_agent_ai(reservation,fixture_user,allowance) IS DISTINCT FROM true THEN RAISE EXCEPTION 'Could not reserve included allowance'; END IF;
    result := public.timewarp_energy_finish_ai(reservation,fixture_user,'openai/gpt-5.6-sol',100,20,allowance*0.125/2.5,'settled');
    usage := public.timewarp_ai_usage(fixture_user,null);
    IF (usage->>'included_balance_credits')::numeric <> 0 OR (result->>'purchasedCreditsUsed')::numeric <> 0 THEN RAISE EXCEPTION 'Incorrect included settlement'; END IF;
    IF public.timewarp_energy_finish_ai(reservation,fixture_user,'openai/gpt-5.6-sol',100,20,allowance*0.125/2.5,'settled') <> result THEN RAISE EXCEPTION 'Settlement is not idempotent'; END IF;
    DELETE FROM public.timewarp_ai_cost_events WHERE user_id=fixture_user;
    DELETE FROM public.timewarp_agent_ai_reservations WHERE user_id=fixture_user;
  END LOOP;
  -- Ultra has 500 included credits; charge 490, then cross into purchased credits.
  PERFORM public.timewarp_grant_credits(null,fixture_user,20,'purchase','acceptance-'||fixture_user::text,fixture_user);
  PERFORM public.timewarp_grant_credits(null,fixture_user,20,'purchase','acceptance-'||fixture_user::text,fixture_user);
  reservation := gen_random_uuid();
  IF public.timewarp_reserve_agent_ai(reservation,fixture_user,490) IS DISTINCT FROM true THEN RAISE EXCEPTION 'Could not reserve first split call'; END IF;
  PERFORM public.timewarp_energy_finish_ai(reservation,fixture_user,'openai/gpt-5.6-sol',100,20,24.5,'settled');
  reservation := gen_random_uuid();
  IF public.timewarp_reserve_agent_ai(reservation,fixture_user,20) IS DISTINCT FROM true THEN RAISE EXCEPTION 'Could not reserve split call'; END IF;
  result := public.timewarp_energy_finish_ai(reservation,fixture_user,'openai/gpt-5.6-sol',100,20,1,'settled');
  usage := public.timewarp_ai_usage(fixture_user,null);
  IF (usage->>'included_balance_credits')::numeric <> 0 OR (usage->>'purchased_balance_credits')::numeric <> 10 OR (result->>'purchasedCreditsUsed')::numeric <> 10 THEN RAISE EXCEPTION 'Incorrect included/purchased split'; END IF;
  saved_balance := (usage->>'purchased_balance_credits')::numeric;
  IF public.timewarp_reserve_agent_ai(gen_random_uuid(),fixture_user,11) IS DISTINCT FROM false THEN RAISE EXCEPTION 'Overspending was allowed'; END IF;
  usage := public.timewarp_ai_usage(fixture_user,null);
  IF (usage->>'purchased_balance_credits')::numeric <> saved_balance THEN RAISE EXCEPTION 'Rejected reservation changed the balance'; END IF;
END $$;
SELECT 'passed' AS accounting_acceptance,
  (SELECT count(*) FROM auth.users WHERE email LIKE 'timewarp-billing-%@example.invalid') AS remaining_billing_fixtures;
ROLLBACK;
