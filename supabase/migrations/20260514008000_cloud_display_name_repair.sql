create or replace function public.cloud_collab_normalized_display_name(
  p_display_name text
)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when nullif(trim(coalesce(p_display_name, '')), '') is null then null
    when trim(p_display_name) = '名前未設定' then null
    when trim(p_display_name) like '%@%' then null
    else trim(p_display_name)
  end
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
      select public.cloud_collab_normalized_display_name(p.display_name)
      from public.profiles p
      where p.user_id = auth.uid()
      limit 1
    ),
    public.cloud_collab_normalized_display_name(auth.jwt() -> 'user_metadata' ->> 'display_name'),
    '名前未設定'
  )
$$;

create or replace function public.handle_project_member_display_name()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_display_name text;
begin
  if public.cloud_collab_normalized_display_name(new.display_name) is not null then
    new.display_name := public.cloud_collab_normalized_display_name(new.display_name);
    return new;
  end if;

  select public.cloud_collab_normalized_display_name(p.display_name)
  into v_display_name
  from public.profiles p
  where p.user_id = new.user_id
  limit 1;

  new.display_name := coalesce(v_display_name, '名前未設定');
  return new;
end;
$$;

update public.project_members pm
set display_name = public.cloud_collab_normalized_display_name(p.display_name)
from public.profiles p
where pm.user_id = p.user_id
  and public.cloud_collab_normalized_display_name(p.display_name) is not null
  and public.cloud_collab_normalized_display_name(pm.display_name) is null;

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
    coalesce(
      public.cloud_collab_normalized_display_name(p.display_name),
      public.cloud_collab_normalized_display_name(pm.display_name),
      '名前未設定'
    ) as display_name,
    null::text as email,
    pm.role,
    pm.joined_at as created_at,
    null::timestamptz as expires_at,
    pm.joined_at as accepted_at,
    null::timestamptz as revoked_at
  from public.project_members pm
  left join public.profiles p on p.user_id = pm.user_id
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
