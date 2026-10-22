-- Agent ID: free machine hours per account (AGENT_ID_FREE_COMPUTE_HOURS, 5
-- by default) before machine time is paid in Timewarp credits. A command
-- takes the most it may use from what's left up front, and gives back what it
-- didn't use, so two commands at once never use more than the allowance.

create table if not exists public.agent_id_compute_allowance (
  user_id uuid primary key references auth.users(id) on delete cascade,
  used_seconds integer not null default 0 check (used_seconds >= 0),
  updated_at timestamptz not null default now()
);

-- Takes up to p_seconds from what's left of p_allowance; returns how many it took.
create or replace function public.agent_id_take_free_compute(p_user uuid, p_seconds integer, p_allowance integer)
returns integer language plpgsql security definer set search_path = public as $$
declare
  taken integer;
begin
  insert into public.agent_id_compute_allowance(user_id) values (p_user) on conflict (user_id) do nothing;
  select least(greatest(p_seconds, 0), greatest(p_allowance - used_seconds, 0)) into taken
    from public.agent_id_compute_allowance where user_id = p_user for update;
  update public.agent_id_compute_allowance set used_seconds = used_seconds + taken, updated_at = now() where user_id = p_user;
  return taken;
end $$;

-- Gives back seconds taken but not used.
create or replace function public.agent_id_return_free_compute(p_user uuid, p_seconds integer)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.agent_id_compute_allowance set used_seconds = greatest(used_seconds - greatest(p_seconds, 0), 0), updated_at = now() where user_id = p_user;
end $$;

alter table public.agent_id_compute_allowance enable row level security;
revoke all on public.agent_id_compute_allowance from public, anon, authenticated;
grant all on public.agent_id_compute_allowance to service_role;
revoke all on function public.agent_id_take_free_compute(uuid, integer, integer) from public, anon, authenticated;
revoke all on function public.agent_id_return_free_compute(uuid, integer) from public, anon, authenticated;
grant execute on function public.agent_id_take_free_compute(uuid, integer, integer) to service_role;
grant execute on function public.agent_id_return_free_compute(uuid, integer) to service_role;
