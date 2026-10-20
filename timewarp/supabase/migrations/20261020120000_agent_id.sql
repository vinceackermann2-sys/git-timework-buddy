-- Agent ID: every AI agent gets an identity that traces back to a responsible
-- person (KYC) or business (KYB), and its own mail inbox, phone number,
-- wallet, virtual card and virtual machine. The agent-id edge function is the
-- only way in (the dashboard, CLI, API and MCP all go through it): browser
-- roles have no access to these tables or functions.

-- The responsible person behind an account's agents: the name and country on
-- record (confirmed once status is 'verified'). Only the outcome of a
-- verification is kept here; identity documents stay with the provider.
create table if not exists public.agent_id_people (
  user_id uuid primary key references auth.users(id) on delete cascade,
  status text not null default 'unverified' check (status in ('unverified','pending','verified','rejected')),
  provider text check (provider in ('stripe_identity','manual','test')),
  provider_ref text check (char_length(provider_ref) <= 300),
  legal_name text check (char_length(legal_name) <= 200),
  country text check (country ~ '^[A-Z]{2}$'),
  verified_at timestamptz,
  -- Why the last check didn't pass, as the provider said it.
  last_error text check (char_length(last_error) <= 300),
  -- The owner as the cardholder of their agents' live cards (Stripe Issuing).
  cardholder_ref text check (char_length(cardholder_ref) <= 100),
  -- The Agent ID Terms version the account accepted, and when.
  terms_version text check (char_length(terms_version) <= 40),
  terms_accepted_at timestamptz,
  -- Explicit consent to the biometric identity check (GDPR Art. 9(2)(a)),
  -- given before it starts.
  consent_version text check (char_length(consent_version) <= 40),
  consent_at timestamptz,
  updated_at timestamptz not null default now()
);

-- The business behind an organization's agents (KYB), submitted by one of its
-- owners or admins.
create table if not exists public.agent_id_businesses (
  workspace_id uuid primary key references public.timewarp_workspaces(id) on delete cascade,
  status text not null default 'unverified' check (status in ('unverified','pending','verified','rejected')),
  legal_name text check (char_length(legal_name) <= 200),
  registration_number text check (char_length(registration_number) <= 100),
  country text check (country ~ '^[A-Z]{2}$'),
  website text check (char_length(website) <= 300),
  submitted_by uuid references auth.users(id) on delete set null,
  -- The verified person who submitted it, their role in the business, and
  -- when they confirmed they may act for it.
  representative_role text check (char_length(representative_role) <= 100),
  attested_at timestamptz,
  provider text check (provider in ('manual','test')),
  provider_ref text check (char_length(provider_ref) <= 300),
  review_note text check (char_length(review_note) <= 1000),
  verified_at timestamptz,
  updated_at timestamptz not null default now()
);

