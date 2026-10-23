-- Agent ID vault: agents save into their own vault too (sealed on their own
-- computer by the Agent ID CLI before it leaves), and the vault's key is
-- encrypted on the agent's computer. Unlocking it takes two halves: one kept
-- on that computer, one kept here. Neither half opens anything alone, so a
-- copy of the computer's disk holds nothing readable, and this table holds no
-- secret of anyone's.

alter table public.agent_id_vault_items add column if not exists saved_by text not null default 'owner' check (saved_by in ('owner', 'agent'));

create table if not exists public.agent_id_vault_unlock (
  resource_id uuid primary key references public.agent_id_resources(id) on delete cascade,
  half text not null check (char_length(half) between 40 and 64),
  created_at timestamptz not null default now()
);

alter table public.agent_id_vault_unlock enable row level security;
revoke all on public.agent_id_vault_unlock from public, anon, authenticated;
grant all on public.agent_id_vault_unlock to service_role;
