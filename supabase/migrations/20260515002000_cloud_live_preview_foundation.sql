-- Live preview foundation for future realtime collaboration.
-- The canonical data remains scenes.data JSONB. Cell versions are created
-- lazily on first patch save so old projects do not need data backfills.

alter table public.edit_locks
  add column if not exists lease_id uuid,
  add column if not exists operation_id uuid,
  add column if not exists holder_client_id text,
  add column if not exists renewed_at timestamptz;

update public.edit_locks
set
  lease_id = coalesce(lease_id, gen_random_uuid()),
  operation_id = coalesce(operation_id, gen_random_uuid()),
  renewed_at = coalesce(renewed_at, last_heartbeat_at, now())
where lease_id is null
   or operation_id is null
   or renewed_at is null;

create index if not exists edit_locks_lease_idx
  on public.edit_locks(project_id, target_type, target_id, lease_id);

create table if not exists public.scene_cell_versions (
  project_id uuid not null references public.projects(id) on delete cascade,
  scene_id text not null,
  cell_kind text not null,
  cell_id text not null,
  version bigint not null default 0,
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  primary key (project_id, scene_id, cell_kind, cell_id),
  foreign key (project_id, scene_id)
    references public.scenes(project_id, scene_id)
    on delete cascade
);

create index if not exists scene_cell_versions_project_scene_idx
  on public.scene_cell_versions(project_id, scene_id);

alter table public.scene_cell_versions enable row level security;

drop policy if exists "project members can read scene cell versions"
on public.scene_cell_versions;

create policy "project members can read scene cell versions"
on public.scene_cell_versions for select
using (public.cloud_collab_is_member(project_id));

