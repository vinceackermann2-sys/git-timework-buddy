-- Agent ID, second part: one Agent ID used from many apps, claiming an Agent
-- ID without an account (verifying your identity creates it), evidence for
-- business checks, and owner withdrawals that don't use up an agent's limits.
-- Like the first part, only the agent-id edge function (service role) reads
-- or writes these.

-- The apps an Agent ID is used in. One Agent ID keeps its name, mail, number,
-- wallet and machine whether Claude Code, Codex or Cursor runs it; each app
-- shows up here the first time it connects (MCP) or is set up (the CLI).
create table if not exists public.agent_id_agent_clients (
  agent_id text not null references public.agent_id_agents(id) on delete cascade,
  app text not null check (app ~ '^[a-z0-9-]{1,40}$'),
  client_name text check (char_length(client_name) <= 100),
  client_version text check (char_length(client_version) <= 40),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  primary key (agent_id, app)
);

-- Getting an Agent ID without an account. An agent (through the CLI) or a
-- person (on the website) starts a claim; the person confirms their email and
-- verifies their identity, which creates their account; then the agent is
-- created for them and its key goes once to whoever holds the claim's secret.
create table if not exists public.agent_id_claims (
  id uuid primary key default gen_random_uuid(),
  -- In the claim link. Random, so links can't be guessed.
  code text not null unique check (code ~ '^[a-z0-9]{20,40}$'),
  -- Shown on both sides so the person can tell it's their agent asking.
  match_code text not null check (match_code ~ '^[A-Z0-9]{4}-[A-Z0-9]{4}$'),
  -- SHA-256 of the secret that collects the agent's key, once.
  secret_hash text not null,
  started_by text not null check (started_by in ('agent','person')),
  name text not null check (char_length(name) between 1 and 60),
  app text check (app ~ '^[a-z0-9-]{1,40}$'),
  client_name text check (char_length(client_name) <= 100),
  device text check (char_length(device) <= 100),
  email text check (char_length(email) <= 320),
  email_code_hash text,
  email_code_sent_at timestamptz,
  email_code_expires_at timestamptz,
  email_attempts integer not null default 0,
  email_sends integer not null default 0,
  email_verified_at timestamptz,
  -- SHA-256 of the browser's claim session, given once the email is confirmed.
  session_hash text,
  user_id uuid references auth.users(id) on delete set null,
  agent_id text references public.agent_id_agents(id) on delete set null,
  status text not null default 'pending' check (status in ('pending','verifying','claimed','canceled')),
  key_delivered_at timestamptz,
  -- SHA-256 of the starting IP with a server secret, to cap claims per network.
  ip_hash text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  updated_at timestamptz not null default now()
);
create index if not exists agent_id_claims_user on public.agent_id_claims(user_id) where user_id is not null;
create index if not exists agent_id_claims_ip on public.agent_id_claims(ip_hash, created_at);

-- What backs a business check: its registration document (in the private
-- agent-id-files bucket) and automatic registry results, such as the EU's VAT
-- register (VIES), for reviewers to see next to the details.
alter table public.agent_id_businesses add column if not exists vat_number text check (char_length(vat_number) <= 30);
alter table public.agent_id_businesses add column if not exists document_path text check (char_length(document_path) <= 300);
alter table public.agent_id_businesses add column if not exists document_name text check (char_length(document_name) <= 200);
alter table public.agent_id_businesses add column if not exists checks jsonb not null default '{}'::jsonb;

