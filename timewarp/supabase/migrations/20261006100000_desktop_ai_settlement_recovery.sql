BEGIN;

-- Usage counts only: no prompts, tool results, audio or credentials.
CREATE TABLE public.timewarp_desktop_ai_settlements (
  reservation_id uuid PRIMARY KEY REFERENCES public.timewarp_agent_ai_reservations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  model text NOT NULL,
  outcome text NOT NULL CHECK(outcome IN ('settled','released','uncertain')),
  input_tokens integer NOT NULL CHECK(input_tokens >= 0),
  output_tokens integer NOT NULL CHECK(output_tokens >= 0),
  cost_usd numeric NOT NULL CHECK(cost_usd >= 0 AND cost_usd < 'Infinity'::numeric),
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','done','review')),
  attempts integer NOT NULL DEFAULT 0,
  last_error_code text,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.timewarp_desktop_ai_settlements ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.timewarp_desktop_ai_settlements FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.timewarp_desktop_ai_settlements TO service_role;
CREATE INDEX timewarp_desktop_ai_settlements_pending ON public.timewarp_desktop_ai_settlements(next_attempt_at) WHERE status='pending';

CREATE FUNCTION public.timewarp_energy_complete_ai(p_id uuid,p_user_id uuid,p_model text,p_input integer,p_output integer,p_cost numeric,p_outcome text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_res public.timewarp_agent_ai_reservations; v_queue public.timewarp_desktop_ai_settlements; v_result jsonb;
BEGIN
  -- Same lock order as the ledger: user, queue, reservation. Every writer,
  -- including the recovery job, serializes on this personal allowance.
  PERFORM pg_advisory_xact_lock(hashtextextended('personal:'||p_user_id::text,0));
  SELECT * INTO v_res FROM public.timewarp_agent_ai_reservations WHERE id=p_id AND user_id=p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Reservation not found'; END IF;
  IF p_outcome IS NULL OR p_outcome NOT IN ('settled','released','uncertain') OR p_model IS NULL OR length(p_model)>200 OR p_input IS NULL OR p_output IS NULL OR p_input<0 OR p_output<0 OR p_cost IS NULL OR p_cost<0 OR p_cost>='Infinity'::numeric OR p_cost='NaN'::numeric OR p_cost*2.5/0.125>v_res.credits THEN RAISE EXCEPTION 'Invalid reserved usage'; END IF;
  IF p_outcome<>'settled' AND (p_input<>0 OR p_output<>0 OR p_cost<>0) THEN RAISE EXCEPTION 'Only known usage can be billed'; END IF;
  IF v_res.status IN ('settled','released') THEN
    UPDATE public.timewarp_desktop_ai_settlements SET status='done',updated_at=now() WHERE reservation_id=p_id;
    RETURN coalesce(v_res.settlement,'{}'::jsonb);
  END IF;
  INSERT INTO public.timewarp_desktop_ai_settlements(reservation_id,user_id,model,outcome,input_tokens,output_tokens,cost_usd)
  VALUES(p_id,p_user_id,p_model,p_outcome,p_input,p_output,p_cost) ON CONFLICT(reservation_id) DO NOTHING;
  SELECT * INTO v_queue FROM public.timewarp_desktop_ai_settlements WHERE reservation_id=p_id FOR UPDATE;
  IF v_queue.user_id<>p_user_id OR v_queue.model<>p_model THEN RAISE EXCEPTION 'Usage owner/model mismatch'; END IF;
  IF v_queue.outcome='uncertain' AND p_outcome<>'uncertain' THEN
    UPDATE public.timewarp_desktop_ai_settlements SET outcome=p_outcome,input_tokens=p_input,output_tokens=p_output,cost_usd=p_cost,status='pending',attempts=0,next_attempt_at=now(),updated_at=now() WHERE reservation_id=p_id RETURNING * INTO v_queue;
  ELSIF p_outcome<>'uncertain' AND (v_queue.outcome<>p_outcome OR v_queue.input_tokens<>p_input OR v_queue.output_tokens<>p_output OR v_queue.cost_usd<>p_cost) THEN
    RAISE EXCEPTION 'Conflicting final usage';
  END IF;
  BEGIN
    v_result:=public.timewarp_energy_finish_ai(p_id,p_user_id,v_queue.model,v_queue.input_tokens,v_queue.output_tokens,v_queue.cost_usd,v_queue.outcome);
    UPDATE public.timewarp_desktop_ai_settlements SET status=CASE WHEN v_queue.outcome='uncertain' THEN 'review' ELSE 'done' END,last_error_code=NULL,updated_at=now() WHERE reservation_id=p_id;
    RETURN v_result;
  EXCEPTION WHEN OTHERS THEN
    -- The nested transaction rolls back partial ledger writes. The outer
    -- transaction commits immutable usage evidence for a later retry.
    UPDATE public.timewarp_desktop_ai_settlements SET attempts=attempts+1,last_error_code=SQLSTATE,
      status=CASE WHEN attempts+1>=12 THEN 'review' ELSE 'pending' END,
      next_attempt_at=now()+make_interval(secs=>least(3600,15*power(2,least(attempts,8)))::integer),updated_at=now() WHERE reservation_id=p_id;
    RETURN jsonb_build_object('reconciliationPending',true);
  END;
END $$;

CREATE FUNCTION public.timewarp_energy_retry_ai_settlements(p_limit integer DEFAULT 100)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_row record; v_result jsonb; v_processed integer:=0; v_pending integer:=0;
BEGIN
  IF p_limit IS NULL OR p_limit<1 OR p_limit>100 THEN RAISE EXCEPTION 'Invalid recovery batch size'; END IF;
  -- Do not take a queue lock before the personal advisory lock. Concurrent
  -- jobs may see the same candidate; complete_ai/finish_ai are idempotent.
  FOR v_row IN SELECT * FROM public.timewarp_desktop_ai_settlements WHERE status='pending' AND next_attempt_at<=now() ORDER BY next_attempt_at,reservation_id LIMIT p_limit LOOP
    v_result:=public.timewarp_energy_complete_ai(v_row.reservation_id,v_row.user_id,v_row.model,v_row.input_tokens,v_row.output_tokens,v_row.cost_usd,v_row.outcome);
    v_processed:=v_processed+1;
    IF coalesce((v_result->>'reconciliationPending')::boolean,false) THEN v_pending:=v_pending+1; END IF;
  END LOOP;
  RETURN jsonb_build_object('processed',v_processed,'pending',v_pending);
END $$;

CREATE FUNCTION public.timewarp_energy_ai_reconciliation_status()
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
  SELECT jsonb_build_object(
    'pending',(SELECT count(*) FROM public.timewarp_desktop_ai_settlements WHERE status='pending'),
    'review',(SELECT count(*) FROM public.timewarp_desktop_ai_settlements WHERE status='review'),
    'oldestPending',(SELECT min(created_at) FROM public.timewarp_desktop_ai_settlements WHERE status='pending'),
    'unrecordedStale',(SELECT count(*) FROM public.timewarp_agent_ai_reservations r WHERE r.status IN ('reserved','uncertain') AND r.created_at<now()-interval '10 minutes' AND NOT EXISTS(SELECT 1 FROM public.timewarp_desktop_ai_settlements q WHERE q.reservation_id=r.id)))
$$;
REVOKE ALL ON FUNCTION public.timewarp_energy_complete_ai(uuid,uuid,text,integer,integer,numeric,text), public.timewarp_energy_retry_ai_settlements(integer), public.timewarp_energy_ai_reconciliation_status() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.timewarp_energy_complete_ai(uuid,uuid,text,integer,integer,numeric,text), public.timewarp_energy_retry_ai_settlements(integer), public.timewarp_energy_ai_reconciliation_status() TO service_role;
COMMIT;
