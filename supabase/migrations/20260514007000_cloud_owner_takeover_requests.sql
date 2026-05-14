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

  if p_target_type not in ('scene', 'project') then
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
