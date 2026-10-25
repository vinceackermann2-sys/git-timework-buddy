-- Agent ID: which model works as an agent, in which app. Each MCP connection
-- gets a session that remembers its app (Claude Code, Codex…) and the model
-- the agent says it is, so every action it takes is recorded with both; each
-- app keeps the model it last ran with and the models it has run with.

alter table public.agent_id_agent_clients add column if not exists model text check (char_length(model) <= 80);
alter table public.agent_id_agent_clients add column if not exists models jsonb not null default '[]'::jsonb;

create table if not exists public.agent_id_mcp_sessions (
  id text primary key check (id ~ '^mcs_[a-z0-9]{24}$'),
  agent_id text not null references public.agent_id_agents(id) on delete cascade,
  app text check (app ~ '^[a-z0-9-]{1,40}$'),
  client_name text check (char_length(client_name) <= 100),
  model text check (char_length(model) <= 80),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create index if not exists agent_id_mcp_sessions_agent on public.agent_id_mcp_sessions(agent_id, last_seen_at desc);

alter table public.agent_id_mcp_sessions enable row level security;
revoke all on public.agent_id_mcp_sessions from public, anon, authenticated;
grant all on public.agent_id_mcp_sessions to service_role;
