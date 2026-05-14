create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (length(trim(display_name)) > 0),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create or replace function public.cloud_collab_user_metadata_display_name(
  p_metadata jsonb
)
returns text
language sql
stable
set search_path = public
as $$
  select nullif(trim(coalesce(p_metadata ->> 'display_name', '')), '')
$$;

create or replace function public.cloud_collab_current_display_name()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select nullif(trim(p.display_name), '')
      from public.profiles p
      where p.user_id = auth.uid()
      limit 1
    ),
    nullif(trim(coalesce(auth.jwt() -> 'user_metadata' ->> 'display_name', '')), ''),
    '名前未設定'
  )
$$;

create or replace function public.handle_auth_user_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (
    user_id,
    display_name,
    updated_at
  )
  values (
    new.id,
    coalesce(
      public.cloud_collab_user_metadata_display_name(new.raw_user_meta_data),
      '名前未設定'
    ),
    now()
  )
  on conflict (user_id) do update
  set display_name = excluded.display_name,
      updated_at = now()
  where public.profiles.display_name = '名前未設定'
    and excluded.display_name <> '名前未設定';

  return new;
end;
$$;

drop trigger if exists on_auth_user_created_profile on auth.users;
create trigger on_auth_user_created_profile
after insert on auth.users
for each row execute function public.handle_auth_user_profile();

insert into public.profiles (
  user_id,
  display_name,
  updated_at
)
select
  u.id,
  coalesce(
    public.cloud_collab_user_metadata_display_name(u.raw_user_meta_data),
    '名前未設定'
  ),
  now()
from auth.users u
on conflict (user_id) do nothing;

drop policy if exists "users can read own profile" on public.profiles;
create policy "users can read own profile"
on public.profiles for select
to authenticated
using (user_id = auth.uid());

drop policy if exists "users can update own profile" on public.profiles;
create policy "users can update own profile"
on public.profiles for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

grant select, update on public.profiles to authenticated;

create or replace function public.handle_project_member_display_name()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_display_name text;
begin
  if new.display_name is not null
    and trim(new.display_name) <> ''
    and new.display_name not like '%@%'
  then
    return new;
  end if;

  select nullif(trim(p.display_name), '')
  into v_display_name
  from public.profiles p
  where p.user_id = new.user_id
  limit 1;

  new.display_name := coalesce(v_display_name, '名前未設定');
  return new;
end;
$$;

drop trigger if exists normalize_project_member_display_name on public.project_members;
create trigger normalize_project_member_display_name
before insert or update of display_name on public.project_members
for each row execute function public.handle_project_member_display_name();

update public.project_members pm
set display_name = coalesce(p.display_name, '名前未設定')
from public.profiles p
where pm.user_id = p.user_id
  and (
    pm.display_name is null
    or trim(pm.display_name) = ''
    or pm.display_name like '%@%'
  );

update public.project_members pm
set display_name = '名前未設定'
where pm.display_name is null
  or trim(pm.display_name) = ''
  or pm.display_name like '%@%';

update public.audit_logs
set metadata = metadata - 'email'
where metadata ? 'email';

drop policy if exists "owners and invited users can read invites" on public.project_invites;
drop policy if exists "users cannot directly read invite emails" on public.project_invites;
create policy "users cannot directly read invite emails"
on public.project_invites for select
using (false);

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
    return query select false, 'token_required', null::uuid, null::timestamptz;
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
    jsonb_build_object('role', p_role)
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
    public.cloud_collab_current_display_name(),
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
    jsonb_build_object('role', v_invite.role)
  );

  return query select true, 'ok', v_invite.project_id, v_invite.role;
end;
$$;

drop function if exists public.list_project_collaboration(uuid);
create function public.list_project_collaboration(
  p_project_id uuid
)
returns table (
  item_type text,
  item_id text,
  user_id uuid,
  display_name text,
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
    coalesce(nullif(trim(pm.display_name), ''), '名前未設定') as display_name,
    null::text as email,
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
    null::text as display_name,
    null::text as email,
    pi.role,
    pi.created_at,
    pi.expires_at,
    pi.accepted_at,
    pi.revoked_at
  from public.project_invites pi
  where pi.project_id = p_project_id
  order by 1, 7;
end;
$$;
