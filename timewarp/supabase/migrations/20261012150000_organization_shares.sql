-- Members of an organization send each other a copy of a chat, an agent or an
-- automation. Nothing is shared live: the recipient accepts a share invite and
-- the desktop makes a personal copy. A share keeps its content only while it
-- waits; answering it, or its expiry, clears the content. Shares are reached
-- only through the authenticated workspace service; browser roles have no access.
create table if not exists public.timewarp_shares (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.timewarp_workspaces(id) on delete cascade,
  kind text not null check (kind in ('chat','agent','automation')),
  sender_user_id uuid not null references auth.users(id) on delete cascade,
  recipient_user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 200),
  summary jsonb not null default '{}'::jsonb,
  payload jsonb,
  status text not null default 'pending' check (status in ('pending','accepted','declined','canceled')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '30 days',
  responded_at timestamptz,
  constraint timewarp_shares_not_self check (sender_user_id <> recipient_user_id)
);
create index if not exists timewarp_shares_recipient on public.timewarp_shares(recipient_user_id, status, created_at desc);
create index if not exists timewarp_shares_sender on public.timewarp_shares(sender_user_id, status, created_at desc);
alter table public.timewarp_shares enable row level security;
revoke all on public.timewarp_shares from public, anon, authenticated;
grant all on public.timewarp_shares to service_role;

-- One share per recipient, all active members of the sender's organization.
create or replace function public.timewarp_create_shares(
  p_sender uuid, p_workspace_id uuid, p_kind text, p_recipients uuid[],
  p_title text, p_summary jsonb, p_payload jsonb
) returns jsonb language plpgsql security definer
set search_path = public, pg_temp as $$
declare
  v_recipients uuid[];
  v_ids uuid[];
begin
  if p_kind is null or p_kind not in ('chat','agent','automation') or coalesce(trim(p_title),'')=''
    or p_payload is null or jsonb_typeof(p_payload)<>'object'
    or jsonb_typeof(coalesce(p_summary,'{}'::jsonb))<>'object' then
    return jsonb_build_object('status','invalid');
  end if;
  if octet_length(p_payload::text)>1900000 or octet_length(coalesce(p_summary,'{}'::jsonb)::text)>20000 then
    return jsonb_build_object('status','too_large');
  end if;
  select coalesce(array_agg(distinct r),'{}') into v_recipients
    from unnest(coalesce(p_recipients,'{}'::uuid[])) r where r is not null and r<>p_sender;
  if cardinality(v_recipients)=0 or cardinality(v_recipients)>20 then
    return jsonb_build_object('status','invalid');
  end if;
  perform 1 from public.timewarp_workspace_members
    where workspace_id=p_workspace_id and user_id=p_sender and status='active';
  if not found then return jsonb_build_object('status','forbidden'); end if;
  if (select count(*) from public.timewarp_workspace_members
    where workspace_id=p_workspace_id and status='active' and user_id=any(v_recipients))<>cardinality(v_recipients) then
    return jsonb_build_object('status','not_member');
  end if;
  if (select count(*) from public.timewarp_shares
    where sender_user_id=p_sender and status='pending' and expires_at>now())+cardinality(v_recipients)>200 then
    return jsonb_build_object('status','too_many');
  end if;
  -- Shares that expired unanswered keep no content.
  update public.timewarp_shares set payload=null
    where payload is not null and status='pending' and expires_at<=now()
      and (sender_user_id=p_sender or recipient_user_id=any(v_recipients));
  with inserted as (
    insert into public.timewarp_shares(workspace_id,kind,sender_user_id,recipient_user_id,title,summary,payload)
    select p_workspace_id,p_kind,p_sender,r,left(trim(p_title),200),coalesce(p_summary,'{}'::jsonb),p_payload
      from unnest(v_recipients) r
    returning id)
  select array_agg(id) into v_ids from inserted;
  return jsonb_build_object('status','ok','ids',to_jsonb(v_ids));
end;
$$;

