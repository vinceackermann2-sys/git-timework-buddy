-- Agent ID: asking the owner first. Per agent, which of its actions (sending
-- mail, texting, calling, changing contacts, saving to the vault) wait for
-- the owner's yes. Unset ones follow Agent ID's defaults (real texts and
-- calls ask).
alter table public.agent_id_agents add column if not exists ask_first jsonb not null default '{}'::jsonb check (jsonb_typeof(ask_first) = 'object');

-- Those actions wait as approvals, beside payments.
alter table public.agent_id_approvals drop constraint if exists agent_id_approvals_kind_check;
alter table public.agent_id_approvals add constraint agent_id_approvals_kind_check check (kind in ('wallet_transfer', 'action'));
