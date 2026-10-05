-- Additive schema for this desktop integration. Existing Timewarp data is untouched.
create table public.timewarp_energy_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (length(title) between 1 and 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(id, user_id)
);
create table public.timewarp_energy_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid not null,
  request_id uuid not null,
  prompt text not null check (length(prompt) between 1 and 20000),
  status text not null default 'queued' check (status in ('queued','running','completed','failed','cancelled')),
  model text not null default 'gpt-5.6-sol',
  messages jsonb not null default '[]'::jsonb,
  result text not null default '',
  error text,
  steps integer not null default 0,
  attempts integer not null default 0,
  lease_id uuid,
  lease_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key(conversation_id, user_id) references public.timewarp_energy_conversations(id, user_id) on delete cascade,
  unique(user_id, request_id)
);
create unique index timewarp_energy_one_active_turn on public.timewarp_energy_runs(conversation_id)
  where status in ('queued','running');
create index timewarp_energy_run_queue on public.timewarp_energy_runs(status, lease_until, created_at);
create index timewarp_energy_runs_owner on public.timewarp_energy_runs(user_id, conversation_id, created_at);
create index timewarp_energy_conversations_owner on public.timewarp_energy_conversations(user_id, updated_at desc);
create table public.timewarp_energy_documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check(length(name) between 1 and 200),
  content text not null check(octet_length(content) <= 1048576),
  revision integer not null default 1,
  updated_at timestamptz not null default now(),
  unique(user_id, name)
);
create table public.timewarp_energy_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  settings jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.timewarp_energy_conversations enable row level security;
alter table public.timewarp_energy_runs enable row level security;
alter table public.timewarp_energy_documents enable row level security;
alter table public.timewarp_energy_settings enable row level security;
create policy owner_select on public.timewarp_energy_conversations for select to authenticated using ((select auth.uid()) = user_id);
create policy owner_select on public.timewarp_energy_runs for select to authenticated using ((select auth.uid()) = user_id);
create policy owner_select on public.timewarp_energy_documents for select to authenticated using ((select auth.uid()) = user_id);
create policy owner_select on public.timewarp_energy_settings for select to authenticated using ((select auth.uid()) = user_id);
revoke all on public.timewarp_energy_conversations, public.timewarp_energy_runs, public.timewarp_energy_documents, public.timewarp_energy_settings from anon, authenticated;
grant select on public.timewarp_energy_conversations, public.timewarp_energy_runs, public.timewarp_energy_documents, public.timewarp_energy_settings to authenticated;
grant all on public.timewarp_energy_conversations, public.timewarp_energy_runs, public.timewarp_energy_documents, public.timewarp_energy_settings to service_role;

-- Atomic leases keep multiple workers from executing the same job.
create function public.timewarp_energy_claim(p_holder uuid, p_run_id uuid default null) returns setof public.timewarp_energy_runs
language plpgsql security invoker set search_path = '' as $$
begin
  update public.timewarp_energy_runs set status='failed', error='The cloud worker could not finish after three attempts.', lease_id=null, lease_until=null, updated_at=now()
    where status='running' and lease_until<now() and attempts>=3;
  return query
    update public.timewarp_energy_runs set status='running', lease_id=p_holder,
      lease_until=now()+interval '150 seconds', attempts=attempts+1, updated_at=now()
    where id=(select id from public.timewarp_energy_runs
      where (status='queued' or (status='running' and lease_until<now() and attempts<3)) and (p_run_id is null or id=p_run_id)
      order by created_at for update skip locked limit 1)
    returning *;
end $$;
revoke all on function public.timewarp_energy_claim(uuid,uuid) from public, anon, authenticated;
grant execute on function public.timewarp_energy_claim(uuid,uuid) to service_role;

-- File writes are guarded by the live lease, including cancellation.
create function public.timewarp_energy_write_doc(p_run uuid, p_holder uuid, p_name text, p_content text)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare owner_id uuid; document_id uuid;
begin
  select user_id into owner_id from public.timewarp_energy_runs
    where id=p_run and lease_id=p_holder and status='running' and lease_until>now() for update;
  if owner_id is null then raise exception 'The run is stopped or its execution lease expired.'; end if;
  insert into public.timewarp_energy_documents(user_id,name,content) values(owner_id,p_name,p_content)
    on conflict(user_id,name) do update set content=excluded.content,
      revision=public.timewarp_energy_documents.revision+1, updated_at=now()
    returning id into document_id;
  return document_id;
end $$;
revoke all on function public.timewarp_energy_write_doc(uuid,uuid,text,text) from public, anon, authenticated;
grant execute on function public.timewarp_energy_write_doc(uuid,uuid,text,text) to service_role;

-- The existing server-only worker credential stays in Supabase Vault.
select cron.schedule('timewarp-energy-jobs', '* * * * *', $cron$
  select net.http_post(
    url := 'https://mrqoeywofslgnquvzhuf.supabase.co/functions/v1/timewarp-energy/internal/worker',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' ||
      (select decrypted_secret from vault.decrypted_secrets where name='agent_job_worker_key' limit 1)),
    body := '{}'::jsonb, timeout_milliseconds := 5000
  ) where exists(select 1 from public.timewarp_energy_runs where status='queued' or (status='running' and lease_until<now()));
$cron$);
