create table if not exists public.user_contacts (
  user_id uuid not null references auth.users(id) on delete cascade,
  contact_user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'accepted' check (status in ('pending', 'accepted', 'blocked')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, contact_user_id),
  check (user_id <> contact_user_id)
);

create index if not exists user_contacts_contact_user_idx
  on public.user_contacts(contact_user_id);

alter table public.user_contacts enable row level security;

drop policy if exists "users can read own contacts" on public.user_contacts;
create policy "users can read own contacts"
on public.user_contacts for select
to authenticated
using (user_id = auth.uid());

drop policy if exists "users can insert own contacts" on public.user_contacts;
create policy "users can insert own contacts"
on public.user_contacts for insert
to authenticated
with check (
  user_id = auth.uid()
  and contact_user_id <> auth.uid()
);

drop policy if exists "users can update own contacts" on public.user_contacts;
create policy "users can update own contacts"
on public.user_contacts for update
to authenticated
using (user_id = auth.uid())
with check (
  user_id = auth.uid()
  and contact_user_id <> auth.uid()
);

drop policy if exists "users can delete own contacts" on public.user_contacts;
create policy "users can delete own contacts"
on public.user_contacts for delete
to authenticated
using (user_id = auth.uid());

grant select, insert, update, delete on public.user_contacts to authenticated;

drop function if exists public.list_user_contacts();
drop function if exists public.add_contact_by_email(text);
drop function if exists public.add_project_member_from_contact(uuid, uuid, text);
drop function if exists public.add_project_member_to_contacts(uuid, uuid);
drop function if exists public.cloud_collab_display_name_for_user(uuid);
create function public.cloud_collab_display_name_for_user(
  p_user_id uuid
)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select public.cloud_collab_normalized_display_name(p.display_name)
      from public.profiles p
      where p.user_id = p_user_id
      limit 1
    ),
    '名前未設定'
  )
$$;

