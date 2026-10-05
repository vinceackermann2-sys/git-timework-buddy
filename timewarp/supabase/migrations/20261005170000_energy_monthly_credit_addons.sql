BEGIN;
ALTER TABLE public.timewarp_subscriptions
  ADD COLUMN IF NOT EXISTS energy_monthly_extra_credits integer NOT NULL DEFAULT 0 CHECK (energy_monthly_extra_credits IN (0,50,100,200,300,500,750,1000)),
  ADD COLUMN IF NOT EXISTS energy_monthly_usd numeric CHECK (energy_monthly_usd >= 0 AND energy_monthly_usd <> 'NaN'::numeric);

-- Only a server-verified Stripe subscription can change the recurring allowance.
CREATE OR REPLACE FUNCTION public.timewarp_energy_sync_monthly_credits(p_owner_user_id uuid,p_stripe_subscription_id text,p_extra_credits integer,p_monthly_usd numeric)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public,pg_temp AS $$
BEGIN
  IF p_owner_user_id IS NULL OR p_extra_credits IS NULL OR p_extra_credits NOT IN (0,50,100,200,300,500,750,1000) THEN RAISE EXCEPTION 'Invalid monthly credit addition'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('personal:'||p_owner_user_id::text,0));
  UPDATE public.timewarp_subscriptions SET
    energy_monthly_extra_credits=CASE WHEN plan IN ('pro','max','ultra') AND subscription_status='active' THEN p_extra_credits ELSE 0 END,
    energy_monthly_usd=p_monthly_usd
  WHERE workspace_id IS NULL AND owner_user_id=p_owner_user_id AND stripe_subscription_id=p_stripe_subscription_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Monthly credit subscription ownership mismatch'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.timewarp_energy_sync_monthly_credits(uuid,text,integer,numeric) FROM public,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.timewarp_energy_sync_monthly_credits(uuid,text,integer,numeric) TO service_role;

CREATE OR REPLACE FUNCTION public.timewarp_energy_monthly_allowance(p_plan text,p_user_id uuid,p_workspace_id uuid)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO public,pg_temp AS $$
  SELECT (CASE p_plan WHEN 'pro' THEN 100 WHEN 'max' THEN 250 WHEN 'ultra' THEN 500 ELSE 0 END) +
    CASE WHEN p_workspace_id IS NULL AND p_plan IN ('pro','max','ultra') THEN COALESCE((
      SELECT energy_monthly_extra_credits FROM public.timewarp_subscriptions
      WHERE workspace_id IS NULL AND owner_user_id=p_user_id AND plan=p_plan AND subscription_status='active'
    ),0) ELSE 0 END;
$$;
REVOKE ALL ON FUNCTION public.timewarp_energy_monthly_allowance(text,uuid,uuid) FROM public,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.timewarp_energy_monthly_allowance(text,uuid,uuid) TO service_role;

-- Preserve the current reservation/settlement logic and monthly usage history.
-- A change in allowance never clears credits already consumed this period.
DO $$
DECLARE name text; definition text; changed text;
BEGIN
  FOREACH name IN ARRAY ARRAY['timewarp_ai_usage_unreserved','timewarp_settle_ai_cost','timewarp_energy_settle_ai_cost'] LOOP
    SELECT pg_get_functiondef(p.oid) INTO definition FROM pg_proc p
      WHERE p.pronamespace='public'::regnamespace AND p.proname=name;
    IF definition IS NULL THEN RAISE EXCEPTION 'Missing monthly accounting function: %',name; END IF;
    changed:=regexp_replace(definition,'v_included_allowance := CASE v_plan[\s\S]*?END;',
      'v_included_allowance := public.timewarp_energy_monthly_allowance(v_plan,p_user_id,p_workspace_id);');
    IF changed=definition AND position('timewarp_energy_monthly_allowance(v_plan,p_user_id,p_workspace_id)' in definition)=0 THEN RAISE EXCEPTION 'Monthly accounting contract changed: %',name; END IF;
    IF changed<>definition THEN EXECUTE changed; END IF;
  END LOOP;
END $$;
COMMIT;