do $$
declare t text;
begin
  foreach t in array array['agent_id_agent_clients','agent_id_claims'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;

-- The apps an agent already named itself with become its first entries.
insert into public.agent_id_agent_clients(agent_id, app, client_name, client_version, first_seen_at, last_seen_at)
  select id, runtime, client_name, client_version, coalesce(client_seen_at, created_at), coalesce(client_seen_at, created_at)
  from public.agent_id_agents
  where runtime not in ('custom','any','other')
on conflict (agent_id, app) do nothing;

-- An owner moving money out of their agent's wallet isn't the agent spending:
-- withdrawals (data.withdrawal) don't count toward the agent's daily limit.
create or replace function public.agent_id_wallet_send(
  p_agent text, p_amount bigint, p_counterparty text, p_to_resource uuid, p_memo text, p_approval uuid
) returns jsonb language plpgsql security definer
set search_path = public, pg_temp as $$
declare
  v_agent public.agent_id_agents%rowtype;
  v_from public.agent_id_resources%rowtype;
  v_to public.agent_id_resources%rowtype;
  v_approval public.agent_id_approvals%rowtype;
  v_used bigint;
  v_limit bigint;
  v_out uuid;
  v_memo text := left(nullif(trim(coalesce(p_memo,'')),''),300);
begin
  if p_amount is null or p_amount <= 0 or p_amount > 100000000000 or coalesce(trim(p_counterparty),'')='' then
    return jsonb_build_object('status','invalid');
  end if;
  select * into v_agent from public.agent_id_agents where id=p_agent;
  if not found then return jsonb_build_object('status','not_found'); end if;
  if v_agent.status<>'active' then return jsonb_build_object('status','agent_inactive'); end if;
  select id into v_from.id from public.agent_id_resources where agent_id=p_agent and kind='wallet' and status<>'released';
  if v_from.id is null then return jsonb_build_object('status','no_wallet'); end if;
  if p_to_resource is not null and p_to_resource=v_from.id then return jsonb_build_object('status','invalid'); end if;
  -- Both wallets are locked in one order, so two opposite transfers can't wait on each other.
  perform 1 from public.agent_id_resources where id in (v_from.id, p_to_resource) order by id for update;
  select * into v_from from public.agent_id_resources where id=v_from.id;
  if v_from.status<>'active' then return jsonb_build_object('status','wallet_inactive'); end if;
  if p_to_resource is not null then
    select * into v_to from public.agent_id_resources where id=p_to_resource and kind='wallet' and status='active';
    if not found or v_to.mode<>v_from.mode or coalesce(v_to.currency,'')<>coalesce(v_from.currency,'') then
      return jsonb_build_object('status','unknown_recipient');
    end if;
  elsif v_from.mode='test' then
    -- Test money never leaves Agent ID.
    return jsonb_build_object('status','unknown_recipient');
  end if;

  -- The owner's caps hold even for a transfer they approve.
  v_limit := public.agent_id_limit(v_from.settings,'perTransfer');
  if v_limit is not null and p_amount > v_limit then
    return jsonb_build_object('status','over_limit','limit','perTransfer','max',v_limit);
  end if;
  v_limit := public.agent_id_limit(v_from.settings,'daily');
  if v_limit is not null then
    select coalesce(sum(amount_minor),0) into v_used from public.agent_id_events
      where resource_id=v_from.id and kind='wallet' and direction='out' and status in ('pending','completed')
        and coalesce(data->>'withdrawal','')<>'true'
        and occurred_at > now() - interval '24 hours';
    if v_used + p_amount > v_limit then
      return jsonb_build_object('status','over_limit','limit','daily','max',v_limit,'used',v_used);
    end if;
  end if;

  if v_from.mode='test' and v_from.balance_minor < p_amount then
    return jsonb_build_object('status','insufficient','balance',v_from.balance_minor);
  end if;

  if p_approval is not null then
    select * into v_approval from public.agent_id_approvals where id=p_approval and agent_id=p_agent and kind='wallet_transfer' for update;
    if not found or v_approval.status<>'approved' or v_approval.expires_at<now()
      or (v_approval.request->>'amount')::bigint is distinct from p_amount
      or v_approval.request->>'to' is distinct from p_counterparty then
      return jsonb_build_object('status','approval_invalid');
    end if;
  else
    v_limit := public.agent_id_limit(v_from.settings,'approvalAbove');
    if v_limit is not null and p_amount > v_limit then
      insert into public.agent_id_approvals(agent_id,owner_user_id,kind,request)
        values(p_agent,v_agent.owner_user_id,'wallet_transfer',jsonb_build_object('amount',p_amount,'currency',v_from.currency,'to',p_counterparty,'memo',v_memo))
        returning id into v_approval.id;
      return jsonb_build_object('status','needs_approval','approval',v_approval.id);
    end if;
  end if;

  if v_from.mode='test' then
    if v_from.balance_minor < p_amount then return jsonb_build_object('status','insufficient','balance',v_from.balance_minor); end if;
    update public.agent_id_resources set balance_minor=balance_minor-p_amount, updated_at=now() where id=v_from.id;
    update public.agent_id_resources set balance_minor=balance_minor+p_amount, updated_at=now() where id=v_to.id;
    insert into public.agent_id_events(agent_id,owner_user_id,resource_id,kind,direction,status,counterparty,subject,amount_minor,currency,data)
      values(p_agent,v_agent.owner_user_id,v_from.id,'wallet','out','completed',p_counterparty,v_memo,p_amount,v_from.currency,
        jsonb_build_object('to_agent',v_to.agent_id)) returning id into v_out;
    insert into public.agent_id_events(agent_id,owner_user_id,resource_id,kind,direction,status,counterparty,subject,amount_minor,currency,data)
      values(v_to.agent_id,v_to.owner_user_id,v_to.id,'wallet','in','completed',coalesce(v_from.address,p_agent),v_memo,p_amount,v_to.currency,
        jsonb_build_object('from_agent',p_agent));
  else
    insert into public.agent_id_events(agent_id,owner_user_id,resource_id,kind,direction,status,counterparty,subject,amount_minor,currency,data)
      values(p_agent,v_agent.owner_user_id,v_from.id,'wallet','out','pending',p_counterparty,v_memo,p_amount,v_from.currency,
        case when v_to.id is null then '{}'::jsonb else jsonb_build_object('to_agent',v_to.agent_id) end) returning id into v_out;
  end if;
  if p_approval is not null then
    update public.agent_id_approvals set status=case when v_from.mode='test' then 'completed' else 'approved' end,
      result=jsonb_build_object('event',v_out) where id=p_approval;
  end if;
  return jsonb_build_object('status','ok','event',v_out,'mode',v_from.mode,
    'balance',case when v_from.mode='test' then v_from.balance_minor-p_amount end);
end $$;

-- An owner's withdrawal from a live wallet: recorded as pending before the
-- provider is asked, so it shows in the history at once, and finished by
-- agent_id_finish_transfer like any live transfer. Owners aren't held to the
-- limits they set for their agent.
create or replace function public.agent_id_wallet_withdraw(p_agent text, p_amount bigint, p_to text, p_memo text)
returns jsonb language plpgsql security definer
set search_path = public, pg_temp as $$
declare
  v_agent public.agent_id_agents%rowtype;
  v_from public.agent_id_resources%rowtype;
  v_out uuid;
begin
  if p_amount is null or p_amount <= 0 or p_amount > 100000000000 or coalesce(p_to,'') !~ '^0x[0-9a-fA-F]{40}$' then
    return jsonb_build_object('status','invalid');
  end if;
  select * into v_agent from public.agent_id_agents where id=p_agent;
  if not found or v_agent.status='revoked' then return jsonb_build_object('status','not_found'); end if;
  select * into v_from from public.agent_id_resources where agent_id=p_agent and kind='wallet' and status<>'released' for update;
  if not found then return jsonb_build_object('status','no_wallet'); end if;
  if v_from.mode<>'live' then return jsonb_build_object('status','not_live'); end if;
  if v_from.status='provisioning' then return jsonb_build_object('status','wallet_inactive'); end if;
  insert into public.agent_id_events(agent_id,owner_user_id,resource_id,kind,direction,status,counterparty,subject,amount_minor,currency,data)
    values(p_agent,v_agent.owner_user_id,v_from.id,'wallet','out','pending',p_to,left(nullif(trim(coalesce(p_memo,'')),''),300),p_amount,v_from.currency,
      jsonb_build_object('withdrawal',true)) returning id into v_out;
  return jsonb_build_object('status','ok','event',v_out);
end $$;

-- The account with this email, if there is one: a claim confirmed by email
-- joins that account instead of making a second one.
create or replace function public.agent_id_user_by_email(p_email text)
returns uuid language sql stable security definer
set search_path = public, auth, pg_temp as $$
  select id from auth.users where lower(email) = lower(trim(p_email)) order by created_at limit 1
$$;

revoke all on function public.agent_id_user_by_email(text) from public, anon, authenticated;
grant execute on function public.agent_id_user_by_email(text) to service_role;
revoke all on function public.agent_id_wallet_withdraw(text,bigint,text,text) from public, anon, authenticated;
grant execute on function public.agent_id_wallet_withdraw(text,bigint,text,text) to service_role;
revoke all on function public.agent_id_wallet_send(text,bigint,text,uuid,text,uuid) from public, anon, authenticated;
grant execute on function public.agent_id_wallet_send(text,bigint,text,uuid,text,uuid) to service_role;
