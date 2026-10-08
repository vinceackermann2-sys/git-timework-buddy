-- All organization writes use authenticated Edge Functions. Table policies
-- alone previously let admins promote themselves and remove the last owner.
-- TRUNCATE also ignores RLS, so remove every unnecessary browser privilege.
revoke all on public.timewarp_workspaces, public.timewarp_workspace_members,
  public.timewarp_workspace_invites from public, anon, authenticated;
grant select on public.timewarp_workspaces, public.timewarp_workspace_members,
  public.timewarp_workspace_invites to authenticated;
grant all on public.timewarp_workspaces, public.timewarp_workspace_members,
  public.timewarp_workspace_invites to service_role;

drop policy if exists "Workspace managers update workspaces" on public.timewarp_workspaces;
drop policy if exists "Workspace managers insert members" on public.timewarp_workspace_members;
drop policy if exists "Workspace managers update members" on public.timewarp_workspace_members;
drop policy if exists "Workspace managers delete members" on public.timewarp_workspace_members;
drop policy if exists "Workspace managers insert invites" on public.timewarp_workspace_invites;
drop policy if exists "Workspace managers update invites" on public.timewarp_workspace_invites;

-- Invitations are visible to their recipient and organization managers.
drop policy if exists "Workspace members view invites" on public.timewarp_workspace_invites;
create policy "Managers and recipients view invites" on public.timewarp_workspace_invites
for select to authenticated using (
  public.timewarp_can_manage_workspace(workspace_id)
  or lower(email) = lower(coalesce(auth.jwt()->>'email', ''))
);

create or replace function public.timewarp_change_member_guarded(
  p_actor_user_id uuid, p_workspace_id uuid, p_member_id uuid,
  p_action text, p_new_role text default null
) returns text language plpgsql security definer
set search_path = public, pg_temp as $$
declare
  v_actor public.timewarp_workspace_members%rowtype;
  v_target public.timewarp_workspace_members%rowtype;
begin
  if p_action is null or p_action not in ('remove','set_role')
    or (p_action = 'set_role' and coalesce(p_new_role,'') not in ('owner','admin','lead')) then
    return 'invalid';
  end if;
  -- A stable row serializes all member changes, including promotions. Checking
  -- the actor after acquiring it prevents a stale admin check granting access.
  perform 1 from public.timewarp_workspaces where id=p_workspace_id for update;
  if not found then return 'not_found'; end if;
  select * into v_actor from public.timewarp_workspace_members
    where workspace_id=p_workspace_id and user_id=p_actor_user_id and status='active' for update;
  if not found then return 'forbidden'; end if;
  select * into v_target from public.timewarp_workspace_members
    where workspace_id=p_workspace_id and id=p_member_id and status='active' for update;
  if not found then return 'not_found'; end if;
  if not (p_action='remove' and v_target.user_id=p_actor_user_id) then
    if v_actor.role not in ('owner','admin') then return 'forbidden'; end if;
    if (v_target.role='owner' or (p_action='set_role' and p_new_role='owner'))
      and v_actor.role<>'owner' then return 'forbidden'; end if;
  end if;
  if v_target.role='owner' and (p_action='remove' or p_new_role<>'owner') then
    if (select count(*) from public.timewarp_workspace_members
      where workspace_id=p_workspace_id and role='owner' and status='active')<=1 then
      return 'last_owner';
    end if;
  end if;
  if p_action='remove' then
    update public.timewarp_workspace_members set status='removed' where id=p_member_id;
  else
    update public.timewarp_workspace_members set role=p_new_role where id=p_member_id;
  end if;
  return 'ok';
end;
$$;

create or replace function public.timewarp_accept_workspace_invite(
  p_user_id uuid, p_invite_id uuid default null, p_token_hash text default null
) returns jsonb language plpgsql security definer
set search_path = public, pg_temp as $$
declare
  v_workspace_id uuid;
  v_invite public.timewarp_workspace_invites%rowtype;
  v_email text;
  v_name text;
begin
  if (p_invite_id is null) = (p_token_hash is null) then
    return jsonb_build_object('status','invalid');
  end if;
  -- Read current, confirmed Auth identity; an old JWT email cannot claim an
  -- invitation after an email change. Never authorize from user metadata.
  select lower(trim(email)),left(coalesce(nullif(trim(raw_user_meta_data->>'name'),''),
    nullif(trim(raw_user_meta_data->>'full_name'),''),split_part(email,'@',1),'Member'),120)
    into v_email,v_name from auth.users where id=p_user_id and email_confirmed_at is not null;
  if not found or coalesce(v_email,'')='' then return jsonb_build_object('status','unconfirmed'); end if;
  select workspace_id into v_workspace_id from public.timewarp_workspace_invites
    where (p_invite_id is not null and id=p_invite_id)
      or (p_token_hash is not null and token_hash=p_token_hash);
  if not found then return jsonb_build_object('status','not_found'); end if;
  perform 1 from public.timewarp_workspaces where id=v_workspace_id for update;
  if not found then return jsonb_build_object('status','not_found'); end if;
  -- Revocation, resending, and acceptance contend on this same invitation row.
  -- Its status, expiry, email and token are checked again under the lock.
  select * into v_invite from public.timewarp_workspace_invites
    where workspace_id=v_workspace_id and status='pending' and expires_at>now()
      and lower(trim(email))=v_email
      and ((p_invite_id is not null and id=p_invite_id)
        or (p_token_hash is not null and token_hash=p_token_hash)) for update;
  if not found then return jsonb_build_object('status','not_found'); end if;
  insert into public.timewarp_workspace_members as existing
    (workspace_id,user_id,email,name,role,status,joined_at)
    values(v_workspace_id,p_user_id,v_email,v_name,v_invite.role,'active',now())
    on conflict(workspace_id,user_id) do update set
      email=excluded.email,name=excluded.name,status='active',
      role=case when existing.status='active' then existing.role else excluded.role end,
      joined_at=case when existing.status='active' then existing.joined_at else excluded.joined_at end;
  -- Membership slot allocation is still guarded by the existing per-user
  -- trigger. Any failure here rolls both writes back in the same transaction.
  update public.timewarp_workspace_invites set status='accepted',accepted_by=p_user_id,accepted_at=now()
    where id=v_invite.id;
  return jsonb_build_object('status','ok','workspace_id',v_workspace_id);
end;
$$;

revoke all on function public.timewarp_change_member_guarded(uuid,uuid,uuid,text,text)
  from public, anon, authenticated;
revoke all on function public.timewarp_accept_workspace_invite(uuid,uuid,text)
  from public, anon, authenticated;
grant execute on function public.timewarp_change_member_guarded(uuid,uuid,uuid,text,text) to service_role;
grant execute on function public.timewarp_accept_workspace_invite(uuid,uuid,text) to service_role;
