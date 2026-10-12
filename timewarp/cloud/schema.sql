-- Current integration schema for a database with existing Timewarp auth, billing and organization services.
create table public.timewarp_energy_settings (user_id uuid primary key references auth.users(id) on delete cascade,settings jsonb not null default '{}'::jsonb,updated_at timestamptz not null default now());
alter table public.timewarp_energy_settings enable row level security;
create policy owner_select on public.timewarp_energy_settings for select to authenticated using ((select auth.uid())=user_id);
revoke all on public.timewarp_energy_settings from anon,authenticated;
grant select on public.timewarp_energy_settings to authenticated;
grant all on public.timewarp_energy_settings to service_role;
-- The harness and files are local. Chat messages are synchronized here; the
-- account's agents, memory, settings and the like in timewarp_energy_account_data below.
create table public.timewarp_energy_desktop_history (
  user_id uuid not null references auth.users(id) on delete cascade,
  id uuid not null,
  conversation jsonb not null,
  agents jsonb not null default '[]',
  entries jsonb not null default '[]',
  updated_at timestamptz not null default now(),
  primary key (user_id,id),
  check (jsonb_typeof(conversation)='object' and jsonb_typeof(agents)='array' and jsonb_typeof(entries)='array')
);
alter table public.timewarp_energy_desktop_history enable row level security;
create policy owner_select on public.timewarp_energy_desktop_history for select to authenticated using ((select auth.uid())=user_id);
revoke all on public.timewarp_energy_desktop_history from anon,authenticated;
grant select on public.timewarp_energy_desktop_history to authenticated;
grant all on public.timewarp_energy_desktop_history to service_role;
create function public.timewarp_energy_merge_history(p_user uuid,p_id uuid,p_conversation jsonb,p_agents jsonb,p_entries jsonb)
returns void language sql security invoker set search_path='' as $$
  insert into public.timewarp_energy_desktop_history(user_id,id,conversation,agents,entries)
  values(p_user,p_id,p_conversation,p_agents,p_entries)
  on conflict(user_id,id) do update set
    conversation=case when (excluded.conversation->>'updatedAt') >= (public.timewarp_energy_desktop_history.conversation->>'updatedAt') then excluded.conversation else public.timewarp_energy_desktop_history.conversation end,
    agents=excluded.agents,
    entries=(select coalesce(jsonb_agg(merged.entry order by merged.entry->>'createdAt',merged.entry->>'id'),'[]'::jsonb) from
      (select distinct on (entry->>'id') entry from jsonb_array_elements(public.timewarp_energy_desktop_history.entries || excluded.entries) with ordinality as rows(entry,position) order by entry->>'id',position desc) merged),
    updated_at=now();
$$;
revoke all on function public.timewarp_energy_merge_history(uuid,uuid,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.timewarp_energy_merge_history(uuid,uuid,jsonb,jsonb,jsonb) to service_role;

-- What follows a Timewarp account to each computer it signs in on, besides its
-- chats (timewarp_energy_desktop_history): its agents, memory, instructions for
-- every agent, skills, settings, which connected accounts each agent may use
-- and its MCP servers' addresses. Secrets, files, browser sign-ins and the
-- vault stay on each computer; the desktop never sends them.
--
-- Each item has a revision from the account's own counter. A write names the
-- revision it was based on and is refused (with what is stored) when the item
-- changed meanwhile, so the desktop merges instead of overwriting. A write
-- holds the account's counter until it commits, so an account's writes happen
-- one at a time and revisions commit in order: a reader that has seen
-- revision n has seen every change up to n. A removed item stays as a row
-- without a value, so every computer learns it was removed.
create table public.timewarp_energy_account_data_revisions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  revision bigint not null
);
create table public.timewarp_energy_account_data (
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('agent','memory','instructions','skill','connector-access','setting','mcp')),
  key text not null check (length(key) between 1 and 400),
  value jsonb,
  revision bigint not null,
  updated_at timestamptz not null default now(),
  primary key (user_id,kind,key)
);
create index timewarp_energy_account_data_changes on public.timewarp_energy_account_data(user_id,revision);
alter table public.timewarp_energy_account_data_revisions enable row level security;
alter table public.timewarp_energy_account_data enable row level security;
create policy owner_select on public.timewarp_energy_account_data for select to authenticated using ((select auth.uid())=user_id);
revoke all on public.timewarp_energy_account_data_revisions from anon,authenticated;
revoke all on public.timewarp_energy_account_data from anon,authenticated;
grant select on public.timewarp_energy_account_data to authenticated;
grant all on public.timewarp_energy_account_data_revisions to service_role;
grant all on public.timewarp_energy_account_data to service_role;

-- p_items: [{kind,key,value,base}] (value null removes the item). Returns one
-- result per item: {revision} once stored, {conflict:true,revision,value}
-- with what is stored when it isn't at revision `base` (0: not stored yet),
-- or {error:'full'} past 20,000 items.
create function public.timewarp_energy_put_account_data(p_user uuid,p_items jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  item jsonb;
  results jsonb := '[]'::jsonb;
  current_revision bigint;
  stored record;
  stored_count bigint;
  item_value jsonb;
  existed boolean;
begin
  if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)>25 then raise exception 'Invalid account data.'; end if;
  -- The account's counter, held until this write commits.
  insert into public.timewarp_energy_account_data_revisions as counter(user_id,revision) values(p_user,0)
    on conflict(user_id) do update set revision=counter.revision
    returning counter.revision into current_revision;
  select count(*) into stored_count from public.timewarp_energy_account_data d where d.user_id=p_user;
  for item in select value from jsonb_array_elements(p_items) loop
    select d.revision,d.value into stored from public.timewarp_energy_account_data d
      where d.user_id=p_user and d.kind=item->>'kind' and d.key=item->>'key';
    existed := found;
    if existed and stored.revision<>coalesce((item->>'base')::bigint,0) then
      results := results || jsonb_build_array(jsonb_build_object('kind',item->>'kind','key',item->>'key','conflict',true,'revision',stored.revision,'value',stored.value));
      continue;
    end if;
    if not existed and stored_count>=20000 then
      results := results || jsonb_build_array(jsonb_build_object('kind',item->>'kind','key',item->>'key','error','full'));
      continue;
    end if;
    current_revision := current_revision+1;
    item_value := case when item->'value' is null or jsonb_typeof(item->'value')='null' then null else item->'value' end;
    insert into public.timewarp_energy_account_data(user_id,kind,key,value,revision,updated_at)
      values(p_user,item->>'kind',item->>'key',item_value,current_revision,now())
      on conflict(user_id,kind,key) do update set value=excluded.value,revision=excluded.revision,updated_at=excluded.updated_at;
    if not existed then stored_count := stored_count+1; end if;
    results := results || jsonb_build_array(jsonb_build_object('kind',item->>'kind','key',item->>'key','revision',current_revision));
  end loop;
  update public.timewarp_energy_account_data_revisions set revision=current_revision where user_id=p_user;
  return results;
end;
$$;
revoke all on function public.timewarp_energy_put_account_data(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.timewarp_energy_put_account_data(uuid,jsonb) to service_role;
