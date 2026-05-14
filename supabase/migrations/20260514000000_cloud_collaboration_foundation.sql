-- Cloud collaboration foundation for Tairetsu Maker.
-- This migration creates the lock-based collaboration schema, RLS policies,
-- and the first RPC surface for scene/resource locks and versioned saves.

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  mode text not null default 'stage' check (mode in ('stage', 'parade')),
  schema_version integer not null default 1,
  legacy_project_id text,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.project_members (
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'editor', 'viewer')),
  display_name text,
  joined_at timestamptz not null default now(),
  primary key (project_id, user_id)
);

create table if not exists public.project_resources (
  project_id uuid not null references public.projects(id) on delete cascade,
  resource_key text not null check (
    resource_key in ('members', 'objects', 'settings', 'audio', 'sceneOrder')
  ),
  data jsonb not null default '{}'::jsonb,
  version integer not null default 1,
  schema_version integer not null default 1,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id),
  primary key (project_id, resource_key)
);

create table if not exists public.scenes (
  project_id uuid not null references public.projects(id) on delete cascade,
  scene_id text not null,
  data jsonb not null default '{}'::jsonb,
  version integer not null default 1,
  schema_version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id),
  primary key (project_id, scene_id)
);

create table if not exists public.edit_locks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  target_type text not null check (target_type in ('scene', 'project')),
  target_id text not null,
  locked_by uuid not null references auth.users(id) on delete cascade,
  lock_token_hash text not null,
  locked_at timestamptz not null default now(),
  last_heartbeat_at timestamptz not null default now(),
  last_activity_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '120 seconds'),
  unique (project_id, target_type, target_id)
);

create table if not exists public.snapshots (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  target_type text not null check (target_type in ('scene', 'project')),
  target_id text not null,
  version integer not null,
  schema_version integer not null default 1,
  data jsonb not null,
  reason text not null default 'save_success',
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id)
);

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  actor_id uuid references auth.users(id),
  action text not null,
  target_type text,
  target_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists edit_locks_project_idx
  on public.edit_locks(project_id, target_type, target_id);

create index if not exists snapshots_target_idx
  on public.snapshots(project_id, target_type, target_id, created_at desc);

create index if not exists audit_logs_project_idx
  on public.audit_logs(project_id, created_at desc);

alter table public.projects enable row level security;
alter table public.project_members enable row level security;
alter table public.project_resources enable row level security;
alter table public.scenes enable row level security;
alter table public.edit_locks enable row level security;
alter table public.snapshots enable row level security;
alter table public.audit_logs enable row level security;