drop function if exists public.list_scene_cell_versions(uuid);
create or replace function public.list_scene_cell_versions(
  p_project_id uuid
)
returns table (
  scene_id text,
  cell_kind text,
  cell_id text,
  version bigint,
  updated_at timestamptz,
  updated_by uuid
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.cloud_collab_is_member(p_project_id) then
    return;
  end if;

  return query
  select
    v.scene_id,
    v.cell_kind,
    v.cell_id,
    v.version,
    v.updated_at,
    v.updated_by
  from public.scene_cell_versions v
  where v.project_id = p_project_id
  order by v.scene_id asc, v.cell_kind asc, v.cell_id asc;
end;
$$;

drop function if exists public.acquire_edit_lock(uuid, text, text, text);
create or replace function public.acquire_edit_lock(
  p_project_id uuid,
  p_target_type text,
  p_target_id text,
  p_lock_token text,
  p_holder_client_id text default null,
  p_lease_id uuid default null,
  p_operation_id uuid default null
)
returns table (
  success boolean,
  reason text,
  locked_by uuid,
  expires_at timestamptz,
  lease_id uuid,
  operation_id uuid,
  holder_client_id text
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
  v_cell_scene_id text;
  v_holder_client_id text := nullif(trim(coalesce(p_holder_client_id, '')), '');
  v_lease_id uuid := coalesce(p_lease_id, gen_random_uuid());
  v_operation_id uuid := coalesce(p_operation_id, gen_random_uuid());
begin
  if v_uid is null then
    return query select false, 'not_authenticated', null::uuid, null::timestamptz, null::uuid, null::uuid, null::text;
    return;
  end if;

  if p_target_type not in ('scene', 'project', 'scene_cell') then
    return query select false, 'invalid_target_type', null::uuid, null::timestamptz, null::uuid, null::uuid, null::text;
    return;
  end if;

  if coalesce(p_target_id, '') = '' or coalesce(p_lock_token, '') = '' then
    return query select false, 'invalid_request', null::uuid, null::timestamptz, null::uuid, null::uuid, null::text;
    return;
  end if;

  perform public.cloud_collab_cleanup_expired_locks(p_project_id);
  v_role := public.cloud_collab_current_role(p_project_id);

  if v_role is null then
    return query select false, 'not_project_member', null::uuid, null::timestamptz, null::uuid, null::uuid, null::text;
    return;
  end if;

  if p_target_type in ('scene', 'scene_cell') and v_role not in ('owner', 'editor') then
    return query select false, 'permission_denied', null::uuid, null::timestamptz, null::uuid, null::uuid, null::text;
    return;
  end if;

  if p_target_type = 'project' and v_role <> 'owner' then
    return query select false, 'owner_required', null::uuid, null::timestamptz, null::uuid, null::uuid, null::text;
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
      return query select false, 'project_lock_active', v_existing.locked_by, v_existing.expires_at, v_existing.lease_id, v_existing.operation_id, v_existing.holder_client_id;
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
      return query select false, 'scene_lock_active', v_existing.locked_by, v_existing.expires_at, v_existing.lease_id, v_existing.operation_id, v_existing.holder_client_id;
      return;
    end if;

    select *
    into v_existing
    from public.edit_locks
    where project_id = p_project_id
      and target_type = 'scene_cell'
      and public.cloud_collab_scene_cell_scene_id(target_id) = p_target_id
    limit 1;

    if found then
      return query select false, 'scene_cell_lock_active', v_existing.locked_by, v_existing.expires_at, v_existing.lease_id, v_existing.operation_id, v_existing.holder_client_id;
      return;
    end if;
  elsif p_target_type = 'scene_cell' then
    v_cell_scene_id := public.cloud_collab_scene_cell_scene_id(p_target_id);
    if coalesce(v_cell_scene_id, '') = '' then
      return query select false, 'invalid_target_id', null::uuid, null::timestamptz, null::uuid, null::uuid, null::text;
      return;
    end if;

    if not exists (
      select 1
      from public.scenes s
      where s.project_id = p_project_id
        and s.scene_id = v_cell_scene_id
    ) then
      return query select false, 'scene_not_found', null::uuid, null::timestamptz, null::uuid, null::uuid, null::text;
      return;
    end if;

    select *
    into v_existing
    from public.edit_locks
    where project_id = p_project_id
      and target_type = 'project'
    limit 1;

    if found then
      return query select false, 'project_lock_active', v_existing.locked_by, v_existing.expires_at, v_existing.lease_id, v_existing.operation_id, v_existing.holder_client_id;
      return;
    end if;

    select *
    into v_existing
    from public.edit_locks
    where project_id = p_project_id
      and target_type = 'scene'
      and target_id = v_cell_scene_id
    limit 1;

    if found then
      return query select false, 'scene_lock_active', v_existing.locked_by, v_existing.expires_at, v_existing.lease_id, v_existing.operation_id, v_existing.holder_client_id;
      return;
    end if;

    select *
    into v_existing
    from public.edit_locks
    where project_id = p_project_id
      and target_type = 'scene_cell'
      and target_id = p_target_id
    limit 1;

    if found then
      return query select false, 'scene_cell_lock_active', v_existing.locked_by, v_existing.expires_at, v_existing.lease_id, v_existing.operation_id, v_existing.holder_client_id;
      return;
    end if;
  else
    select *
    into v_existing
    from public.edit_locks
    where project_id = p_project_id
    limit 1;

    if found then
      return query select false, 'project_lock_wait_for_active_scene', v_existing.locked_by, v_existing.expires_at, v_existing.lease_id, v_existing.operation_id, v_existing.holder_client_id;
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
    expires_at,
    renewed_at,
    lease_id,
    operation_id,
    holder_client_id
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
    v_expires_at,
    now(),
    v_lease_id,
    v_operation_id,
    v_holder_client_id
  );

  perform public.cloud_collab_log(
    p_project_id,
    'lock_acquired',
    p_target_type,
    p_target_id,
    jsonb_build_object(
      'leaseId',
      v_lease_id,
      'operationId',
      v_operation_id,
      'holderClientId',
      v_holder_client_id,
      'expiresAt',
      v_expires_at
    )
  );

  return query select true, 'ok', v_uid, v_expires_at, v_lease_id, v_operation_id, v_holder_client_id;
end;
$$;

drop function if exists public.heartbeat_edit_lock(uuid, text, text, text, boolean);
create or replace function public.heartbeat_edit_lock(
  p_project_id uuid,
  p_target_type text,
  p_target_id text,
  p_lock_token text,
  p_has_activity boolean default false,
  p_lease_id uuid default null,
  p_operation_id uuid default null,
  p_holder_client_id text default null
)
returns table (
  success boolean,
  reason text,
  expires_at timestamptz,
  renewed_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_expires_at timestamptz := now() + interval '120 seconds';
  v_renewed_at timestamptz := now();
  v_holder_client_id text := nullif(trim(coalesce(p_holder_client_id, '')), '');
begin
  if auth.uid() is null then
    return query select false, 'not_authenticated', null::timestamptz, null::timestamptz;
    return;
  end if;

  update public.edit_locks l
  set
    last_heartbeat_at = v_renewed_at,
    last_activity_at = case when p_has_activity then v_renewed_at else l.last_activity_at end,
    expires_at = v_expires_at,
    renewed_at = v_renewed_at
  where l.project_id = p_project_id
    and l.target_type = p_target_type
    and l.target_id = p_target_id
    and l.locked_by = auth.uid()
    and l.lock_token_hash = public.cloud_collab_token_hash(p_lock_token)
    and l.expires_at > now()
    and l.last_heartbeat_at > now() - interval '120 seconds'
    and (p_lease_id is null or l.lease_id = p_lease_id)
    and (p_operation_id is null or l.operation_id = p_operation_id)
    and (v_holder_client_id is null or l.holder_client_id = v_holder_client_id);

  if not found then
    return query select false, 'lock_not_found_or_token_mismatch', null::timestamptz, null::timestamptz;
    return;
  end if;

  return query select true, 'ok', v_expires_at, v_renewed_at;
end;
$$;

drop function if exists public.release_edit_lock(uuid, text, text, text);
create or replace function public.release_edit_lock(
  p_project_id uuid,
  p_target_type text,
  p_target_id text,
  p_lock_token text,
  p_lease_id uuid default null,
  p_operation_id uuid default null,
  p_holder_client_id text default null
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
  v_holder_client_id text := nullif(trim(coalesce(p_holder_client_id, '')), '');
begin
  if auth.uid() is null then
    return query select false, 'not_authenticated';
    return;
  end if;

  delete from public.edit_locks
  where project_id = p_project_id
    and target_type = p_target_type
    and target_id = p_target_id
    and locked_by = auth.uid()
    and lock_token_hash = public.cloud_collab_token_hash(p_lock_token)
    and (p_lease_id is null or lease_id = p_lease_id)
    and (p_operation_id is null or operation_id = p_operation_id)
    and (v_holder_client_id is null or holder_client_id = v_holder_client_id);

  if not found then
    return query select false, 'lock_not_found_or_token_mismatch';
    return;
  end if;

  perform public.cloud_collab_log(
    p_project_id,
    'lock_released',
    p_target_type,
    p_target_id,
    jsonb_build_object(
      'leaseId',
      p_lease_id,
      'operationId',
      p_operation_id,
      'holderClientId',
      v_holder_client_id
    )
  );

  return query select true, 'ok';
end;
$$;

drop function if exists public.save_scene_cell_patch_with_lock(uuid, text, text, text, jsonb, text, integer, text);
create or replace function public.save_scene_cell_patch_with_lock(
  p_project_id uuid,
  p_scene_id text,
  p_patch_type text,
  p_cell_id text,
  p_value jsonb,
  p_lock_token text,
  p_schema_version integer default 1,
  p_summary text default null,
  p_expected_base_version bigint default null,
  p_lease_id uuid default null,
  p_operation_id uuid default null,
  p_holder_client_id text default null
)
returns table (
  success boolean,
  reason text,
  version integer,
  updated_at timestamptz,
  cell_version bigint,
  lease_id uuid,
  operation_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_current_version integer;
  v_current_data jsonb;
  v_next_data jsonb;
  v_next_version integer;
  v_updated_at timestamptz := now();
  v_lock public.edit_locks%rowtype;
  v_lock_target_id text;
  v_cell_id text;
  v_current_cell_version bigint;
  v_base_cell_version bigint;
  v_next_cell_version bigint;
  v_holder_client_id text := nullif(trim(coalesce(p_holder_client_id, '')), '');
begin
  if v_uid is null then
    return query select false, 'not_authenticated', null::integer, null::timestamptz, null::bigint, null::uuid, null::uuid;
    return;
  end if;

  perform public.cloud_collab_cleanup_expired_locks(p_project_id);

  if not public.cloud_collab_can_edit_scene(p_project_id) then
    return query select false, 'permission_denied', null::integer, null::timestamptz, null::bigint, null::uuid, null::uuid;
    return;
  end if;

  if p_patch_type not in (
    'member_position',
    'object_state',
    'member_visibility',
    'object_visibility',
    'object_assignment',
    'notes'
  ) then
    return query select false, 'invalid_patch_type', null::integer, null::timestamptz, null::bigint, null::uuid, null::uuid;
    return;
  end if;

  if p_patch_type <> 'notes' and coalesce(trim(p_cell_id), '') = '' then
    return query select false, 'invalid_cell_id', null::integer, null::timestamptz, null::bigint, null::uuid, null::uuid;
    return;
  end if;

  v_cell_id := case when p_patch_type = 'notes' then '_' else p_cell_id end;
  v_lock_target_id := public.cloud_collab_scene_cell_target_id(
    p_scene_id,
    p_patch_type,
    v_cell_id
  );

  select *
  into v_lock
  from public.edit_locks l
  where l.project_id = p_project_id
    and l.target_type = 'scene_cell'
    and l.target_id = v_lock_target_id
    and l.locked_by = v_uid
    and l.lock_token_hash = public.cloud_collab_token_hash(p_lock_token)
    and l.expires_at > now()
    and l.last_heartbeat_at > now() - interval '120 seconds'
    and (p_lease_id is null or l.lease_id = p_lease_id)
    and (p_operation_id is null or l.operation_id = p_operation_id)
    and (v_holder_client_id is null or l.holder_client_id = v_holder_client_id)
  for update;

  if not found then
    return query select false, 'lock_required', null::integer, null::timestamptz, null::bigint, null::uuid, null::uuid;
    return;
  end if;

  if not exists (
    select 1
    from public.scenes s
    where s.project_id = p_project_id
      and s.scene_id = p_scene_id
  ) then
    return query select false, 'scene_not_found', null::integer, null::timestamptz, null::bigint, v_lock.lease_id, v_lock.operation_id;
    return;
  end if;

  insert into public.scene_cell_versions (
    project_id,
    scene_id,
    cell_kind,
    cell_id,
    version,
    updated_by,
    updated_at
  )
  values (
    p_project_id,
    p_scene_id,
    p_patch_type,
    v_cell_id,
    0,
    null,
    now()
  )
  on conflict (project_id, scene_id, cell_kind, cell_id) do nothing;

  select v.version
  into v_current_cell_version
  from public.scene_cell_versions v
  where v.project_id = p_project_id
    and v.scene_id = p_scene_id
    and v.cell_kind = p_patch_type
    and v.cell_id = v_cell_id
  for update;

  v_base_cell_version := coalesce(p_expected_base_version, v_current_cell_version);

  if v_current_cell_version <> v_base_cell_version then
    perform public.cloud_collab_log(
      p_project_id,
      'save_conflict',
      'scene',
      p_scene_id,
      jsonb_build_object(
        'summary',
        p_summary,
        'patchType',
        p_patch_type,
        'cellId',
        case when p_patch_type = 'notes' then null else p_cell_id end,
        'cellLockTargetId',
        v_lock_target_id,
        'baseCellVersion',
        v_base_cell_version,
        'currentCellVersion',
        v_current_cell_version,
        'leaseId',
        v_lock.lease_id,
        'operationId',
        v_lock.operation_id,
        'holderClientId',
        v_lock.holder_client_id
      )
    );
    return query select false, 'version_conflict', null::integer, null::timestamptz, v_current_cell_version, v_lock.lease_id, v_lock.operation_id;
    return;
  end if;

  select s.version, s.data
  into v_current_version, v_current_data
  from public.scenes s
  where s.project_id = p_project_id
    and s.scene_id = p_scene_id
  for update;

  if not found then
    return query select false, 'scene_not_found', null::integer, null::timestamptz, v_current_cell_version, v_lock.lease_id, v_lock.operation_id;
    return;
  end if;

  v_next_data := coalesce(v_current_data, '{}'::jsonb);

  if p_patch_type = 'member_position' then
    v_next_data := jsonb_set(
      v_next_data,
      array['positions', p_cell_id],
      coalesce(p_value, 'null'::jsonb),
      true
    );
  elsif p_patch_type = 'object_state' then
    v_next_data := jsonb_set(
      v_next_data,
      array['objectStates', p_cell_id],
      coalesce(p_value, '{}'::jsonb),
      true
    );
  elsif p_patch_type = 'member_visibility' then
    v_next_data := jsonb_set(
      v_next_data,
      array['memberVisibility', p_cell_id],
      coalesce(p_value, 'true'::jsonb),
      true
    );
  elsif p_patch_type = 'object_visibility' then
    v_next_data := jsonb_set(
      v_next_data,
      array['objectStates', p_cell_id, 'visible'],
      coalesce(p_value, 'true'::jsonb),
      true
    );
  elsif p_patch_type = 'object_assignment' then
    v_next_data := jsonb_set(
      v_next_data,
      array['objectAssignments', p_cell_id],
      coalesce(p_value, '[]'::jsonb),
      true
    );
  else
    v_next_data := jsonb_set(
      v_next_data,
      array['notes'],
      to_jsonb(coalesce(p_value #>> '{}', '')),
      true
    );
  end if;

  v_next_version := v_current_version + 1;
  v_next_cell_version := v_current_cell_version + 1;

  update public.scenes s
  set
    data = v_next_data,
    version = v_next_version,
    schema_version = p_schema_version,
    updated_at = v_updated_at,
    updated_by = v_uid
  where s.project_id = p_project_id
    and s.scene_id = p_scene_id;

  update public.scene_cell_versions v
  set
    version = v_next_cell_version,
    updated_at = v_updated_at,
    updated_by = v_uid
  where v.project_id = p_project_id
    and v.scene_id = p_scene_id
    and v.cell_kind = p_patch_type
    and v.cell_id = v_cell_id;

  update public.edit_locks l
  set
    last_activity_at = now(),
    last_heartbeat_at = now(),
    expires_at = now() + interval '120 seconds',
    renewed_at = now()
  where l.project_id = p_project_id
    and l.target_type = 'scene_cell'
    and l.target_id = v_lock_target_id
    and l.locked_by = v_uid
    and l.lock_token_hash = public.cloud_collab_token_hash(p_lock_token)
    and l.lease_id = v_lock.lease_id
    and l.operation_id = v_lock.operation_id;

  perform public.cloud_collab_log(
    p_project_id,
    'save_success',
    'scene',
    p_scene_id,
    jsonb_build_object(
      'version',
      v_next_version,
      'summary',
      p_summary,
      'patchType',
      p_patch_type,
      'cellId',
      case when p_patch_type = 'notes' then null else p_cell_id end,
      'cellLockTargetId',
      v_lock_target_id,
      'patchValue',
      p_value,
      'baseCellVersion',
      v_base_cell_version,
      'cellVersion',
      v_next_cell_version,
      'leaseId',
      v_lock.lease_id,
      'operationId',
      v_lock.operation_id,
      'holderClientId',
      v_lock.holder_client_id
    )
  );

  update public.projects
  set updated_at = v_updated_at
  where id = p_project_id;

  return query select true, 'ok', v_next_version, v_updated_at, v_next_cell_version, v_lock.lease_id, v_lock.operation_id;
end;
$$;
