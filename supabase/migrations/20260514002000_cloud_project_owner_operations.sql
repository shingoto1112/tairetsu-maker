-- Owner-only project operations for lock-based collaboration.
-- Adds atomic sceneOrder save with scene create/delete and full cloud import.

create or replace function public.save_scene_order_with_lock(
  p_project_id uuid,
  p_base_version integer,
  p_data jsonb,
  p_new_scenes jsonb default '[]'::jsonb,
  p_deleted_scene_ids text[] default array[]::text[],
  p_lock_token text default '',
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
  v_current_data jsonb;
  v_current_version integer;
  v_deleted_scene_id text;
  v_next_version integer;
  v_scene jsonb;
  v_scene_id text;
  v_scene_schema_version integer;
  v_scene_version integer;
  v_updated_at timestamptz := now();
begin
  if auth.uid() is null then
    return query select false, 'not_authenticated', null::integer, null::timestamptz;
    return;
  end if;

  perform public.cloud_collab_cleanup_expired_locks(p_project_id);

  if not public.cloud_collab_is_owner(p_project_id) then
    return query select false, 'owner_required', null::integer, null::timestamptz;
    return;
  end if;

  if not public.cloud_collab_verify_lock(p_project_id, 'project', 'sceneOrder', p_lock_token) then
    return query select false, 'lock_required', null::integer, null::timestamptz;
    return;
  end if;

  if coalesce(jsonb_typeof(p_data), 'null') <> 'object' then
    return query select false, 'invalid_scene_order_data', null::integer, null::timestamptz;
    return;
  end if;

  if coalesce(jsonb_typeof(p_new_scenes), 'array') <> 'array' then
    return query select false, 'new_scenes_must_be_array', null::integer, null::timestamptz;
    return;
  end if;

  select r.version, r.data
  into v_current_version, v_current_data
  from public.project_resources r
  where r.project_id = p_project_id
    and r.resource_key = 'sceneOrder'
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
      'sceneOrder',
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

  for v_scene in
    select value from jsonb_array_elements(p_new_scenes)
  loop
    if coalesce(v_scene ->> 'sceneId', '') = '' then
      return query select false, 'scene_id_required', null::integer, null::timestamptz;
      return;
    end if;
  end loop;

  if coalesce(array_length(p_deleted_scene_ids, 1), 0) > 0 then
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
      'sceneOrder',
      v_current_version,
      p_schema_version,
      coalesce(v_current_data, '{}'::jsonb),
      'before_scene_delete',
      auth.uid()
    );
  end if;

  foreach v_deleted_scene_id in array coalesce(p_deleted_scene_ids, array[]::text[]) loop
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
    select
      s.project_id,
      'scene',
      s.scene_id,
      s.version,
      s.schema_version,
      s.data,
      'before_delete',
      auth.uid()
    from public.scenes s
    where s.project_id = p_project_id
      and s.scene_id = v_deleted_scene_id;

    delete from public.scenes s
    where s.project_id = p_project_id
      and s.scene_id = v_deleted_scene_id;
  end loop;

  for v_scene in
    select value from jsonb_array_elements(p_new_scenes)
  loop
    v_scene_id := v_scene ->> 'sceneId';
    if coalesce(v_scene_id, '') = '' then
      return query select false, 'scene_id_required', null::integer, null::timestamptz;
      return;
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
      p_project_id,
      v_scene_id,
      coalesce(v_scene -> 'data', '{}'::jsonb),
      v_scene_version,
      v_scene_schema_version,
      now(),
      v_updated_at,
      auth.uid()
    )
    on conflict (project_id, scene_id) do nothing;

    if found then
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
        v_scene_id,
        v_scene_version,
        v_scene_schema_version,
        coalesce(v_scene -> 'data', '{}'::jsonb),
        'scene_added',
        auth.uid()
      );
    end if;
  end loop;

  v_next_version := v_current_version + 1;

  update public.project_resources r
  set
    data = p_data,
    version = v_next_version,
    schema_version = p_schema_version,
    updated_at = v_updated_at,
    updated_by = auth.uid()
  where r.project_id = p_project_id
    and r.resource_key = 'sceneOrder';

  update public.edit_locks l
  set last_activity_at = now(),
      last_heartbeat_at = now(),
      expires_at = now() + interval '120 seconds'
  where l.project_id = p_project_id
    and l.target_type = 'project'
    and l.target_id = 'sceneOrder'
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
    'sceneOrder',
    v_next_version,
    p_schema_version,
    p_data,
    'save_success',
    auth.uid()
  );

  perform public.cloud_collab_prune_snapshots(p_project_id, 'project', 'sceneOrder');
  perform public.cloud_collab_log(
    p_project_id,
    'save_success',
    'project',
    'sceneOrder',
    jsonb_build_object(
      'version',
      v_next_version,
      'summary',
      p_summary,
      'newSceneCount',
      jsonb_array_length(p_new_scenes),
      'deletedSceneCount',
      coalesce(array_length(p_deleted_scene_ids, 1), 0)
    )
  );

  update public.projects
  set updated_at = v_updated_at
  where id = p_project_id;

  return query select true, 'ok', v_next_version, v_updated_at;
