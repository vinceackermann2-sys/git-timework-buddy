-- Agent ID trace: what agents make, traceable back to them. Each record is one
-- output (a picture, a sound, a text, code, a video or another file) with the
-- agent that made it, how (its app and model, or the model maker that marked
-- it), and what's needed to recognise it later: the hidden mark's id (the
-- record's id), the bytes' hashes, and for text and code a fingerprint. The
-- output itself is never kept.

create table if not exists public.agent_id_traces (
  id text primary key check (id ~ '^tr_[0-9a-f]{16}$'),
  agent_id text not null references public.agent_id_agents(id) on delete cascade,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('image', 'audio', 'text', 'code', 'video', 'other')),
  -- How it was marked: a hidden mark in it, only recorded, or text matched by its fingerprint.
  marked text not null check (marked in ('mark', 'record', 'fingerprint')),
  -- Through which door: the agent itself, a model maker for it, or what Agent ID sent for it.
  via text not null check (via in ('agent', 'provider', 'mail', 'sms', 'call')),
  provider text check (char_length(provider) <= 100),
  app text check (char_length(app) <= 40),
  model text check (char_length(model) <= 80),
  mime text check (char_length(mime) <= 150),
  size_bytes bigint,
  -- SHA-256 of the output as it came in, and as it went out with its mark.
  sha256 text check (sha256 ~ '^[0-9a-f]{64}$'),
  marked_sha256 text check (marked_sha256 ~ '^[0-9a-f]{64}$'),
  -- Text and code: winnowed hashes of the normalised text, never the text.
  fingerprint integer[],
  -- Agent ID's signed receipt (ES256, the passport keys): this agent made it, then.
  receipt text,
  created_at timestamptz not null default now()
);
create index if not exists agent_id_traces_agent on public.agent_id_traces(agent_id, created_at desc);
create index if not exists agent_id_traces_sha256 on public.agent_id_traces(sha256);
create index if not exists agent_id_traces_marked_sha256 on public.agent_id_traces(marked_sha256);
create index if not exists agent_id_traces_fingerprint on public.agent_id_traces using gin (fingerprint);

alter table public.agent_id_traces enable row level security;
revoke all on public.agent_id_traces from public, anon, authenticated;
grant all on public.agent_id_traces to service_role;

-- The records sharing the most fingerprint hashes with a text being checked,
-- as a list of { id, kind, shared }.
create or replace function public.agent_id_trace_matches(p_hashes integer[])
returns jsonb
language sql stable security invoker set search_path = public as $$
  select coalesce(jsonb_agg(m order by m.shared desc), '[]'::jsonb) from (
    select t.id, t.kind, (select count(*)::integer from unnest(t.fingerprint) h where h = any(p_hashes)) as shared
    from public.agent_id_traces t
    where t.fingerprint && p_hashes
    order by shared desc, t.created_at asc
    limit 5
  ) m
$$;
revoke all on function public.agent_id_trace_matches(integer[]) from public, anon, authenticated;
grant execute on function public.agent_id_trace_matches(integer[]) to service_role;
