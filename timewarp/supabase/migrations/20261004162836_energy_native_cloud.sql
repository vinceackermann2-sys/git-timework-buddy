-- Cloud conversations in the original desktop interface. Device vaults stay local.
create table public.timewarp_energy_agents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null check(length(display_name) between 1 and 120),
  instructions text not null default '' check(length(instructions)<=50000),
  conversation_id uuid not null,
  is_default boolean not null default false,
  starred boolean not null default false,
  archived boolean not null default false,
  sort_order double precision not null default 0,
  memory_mode text check(memory_mode in ('enabled','read-only','write-only','none')),
  updated_at timestamptz not null default now(),
  unique(id,user_id)
);
create unique index timewarp_energy_default_agent on public.timewarp_energy_agents(user_id) where is_default and not archived;
create index timewarp_energy_agents_owner on public.timewarp_energy_agents(user_id,archived,sort_order);
alter table public.timewarp_energy_agents enable row level security;
create policy owner_select on public.timewarp_energy_agents for select to authenticated using ((select auth.uid())=user_id);
revoke all on public.timewarp_energy_agents from anon,authenticated;
grant select on public.timewarp_energy_agents to authenticated;
grant all on public.timewarp_energy_agents to service_role;
alter table public.timewarp_energy_conversations add column agent_id uuid;
alter table public.timewarp_energy_conversations add column archived boolean not null default false;
alter table public.timewarp_energy_conversations add column is_read boolean not null default true;
alter table public.timewarp_energy_conversations add column model_settings jsonb;
alter table public.timewarp_energy_conversations add constraint timewarp_energy_conversation_agent foreign key(agent_id,user_id) references public.timewarp_energy_agents(id,user_id);
alter table public.timewarp_energy_runs add column native_instructions text not null default '' check(length(native_instructions)<=50000);
alter table public.timewarp_energy_runs add column entry_sequence bigint generated always as identity;

create function public.timewarp_energy_native_agent(p_user uuid,p_id uuid default null,p_name text default 'Timewarp',p_instructions text default '')
returns setof public.timewarp_energy_agents language plpgsql security invoker set search_path='' as $$
declare agent public.timewarp_energy_agents; conversation uuid;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user::text,0));
  if p_id is null then
    select * into agent from public.timewarp_energy_agents where user_id=p_user and is_default and not archived;
    if found then return next agent; return; end if;
  else
    select * into agent from public.timewarp_energy_agents where user_id=p_user and id=p_id;
    if found then return next agent; return; end if;
  end if;
  conversation:=gen_random_uuid();
  insert into public.timewarp_energy_agents(id,user_id,display_name,instructions,conversation_id,is_default)
    values(coalesce(p_id,gen_random_uuid()),p_user,p_name,p_instructions,conversation,p_id is null) returning * into agent;
  insert into public.timewarp_energy_conversations(id,user_id,title,agent_id) values(conversation,p_user,p_name,agent.id);
  return next agent;
end $$;
revoke all on function public.timewarp_energy_native_agent(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.timewarp_energy_native_agent(uuid,uuid,text,text) to service_role;

create function public.timewarp_energy_native_submit(p_user uuid,p_conversation uuid,p_agent uuid,p_request uuid,p_prompt text,p_model text,p_start boolean)
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
  insert into public.timewarp_energy_runs(user_id,conversation_id,request_id,prompt,model,native_instructions)
    values(p_user,p_conversation,p_request,p_prompt,p_model,agent.instructions) returning * into turn;
  update public.timewarp_energy_conversations set archived=false,is_read=true,updated_at=now() where id=conv.id and user_id=p_user;
  return next turn;
end $$;
revoke all on function public.timewarp_energy_native_submit(uuid,uuid,uuid,uuid,text,text,boolean) from public,anon,authenticated;
grant execute on function public.timewarp_energy_native_submit(uuid,uuid,uuid,uuid,text,text,boolean) to service_role;
