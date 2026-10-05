-- Current integration schema for a database with existing Timewarp auth, billing and organization services.
create table public.timewarp_energy_settings (user_id uuid primary key references auth.users(id) on delete cascade,settings jsonb not null default '{}'::jsonb,updated_at timestamptz not null default now());
alter table public.timewarp_energy_settings enable row level security;
create policy owner_select on public.timewarp_energy_settings for select to authenticated using ((select auth.uid())=user_id);
revoke all on public.timewarp_energy_settings from anon,authenticated;
grant select on public.timewarp_energy_settings to authenticated;
grant all on public.timewarp_energy_settings to service_role;
-- The harness, files and memory are local. Only chat messages are synchronized.
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
