-- Agent ID: an agent's automations, as Timewarp runs them. Timewarp keeps
-- them on the computer they were made on and runs them there; it sends what
-- they are (name, schedule, next and last run) here after each change, so the
-- agent's Agent ID shows them on the website too. Pausing, resuming or
-- running one from the website waits here as a request until Timewarp picks
-- it up and says how it went.
create table if not exists public.agent_id_automations (
  agent_id text not null references public.agent_id_agents(id) on delete cascade,
  id text not null check (char_length(id) between 1 and 100),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 200),
  -- As Timewarp keeps it ({ kind, time, days, … }), and in words.
  schedule jsonb not null default '{}'::jsonb check (jsonb_typeof(schedule) = 'object'),
  summary text check (char_length(summary) <= 200),
  enabled boolean not null default true,
  next_run_at timestamptz,
  -- { status, at } of the latest run.
  last_run jsonb check (last_run is null or jsonb_typeof(last_run) = 'object'),
  -- The computer it runs on.
  device text check (char_length(device) <= 100),
  updated_at timestamptz not null default now(),
  primary key (agent_id, id)
);
create index if not exists agent_id_automations_owner on public.agent_id_automations(owner_user_id);

create table if not exists public.agent_id_automation_requests (
  id uuid primary key default gen_random_uuid(),
  agent_id text not null references public.agent_id_agents(id) on delete cascade,
  automation_id text not null check (char_length(automation_id) between 1 and 100),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  action text not null check (action in ('pause', 'resume', 'run')),
  status text not null default 'pending' check (status in ('pending', 'done', 'failed')),
  error text check (char_length(error) <= 500),
  created_at timestamptz not null default now(),
  done_at timestamptz
);
create index if not exists agent_id_automation_requests_pending on public.agent_id_automation_requests(owner_user_id, status, created_at);

alter table public.agent_id_automations enable row level security;
alter table public.agent_id_automation_requests enable row level security;
revoke all on public.agent_id_automations from public, anon, authenticated;
revoke all on public.agent_id_automation_requests from public, anon, authenticated;
grant all on public.agent_id_automations to service_role;
grant all on public.agent_id_automation_requests to service_role;