end;
$$;

create or replace function public.import_cloud_project_with_lock(
  p_project_id uuid,
  p_title text,
  p_mode text,
  p_schema_version integer,
  p_resources jsonb,
  p_scenes jsonb,
  p_lock_token text,
  p_summary text default null
)
returns table (
  success boolean,
  reason text,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_required_key text;
  v_required_resource_keys text[] := array[
    'members',
    'objects',
    'settings',
    'audio',
    'sceneOrder'
  ];
  v_resource jsonb;
  v_resource_key text;
  v_resource_schema_version integer;
  v_resource_version integer;
  v_scene jsonb;
  v_scene_id text;
  v_scene_schema_version integer;
  v_scene_version integer;
  v_updated_at timestamptz := now();
begin
  if auth.uid() is null then
    return query select false, 'not_authenticated', null::timestamptz;
    return;
  end if;

  perform public.cloud_collab_cleanup_expired_locks(p_project_id);

  if not public.cloud_collab_is_owner(p_project_id) then
    return query select false, 'owner_required', null::timestamptz;
    return;
  end if;

  if not public.cloud_collab_verify_lock(p_project_id, 'project', 'import', p_lock_token) then
    return query select false, 'lock_required', null::timestamptz;
    return;
  end if;

  if p_mode not in ('stage', 'parade') then
    return query select false, 'invalid_mode', null::timestamptz;
    return;
  end if;

  if coalesce(trim(p_title), '') = '' then
    return query select false, 'title_required', null::timestamptz;
    return;
  end if;

  if coalesce(jsonb_typeof(p_resources), 'null') <> 'array' then
    return query select false, 'resources_must_be_array', null::timestamptz;
    return;
  end if;

  if coalesce(jsonb_typeof(p_scenes), 'null') <> 'array' then
    return query select false, 'scenes_must_be_array', null::timestamptz;
    return;
  end if;

  if jsonb_array_length(p_scenes) = 0 then
    return query select false, 'at_least_one_scene_required', null::timestamptz;
    return;
  end if;

  for v_resource in
    select value from jsonb_array_elements(p_resources)
  loop
    v_resource_key := v_resource ->> 'resourceKey';
    if v_resource_key not in ('members', 'objects', 'settings', 'audio', 'sceneOrder') then
      return query select false, 'invalid_resource_key', null::timestamptz;
      return;
    end if;
  end loop;

  foreach v_required_key in array v_required_resource_keys loop
    if not exists (
      select 1
      from jsonb_array_elements(p_resources) resource_item
      where resource_item.value ->> 'resourceKey' = v_required_key
    ) then
      return query select false, 'missing_required_resource', null::timestamptz;
      return;
    end if;
  end loop;

  for v_scene in
    select value from jsonb_array_elements(p_scenes)
  loop
    if coalesce(v_scene ->> 'sceneId', '') = '' then
      return query select false, 'scene_id_required', null::timestamptz;
      return;
    end if;
  end loop;

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
  select
    pr.project_id,
    'project',
    pr.resource_key,
    pr.version,
    pr.schema_version,
    pr.data,
    'before_import',
    auth.uid()
  from public.project_resources pr
  where pr.project_id = p_project_id;

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
  select
    s.project_id,
    'scene',
    s.scene_id,
    s.version,
    s.schema_version,
    s.data,
    'before_import',
    auth.uid()
  from public.scenes s
  where s.project_id = p_project_id;

  update public.projects
  set
    title = trim(p_title),
    mode = p_mode,
    schema_version = coalesce(p_schema_version, 1),
    updated_at = v_updated_at
  where id = p_project_id;

  delete from public.project_resources pr
  where pr.project_id = p_project_id;

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
      p_project_id,
      v_resource_key,
      coalesce(v_resource -> 'data', '{}'::jsonb),
      v_resource_version,
      v_resource_schema_version,
      v_updated_at,
      auth.uid()
    );
  end loop;

  delete from public.scenes s
  where s.project_id = p_project_id;

  for v_scene in
    select value from jsonb_array_elements(p_scenes)
  loop
    v_scene_id := v_scene ->> 'sceneId';
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
      p_project_id,
      v_scene_id,
      coalesce(v_scene -> 'data', '{}'::jsonb),
      v_scene_version,
      v_scene_schema_version,
      now(),
      v_updated_at,
      auth.uid()
    );
  end loop;

  delete from public.edit_locks l
  where l.project_id = p_project_id
    and l.target_type = 'project'
    and l.target_id = 'import'
    and l.locked_by = auth.uid()
    and l.lock_token_hash = public.cloud_collab_token_hash(p_lock_token);

  perform public.cloud_collab_log(
    p_project_id,
    'cloud_import_success',
    'project',
    'import',
    jsonb_build_object(
      'summary',
      p_summary,
      'resourceCount',
      jsonb_array_length(p_resources),
      'sceneCount',
      jsonb_array_length(p_scenes)
    )
  );

  foreach v_required_key in array v_required_resource_keys loop
    perform public.cloud_collab_prune_snapshots(p_project_id, 'project', v_required_key);
  end loop;

  return query select true, 'ok', v_updated_at;
end;
$$;