drop function if exists public.list_user_contacts();
create function public.list_user_contacts()
returns table (
  contact_user_id uuid,
  display_name text,
  status text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return;
  end if;

  return query
  select
    uc.contact_user_id,
    public.cloud_collab_display_name_for_user(uc.contact_user_id) as display_name,
    uc.status,
    uc.created_at
  from public.user_contacts uc
  where uc.user_id = auth.uid()
  order by
    public.cloud_collab_display_name_for_user(uc.contact_user_id) asc,
    uc.created_at desc;
end;
$$;

drop function if exists public.add_contact_by_email(text);
create function public.add_contact_by_email(
  p_email text
)
returns table (
  success boolean,
  reason text,
  contact_user_id uuid,
  display_name text,
  status text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  v_contact_user_id uuid;
  v_display_name text;
  v_status text;
begin
  if auth.uid() is null then
    return query select false, 'not_authenticated', null::uuid, null::text, null::text;
    return;
  end if;

  if v_email = '' or v_email not like '%@%' then
    return query select false, 'invalid_email', null::uuid, null::text, null::text;
    return;
  end if;

  select u.id
  into v_contact_user_id
  from auth.users u
  where lower(u.email) = v_email
  limit 1;

  if v_contact_user_id is null then
    return query select false, 'user_not_found', null::uuid, null::text, null::text;
    return;
  end if;

  if v_contact_user_id = auth.uid() then
    return query select false, 'self_contact', null::uuid, null::text, null::text;
    return;
  end if;

  v_display_name := public.cloud_collab_display_name_for_user(v_contact_user_id);

  select uc.status
  into v_status
  from public.user_contacts uc
  where uc.user_id = auth.uid()
    and uc.contact_user_id = v_contact_user_id
  limit 1;

  if found then
    return query select true, 'already_contact', v_contact_user_id, v_display_name, v_status;
    return;
  end if;

  insert into public.user_contacts (
    user_id,
    contact_user_id,
    status,
    created_at,
    updated_at
  )
  values (
    auth.uid(),
    v_contact_user_id,
    'accepted',
    now(),
    now()
  );

  return query select true, 'ok', v_contact_user_id, v_display_name, 'accepted'::text;
end;
$$;

drop function if exists public.add_project_member_from_contact(uuid, uuid, text);
create function public.add_project_member_from_contact(
  p_project_id uuid,
  p_contact_user_id uuid,
  p_role text
)
returns table (
  success boolean,
  reason text,
  user_id uuid,
  display_name text,
  role text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_display_name text;
begin
  if auth.uid() is null then
    return query select false, 'not_authenticated', null::uuid, null::text, null::text;
    return;
  end if;

  if not public.cloud_collab_is_owner(p_project_id) then
    return query select false, 'owner_required', null::uuid, null::text, null::text;
    return;
  end if;

  if p_role not in ('editor', 'viewer') then
    return query select false, 'invalid_role', null::uuid, null::text, null::text;
    return;
  end if;

  if p_contact_user_id = auth.uid() then
    return query select false, 'self_member', null::uuid, null::text, null::text;
    return;
  end if;

  if not exists (
    select 1
    from public.user_contacts uc
    where uc.user_id = auth.uid()
      and uc.contact_user_id = p_contact_user_id
      and uc.status = 'accepted'
  ) then
    return query select false, 'contact_not_found', null::uuid, null::text, null::text;
    return;
  end if;

  if exists (
    select 1
    from public.project_members pm
    where pm.project_id = p_project_id
      and pm.user_id = p_contact_user_id
  ) then
    return query select false, 'already_member', p_contact_user_id, public.cloud_collab_display_name_for_user(p_contact_user_id), p_role;
    return;
  end if;

  v_display_name := public.cloud_collab_display_name_for_user(p_contact_user_id);

  insert into public.project_members (
    project_id,
    user_id,
    role,
    display_name,
    joined_at
  )
  values (
    p_project_id,
    p_contact_user_id,
    p_role,
    v_display_name,
    now()
  );

  perform public.cloud_collab_log(
    p_project_id,
    'member_added_from_contact',
    'project',
    p_project_id::text,
    jsonb_build_object('userId', p_contact_user_id, 'role', p_role)
  );

  return query select true, 'ok', p_contact_user_id, v_display_name, p_role;
end;
$$;

drop function if exists public.add_project_member_to_contacts(uuid, uuid);
create function public.add_project_member_to_contacts(
  p_project_id uuid,
  p_contact_user_id uuid
)
returns table (
  success boolean,
  reason text,
  contact_user_id uuid,
  display_name text,
  status text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_display_name text;
  v_status text;
begin
  if auth.uid() is null then
    return query select false, 'not_authenticated', null::uuid, null::text, null::text;
    return;
  end if;

  if not public.cloud_collab_is_owner(p_project_id) then
    return query select false, 'owner_required', null::uuid, null::text, null::text;
    return;
  end if;

  if p_contact_user_id = auth.uid() then
    return query select false, 'self_contact', null::uuid, null::text, null::text;
    return;
  end if;

  if not exists (
    select 1
    from public.project_members pm
    where pm.project_id = p_project_id
      and pm.user_id = p_contact_user_id
  ) then
    return query select false, 'member_not_found', null::uuid, null::text, null::text;
    return;
  end if;

  v_display_name := public.cloud_collab_display_name_for_user(p_contact_user_id);

  select uc.status
  into v_status
  from public.user_contacts uc
  where uc.user_id = auth.uid()
    and uc.contact_user_id = p_contact_user_id
  limit 1;

  if found then
    return query select true, 'already_contact', p_contact_user_id, v_display_name, v_status;
    return;
  end if;

  insert into public.user_contacts (
    user_id,
    contact_user_id,
    status,
    created_at,
    updated_at
  )
  values (
    auth.uid(),
    p_contact_user_id,
    'accepted',
    now(),
    now()
  );

  return query select true, 'ok', p_contact_user_id, v_display_name, 'accepted'::text;
end;
$$;

notify pgrst, 'reload schema';
