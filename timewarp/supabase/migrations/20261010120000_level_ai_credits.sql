-- Level AI credits. Every paid plan and monthly addition now gives 14 credits
-- per dollar (Max 700, Ultra 1400). Pro is no longer sold; existing Pro
-- subscribers keep it at the same rate (280). One credit still redeems $0.05 of
-- provider cost (2.5x at $0.125), so a fully used plan spends 70% of its price.
-- Additions sold before this change (50-1000 credits at $0.20 each) remain valid
-- for their subscribers. Usage already consumed this period is unchanged.
BEGIN;
DO $$
DECLARE c record;
BEGIN
  FOR c IN SELECT conname FROM pg_constraint
    WHERE conrelid='public.timewarp_subscriptions'::regclass AND contype='c'
      AND pg_get_constraintdef(oid) LIKE '%energy_monthly_extra_credits%' LOOP
    EXECUTE format('ALTER TABLE public.timewarp_subscriptions DROP CONSTRAINT %I',c.conname);
  END LOOP;
END $$;
ALTER TABLE public.timewarp_subscriptions ADD CONSTRAINT timewarp_subscriptions_energy_monthly_extra_credits_check
  CHECK (energy_monthly_extra_credits IN (0,210,420,630,840,1050,1400,1750,50,100,200,300,500,750,1000));

CREATE OR REPLACE FUNCTION public.timewarp_energy_sync_monthly_credits(p_owner_user_id uuid,p_stripe_subscription_id text,p_extra_credits integer,p_monthly_usd numeric)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public,pg_temp AS $$
BEGIN
  IF p_owner_user_id IS NULL OR p_extra_credits IS NULL OR p_extra_credits NOT IN (0,210,420,630,840,1050,1400,1750,50,100,200,300,500,750,1000) THEN RAISE EXCEPTION 'Invalid monthly credit addition'; END IF;
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
  SELECT (CASE p_plan WHEN 'pro' THEN 280 WHEN 'max' THEN 700 WHEN 'ultra' THEN 1400 ELSE 0 END) +
    CASE WHEN p_workspace_id IS NULL AND p_plan IN ('pro','max','ultra') THEN COALESCE((
      SELECT energy_monthly_extra_credits FROM public.timewarp_subscriptions
      WHERE workspace_id IS NULL AND owner_user_id=p_user_id AND plan=p_plan AND subscription_status='active'
    ),0) ELSE 0 END;
$$;
REVOKE ALL ON FUNCTION public.timewarp_energy_monthly_allowance(text,uuid,uuid) FROM public,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.timewarp_energy_monthly_allowance(text,uuid,uuid) TO service_role;
COMMIT;