create or replace function public.cloud_collab_current_role(p_project_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select pm.role
  from public.project_members pm
  where pm.project_id = p_project_id
    and pm.user_id = auth.uid()
  limit 1
$$;

create or replace function public.cloud_collab_is_member(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.cloud_collab_current_role(p_project_id) is not null
$$;

create or replace function public.cloud_collab_is_owner(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.cloud_collab_current_role(p_project_id) = 'owner'
$$;

create or replace function public.cloud_collab_can_edit_scene(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.cloud_collab_current_role(p_project_id) in ('owner', 'editor')
$$;

create or replace function public.cloud_collab_token_hash(p_lock_token text)
returns text
language sql
immutable
as $$
  select encode(
    extensions.digest(convert_to(coalesce(p_lock_token, ''), 'UTF8'), 'sha256'),
    'hex'
  )
$$;

create or replace function public.cloud_collab_log(
  p_project_id uuid,
  p_action text,
  p_target_type text default null,
  p_target_id text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.audit_logs (
    project_id,
    actor_id,
    action,
    target_type,
    target_id,
    metadata
  )
  values (
    p_project_id,
    auth.uid(),
    p_action,
    p_target_type,
    p_target_id,
    coalesce(p_metadata, '{}'::jsonb)
  );
end;
$$;

create or replace function public.cloud_collab_cleanup_expired_locks(
  p_project_id uuid
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted integer := 0;
begin
  delete from public.edit_locks
  where project_id = p_project_id
    and (
      expires_at <= now()
      or last_heartbeat_at <= now() - interval '120 seconds'
    );

  get diagnostics v_deleted = row_count;

  if v_deleted > 0 then
    perform public.cloud_collab_log(
      p_project_id,
      'lock_expired',
      null,
      null,
      jsonb_build_object('count', v_deleted)
    );
  end if;

  return v_deleted;
end;
$$;

create or replace function public.cloud_collab_prune_snapshots(
  p_project_id uuid,
  p_target_type text,
  p_target_id text
)
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.snapshots s
  using (
    select id
    from (
      select
        id,
        row_number() over (
          partition by project_id, target_type, target_id
          order by created_at desc
        ) as row_index
      from public.snapshots
      where project_id = p_project_id
        and target_type = p_target_type
        and target_id = p_target_id
    ) ranked
    where row_index > 10
  ) stale
  where s.id = stale.id
$$;

create or replace function public.cloud_collab_verify_lock(
  p_project_id uuid,
  p_target_type text,
  p_target_id text,
  p_lock_token text
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.edit_locks l
    where l.project_id = p_project_id
      and l.target_type = p_target_type
      and l.target_id = p_target_id
      and l.locked_by = auth.uid()
      and l.lock_token_hash = public.cloud_collab_token_hash(p_lock_token)
      and l.expires_at > now()
      and l.last_heartbeat_at > now() - interval '120 seconds'
  )
$$;

create or replace function public.create_cloud_project(
  p_title text,
  p_mode text,
  p_schema_version integer,
  p_legacy_project_id text,
  p_resources jsonb,
  p_scenes jsonb
)
returns table (
  success boolean,
  reason text,
  project_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_project_id uuid;
  v_resource jsonb;
  v_resource_key text;
  v_resource_version integer;
  v_resource_schema_version integer;
  v_scene jsonb;
  v_scene_id text;
  v_scene_version integer;
  v_scene_schema_version integer;
  v_required_key text;
  v_required_resource_keys text[] := array[
    'members',
    'objects',
    'settings',
    'audio',
    'sceneOrder'
  ];
begin
  if v_uid is null then
    return query select false, 'not_authenticated', null::uuid;
    return;
  end if;

  if coalesce(trim(p_title), '') = '' then
    return query select false, 'title_required', null::uuid;
    return;
  end if;

  if p_mode not in ('stage', 'parade') then
    return query select false, 'invalid_mode', null::uuid;
    return;
  end if;

  if coalesce(jsonb_typeof(p_resources), 'null') <> 'array' then
    return query select false, 'resources_must_be_array', null::uuid;
    return;
  end if;

  if coalesce(jsonb_typeof(p_scenes), 'null') <> 'array' then
    return query select false, 'scenes_must_be_array', null::uuid;
    return;
  end if;

  if jsonb_array_length(p_scenes) = 0 then
    return query select false, 'at_least_one_scene_required', null::uuid;
    return;
  end if;

  insert into public.projects (
    title,
    mode,
    schema_version,
    legacy_project_id,
    created_by,
    created_at,
    updated_at
  )
  values (
    trim(p_title),
    p_mode,
    coalesce(p_schema_version, 1),
    nullif(p_legacy_project_id, ''),
    v_uid,
    now(),
    now()
  )
  returning id into v_project_id;

  insert into public.project_members (
    project_id,
    user_id,
    role,
    display_name
  )
  values (
    v_project_id,
    v_uid,
    'owner',
    nullif(lower(coalesce(auth.jwt() ->> 'email', '')), '')
  );

  for v_resource in
    select value from jsonb_array_elements(p_resources)
  loop
    v_resource_key := v_resource ->> 'resourceKey';
    v_resource_version := coalesce((v_resource ->> 'version')::integer, 1);
    v_resource_schema_version :=
      coalesce((v_resource ->> 'schemaVersion')::integer, coalesce(p_schema_version, 1));

    insert into public.project_resources (
      project_id,
      resource_key,
      data,
      version,
      schema_version,
      updated_at,
      updated_by
    )
    values (
      v_project_id,
      v_resource_key,
      coalesce(v_resource -> 'data', '{}'::jsonb),
      v_resource_version,
      v_resource_schema_version,
      now(),
      v_uid
    );

    insert into public.snapshots (
      project_id,
      target_type,
      target_id,
      version,
      schema_version,
      data,
      reason,
      created_by
    )
    values (
      v_project_id,
      'project',
      v_resource_key,
      v_resource_version,
      v_resource_schema_version,
      coalesce(v_resource -> 'data', '{}'::jsonb),
      'cloud_create',
      v_uid
    );
  end loop;

  foreach v_required_key in array v_required_resource_keys loop
    if not exists (
      select 1
      from public.project_resources pr
      where pr.project_id = v_project_id
        and pr.resource_key = v_required_key
    ) then
      raise exception 'missing required resource: %', v_required_key
        using errcode = '22023';
    end if;
  end loop;

  for v_scene in
    select value from jsonb_array_elements(p_scenes)
  loop
    v_scene_id := v_scene ->> 'sceneId';
    if coalesce(v_scene_id, '') = '' then
      raise exception 'sceneId is required' using errcode = '22023';
    end if;

    v_scene_version := coalesce((v_scene ->> 'version')::integer, 1);
    v_scene_schema_version :=
      coalesce((v_scene ->> 'schemaVersion')::integer, coalesce(p_schema_version, 1));

    insert into public.scenes (
      project_id,
      scene_id,
      data,
      version,
      schema_version,
      created_at,
      updated_at,
      updated_by
    )
    values (
      v_project_id,
      v_scene_id,
      coalesce(v_scene -> 'data', '{}'::jsonb),
      v_scene_version,
      v_scene_schema_version,
      now(),
      now(),
      v_uid
    );

    insert into public.snapshots (
      project_id,
      target_type,
      target_id,
      version,
      schema_version,
      data,
      reason,
      created_by
    )
    values (
      v_project_id,
      'scene',
      v_scene_id,
      v_scene_version,
      v_scene_schema_version,
      coalesce(v_scene -> 'data', '{}'::jsonb),
      'cloud_create',
      v_uid
    );
  end loop;

  perform public.cloud_collab_log(
    v_project_id,
    'project_created',
    'project',
    v_project_id::text,
    jsonb_build_object(
      'mode',
      p_mode,
      'resourceCount',
      jsonb_array_length(p_resources),
      'sceneCount',
      jsonb_array_length(p_scenes)
    )
  );

  return query select true, 'ok', v_project_id;
end;
$$;

create or replace function public.acquire_edit_lock(
  p_project_id uuid,
  p_target_type text,
  p_target_id text,
  p_lock_token text
)
returns table (
  success boolean,
  reason text,
  locked_by uuid,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_existing public.edit_locks%rowtype;
  v_expires_at timestamptz := now() + interval '120 seconds';
begin
  if v_uid is null then
    return query select false, 'not_authenticated', null::uuid, null::timestamptz;
    return;
  end if;

  if p_target_type not in ('scene', 'project') then
    return query select false, 'invalid_target_type', null::uuid, null::timestamptz;
    return;
  end if;

  if coalesce(p_target_id, '') = '' or coalesce(p_lock_token, '') = '' then
    return query select false, 'invalid_request', null::uuid, null::timestamptz;
    return;
  end if;

  perform public.cloud_collab_cleanup_expired_locks(p_project_id);
  v_role := public.cloud_collab_current_role(p_project_id);

  if v_role is null then
    return query select false, 'not_project_member', null::uuid, null::timestamptz;
    return;
  end if;

  if p_target_type = 'scene' and v_role not in ('owner', 'editor') then
    return query select false, 'permission_denied', null::uuid, null::timestamptz;
    return;
  end if;

  if p_target_type = 'project' and v_role <> 'owner' then
    return query select false, 'owner_required', null::uuid, null::timestamptz;
    return;
  end if;

  if p_target_type = 'scene' then
    select *
    into v_existing
    from public.edit_locks
    where project_id = p_project_id
      and target_type = 'project'
    limit 1;

    if found then
      return query select false, 'project_lock_active', v_existing.locked_by, v_existing.expires_at;
      return;
    end if;

    select *
    into v_existing
    from public.edit_locks
    where project_id = p_project_id
      and target_type = 'scene'
      and target_id = p_target_id
    limit 1;

    if found then
      return query select false, 'scene_lock_active', v_existing.locked_by, v_existing.expires_at;
      return;
    end if;
  else
    select *
    into v_existing
    from public.edit_locks
    where project_id = p_project_id
    limit 1;

    if found then
      return query select false, 'project_lock_wait_for_active_scene', v_existing.locked_by, v_existing.expires_at;
      return;
    end if;
  end if;

  insert into public.edit_locks (
    project_id,
    target_type,
    target_id,
    locked_by,
    lock_token_hash,
    locked_at,
    last_heartbeat_at,
    last_activity_at,
    expires_at
  )
  values (
    p_project_id,
    p_target_type,
    p_target_id,
    v_uid,
    public.cloud_collab_token_hash(p_lock_token),
    now(),
    now(),
    now(),
    v_expires_at
  );

  perform public.cloud_collab_log(
    p_project_id,
    'lock_acquired',
    p_target_type,
    p_target_id
  );

  return query select true, 'ok', v_uid, v_expires_at;
end;
$$;

create or replace function public.heartbeat_edit_lock(
  p_project_id uuid,
  p_target_type text,
  p_target_id text,
  p_lock_token text,
  p_has_activity boolean default false
)
returns table (
  success boolean,
  reason text,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_expires_at timestamptz := now() + interval '120 seconds';
begin
  perform public.cloud_collab_cleanup_expired_locks(p_project_id);

  update public.edit_locks l
  set
    last_heartbeat_at = now(),
    last_activity_at = case when p_has_activity then now() else l.last_activity_at end,
    expires_at = v_expires_at
  where l.project_id = p_project_id
    and l.target_type = p_target_type
    and l.target_id = p_target_id
    and l.locked_by = auth.uid()
    and l.lock_token_hash = public.cloud_collab_token_hash(p_lock_token);

  if not found then
    return query select false, 'lock_not_found_or_token_mismatch', null::timestamptz;
    return;
  end if;

  return query select true, 'ok', v_expires_at;
end;
$$;

create or replace function public.release_edit_lock(
  p_project_id uuid,
  p_target_type text,
  p_target_id text,
  p_lock_token text
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
  delete from public.edit_locks
  where project_id = p_project_id
    and target_type = p_target_type
    and target_id = p_target_id
    and locked_by = auth.uid()
    and lock_token_hash = public.cloud_collab_token_hash(p_lock_token);

  if not found then
    return query select false, 'lock_not_found_or_token_mismatch';
    return;
  end if;

  perform public.cloud_collab_log(
    p_project_id,
    'lock_released',
    p_target_type,
    p_target_id
  );

  return query select true, 'ok';
end;
$$;

create or replace function public.force_release_edit_lock(
  p_project_id uuid,
  p_target_type text,
  p_target_id text
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
  if not public.cloud_collab_is_owner(p_project_id) then
    return query select false, 'owner_required';
    return;
  end if;

  delete from public.edit_locks
  where project_id = p_project_id
    and target_type = p_target_type
    and target_id = p_target_id;

  if not found then
    return query select false, 'lock_not_found';
    return;
  end if;

  perform public.cloud_collab_log(
    p_project_id,
    'lock_force_released',
    p_target_type,
    p_target_id
  );

  return query select true, 'ok';
end;
$$;

create or replace function public.save_scene_with_lock(
  p_project_id uuid,
  p_scene_id text,
  p_base_version integer,
  p_data jsonb,
  p_lock_token text,
  p_schema_version integer default 1,
  p_summary text default null
)
returns table (
  success boolean,
  reason text,
  version integer,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current_version integer;
  v_next_version integer;
  v_updated_at timestamptz := now();
begin
  perform public.cloud_collab_cleanup_expired_locks(p_project_id);

  if not public.cloud_collab_can_edit_scene(p_project_id) then
    return query select false, 'permission_denied', null::integer, null::timestamptz;
    return;
  end if;

  if not public.cloud_collab_verify_lock(p_project_id, 'scene', p_scene_id, p_lock_token) then
    return query select false, 'lock_required', null::integer, null::timestamptz;
    return;
  end if;

  select s.version
  into v_current_version
  from public.scenes s
  where s.project_id = p_project_id
    and s.scene_id = p_scene_id
  for update;

  if not found then
    return query select false, 'scene_not_found', null::integer, null::timestamptz;
    return;
  end if;

  if v_current_version <> p_base_version then
    perform public.cloud_collab_log(
      p_project_id,
      'save_conflict',
      'scene',
      p_scene_id,
      jsonb_build_object(
        'baseVersion',
        p_base_version,
        'currentVersion',
        v_current_version
      )
    );
    return query select false, 'version_conflict', v_current_version, null::timestamptz;
    return;
  end if;

  v_next_version := v_current_version + 1;

  update public.scenes s
  set
    data = p_data,
    version = v_next_version,
    schema_version = p_schema_version,
    updated_at = v_updated_at,
    updated_by = auth.uid()
  where s.project_id = p_project_id
    and s.scene_id = p_scene_id;

  update public.edit_locks l
  set last_activity_at = now(),
      last_heartbeat_at = now(),
      expires_at = now() + interval '120 seconds'
  where l.project_id = p_project_id
    and l.target_type = 'scene'
    and l.target_id = p_scene_id
    and l.locked_by = auth.uid()
    and l.lock_token_hash = public.cloud_collab_token_hash(p_lock_token);

  insert into public.snapshots (
    project_id,
    target_type,
    target_id,
    version,
    schema_version,
    data,
    reason,
    created_by
  )
  values (
    p_project_id,
    'scene',
    p_scene_id,
    v_next_version,
    p_schema_version,
    p_data,
    'save_success',
    auth.uid()
  );

  perform public.cloud_collab_prune_snapshots(p_project_id, 'scene', p_scene_id);
  perform public.cloud_collab_log(
    p_project_id,
    'save_success',
    'scene',
    p_scene_id,
    jsonb_build_object(
      'version',
      v_next_version,
      'summary',
      p_summary
    )
  );

  update public.projects
  set updated_at = v_updated_at
  where id = p_project_id;

  return query select true, 'ok', v_next_version, v_updated_at;
end;
$$;

create or replace function public.save_project_resource_with_lock(
  p_project_id uuid,
  p_resource_key text,
  p_base_version integer,
  p_data jsonb,
  p_lock_token text,
  p_schema_version integer default 1,
  p_summary text default null
)
returns table (
  success boolean,
  reason text,
  version integer,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current_version integer;
  v_next_version integer;
  v_updated_at timestamptz := now();
begin
  perform public.cloud_collab_cleanup_expired_locks(p_project_id);

  if not public.cloud_collab_is_owner(p_project_id) then
    return query select false, 'owner_required', null::integer, null::timestamptz;
    return;
  end if;

  if p_resource_key not in ('members', 'objects', 'settings', 'audio', 'sceneOrder') then
    return query select false, 'invalid_resource_key', null::integer, null::timestamptz;
    return;
  end if;

  if not public.cloud_collab_verify_lock(p_project_id, 'project', p_resource_key, p_lock_token) then
    return query select false, 'lock_required', null::integer, null::timestamptz;
    return;
  end if;

  select r.version
  into v_current_version
  from public.project_resources r
  where r.project_id = p_project_id
    and r.resource_key = p_resource_key
  for update;

  if not found then
    return query select false, 'resource_not_found', null::integer, null::timestamptz;
    return;
  end if;

  if v_current_version <> p_base_version then
    perform public.cloud_collab_log(
      p_project_id,
      'save_conflict',
      'project',
      p_resource_key,
      jsonb_build_object(
        'baseVersion',
        p_base_version,
        'currentVersion',
        v_current_version
      )
    );
    return query select false, 'version_conflict', v_current_version, null::timestamptz;
    return;
  end if;

  v_next_version := v_current_version + 1;

  update public.project_resources r
  set
    data = p_data,
    version = v_next_version,
    schema_version = p_schema_version,
    updated_at = v_updated_at,
    updated_by = auth.uid()
  where r.project_id = p_project_id
    and r.resource_key = p_resource_key;

  update public.edit_locks l
  set last_activity_at = now(),
      last_heartbeat_at = now(),
      expires_at = now() + interval '120 seconds'
  where l.project_id = p_project_id
    and l.target_type = 'project'
    and l.target_id = p_resource_key
    and l.locked_by = auth.uid()
    and l.lock_token_hash = public.cloud_collab_token_hash(p_lock_token);

  insert into public.snapshots (
    project_id,
    target_type,
    target_id,
    version,
    schema_version,
    data,
    reason,
    created_by
  )
  values (
    p_project_id,
    'project',
    p_resource_key,
    v_next_version,
    p_schema_version,
    p_data,
    'save_success',
    auth.uid()
  );

  perform public.cloud_collab_prune_snapshots(p_project_id, 'project', p_resource_key);
  perform public.cloud_collab_log(
    p_project_id,
    'save_success',
    'project',
    p_resource_key,
    jsonb_build_object(
      'version',
      v_next_version,
      'summary',
      p_summary
    )
  );

  update public.projects
  set updated_at = v_updated_at
  where id = p_project_id;

  return query select true, 'ok', v_next_version, v_updated_at;
end;
$$;

drop policy if exists "project members can read projects" on public.projects;
create policy "project members can read projects"
on public.projects for select
using (public.cloud_collab_is_member(id));

drop policy if exists "authenticated users can create projects" on public.projects;

drop policy if exists "owners can update project basics" on public.projects;
create policy "owners can update project basics"
on public.projects for update
using (public.cloud_collab_is_owner(id))
with check (public.cloud_collab_is_owner(id));

drop policy if exists "project members can read membership" on public.project_members;
create policy "project members can read membership"
on public.project_members for select
using (public.cloud_collab_is_member(project_id));

drop policy if exists "owners can add members" on public.project_members;
create policy "owners can add members"
on public.project_members for insert
to authenticated
with check (public.cloud_collab_is_owner(project_id));

drop policy if exists "owners can update members" on public.project_members;
create policy "owners can update members"
on public.project_members for update
using (public.cloud_collab_is_owner(project_id))
with check (public.cloud_collab_is_owner(project_id));

drop policy if exists "owners can delete members" on public.project_members;
create policy "owners can delete members"
on public.project_members for delete
using (public.cloud_collab_is_owner(project_id));

drop policy if exists "project members can read resources" on public.project_resources;
create policy "project members can read resources"
on public.project_resources for select
using (public.cloud_collab_is_member(project_id));

drop policy if exists "project members can read scenes" on public.scenes;
create policy "project members can read scenes"
on public.scenes for select
using (public.cloud_collab_is_member(project_id));

drop policy if exists "project members can read locks" on public.edit_locks;
create policy "project members can read locks"
on public.edit_locks for select
using (public.cloud_collab_is_member(project_id));

drop policy if exists "project members can read snapshots" on public.snapshots;
create policy "project members can read snapshots"
on public.snapshots for select
using (public.cloud_collab_is_member(project_id));

drop policy if exists "project members can read audit logs" on public.audit_logs;
create policy "project members can read audit logs"
on public.audit_logs for select
using (public.cloud_collab_is_member(project_id));