-- Waiting shares for one person, without their content: those sent to them,
-- and those they sent. Both people must still be in the organization.
create or replace function public.timewarp_list_shares(p_user uuid)
returns jsonb language sql stable security definer
set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'incoming', coalesce((select jsonb_agg(item order by item->>'createdAt' desc) from (
      select jsonb_build_object('id',s.id,'workspaceId',s.workspace_id,'organizationName',w.name,'kind',s.kind,
        'title',s.title,'summary',s.summary,'createdAt',s.created_at,'expiresAt',s.expires_at,
        'sender',jsonb_build_object('userId',s.sender_user_id,'name',sm.name,'email',sm.email)) item
      from public.timewarp_shares s
      join public.timewarp_workspaces w on w.id=s.workspace_id
      join public.timewarp_workspace_members sm on sm.workspace_id=s.workspace_id and sm.user_id=s.sender_user_id and sm.status='active'
      join public.timewarp_workspace_members rm on rm.workspace_id=s.workspace_id and rm.user_id=s.recipient_user_id and rm.status='active'
      where s.recipient_user_id=p_user and s.status='pending' and s.expires_at>now() and s.payload is not null
      order by s.created_at desc limit 100) incoming), '[]'::jsonb),
    'outgoing', coalesce((select jsonb_agg(item order by item->>'createdAt' desc) from (
      select jsonb_build_object('id',s.id,'workspaceId',s.workspace_id,'organizationName',w.name,'kind',s.kind,
        'title',s.title,'createdAt',s.created_at,'expiresAt',s.expires_at,
        'recipient',jsonb_build_object('userId',s.recipient_user_id,'name',rm.name,'email',rm.email)) item
      from public.timewarp_shares s
      join public.timewarp_workspaces w on w.id=s.workspace_id
      join public.timewarp_workspace_members sm on sm.workspace_id=s.workspace_id and sm.user_id=s.sender_user_id and sm.status='active'
      join public.timewarp_workspace_members rm on rm.workspace_id=s.workspace_id and rm.user_id=s.recipient_user_id and rm.status='active'
      where s.sender_user_id=p_user and s.status='pending' and s.expires_at>now()
      order by s.created_at desc limit 100) outgoing), '[]'::jsonb));
$$;

-- A waiting share's content, for its recipient only. Reading it changes
-- nothing: the desktop makes its copy first and then accepts.
create or replace function public.timewarp_open_share(p_user uuid, p_share_id uuid)
returns jsonb language plpgsql stable security definer
set search_path = public, pg_temp as $$
declare
  v_share jsonb;
begin
  select jsonb_build_object('id',s.id,'workspaceId',s.workspace_id,'kind',s.kind,'title',s.title,'summary',s.summary,
    'payload',s.payload,'createdAt',s.created_at,
    'sender',jsonb_build_object('userId',s.sender_user_id,'name',sm.name,'email',sm.email))
    into v_share
    from public.timewarp_shares s
    join public.timewarp_workspace_members sm on sm.workspace_id=s.workspace_id and sm.user_id=s.sender_user_id and sm.status='active'
    join public.timewarp_workspace_members rm on rm.workspace_id=s.workspace_id and rm.user_id=s.recipient_user_id and rm.status='active'
    where s.id=p_share_id and s.recipient_user_id=p_user and s.status='pending' and s.expires_at>now() and s.payload is not null;
  if v_share is null then return jsonb_build_object('status','not_found'); end if;
  return jsonb_build_object('status','ok','share',v_share);
end;
$$;

-- The recipient accepts or declines; the sender cancels. Any answer clears
-- the content. Accepting needs both people to still be in the organization.
create or replace function public.timewarp_respond_share(p_user uuid, p_share_id uuid, p_action text)
returns text language plpgsql security definer
set search_path = public, pg_temp as $$
declare
  v public.timewarp_shares%rowtype;
begin
  if p_action is null or p_action not in ('accept','decline','cancel') then return 'invalid'; end if;
  select * into v from public.timewarp_shares where id=p_share_id for update;
  if not found or v.status<>'pending' then return 'not_found'; end if;
  if p_action='cancel' then
    if v.sender_user_id<>p_user then return 'not_found'; end if;
  else
    if v.recipient_user_id<>p_user or v.expires_at<=now() then return 'not_found'; end if;
    if p_action='accept' and (select count(*) from public.timewarp_workspace_members
      where workspace_id=v.workspace_id and status='active' and user_id in (v.sender_user_id,v.recipient_user_id))<>2 then
      return 'not_found';
    end if;
  end if;
  update public.timewarp_shares
    set status=case p_action when 'accept' then 'accepted' when 'decline' then 'declined' else 'canceled' end,
      responded_at=now(), payload=null
    where id=p_share_id;
  return 'ok';
end;
$$;

revoke all on function public.timewarp_create_shares(uuid,uuid,text,uuid[],text,jsonb,jsonb) from public, anon, authenticated;
revoke all on function public.timewarp_list_shares(uuid) from public, anon, authenticated;
revoke all on function public.timewarp_open_share(uuid,uuid) from public, anon, authenticated;
revoke all on function public.timewarp_respond_share(uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.timewarp_create_shares(uuid,uuid,text,uuid[],text,jsonb,jsonb) to service_role;
grant execute on function public.timewarp_list_shares(uuid) to service_role;
grant execute on function public.timewarp_open_share(uuid,uuid) to service_role;
grant execute on function public.timewarp_respond_share(uuid,uuid,text) to service_role;
