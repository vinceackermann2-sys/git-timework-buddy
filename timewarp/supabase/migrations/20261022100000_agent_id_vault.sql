-- Agent ID vault: what's in each agent's vault, without the secrets. The
-- secrets live only on the agent's computer, sealed in the owner's browser to
-- the computer's own key; this keeps the name, the kind, and the website or
-- the sites a key may go to, so the vault can be listed without the computer.
-- Removing the computer removes its vault.

create table if not exists public.agent_id_vault_items (
  id text primary key check (id ~ '^vlt_[a-z0-9]{24}$'),
  agent_id text not null references public.agent_id_agents(id) on delete cascade,
  resource_id uuid not null references public.agent_id_resources(id) on delete cascade,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('login', 'key')),
  label text not null check (char_length(label) between 1 and 100),
  site text check (char_length(site) <= 300),
  hosts jsonb not null default '[]'::jsonb,
  send text check (send in ('bearer', 'header', 'query', 'basic')),
  totp boolean not null default false,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);
create index if not exists agent_id_vault_items_resource on public.agent_id_vault_items(resource_id, created_at);
create index if not exists agent_id_vault_items_agent on public.agent_id_vault_items(agent_id);

alter table public.agent_id_vault_items enable row level security;
revoke all on public.agent_id_vault_items from public, anon, authenticated;
grant all on public.agent_id_vault_items to service_role;
