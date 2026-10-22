-- Agent ID: memory, and asking the owner first.
--
-- Each agent's memory: what it should remember across every app it's used in
-- (Claude Code, Codex, Cursor, Antigravity…), which its owner sees and edits.
-- Every memory is encrypted before it's stored (AES-256-GCM, with a key made
-- per agent from AGENT_ID_DATA_KEY, a secret of the function that is never in
-- the database) and bound to its own id, so this table holds nothing readable.
-- `digest`, a keyed hash, spots duplicates without revealing them.
create table if not exists public.agent_id_memories (
  id text primary key check (id ~ '^mem_[a-z0-9]{24}$'),
  agent_id text not null references public.agent_id_agents(id) on delete cascade,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  sealed text not null check (char_length(sealed) <= 16000),
  digest text not null check (digest ~ '^[0-9a-f]{64}$'),
  source text not null check (source in ('agent', 'owner', 'import')),
  app text check (app ~ '^[a-z0-9-]{1,40}$'),
  model text check (char_length(model) <= 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists agent_id_memories_digest on public.agent_id_memories(agent_id, digest);
create index if not exists agent_id_memories_agent on public.agent_id_memories(agent_id, created_at desc);

alter table public.agent_id_memories enable row level security;
revoke all on public.agent_id_memories from public, anon, authenticated;
grant all on public.agent_id_memories to service_role;

-- Asking the owner first: per agent, which of its actions (sending mail,
-- texting, calling, changing contacts, saving to the vault) wait for the
-- owner's yes. Unset ones follow Agent ID's defaults (real texts and calls ask).
alter table public.agent_id_agents add column if not exists ask_first jsonb not null default '{}'::jsonb check (jsonb_typeof(ask_first) = 'object');

-- Those actions wait as approvals, beside payments.
alter table public.agent_id_approvals drop constraint if exists agent_id_approvals_kind_check;
alter table public.agent_id_approvals add constraint agent_id_approvals_kind_check check (kind in ('wallet_transfer', 'action'));
