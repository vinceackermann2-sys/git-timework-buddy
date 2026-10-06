alter table public.timewarp_energy_runs add column native_reasoning text not null default 'low' check(native_reasoning in ('low','medium','high'));
create or replace function public.timewarp_energy_native_submit(p_user uuid,p_conversation uuid,p_agent uuid,p_request uuid,p_prompt text,p_model text,p_start boolean)
returns setof public.timewarp_energy_runs language plpgsql security invoker set search_path='' as $$
declare turn public.timewarp_energy_runs; agent public.timewarp_energy_agents; conv public.timewarp_energy_conversations;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user::text,0));
  select * into turn from public.timewarp_energy_runs where user_id=p_user and request_id=p_request;
  if found then
    if turn.conversation_id<>p_conversation then raise exception 'This message identifier belongs to another conversation.'; end if;
    return next turn; return;
  end if;
  select * into conv from public.timewarp_energy_conversations where id=p_conversation and user_id=p_user;
  if not found then
    if not p_start then raise exception 'Conversation not found.'; end if;
    select * into agent from public.timewarp_energy_agents where id=p_agent and user_id=p_user and not archived;
    if not found then raise exception 'Agent not found.'; end if;
    insert into public.timewarp_energy_conversations(id,user_id,title,agent_id) values(p_conversation,p_user,left(p_prompt,90),agent.id) returning * into conv;
  else
    select * into agent from public.timewarp_energy_agents where id=conv.agent_id and user_id=p_user and not archived;
    if not found then raise exception 'Agent not found.'; end if;
  end if;
  if exists(select 1 from public.timewarp_energy_runs where user_id=p_user and conversation_id=p_conversation and status in ('queued','running')) then raise exception 'A task is already running in this conversation.'; end if;
  if (select count(*) from public.timewarp_energy_runs where user_id=p_user and status in ('queued','running'))>=3 then raise exception 'Three tasks are already active.'; end if;
  insert into public.timewarp_energy_runs(user_id,conversation_id,request_id,prompt,model,native_instructions,native_reasoning)
    values(p_user,p_conversation,p_request,p_prompt,p_model,agent.instructions,coalesce(conv.model_settings->>'reasoningEffort',(select settings->'native'->'modelSettings'->>'reasoningEffort' from public.timewarp_energy_settings where user_id=p_user),'low')) returning * into turn;
  update public.timewarp_energy_conversations set archived=false,is_read=true,updated_at=now() where id=conv.id and user_id=p_user;
  return next turn;
end $$;
