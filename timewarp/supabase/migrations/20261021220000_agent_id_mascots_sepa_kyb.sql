-- Agent ID, round three of 21 October:
--   - every agent has a Timewarp mascot (Orbit, Nova or Cosmo) as its face;
--   - adding money by SEPA is a one-off payment request for an amount (a
--     Bridge transfer that arrives in the wallet as USDC);
--   - a business is checked by Bridge too (KYB), the same way people are.
-- Only the agent-id edge function (service role) reads or writes these.

alter table public.agent_id_agents add column if not exists mascot text
  check (mascot in ('orbit','nova','cosmo'));

-- A SEPA payment someone said they'll make into an agent's wallet: what to
-- pay, and where Bridge's transfer is. The money itself shows in the
-- wallet's history when it arrives.
create table if not exists public.agent_id_bank_payins (
  id text primary key check (id ~ '^pay_[a-z0-9]{24}$'),
  resource_id uuid not null references public.agent_id_resources(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  provider_ref text not null check (char_length(provider_ref) <= 100),
  currency text not null check (currency in ('eur','usd')),
  amount_minor bigint not null check (amount_minor > 0),
  state text not null default 'awaiting_funds' check (char_length(state) <= 40),
  instructions jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists agent_id_bank_payins_resource on public.agent_id_bank_payins(resource_id, created_at desc);

-- A business's check at Bridge (KYB), started by a verified owner or admin.
create table if not exists public.agent_id_bank_businesses (
  workspace_id uuid primary key references public.timewarp_workspaces(id) on delete cascade,
  started_by uuid references auth.users(id) on delete set null,
  kyc_link_ref text check (char_length(kyc_link_ref) <= 100),
  customer_ref text check (char_length(customer_ref) <= 100),
  kyc_link text check (char_length(kyc_link) <= 2000),
  tos_link text check (char_length(tos_link) <= 2000),
  kyc_status text not null default 'not_started' check (char_length(kyc_status) <= 40),
  tos_status text not null default 'pending' check (char_length(tos_status) <= 40),
  rejection text check (char_length(rejection) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.agent_id_businesses drop constraint if exists agent_id_businesses_provider_check;
alter table public.agent_id_businesses add constraint agent_id_businesses_provider_check
  check (provider in ('manual','test','bridge'));

do $$
declare t text;
begin
  foreach t in array array['agent_id_bank_payins','agent_id_bank_businesses'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;
