-- Agent ID: any kind of AI. An Agent ID can stand for an agent that acts with
-- tools, or for a model that makes one kind of output (images, voices, video,
-- code, text, decisions…), with who makes the model and which one it is, as
-- its owner says.
alter table public.agent_id_agents add column if not exists model_kind text not null default 'agent'
  check (model_kind in ('agent', 'llm', 'image', 'voice', 'video', 'code', 'text', 'decision', 'other'));
alter table public.agent_id_agents add column if not exists model_provider text check (char_length(model_provider) <= 60);
alter table public.agent_id_agents add column if not exists model_name text check (char_length(model_name) <= 80);
