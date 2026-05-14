-- Sharing and realtime support for lock-based cloud collaboration.

create table if not exists public.project_invites (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  invited_email text not null,
  role text not null check (role in ('editor', 'viewer')),
  token_hash text not null unique,
  invited_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '7 days'),
  accepted_at timestamptz,
  accepted_by uuid references auth.users(id),
  revoked_at timestamptz
);

create index if not exists project_invites_project_idx
  on public.project_invites(project_id, created_at desc);

create index if not exists project_invites_email_idx
  on public.project_invites(lower(invited_email))
  where accepted_at is null and revoked_at is null;

alter table public.project_invites enable row level security;

alter table public.edit_locks replica identity full;
alter table public.audit_logs replica identity full;

do $$
begin
  execute 'alter publication supabase_realtime add table public.edit_locks';
exception
  when duplicate_object or undefined_object then
    null;
end;
$$;

do $$
begin
  execute 'alter publication supabase_realtime add table public.audit_logs';
exception
  when duplicate_object or undefined_object then
    null;
end;
$$;

create or replace function public.cloud_collab_current_email()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select nullif(lower(coalesce(auth.jwt() ->> 'email', '')), '')
$$;

create or replace function public.create_project_invite(
  p_project_id uuid,
  p_invited_email text,
  p_role text,
  p_invite_token text
)
returns table (
  success boolean,
  reason text,
  invite_id uuid,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_email text := lower(trim(coalesce(p_invited_email, '')));
  v_invite_id uuid;
  v_expires_at timestamptz := now() + interval '7 days';
begin
  if v_uid is null then
    return query select false, 'not_authenticated', null::uuid, null::timestamptz;
    return;
  end if;

  if not public.cloud_collab_is_owner(p_project_id) then
    return query select false, 'owner_required', null::uuid, null::timestamptz;
    return;
  end if;

  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    return query select false, 'invalid_email', null::uuid, null::timestamptz;
    return;
  end if;

  if p_role not in ('editor', 'viewer') then
    return query select false, 'invalid_role', null::uuid, null::timestamptz;
    return;
  end if;

  if coalesce(p_invite_token, '') = '' then
    return query select false, 'invalid_token', null::uuid, null::timestamptz;
    return;
  end if;

  update public.project_invites pi
  set revoked_at = now()
  where pi.project_id = p_project_id
    and lower(pi.invited_email) = v_email
    and pi.accepted_at is null
    and pi.revoked_at is null;

  insert into public.project_invites (
    project_id,
    invited_email,
    role,
    token_hash,
    invited_by,
    expires_at
  )
  values (
    p_project_id,
    v_email,
    p_role,
    public.cloud_collab_token_hash(p_invite_token),
    v_uid,
    v_expires_at
  )
  returning id into v_invite_id;

  perform public.cloud_collab_log(
    p_project_id,
    'invite_created',
    'project',
    p_project_id::text,
    jsonb_build_object('email', v_email, 'role', p_role)
  );

  return query select true, 'ok', v_invite_id, v_expires_at;
end;
$$;

create or replace function public.accept_project_invite(
  p_invite_token text
)
returns table (
  success boolean,
  reason text,
  project_id uuid,
  role text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_email text := public.cloud_collab_current_email();
  v_invite public.project_invites%rowtype;
  v_existing_role text;
begin
  if v_uid is null then
    return query select false, 'not_authenticated', null::uuid, null::text;
    return;
  end if;

  if v_email is null then
    return query select false, 'email_required', null::uuid, null::text;
    return;
  end if;

  select *
  into v_invite
  from public.project_invites
  where token_hash = public.cloud_collab_token_hash(p_invite_token)
    and accepted_at is null
    and revoked_at is null
    and expires_at > now()
  limit 1;

  if not found then
    return query select false, 'invite_not_found', null::uuid, null::text;
    return;
  end if;

  if lower(v_invite.invited_email) <> v_email then
    return query select false, 'email_mismatch', null::uuid, null::text;
    return;
  end if;

  select pm.role
  into v_existing_role
  from public.project_members pm
  where pm.project_id = v_invite.project_id
    and pm.user_id = v_uid;

  if found then
    update public.project_invites
    set accepted_at = now(),
        accepted_by = v_uid
    where id = v_invite.id;

    return query select true, 'already_member', v_invite.project_id, v_existing_role;
    return;
  end if;

  insert into public.project_members (
    project_id,
    user_id,
    role,
    display_name,
    joined_at
  )
  values (
    v_invite.project_id,
    v_uid,
    v_invite.role,
    v_email,
    now()
  );

  update public.project_invites
  set accepted_at = now(),
      accepted_by = v_uid
  where id = v_invite.id;

  perform public.cloud_collab_log(
    v_invite.project_id,
    'invite_accepted',
    'project',
    v_invite.project_id::text,
    jsonb_build_object('email', v_email, 'role', v_invite.role)
  );

  return query select true, 'ok', v_invite.project_id, v_invite.role;
end;
$$;

create or replace function public.list_project_collaboration(
  p_project_id uuid
)
returns table (
  item_type text,
  item_id text,
  user_id uuid,
  email text,
  role text,
  created_at timestamptz,
  expires_at timestamptz,
  accepted_at timestamptz,
  revoked_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return;
  end if;

  if not public.cloud_collab_is_owner(p_project_id) then
    return;
  end if;

  return query
  select
    'member'::text as item_type,
    pm.user_id::text as item_id,
    pm.user_id,
    pm.display_name as email,
    pm.role,
    pm.joined_at as created_at,
    null::timestamptz as expires_at,
    pm.joined_at as accepted_at,
    null::timestamptz as revoked_at
  from public.project_members pm
  where pm.project_id = p_project_id
  union all
  select
    'invite'::text as item_type,
    pi.id::text as item_id,
    pi.accepted_by as user_id,
    pi.invited_email as email,
    pi.role,
    pi.created_at,
    pi.expires_at,
    pi.accepted_at,
    pi.revoked_at
  from public.project_invites pi
  where pi.project_id = p_project_id
  order by 1, 6;
end;
$$;

create or replace function public.update_project_member_role(
  p_project_id uuid,
  p_user_id uuid,
  p_role text
)
returns table (
  success boolean,
  reason text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner_count integer;
  v_current_role text;
begin
  if auth.uid() is null then
    return query select false, 'not_authenticated';
    return;
  end if;

  if not public.cloud_collab_is_owner(p_project_id) then
    return query select false, 'owner_required';
    return;
  end if;

  if p_role not in ('owner', 'editor', 'viewer') then
    return query select false, 'invalid_role';
    return;
  end if;

  select pm.role
  into v_current_role
  from public.project_members pm
  where pm.project_id = p_project_id
    and pm.user_id = p_user_id;

  if not found then
    return query select false, 'member_not_found';
    return;
  end if;

  if v_current_role = 'owner' and p_role <> 'owner' then
    select count(*)
    into v_owner_count
    from public.project_members pm
    where pm.project_id = p_project_id
      and pm.role = 'owner';

    if v_owner_count <= 1 then
      return query select false, 'last_owner';
      return;
    end if;
  end if;

  update public.project_members pm
  set role = p_role
  where pm.project_id = p_project_id
    and pm.user_id = p_user_id;

  perform public.cloud_collab_log(
    p_project_id,
    'member_role_updated',
    'project',
    p_project_id::text,
    jsonb_build_object('userId', p_user_id, 'role', p_role)
  );

  return query select true, 'ok';
end;
$$;

create or replace function public.remove_project_member(
  p_project_id uuid,
  p_user_id uuid
)
returns table (
  success boolean,
  reason text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_owner_count integer;
begin
  if auth.uid() is null then
    return query select false, 'not_authenticated';
    return;
  end if;

  if not public.cloud_collab_is_owner(p_project_id) then
    return query select false, 'owner_required';
    return;
  end if;

  select pm.role
  into v_role
  from public.project_members pm
  where pm.project_id = p_project_id
    and pm.user_id = p_user_id;

  if not found then
    return query select false, 'member_not_found';
    return;
  end if;

  if v_role = 'owner' then
    select count(*)
    into v_owner_count
    from public.project_members pm
    where pm.project_id = p_project_id
      and pm.role = 'owner';

    if v_owner_count <= 1 then
      return query select false, 'last_owner';
      return;
    end if;
  end if;

  delete from public.edit_locks l
  where l.project_id = p_project_id
    and l.locked_by = p_user_id;

  delete from public.project_members pm
  where pm.project_id = p_project_id
    and pm.user_id = p_user_id;

  perform public.cloud_collab_log(
    p_project_id,
    'member_removed',
    'project',
    p_project_id::text,
    jsonb_build_object('userId', p_user_id)
  );

  return query select true, 'ok';
end;
$$;

create or replace function public.revoke_project_invite(
  p_project_id uuid,
  p_invite_id uuid
)
returns table (
  success boolean,
  reason text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return query select false, 'not_authenticated';
    return;
  end if;

  if not public.cloud_collab_is_owner(p_project_id) then
    return query select false, 'owner_required';
    return;
  end if;

  update public.project_invites pi
  set revoked_at = now()
  where pi.project_id = p_project_id
    and pi.id = p_invite_id
    and pi.accepted_at is null
    and pi.revoked_at is null;

  if not found then
    return query select false, 'invite_not_found';
    return;
  end if;

  perform public.cloud_collab_log(
    p_project_id,
    'invite_revoked',
    'project',
    p_project_id::text,
    jsonb_build_object('inviteId', p_invite_id)
  );

  return query select true, 'ok';
end;
$$;

drop policy if exists "owners and invited users can read invites" on public.project_invites;
create policy "owners and invited users can read invites"
on public.project_invites for select
using (
  public.cloud_collab_is_owner(project_id)
  or lower(invited_email) = public.cloud_collab_current_email()
);

drop policy if exists "owners can create invites" on public.project_invites;
create policy "owners can create invites"
on public.project_invites for insert
with check (public.cloud_collab_is_owner(project_id));

drop policy if exists "owners can update invites" on public.project_invites;
create policy "owners can update invites"
on public.project_invites for update
using (public.cloud_collab_is_owner(project_id))
with check (public.cloud_collab_is_owner(project_id));
