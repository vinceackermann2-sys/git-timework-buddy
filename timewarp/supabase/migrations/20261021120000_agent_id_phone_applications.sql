-- Agent ID phone numbers start as an application: until live numbers are
-- switched on, an owner applies for one per agent, like cards. Only the
-- agent-id edge function (service role) reads or writes it.
create table if not exists public.agent_id_phone_applications (
  agent_id text primary key references public.agent_id_agents(id) on delete cascade,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'submitted' check (status in ('submitted','approved','declined')),
  use_case text not null check (char_length(use_case) between 1 and 1000),
  country text check (country ~ '^[A-Z]{2}$'),
  -- What the number is for: texts, calls, or both.
  uses text[] not null default array['sms','calls'] check (uses <@ array['sms','calls'] and cardinality(uses) between 1 and 2),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.agent_id_phone_applications enable row level security;
revoke all on public.agent_id_phone_applications from public, anon, authenticated;
grant all on public.agent_id_phone_applications to service_role;
