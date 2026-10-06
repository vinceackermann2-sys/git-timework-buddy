-- Energy AI calls redeem credits at 2.5x provider cost. Existing events and balances are preserved.
BEGIN;
CREATE OR REPLACE FUNCTION public.timewarp_energy_settle_ai_cost(p_user_id uuid, p_workspace_id uuid, p_model text, p_prompt_tokens integer, p_response_tokens integer, p_cost_usd numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_now TIMESTAMPTZ := now();
  v_plan TEXT := 'free';
  v_anchor TIMESTAMPTZ;
  v_period RECORD;
  v_included_allowance NUMERIC := 0;
  v_included_used NUMERIC := 0;
  v_request_credits NUMERIC := 0;
  v_included_credits NUMERIC := 0;
  v_purchased_credits NUMERIC := 0;
  v_plan_charge_usd NUMERIC := 0;
  v_purchased_charge_usd NUMERIC := 0;
  v_credit_row public.timewarp_credit_balances;
  v_purchased_balance NUMERIC := 0;
  v_below_threshold BOOLEAN := false;
  v_paid_with TEXT := 'plan';
BEGIN
  IF p_user_id IS NULL OR COALESCE(p_cost_usd, 0) <= 0 THEN
    RETURN jsonb_build_object(
      'settled', false,
      'paidWith', 'plan',
      'planChargedUsd', 0,
      'creditsUsed', 0,
      'purchasedCreditsUsed', 0
    );
  END IF;

  IF p_workspace_id IS NOT NULL
     AND public.timewarp_workspace_role_for(p_user_id, p_workspace_id) IS NULL THEN
    RAISE EXCEPTION 'User % is not an active member of workspace %', p_user_id, p_workspace_id;
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      CASE
        WHEN p_workspace_id IS NOT NULL THEN 'workspace:' || p_workspace_id::TEXT
        ELSE 'personal:' || p_user_id::TEXT
      END,
      0
    )
  );

  IF p_workspace_id IS NOT NULL THEN
    SELECT plan, plan_anchor_at
      INTO v_plan, v_anchor
    FROM public.timewarp_subscriptions
    WHERE workspace_id = p_workspace_id;

    IF v_anchor IS NULL THEN
      SELECT created_at INTO v_anchor
      FROM public.timewarp_workspaces
      WHERE id = p_workspace_id;
    END IF;
  ELSE
    SELECT plan, plan_anchor_at
      INTO v_plan, v_anchor
    FROM public.timewarp_subscriptions
    WHERE owner_user_id = p_user_id AND workspace_id IS NULL;

    IF v_anchor IS NULL THEN
      SELECT created_at INTO v_anchor
      FROM public.profiles
      WHERE user_id = p_user_id;
    END IF;
  END IF;

  v_plan := COALESCE(v_plan, 'free');
  v_anchor := COALESCE(v_anchor, v_now);
  v_included_allowance := CASE v_plan
    WHEN 'free' THEN 0
    WHEN 'pro' THEN 100
    WHEN 'max' THEN 250
    WHEN 'ultra' THEN 500
    ELSE 0
  END;

  SELECT * INTO v_period
  FROM public.timewarp_billing_period(v_anchor, v_now);

  SELECT COALESCE(SUM(COALESCE(credits_charged, cost_usd * 1.33 / 0.125)), 0)
    INTO v_included_used
  FROM public.timewarp_ai_cost_events
  WHERE occurred_at >= v_period.period_start
    AND paid_with = 'plan'
    AND (
      (p_workspace_id IS NOT NULL AND workspace_id = p_workspace_id)
      OR (p_workspace_id IS NULL AND workspace_id IS NULL AND user_id = p_user_id)
    );

  v_included_used := LEAST(v_included_allowance, GREATEST(0, v_included_used));
  v_request_credits := COALESCE(p_cost_usd, 0) * 2.5 / 0.125;
  v_included_credits := LEAST(
    v_request_credits,
    GREATEST(0, v_included_allowance - v_included_used)
  );
  v_purchased_credits := GREATEST(0, v_request_credits - v_included_credits);
  v_plan_charge_usd := v_included_credits * 0.125 / 2.5;
  v_purchased_charge_usd := GREATEST(0, COALESCE(p_cost_usd, 0) - v_plan_charge_usd);

  IF v_included_credits > 0 THEN
    INSERT INTO public.timewarp_ai_cost_events (
      user_id, workspace_id, model, prompt_tokens, response_tokens,
      cost_usd, paid_with, occurred_at, credits_charged
    )
    VALUES (
      p_user_id,
      p_workspace_id,
      COALESCE(p_model, ''),
      GREATEST(0, COALESCE(p_prompt_tokens, 0)),
      CASE WHEN v_purchased_credits > 0 THEN 0 ELSE GREATEST(0, COALESCE(p_response_tokens, 0)) END,
      v_plan_charge_usd,
      'plan',
      v_now, v_included_credits
    );
  END IF;

  IF v_purchased_credits > 0 THEN
    v_credit_row := public.timewarp_lock_credit_balance(p_user_id, p_workspace_id);
    v_purchased_balance := v_credit_row.balance_credits - v_purchased_credits;
    IF v_purchased_balance < 0 THEN RAISE EXCEPTION 'Insufficient purchased credits at settlement'; END IF;
    v_below_threshold :=
      v_credit_row.auto_recharge_enabled
      AND v_purchased_balance <= v_credit_row.auto_recharge_threshold;

    UPDATE public.timewarp_credit_balances
    SET balance_credits = v_purchased_balance
    WHERE id = v_credit_row.id;

    INSERT INTO public.timewarp_ai_cost_events (
      user_id, workspace_id, model, prompt_tokens, response_tokens,
      cost_usd, paid_with, occurred_at, credits_charged
    )
    VALUES (
      p_user_id,
      p_workspace_id,
      COALESCE(p_model, ''),
      CASE WHEN v_included_credits > 0 THEN 0 ELSE GREATEST(0, COALESCE(p_prompt_tokens, 0)) END,
      GREATEST(0, COALESCE(p_response_tokens, 0)),
      v_purchased_charge_usd,
      'credits',
      v_now, v_purchased_credits
    );

    INSERT INTO public.timewarp_credit_events (
      user_id, workspace_id, delta_credits, kind, model, cost_usd, occurred_at
    )
    VALUES (
      p_user_id,
      p_workspace_id,
      -v_purchased_credits,
      'spend',
      COALESCE(p_model, ''),
      v_purchased_charge_usd,
      v_now
    );
  ELSE
    IF p_workspace_id IS NOT NULL THEN
      SELECT COALESCE(balance_credits, 0)
        INTO v_purchased_balance
      FROM public.timewarp_credit_balances
      WHERE workspace_id = p_workspace_id;
    ELSE
      SELECT COALESCE(balance_credits, 0)
        INTO v_purchased_balance
      FROM public.timewarp_credit_balances
      WHERE owner_user_id = p_user_id AND workspace_id IS NULL;
    END IF;
    v_purchased_balance := COALESCE(v_purchased_balance, 0);
  END IF;

  v_paid_with := CASE
    WHEN v_included_credits > 0 AND v_purchased_credits > 0 THEN 'plan_and_credits'
    WHEN v_purchased_credits > 0 THEN 'credits'
    ELSE 'plan'
  END;

  RETURN jsonb_build_object(
    'settled', true,
    'paidWith', v_paid_with,
    'plan', v_plan,
    'planChargedUsd', v_plan_charge_usd,
    'creditsUsed', v_purchased_credits,
    'includedAllowanceCredits', v_included_allowance,
    'includedUsedCredits', LEAST(v_included_allowance, v_included_used + v_included_credits),
    'includedBalanceCredits', GREATEST(0, v_included_allowance - v_included_used - v_included_credits),
    'purchasedCreditsUsed', v_purchased_credits,
    'purchasedBalanceCredits', v_purchased_balance,
    'creditBalance', v_purchased_balance,
    'belowRechargeThreshold', v_below_threshold,
    'occurredAt', v_now
  );
END;
$function$;

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

COMMIT;
