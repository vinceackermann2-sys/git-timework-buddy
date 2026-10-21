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

-- Owner withdrawals from test wallets too (development), as a simulation:
-- test dollars leave the test balance and nothing reaches a blockchain.
create or replace function public.agent_id_wallet_withdraw(p_agent text, p_amount bigint, p_to text, p_memo text)
returns jsonb language plpgsql security definer
set search_path = public, pg_temp as $$
declare
  v_agent public.agent_id_agents%rowtype;
  v_from public.agent_id_resources%rowtype;
  v_out uuid;
  v_memo text := left(nullif(trim(coalesce(p_memo,'')),''),300);
begin
  if p_amount is null or p_amount <= 0 or p_amount > 100000000000 or coalesce(p_to,'') !~ '^0x[0-9a-fA-F]{40}$' then
    return jsonb_build_object('status','invalid');
  end if;
  select * into v_agent from public.agent_id_agents where id=p_agent;
  if not found or v_agent.status='revoked' then return jsonb_build_object('status','not_found'); end if;
  select * into v_from from public.agent_id_resources where agent_id=p_agent and kind='wallet' and status<>'released' for update;
  if not found then return jsonb_build_object('status','no_wallet'); end if;
  if v_from.status='provisioning' then return jsonb_build_object('status','wallet_inactive'); end if;
  if v_from.mode='test' then
    if v_from.balance_minor < p_amount then return jsonb_build_object('status','insufficient','balance',v_from.balance_minor); end if;
    update public.agent_id_resources set balance_minor=balance_minor-p_amount, updated_at=now() where id=v_from.id;
    insert into public.agent_id_events(agent_id,owner_user_id,resource_id,kind,direction,status,counterparty,subject,amount_minor,currency,data)
      values(p_agent,v_agent.owner_user_id,v_from.id,'wallet','out','completed',p_to,v_memo,p_amount,v_from.currency,
        jsonb_build_object('withdrawal',true,'test',true)) returning id into v_out;
    return jsonb_build_object('status','ok','event',v_out,'mode','test','balance',v_from.balance_minor-p_amount);
  end if;
  insert into public.agent_id_events(agent_id,owner_user_id,resource_id,kind,direction,status,counterparty,subject,amount_minor,currency,data)
    values(p_agent,v_agent.owner_user_id,v_from.id,'wallet','out','pending',p_to,v_memo,p_amount,v_from.currency,
      jsonb_build_object('withdrawal',true)) returning id into v_out;
  return jsonb_build_object('status','ok','event',v_out,'mode','live');
end $$;

revoke all on function public.agent_id_wallet_withdraw(text,bigint,text,text) from public, anon, authenticated;
grant execute on function public.agent_id_wallet_withdraw(text,bigint,text,text) to service_role;

alter table public.agent_id_phone_applications enable row level security;
revoke all on public.agent_id_phone_applications from public, anon, authenticated;
grant all on public.agent_id_phone_applications to service_role;
