create table public.timewarp_energy_memories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  subject text not null check(length(subject) between 1 and 120),
  content text not null check(length(content) between 1 and 2000),
  updated_at timestamptz not null default now(),
  unique(user_id,subject)
);
alter table public.timewarp_energy_memories enable row level security;
create policy owner_read on public.timewarp_energy_memories for select to authenticated using((select auth.uid())=user_id);
revoke all on public.timewarp_energy_memories from anon,authenticated;
grant select on public.timewarp_energy_memories to authenticated;
grant all on public.timewarp_energy_memories to service_role;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('timewarp-energy-pictures','timewarp-energy-pictures',false,5242880,array['image/png','image/jpeg','image/webp'])
on conflict(id) do nothing;
-- Picture upload/download capabilities are issued only by the authenticated API.
-- No public storage-object policy is created for this private bucket.
