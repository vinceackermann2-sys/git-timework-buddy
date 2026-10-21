-- Agent ID bank transfers through Bridge (Stripe's stablecoin bank partner):
-- an owner verifies once with Bridge, then adds money to an agent's wallet by
-- bank transfer (deposit details per wallet) and withdraws to their own bank
-- account. Bank numbers stay with Bridge; Agent ID keeps the bank's name and
-- the last four digits. Only the agent-id edge function (service role) reads
-- or writes these.
create table if not exists public.agent_id_bank_customers (
  user_id uuid primary key references auth.users(id) on delete cascade,
  provider text not null default 'bridge' check (provider in ('bridge')),
  type text not null default 'individual' check (type in ('individual','business')),
  -- Bridge's KYC link and the customer it becomes.
  kyc_link_ref text check (char_length(kyc_link_ref) <= 100),
  customer_ref text check (char_length(customer_ref) <= 100),
  kyc_link text check (char_length(kyc_link) <= 2000),
  tos_link text check (char_length(tos_link) <= 2000),
  kyc_status text not null default 'not_started' check (char_length(kyc_status) <= 40),
  tos_status text not null default 'pending' check (char_length(tos_status) <= 40),
  -- Rails Bridge approved this customer for (endorsement name -> status).
  endorsements jsonb not null default '{}'::jsonb,
  rejection text check (char_length(rejection) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.agent_id_bank_accounts (
  id text primary key check (id ~ '^bnk_[a-z0-9]{24}$'),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider_ref text not null check (char_length(provider_ref) <= 100),
  currency text not null check (currency in ('usd','eur')),
  -- How payouts reach it: ACH (US), SEPA (euro IBAN) or wire.
  rail text not null check (rail in ('ach','wire','sepa')),
  bank_name text check (char_length(bank_name) <= 200),
  last4 text not null check (last4 ~ '^[0-9A-Za-z]{1,4}$'),
  owner_name text check (char_length(owner_name) <= 200),
  created_at timestamptz not null default now(),
  removed_at timestamptz
);
create index if not exists agent_id_bank_accounts_user on public.agent_id_bank_accounts(user_id) where removed_at is null;

-- A wallet's own bank details for deposits (a Bridge virtual account): money
-- sent there arrives in the wallet as USDC.
create table if not exists public.agent_id_bank_deposits (
  resource_id uuid not null references public.agent_id_resources(id) on delete cascade,
  currency text not null check (currency in ('usd','eur')),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider_ref text not null check (char_length(provider_ref) <= 100),
  instructions jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  primary key (resource_id, currency)
);

do $$
declare t text;
begin
  foreach t in array array['agent_id_bank_customers','agent_id_bank_accounts','agent_id_bank_deposits'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;
