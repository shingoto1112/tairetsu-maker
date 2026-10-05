-- 11b: additive rescue-list metadata. Body/export v1 and authorization unchanged.
-- Required because 11a did not distinguish hidden owner documents or expose deadline.
begin;
create or replace function public.legacy_list_owned_projects(
  p_limit integer default 20, p_before_created_at timestamptz default null,
  p_before_project_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  v_uid uuid := legacy_cloud_private.require_export_account();
  v_result jsonb;
begin
  if p_limit is null or p_limit<1 or p_limit>50
    or (p_before_created_at is null)<>(p_before_project_id is null)
    or (p_before_created_at is not null and not isfinite(p_before_created_at)) then
    raise exception using errcode='22023', message='INVALID_ARGUMENT';
  end if;
  with page as materialized (
    select p.id,p.created_at,left(p.title,256) as title,p.mode,p.schema_version,
      m.hidden_at is not null as hidden
    from public.projects p
    join public.project_members m on m.project_id=p.id and m.user_id=v_uid and m.role='owner'
    where p.deleted_at is null and (p_before_created_at is null
      or (p.created_at,p.id)<(p_before_created_at,p_before_project_id))
    order by p.created_at desc,p.id desc limit p_limit+1
  ), visible as (select * from page order by created_at desc,id desc limit p_limit)
  select jsonb_build_object('contractVersion',1,
    'exportUntil',(select s.export_until from legacy_cloud_private.shutdown_settings s where s.singleton),
    'items',coalesce((select jsonb_agg(jsonb_build_object('projectId',id,'title',title,
      'mode',mode,'schemaVersion',schema_version,'createdAt',created_at,'hidden',hidden)
      order by created_at desc,id desc) from visible),'[]'::jsonb),
    'nextCursor',case when (select count(*) from page)>p_limit then
      (select jsonb_build_object('createdAt',created_at,'projectId',id)
       from visible order by created_at asc,id asc limit 1) else null end)
  into v_result;
  return v_result;
end $$;
revoke all on function public.legacy_list_owned_projects(integer,timestamptz,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.legacy_list_owned_projects(integer,timestamptz,uuid) to authenticated;
commit;
