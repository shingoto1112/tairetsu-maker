-- Scene cell locks and patch saves for same-scene collaboration.
-- This keeps the existing scene/project lock system but lets supported scene
-- fields be edited independently by member/object target.

alter table public.edit_locks
  drop constraint if exists edit_locks_target_type_check;

alter table public.edit_locks
  add constraint edit_locks_target_type_check
  check (target_type in ('scene', 'project', 'scene_cell'));

create or replace function public.cloud_collab_scene_cell_scene_id(
  p_target_id text
)
returns text
language sql
immutable
as $$
  select nullif(split_part(coalesce(p_target_id, ''), '|', 1), '')
$$;

create or replace function public.cloud_collab_scene_cell_target_id(
  p_scene_id text,
  p_patch_type text,
  p_cell_id text
)
returns text
language sql
immutable
as $$
  select concat_ws('|', p_scene_id, p_patch_type, coalesce(nullif(p_cell_id, ''), '_'))
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
  v_cell_scene_id text;
begin
  if v_uid is null then
    return query select false, 'not_authenticated', null::uuid, null::timestamptz;
    return;
  end if;

  if p_target_type not in ('scene', 'project', 'scene_cell') then
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

  if p_target_type in ('scene', 'scene_cell') and v_role not in ('owner', 'editor') then
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

    select *
    into v_existing
    from public.edit_locks
    where project_id = p_project_id
      and target_type = 'scene_cell'
      and public.cloud_collab_scene_cell_scene_id(target_id) = p_target_id
    limit 1;

    if found then
      return query select false, 'scene_cell_lock_active', v_existing.locked_by, v_existing.expires_at;
      return;
    end if;
  elsif p_target_type = 'scene_cell' then
    v_cell_scene_id := public.cloud_collab_scene_cell_scene_id(p_target_id);
    if coalesce(v_cell_scene_id, '') = '' then
      return query select false, 'invalid_target_id', null::uuid, null::timestamptz;
      return;
    end if;

    if not exists (
      select 1
      from public.scenes s
      where s.project_id = p_project_id
        and s.scene_id = v_cell_scene_id
    ) then
      return query select false, 'scene_not_found', null::uuid, null::timestamptz;
      return;
    end if;

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
      and target_id = v_cell_scene_id
    limit 1;

    if found then
      return query select false, 'scene_lock_active', v_existing.locked_by, v_existing.expires_at;
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
      return query select false, 'scene_cell_lock_active', v_existing.locked_by, v_existing.expires_at;
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

create or replace function public.request_lock_takeover(
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
  if auth.uid() is null then
    return query select false, 'not_authenticated';
    return;
  end if;

  if not public.cloud_collab_is_owner(p_project_id) then
    return query select false, 'owner_required';
    return;
  end if;

  if p_target_type not in ('scene', 'project', 'scene_cell') then
    return query select false, 'invalid_target_type';
    return;
  end if;

  if coalesce(trim(p_target_id), '') = '' then
    return query select false, 'invalid_target_id';
    return;
  end if;

  perform public.cloud_collab_log(
    p_project_id,
    'lock_takeover_requested',
    p_target_type,
    p_target_id,
    jsonb_build_object('requestId', gen_random_uuid()::text)
  );

  return query select true, 'ok';
end;
$$;

create or replace function public.save_scene_cell_patch_with_lock(
  p_project_id uuid,
  p_scene_id text,
  p_patch_type text,
  p_cell_id text,
  p_value jsonb,
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
  v_uid uuid := auth.uid();
  v_current_version integer;
  v_current_data jsonb;
  v_next_data jsonb;
  v_next_version integer;
  v_updated_at timestamptz := now();
  v_lock_target_id text;
begin
  if v_uid is null then
    return query select false, 'not_authenticated', null::integer, null::timestamptz;
    return;
  end if;

  perform public.cloud_collab_cleanup_expired_locks(p_project_id);

  if not public.cloud_collab_can_edit_scene(p_project_id) then
    return query select false, 'permission_denied', null::integer, null::timestamptz;
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
    return query select false, 'invalid_patch_type', null::integer, null::timestamptz;
    return;
  end if;

  if p_patch_type <> 'notes' and coalesce(trim(p_cell_id), '') = '' then
    return query select false, 'invalid_cell_id', null::integer, null::timestamptz;
    return;
  end if;

  v_lock_target_id := public.cloud_collab_scene_cell_target_id(
    p_scene_id,
    p_patch_type,
    case when p_patch_type = 'notes' then '_' else p_cell_id end
  );

  if not public.cloud_collab_verify_lock(
    p_project_id,
    'scene_cell',
    v_lock_target_id,
    p_lock_token
  ) then
    return query select false, 'lock_required', null::integer, null::timestamptz;
    return;
  end if;

  select s.version, s.data
  into v_current_version, v_current_data
  from public.scenes s
  where s.project_id = p_project_id
    and s.scene_id = p_scene_id
  for update;

  if not found then
    return query select false, 'scene_not_found', null::integer, null::timestamptz;
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

  update public.scenes s
  set
    data = v_next_data,
    version = v_next_version,
    schema_version = p_schema_version,
    updated_at = v_updated_at,
    updated_by = auth.uid()
  where s.project_id = p_project_id
    and s.scene_id = p_scene_id;

  update public.edit_locks l
  set
    last_activity_at = now(),
    last_heartbeat_at = now(),
    expires_at = now() + interval '120 seconds'
  where l.project_id = p_project_id
    and l.target_type = 'scene_cell'
    and l.target_id = v_lock_target_id
    and l.locked_by = auth.uid()
    and l.lock_token_hash = public.cloud_collab_token_hash(p_lock_token);

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
      p_value
    )
  );

  update public.projects
  set updated_at = v_updated_at
  where id = p_project_id;

  return query select true, 'ok', v_next_version, v_updated_at;
end;
$$;