-- An agent's identity. The handle names its mail address and is never given to
-- another agent, even after this one is revoked, so mail meant for it can't
-- reach someone else.
create table if not exists public.agent_id_agents (
  id text primary key check (id ~ '^agt_[a-z0-9]{24}$'),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  workspace_id uuid references public.timewarp_workspaces(id) on delete set null,
  name text not null check (char_length(name) between 1 and 60),
  handle text not null unique check (handle ~ '^[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])?$'),
  -- Where the agent comes from: the app it runs in (claude-code, codex, cursor,
  -- gemini, timewarp, …), set by its owner or the CLI, and the MCP client it
  -- last connected with, as that client named itself.
  -- Where the agent comes from: the app it runs in (claude-code, codex, cursor,
  -- gemini, timewarp, …), set by its owner or the CLI, and the MCP client it
  -- last connected with, as that client named itself.
  runtime text not null default 'custom' check (runtime ~ '^[a-z0-9-]{1,40}$'),
  origin_detail text check (char_length(origin_detail) <= 200),
  client_name text check (char_length(client_name) <= 100),
  client_version text check (char_length(client_version) <= 40),
  client_seen_at timestamptz,
  status text not null default 'active' check (status in ('active','suspended','revoked')),
  desktop_agent_id text check (char_length(desktop_agent_id) <= 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_seen_at timestamptz
);
create index if not exists agent_id_agents_owner on public.agent_id_agents(owner_user_id, created_at);
create index if not exists agent_id_agents_workspace on public.agent_id_agents(workspace_id) where workspace_id is not null;

-- API keys. An agent key (agent_id set) acts as that agent; an owner key acts
-- as the account, for the CLI. Only a SHA-256 hash of the key is stored.
create table if not exists public.agent_id_keys (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  agent_id text references public.agent_id_agents(id) on delete cascade,
  name text not null default 'Key' check (char_length(name) between 1 and 60),
  prefix text not null check (char_length(prefix) between 8 and 24),
  hash text not null unique check (hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
create index if not exists agent_id_keys_owner on public.agent_id_keys(owner_user_id, created_at);
create index if not exists agent_id_keys_agent on public.agent_id_keys(agent_id) where agent_id is not null;

-- Public halves of an agent's signing keys (Git commit signing). The private
-- key never leaves the agent's machine.
create table if not exists public.agent_id_signing_keys (
  id uuid primary key default gen_random_uuid(),
  agent_id text not null references public.agent_id_agents(id) on delete cascade,
  public_key text not null check (public_key ~ '^ssh-ed25519 [A-Za-z0-9+/]+=*$'),
  fingerprint text not null unique check (fingerprint ~ '^SHA256:[A-Za-z0-9+/]{43}$'),
  name text not null default 'Signing key' check (char_length(name) between 1 and 60),
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);
create index if not exists agent_id_signing_keys_agent on public.agent_id_signing_keys(agent_id);

-- What an agent has been given: one of each kind at a time. `mode` says
-- whether it is real (live) or a test resource that only works inside Agent
-- ID. Test wallets keep their balance here; live balances come from the
-- provider. Amounts are in minor units (cents).
create table if not exists public.agent_id_resources (
  id uuid primary key default gen_random_uuid(),
  agent_id text not null references public.agent_id_agents(id) on delete cascade,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('mail','phone','wallet','card','vm')),
  provider text not null check (char_length(provider) between 1 and 40),
  mode text not null check (mode in ('live','test')),
  provider_ref text check (char_length(provider_ref) <= 300),
  address text check (char_length(address) <= 300),
  label text check (char_length(label) <= 120),
  status text not null default 'active' check (status in ('provisioning','active','suspended','released','failed')),
  settings jsonb not null default '{}'::jsonb check (jsonb_typeof(settings)='object'),
  state jsonb not null default '{}'::jsonb check (jsonb_typeof(state)='object'),
  balance_minor bigint not null default 0 check (balance_minor >= 0),
  currency text check (currency ~ '^[A-Z]{3,5}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  released_at timestamptz
);
create unique index if not exists agent_id_resources_one_per_kind on public.agent_id_resources(agent_id, kind) where status <> 'released';
-- Mail addresses and wallet addresses are never reused; numbers, cards and
-- machines go back to their provider when released.
create unique index if not exists agent_id_resources_lasting_address on public.agent_id_resources(kind, lower(address)) where kind in ('mail','wallet') and address is not null;
create unique index if not exists agent_id_resources_address on public.agent_id_resources(kind, lower(address)) where status <> 'released' and address is not null;
create index if not exists agent_id_resources_provider_ref on public.agent_id_resources(provider, provider_ref) where provider_ref is not null;
create index if not exists agent_id_resources_owner on public.agent_id_resources(owner_user_id);

-- Everything that happens with an agent's resources: mail, texts, calls,
-- wallet transfers, card authorizations, machine activity. A provider's own id
-- makes webhook deliveries idempotent.
create table if not exists public.agent_id_events (
  id uuid primary key default gen_random_uuid(),
  agent_id text not null references public.agent_id_agents(id) on delete cascade,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  resource_id uuid references public.agent_id_resources(id) on delete set null,
  kind text not null check (kind in ('mail','sms','call','wallet','card','vm')),
  direction text not null check (direction in ('in','out','none')),
  status text not null check (char_length(status) between 1 and 40),
  counterparty text check (char_length(counterparty) <= 400),
  subject text check (char_length(subject) <= 1000),
  body text check (char_length(body) <= 200000),
  amount_minor bigint,
  currency text check (currency ~ '^[A-Z]{3,5}$'),
  provider_ref text check (char_length(provider_ref) <= 300),
  thread text check (char_length(thread) <= 300),
  data jsonb not null default '{}'::jsonb check (jsonb_typeof(data)='object'),
  read_at timestamptz,
  -- Mail only: inbox, sent or trash (the bin).
  folder text check (folder in ('inbox','sent','trash')),
  occurred_at timestamptz not null default now()
);
create index if not exists agent_id_events_agent on public.agent_id_events(agent_id, kind, occurred_at desc);
create index if not exists agent_id_events_owner on public.agent_id_events(owner_user_id, occurred_at desc);
create unique index if not exists agent_id_events_provider_ref on public.agent_id_events(resource_id, provider_ref) where provider_ref is not null;
create index if not exists agent_id_events_mail_folder on public.agent_id_events(agent_id, folder, occurred_at desc) where kind = 'mail';

-- Files agents send and receive (mail attachments). The bytes are in the
-- private agent-id-files storage bucket; this is who they belong to.
create table if not exists public.agent_id_files (
  id uuid primary key default gen_random_uuid(),
  agent_id text not null references public.agent_id_agents(id) on delete cascade,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  event_id uuid references public.agent_id_events(id) on delete set null,
  filename text not null check (char_length(filename) between 1 and 255),
  content_type text not null check (char_length(content_type) between 1 and 150),
  size integer not null check (size between 0 and 10485760),
  storage_path text not null check (char_length(storage_path) <= 500),
  created_at timestamptz not null default now()
);
create index if not exists agent_id_files_agent on public.agent_id_files(agent_id, created_at desc);
create index if not exists agent_id_files_event on public.agent_id_files(event_id) where event_id is not null;
insert into storage.buckets (id, name, public) values ('agent-id-files', 'agent-id-files', false) on conflict (id) do nothing;

-- Early-access applications for virtual cards, one per agent.
create table if not exists public.agent_id_card_applications (
  id uuid primary key default gen_random_uuid(),
  agent_id text not null unique references public.agent_id_agents(id) on delete cascade,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'submitted' check (status in ('submitted','approved','declined')),
  use_case text not null check (char_length(use_case) between 1 and 500),
  monthly_spend bigint check (monthly_spend >= 0),
  country text check (country ~ '^[A-Z]{2}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Values the service keeps for itself, such as the signing secrets of the
-- webhooks it registered with its providers.
create table if not exists public.agent_id_settings (
  key text primary key check (key ~ '^[a-z0-9_.-]{1,80}$'),
  value jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.agent_id_contacts (
  id uuid primary key default gen_random_uuid(),
  agent_id text not null references public.agent_id_agents(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  email text check (char_length(email) <= 300),
  phone text check (phone ~ '^\+[1-9][0-9]{6,14}$'),
  wallet text check (char_length(wallet) <= 300),
  note text check (char_length(note) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists agent_id_contacts_agent on public.agent_id_contacts(agent_id, name);

-- Requests an agent can't complete alone, such as a transfer above the
-- amount its owner wants to approve. The owner answers on the dashboard.
create table if not exists public.agent_id_approvals (
  id uuid primary key default gen_random_uuid(),
  agent_id text not null references public.agent_id_agents(id) on delete cascade,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('wallet_transfer')),
  request jsonb not null check (jsonb_typeof(request)='object'),
  status text not null default 'pending' check (status in ('pending','approved','denied','completed','failed')),
  reason text check (char_length(reason) <= 500),
  result jsonb,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '24 hours',
  decided_at timestamptz
);
create index if not exists agent_id_approvals_owner on public.agent_id_approvals(owner_user_id, status, created_at desc);

-- Companies that accept only verified agents: each has an audience its agents
-- ask passports for, a secret for checking them online and a policy. An
-- audience isn't owned: passports can be checked by anyone with the public
-- keys anyway, and making it unique would let someone claim another
-- company's address first.
create table if not exists public.agent_id_relying_parties (
  id text primary key check (id ~ '^rp_[a-z0-9]{24}$'),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  workspace_id uuid references public.timewarp_workspaces(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  audience text not null check (char_length(audience) between 3 and 300),
  secret_hash text not null unique check (secret_hash ~ '^[0-9a-f]{64}$'),
  secret_prefix text not null,
  policy jsonb not null default '{}'::jsonb check (jsonb_typeof(policy)='object'),
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);
create index if not exists agent_id_relying_parties_owner on public.agent_id_relying_parties(owner_user_id);
create index if not exists agent_id_relying_parties_workspace on public.agent_id_relying_parties(workspace_id) where workspace_id is not null;

-- Who did what: every action by an owner, an agent, a provider or a company
-- checking an agent.
create table if not exists public.agent_id_audit (
  id bigint generated always as identity primary key,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  agent_id text,
  actor text not null check (actor in ('owner','agent','system','provider','relying_party')),
  action text not null check (char_length(action) between 1 and 80),
  detail jsonb not null default '{}'::jsonb,
  at timestamptz not null default now()
);
create index if not exists agent_id_audit_owner on public.agent_id_audit(owner_user_id, at desc);
create index if not exists agent_id_audit_agent on public.agent_id_audit(agent_id, at desc) where agent_id is not null;

do $$
declare t text;
begin
  foreach t in array array['agent_id_people','agent_id_businesses','agent_id_agents','agent_id_keys','agent_id_signing_keys',
    'agent_id_resources','agent_id_events','agent_id_contacts','agent_id_approvals','agent_id_relying_parties','agent_id_audit',
    'agent_id_files','agent_id_card_applications','agent_id_settings'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;
grant usage, select on sequence public.agent_id_audit_id_seq to service_role;

-- A number from a JSON limit, or null when it isn't set.
create or replace function public.agent_id_limit(p_limits jsonb, p_key text) returns bigint
language sql immutable set search_path = public, pg_temp as $$
  select case when jsonb_typeof(p_limits->p_key)='number' and (p_limits->>p_key)::numeric >= 0
    then floor((p_limits->>p_key)::numeric)::bigint end
$$;

-- Records a provider event once: a repeated webhook delivery returns the
-- event already recorded instead of adding another.
create or replace function public.agent_id_record_event(
  p_resource uuid, p_kind text, p_direction text, p_status text, p_counterparty text, p_subject text,
  p_body text, p_amount bigint, p_currency text, p_provider_ref text, p_thread text, p_data jsonb, p_folder text default null
) returns jsonb language plpgsql security definer
set search_path = public, pg_temp as $$
declare
  v_resource public.agent_id_resources%rowtype;
  v_id uuid;
begin
  select * into v_resource from public.agent_id_resources where id=p_resource;
  if not found then return jsonb_build_object('status','not_found'); end if;
  if p_provider_ref is not null then
    select id into v_id from public.agent_id_events where resource_id=p_resource and provider_ref=p_provider_ref;
    if found then return jsonb_build_object('status','duplicate','id',v_id); end if;
  end if;
  insert into public.agent_id_events(agent_id,owner_user_id,resource_id,kind,direction,status,counterparty,subject,body,amount_minor,currency,provider_ref,thread,data,folder)
    values(v_resource.agent_id,v_resource.owner_user_id,p_resource,p_kind,p_direction,p_status,left(p_counterparty,400),left(p_subject,1000),
      left(p_body,200000),p_amount,p_currency,p_provider_ref,left(p_thread,300),coalesce(p_data,'{}'::jsonb),
      case when p_kind='mail' then coalesce(p_folder, case when p_direction='in' then 'inbox' else 'sent' end) end)
    on conflict (resource_id, provider_ref) where provider_ref is not null do nothing
    returning id into v_id;
  if v_id is null then
    select id into v_id from public.agent_id_events where resource_id=p_resource and provider_ref=p_provider_ref;
    return jsonb_build_object('status','duplicate','id',v_id);
  end if;
  return jsonb_build_object('status','ok','id',v_id);
end $$;

-- Sends money from an agent's wallet, within the limits its owner set:
-- `perTransfer` and `daily` caps, which always hold, and `approvalAbove`,
-- over which the owner must approve first (the request is saved and
-- 'needs_approval' returned). A
-- transfer between two test wallets completes here; a live one is recorded as
-- pending, counts against the limits at once, and is finished with
-- agent_id_finish_transfer once the provider answers.
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

-- Finishes a live transfer with the provider's answer.
create or replace function public.agent_id_finish_transfer(p_event uuid, p_ok boolean, p_provider_ref text, p_data jsonb)
returns jsonb language plpgsql security definer
set search_path = public, pg_temp as $$
begin
  update public.agent_id_events set status=case when p_ok then 'completed' else 'failed' end,
    provider_ref=coalesce(p_provider_ref,provider_ref), data=data||coalesce(p_data,'{}'::jsonb)
    where id=p_event and kind='wallet' and direction='out' and status='pending';
  if not found then return jsonb_build_object('status','not_found'); end if;
  update public.agent_id_approvals set status=case when p_ok then 'completed' else 'failed' end
    where status='approved' and result->>'event'=p_event::text;
  return jsonb_build_object('status','ok');
end $$;

-- Decides on a card payment as it happens, from the limits the owner set:
-- `perTransaction`, `daily` and `monthly` caps, and `blockedCategories` /
-- `allowedCategories` (merchant category codes or names). Answering the same
-- authorization twice gives the same decision.
create or replace function public.agent_id_card_authorize(
  p_resource uuid, p_amount bigint, p_currency text, p_merchant text, p_category text, p_provider_ref text, p_data jsonb
) returns jsonb language plpgsql security definer
set search_path = public, pg_temp as $$
declare
  v_card public.agent_id_resources%rowtype;
  v_agent_status text;
  v_existing public.agent_id_events%rowtype;
  v_limit bigint;
  v_used bigint;
  v_reason text;
  v_id uuid;
begin
  select * into v_card from public.agent_id_resources where id=p_resource and kind='card' for update;
  if not found then return jsonb_build_object('status','not_found','approved',false,'reason','unknown_card'); end if;
  if p_provider_ref is not null then
    select * into v_existing from public.agent_id_events where resource_id=p_resource and provider_ref=p_provider_ref;
    if found then return jsonb_build_object('status','duplicate','approved',v_existing.status='approved','reason',v_existing.data->>'reason','event',v_existing.id); end if;
  end if;
  select status into v_agent_status from public.agent_id_agents where id=v_card.agent_id;
  if p_amount is null or p_amount < 0 then v_reason := 'invalid_amount';
  elsif v_card.status<>'active' or v_agent_status<>'active' then v_reason := 'card_inactive';
  elsif v_card.currency is not null and upper(coalesce(p_currency,''))<>v_card.currency then v_reason := 'currency';
  elsif jsonb_typeof(v_card.settings->'blockedCategories')='array' and v_card.settings->'blockedCategories' ? coalesce(p_category,'') then v_reason := 'blocked_category';
  elsif jsonb_typeof(v_card.settings->'allowedCategories')='array' and jsonb_array_length(v_card.settings->'allowedCategories')>0
    and not (v_card.settings->'allowedCategories' ? coalesce(p_category,'')) then v_reason := 'category_not_allowed';
  end if;
  if v_reason is null then
    v_limit := public.agent_id_limit(v_card.settings,'perTransaction');
    if v_limit is not null and p_amount > v_limit then v_reason := 'over_transaction_limit'; end if;
  end if;
  if v_reason is null then
    v_limit := public.agent_id_limit(v_card.settings,'daily');
    if v_limit is not null then
      select coalesce(sum(amount_minor),0) into v_used from public.agent_id_events
        where resource_id=p_resource and kind='card' and direction='out' and status='approved' and occurred_at > now() - interval '24 hours';
      if v_used + p_amount > v_limit then v_reason := 'over_daily_limit'; end if;
    end if;
  end if;
  if v_reason is null then
    v_limit := public.agent_id_limit(v_card.settings,'monthly');
    if v_limit is not null then
      select coalesce(sum(amount_minor),0) into v_used from public.agent_id_events
        where resource_id=p_resource and kind='card' and direction='out' and status='approved' and occurred_at > now() - interval '30 days';
      if v_used + p_amount > v_limit then v_reason := 'over_monthly_limit'; end if;
    end if;
  end if;
  insert into public.agent_id_events(agent_id,owner_user_id,resource_id,kind,direction,status,counterparty,amount_minor,currency,provider_ref,data)
    values(v_card.agent_id,v_card.owner_user_id,p_resource,'card','out',case when v_reason is null then 'approved' else 'declined' end,
      left(coalesce(p_merchant,'Unknown merchant'),400),p_amount,upper(nullif(p_currency,'')),p_provider_ref,
      coalesce(p_data,'{}'::jsonb)||jsonb_strip_nulls(jsonb_build_object('category',p_category,'reason',v_reason)))
    returning id into v_id;
  return jsonb_build_object('status','ok','approved',v_reason is null,'reason',v_reason,'event',v_id);
end $$;

-- The owner's answer to an approval request.
create or replace function public.agent_id_decide_approval(p_owner uuid, p_approval uuid, p_decision text)
returns jsonb language plpgsql security definer
set search_path = public, pg_temp as $$
declare v public.agent_id_approvals%rowtype;
begin
  if p_decision not in ('approve','deny') then return jsonb_build_object('status','invalid'); end if;
  select * into v from public.agent_id_approvals where id=p_approval and owner_user_id=p_owner for update;
  if not found then return jsonb_build_object('status','not_found'); end if;
  if v.status<>'pending' then return jsonb_build_object('status','already_decided','decision',v.status); end if;
  if v.expires_at<now() then
    update public.agent_id_approvals set status='denied', reason='expired', decided_at=now() where id=p_approval;
    return jsonb_build_object('status','expired');
  end if;
  update public.agent_id_approvals set status=case when p_decision='approve' then 'approved' else 'denied' end, decided_at=now()
    where id=p_approval;
  return jsonb_build_object('status','ok','agent',v.agent_id,'request',v.request);
end $$;

-- Test money for a test wallet, so agents can try transfers. A test wallet
-- holds at most 10,000.00.
create or replace function public.agent_id_test_fund(p_resource uuid, p_amount bigint)
returns jsonb language plpgsql security definer
set search_path = public, pg_temp as $$
declare v public.agent_id_resources%rowtype;
begin
  select * into v from public.agent_id_resources where id=p_resource and kind='wallet' for update;
  if not found or v.mode<>'test' or v.status<>'active' then return jsonb_build_object('status','not_test_wallet'); end if;
  if p_amount is null or p_amount <= 0 then return jsonb_build_object('status','invalid'); end if;
  if v.balance_minor + p_amount > 1000000 then return jsonb_build_object('status','over_limit','balance',v.balance_minor); end if;
  update public.agent_id_resources set balance_minor=balance_minor+p_amount, updated_at=now() where id=p_resource;
  insert into public.agent_id_events(agent_id,owner_user_id,resource_id,kind,direction,status,counterparty,subject,amount_minor,currency)
    values(v.agent_id,v.owner_user_id,p_resource,'wallet','in','completed','Test funds','Added on the dashboard',p_amount,v.currency);
  return jsonb_build_object('status','ok','balance',v.balance_minor+p_amount);
end $$;

-- One command at a time on a machine: a command stops the machine when it
-- ends, which would cut off another still running. The lease lapses by
-- itself if its holder never releases it.
create or replace function public.agent_id_machine_lease(p_resource uuid, p_holder text, p_seconds integer)
returns boolean language plpgsql security definer
set search_path = public, pg_temp as $$
begin
  update public.agent_id_resources
    set state = state || jsonb_build_object('lease', p_holder, 'leaseUntil', now() + make_interval(secs => greatest(10, least(p_seconds, 3600))))
    where id = p_resource and kind = 'vm'
      and (state->>'leaseUntil' is null or (state->>'leaseUntil')::timestamptz < now() or state->>'lease' = p_holder);
  return found;
end $$;
create or replace function public.agent_id_machine_release(p_resource uuid, p_holder text)
returns void language sql security definer
set search_path = public, pg_temp as $$
  update public.agent_id_resources set state = state - 'lease' - 'leaseUntil'
    where id = p_resource and state->>'lease' = p_holder;
$$;

revoke all on function public.agent_id_machine_lease(uuid,text,integer) from public, anon, authenticated;
revoke all on function public.agent_id_machine_release(uuid,text) from public, anon, authenticated;
grant execute on function public.agent_id_machine_lease(uuid,text,integer) to service_role;
grant execute on function public.agent_id_machine_release(uuid,text) to service_role;
revoke all on function public.agent_id_limit(jsonb,text) from public, anon, authenticated;
revoke all on function public.agent_id_record_event(uuid,text,text,text,text,text,text,bigint,text,text,text,jsonb,text) from public, anon, authenticated;
revoke all on function public.agent_id_wallet_send(text,bigint,text,uuid,text,uuid) from public, anon, authenticated;
revoke all on function public.agent_id_finish_transfer(uuid,boolean,text,jsonb) from public, anon, authenticated;
revoke all on function public.agent_id_card_authorize(uuid,bigint,text,text,text,text,jsonb) from public, anon, authenticated;
revoke all on function public.agent_id_decide_approval(uuid,uuid,text) from public, anon, authenticated;
revoke all on function public.agent_id_test_fund(uuid,bigint) from public, anon, authenticated;
grant execute on function public.agent_id_limit(jsonb,text) to service_role;
grant execute on function public.agent_id_record_event(uuid,text,text,text,text,text,text,bigint,text,text,text,jsonb,text) to service_role;
grant execute on function public.agent_id_wallet_send(text,bigint,text,uuid,text,uuid) to service_role;
grant execute on function public.agent_id_finish_transfer(uuid,boolean,text,jsonb) to service_role;
grant execute on function public.agent_id_card_authorize(uuid,bigint,text,text,text,text,jsonb) to service_role;
grant execute on function public.agent_id_decide_approval(uuid,uuid,text) to service_role;
grant execute on function public.agent_id_test_fund(uuid,bigint) to service_role;
