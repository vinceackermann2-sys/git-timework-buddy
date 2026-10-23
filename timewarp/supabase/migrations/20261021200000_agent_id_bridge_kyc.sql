-- A person's identity check can be Bridge's: where Bridge moves money to and
-- from banks it checks people itself, and Agent ID uses that one check
-- instead of asking for a second one.
alter table public.agent_id_people drop constraint if exists agent_id_people_provider_check;
alter table public.agent_id_people add constraint agent_id_people_provider_check
  check (provider in ('stripe_identity','manual','test','bridge'));
