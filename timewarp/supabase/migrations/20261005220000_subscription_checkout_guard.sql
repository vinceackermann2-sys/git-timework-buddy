-- One durable pending subscription checkout per personal/workspace billing scope.
-- Apply before deploying stripe-billing. Existing subscriptions are not changed.
BEGIN;

CREATE TABLE public.timewarp_subscription_checkouts (
  scope_key text PRIMARY KEY,
  owner_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  workspace_id uuid REFERENCES public.timewarp_workspaces(id) ON DELETE CASCADE,
  attempt_id uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  request jsonb NOT NULL CHECK (jsonb_typeof(request) = 'object'),
  session_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '1 hour'),
  CHECK (scope_key = CASE WHEN workspace_id IS NULL THEN 'personal:' || owner_user_id::text ELSE 'workspace:' || workspace_id::text END),
  CHECK (expires_at > created_at)
);
ALTER TABLE public.timewarp_subscription_checkouts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.timewarp_subscription_checkouts FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.timewarp_prepare_subscription_checkout(
  p_user_id uuid, p_workspace_id uuid, p_request jsonb, p_previous_attempt uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_scope text;
  v_attempt public.timewarp_subscription_checkouts;
  v_created timestamptz;
BEGIN
  IF p_user_id IS NULL OR jsonb_typeof(p_request) IS DISTINCT FROM 'object'
    OR p_request->>'mode' IS DISTINCT FROM 'subscription'
    OR p_request->>'client_reference_id' IS DISTINCT FROM p_user_id::text
    OR p_request->'metadata'->>'workspace_id' IS DISTINCT FROM COALESCE(p_workspace_id::text, '') THEN
    RAISE EXCEPTION 'Invalid subscription checkout request';
  END IF;
  IF p_workspace_id IS NOT NULL AND COALESCE(public.timewarp_workspace_role_for(p_user_id,p_workspace_id), '') NOT IN ('owner','admin') THEN
    RAISE EXCEPTION 'Workspace billing access denied';
  END IF;
  v_scope := CASE WHEN p_workspace_id IS NULL THEN 'personal:' || p_user_id::text ELSE 'workspace:' || p_workspace_id::text END;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('subscription-checkout:' || v_scope,0));
  -- Recheck after acquiring the lock: the webhook may have activated a plan
  -- after the edge handler read its subscription row.
  IF EXISTS (SELECT 1 FROM public.timewarp_subscriptions
    WHERE ((p_workspace_id IS NULL AND workspace_id IS NULL AND owner_user_id=p_user_id) OR workspace_id=p_workspace_id)
      AND stripe_subscription_id IS NOT NULL
      AND subscription_status IS DISTINCT FROM 'canceled'
      AND subscription_status IS DISTINCT FROM 'incomplete_expired') THEN
    RETURN jsonb_build_object('subscription_exists',true);
  END IF;
  SELECT * INTO v_attempt FROM public.timewarp_subscription_checkouts WHERE scope_key=v_scope FOR UPDATE;
  IF FOUND AND (p_previous_attempt IS NULL OR v_attempt.attempt_id<>p_previous_attempt) THEN
    RETURN to_jsonb(v_attempt);
  END IF;
  -- Rotation is compare-and-set. The service must first verify expiry or a
  -- terminated subscription with Stripe; elapsed time alone never unlocks it.
  v_created := clock_timestamp();
  INSERT INTO public.timewarp_subscription_checkouts AS pending
    (scope_key,owner_user_id,workspace_id,request,created_at,expires_at)
  VALUES (v_scope,p_user_id,p_workspace_id,p_request,v_created,v_created+interval '1 hour')
  ON CONFLICT (scope_key) DO UPDATE SET
    owner_user_id=EXCLUDED.owner_user_id, attempt_id=gen_random_uuid(), request=EXCLUDED.request,
    session_id=NULL, created_at=EXCLUDED.created_at, expires_at=EXCLUDED.expires_at
  RETURNING * INTO v_attempt;
  RETURN to_jsonb(v_attempt);
END $$;

CREATE FUNCTION public.timewarp_save_subscription_checkout(
  p_user_id uuid, p_workspace_id uuid, p_attempt_id uuid, p_session_id text
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_scope text;
BEGIN
  IF p_user_id IS NULL OR p_session_id IS NULL OR p_session_id !~ '^cs_[A-Za-z0-9_]+$' THEN
    RAISE EXCEPTION 'Invalid checkout session';
  END IF;
  IF p_workspace_id IS NOT NULL AND COALESCE(public.timewarp_workspace_role_for(p_user_id,p_workspace_id), '') NOT IN ('owner','admin') THEN
    RAISE EXCEPTION 'Workspace billing access denied';
  END IF;
  v_scope := CASE WHEN p_workspace_id IS NULL THEN 'personal:' || p_user_id::text ELSE 'workspace:' || p_workspace_id::text END;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('subscription-checkout:' || v_scope,0));
  UPDATE public.timewarp_subscription_checkouts SET session_id=p_session_id
    WHERE scope_key=v_scope AND attempt_id=p_attempt_id AND owner_user_id=p_user_id
      AND (session_id IS NULL OR session_id=p_session_id);
  RETURN FOUND;
END $$;

REVOKE ALL ON FUNCTION public.timewarp_prepare_subscription_checkout(uuid,uuid,jsonb,uuid),
  public.timewarp_save_subscription_checkout(uuid,uuid,uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.timewarp_prepare_subscription_checkout(uuid,uuid,jsonb,uuid),
  public.timewarp_save_subscription_checkout(uuid,uuid,uuid,text) TO service_role;
COMMIT;
