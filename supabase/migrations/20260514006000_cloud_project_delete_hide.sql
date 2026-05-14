alter table public.project_members
add column if not exists hidden_at timestamptz;

create or replace function public.hide_cloud_project(
  p_project_id uuid
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

  update public.project_members pm
  set hidden_at = now()
  where pm.project_id = p_project_id
    and pm.user_id = auth.uid();

  if not found then
    return query select false, 'not_project_member';
    return;
  end if;

  perform public.cloud_collab_log(
    p_project_id,
    'project_hidden',
    'project',
    p_project_id::text
  );

  return query select true, 'ok';
end;
$$;

create or replace function public.delete_cloud_project(
  p_project_id uuid
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

  perform public.cloud_collab_cleanup_expired_locks(p_project_id);

  if not public.cloud_collab_is_owner(p_project_id) then
    return query select false, 'owner_required';
    return;
  end if;

  if not exists (
    select 1
    from public.projects p
    where p.id = p_project_id
      and p.deleted_at is null
  ) then
    return query select false, 'project_not_found';
    return;
  end if;

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
    'before_project_delete',
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
    'before_project_delete',
    auth.uid()
  from public.scenes s
  where s.project_id = p_project_id;

  delete from public.edit_locks l
  where l.project_id = p_project_id;

  update public.projects p
  set deleted_at = now(),
      updated_at = now()
  where p.id = p_project_id
    and p.deleted_at is null;

  perform public.cloud_collab_log(
    p_project_id,
    'project_deleted',
    'project',
    p_project_id::text
  );

  return query select true, 'ok';
end;
$$;
