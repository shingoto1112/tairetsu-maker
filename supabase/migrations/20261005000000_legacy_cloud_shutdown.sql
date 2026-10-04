-- 11a: retain legacy data, close the client surface, allow owner-only rescue.
-- Requires the 11 legacy migrations. Independent of the v2 foundation.
begin;
set local search_path = '';

do $$
declare
  v_names text[] := array['projects','project_members','project_resources','scenes',
    'edit_locks','snapshots','audit_logs','project_invites','scene_cell_versions',
    'user_contacts','profiles'];
  v_roots oid[];
  v_rel record;
  v_column record;
  v_signature text;
  v_function regprocedure;
  v_role text;
  v_table_privileges text := 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER';
begin
  if current_setting('server_version_num')::integer>=170000 then
    v_table_privileges := v_table_privileges||',MAINTAIN';
  end if;
  select array_agg(c.oid) into v_roots from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relname=any(v_names) and c.relkind='r';
  if cardinality(v_roots) is distinct from 11 then
    raise exception 'LEGACY_INVENTORY_MISMATCH';
  end if;
  -- Enumerated roots plus catalog-proven dependent views (including view chains)
  -- and owned serial/identity sequences. No public-schema-wide REVOKE.
  for v_rel in
    with recursive targets(oid) as (
      select unnest(v_roots)
      union
      select r.ev_class from targets t
      join pg_catalog.pg_depend d on d.refobjid=t.oid
        and d.refclassid='pg_catalog.pg_class'::regclass
        and d.classid='pg_catalog.pg_rewrite'::regclass
      join pg_catalog.pg_rewrite r on r.oid=d.objid
      join pg_catalog.pg_class c on c.oid=r.ev_class and c.relkind in ('v','m')
    ), all_targets as (
      select oid from targets
      union
      select d.objid from pg_catalog.pg_depend d
      where d.refclassid='pg_catalog.pg_class'::regclass and d.refobjid=any(v_roots)
        and d.classid='pg_catalog.pg_class'::regclass and d.deptype in ('a','i')
    )
    select c.oid,c.relkind,n.nspname,c.relname from all_targets t
    join pg_catalog.pg_class c on c.oid=t.oid and c.relkind in ('r','v','m','S')
    join pg_catalog.pg_namespace n on n.oid=c.relnamespace
  loop
    if v_rel.relname like 'collab_v2_%' or v_rel.nspname like 'collab_v2_%' then
      raise exception 'LEGACY_DEPENDENCY_TOUCHES_V2';
    end if;
    if v_rel.relkind='S' then
      execute format('revoke all privileges on sequence %I.%I from public, anon, authenticated',v_rel.nspname,v_rel.relname);
    else
      execute format('revoke all privileges on table %I.%I from public, anon, authenticated',v_rel.nspname,v_rel.relname);
      -- Table REVOKE does not remove independently granted column privileges.
      for v_column in select attname from pg_catalog.pg_attribute
        where attrelid=v_rel.oid and attnum>0 and not attisdropped
      loop
        execute format('revoke all privileges (%I) on table %I.%I from public, anon, authenticated',v_column.attname,v_rel.nspname,v_rel.relname);
      end loop;
    end if;
    -- Fail closed on inherited/custom grants rather than editing unrelated roles.
    foreach v_role in array array['anon','authenticated'] loop
      if v_rel.relkind='S' then
        if pg_catalog.has_sequence_privilege(v_role,v_rel.oid,'USAGE,SELECT,UPDATE') then
          raise exception 'LEGACY_INHERITED_SEQUENCE_GRANT: %',v_rel.relname;
        end if;
      elsif pg_catalog.has_table_privilege(v_role,v_rel.oid,v_table_privileges)
        or pg_catalog.has_any_column_privilege(v_role,v_rel.oid,'SELECT,INSERT,UPDATE,REFERENCES') then
        raise exception 'LEGACY_INHERITED_TABLE_GRANT: %',v_rel.relname;
      end if;
    end loop;
  end loop;

  -- Historical and current signatures are explicit; absent old overloads are OK.
  foreach v_signature in array array[
    'public.accept_project_invite(text)',
    'public.acquire_edit_lock(uuid,text,text,text)',
    'public.acquire_edit_lock(uuid,text,text,text,text,uuid,uuid)',
    'public.add_contact_by_email(text)',
    'public.add_project_member_from_contact(uuid,uuid,text)',
    'public.add_project_member_to_contacts(uuid,uuid)',
    'public.cloud_collab_can_edit_scene(uuid)',
    'public.cloud_collab_cleanup_expired_locks(uuid)',
    'public.cloud_collab_current_display_name()',
    'public.cloud_collab_current_email()',
    'public.cloud_collab_current_role(uuid)',
    'public.cloud_collab_display_name_for_user(uuid)',
    'public.cloud_collab_is_member(uuid)',
    'public.cloud_collab_is_owner(uuid)',
    'public.cloud_collab_log(uuid,text,text,text,jsonb)',
    'public.cloud_collab_normalized_display_name(text)',
    'public.cloud_collab_prune_snapshots(uuid,text,text)',
    'public.cloud_collab_scene_cell_scene_id(text)',
    'public.cloud_collab_scene_cell_target_id(text,text,text)',
    'public.cloud_collab_token_hash(text)',
    'public.cloud_collab_user_metadata_display_name(jsonb)',
    'public.cloud_collab_verify_lock(uuid,text,text,text)',
    'public.create_cloud_project(text,text,integer,text,jsonb,jsonb)',
    'public.create_project_invite(uuid,text,text,text)',
    'public.delete_cloud_project(uuid)',
    'public.force_release_edit_lock(uuid,text,text)',
    'public.handle_auth_user_profile()',
    'public.handle_project_member_display_name()',
    'public.heartbeat_edit_lock(uuid,text,text,text,boolean)',
    'public.heartbeat_edit_lock(uuid,text,text,text,boolean,uuid,uuid,text)',
    'public.hide_cloud_project(uuid)',
    'public.import_cloud_project_with_lock(uuid,text,text,integer,jsonb,jsonb,text,text)',
    'public.list_project_collaboration(uuid)',
    'public.list_scene_cell_versions(uuid)',
    'public.list_user_contacts()',
    'public.release_edit_lock(uuid,text,text,text)',
    'public.release_edit_lock(uuid,text,text,text,uuid,uuid,text)',
    'public.remove_project_member(uuid,uuid)',
    'public.request_lock_takeover(uuid,text,text)',
    'public.revoke_project_invite(uuid,uuid)',
    'public.save_project_resource_with_lock(uuid,text,integer,jsonb,text,integer,text)',
    'public.save_scene_cell_patch_with_lock(uuid,text,text,text,jsonb,text,integer,text)',
    'public.save_scene_cell_patch_with_lock(uuid,text,text,text,jsonb,text,integer,text,bigint,uuid,uuid,text)',
    'public.save_scene_order_with_lock(uuid,integer,jsonb,jsonb,text[],text,integer,text)',
    'public.save_scene_with_lock(uuid,text,integer,jsonb,text,integer,text)',
    'public.update_project_member_role(uuid,uuid,text)'
  ] loop
    v_function := pg_catalog.to_regprocedure(v_signature);
    if v_function is not null then
      execute format('revoke all privileges on function %s from public, anon, authenticated',v_function);
      if pg_catalog.has_function_privilege('anon',v_function,'EXECUTE')
        or pg_catalog.has_function_privilege('authenticated',v_function,'EXECUTE') then
        raise exception 'LEGACY_INHERITED_FUNCTION_GRANT: %',v_signature;
      end if;
    end if;
  end loop;

  -- FOR ALL TABLES / schema publications cannot exclude individual legacy tables.
  if exists(select 1 from pg_catalog.pg_publication where pubname='supabase_realtime' and puballtables)
    or exists(select 1 from pg_catalog.pg_publication_namespace pn
      join pg_catalog.pg_publication p on p.oid=pn.pnpubid
      join pg_catalog.pg_namespace n on n.oid=pn.pnnspid
      where p.pubname='supabase_realtime' and n.nspname='public') then
    raise exception 'LEGACY_PUBLICATION_REQUIRES_EXPLICIT_TABLES';
  end if;
  for v_rel in select pt.schemaname,pt.tablename from pg_catalog.pg_publication_tables pt
    where pt.pubname='supabase_realtime' and pt.schemaname='public' and pt.tablename=any(v_names)
  loop
    execute format('alter publication supabase_realtime drop table %I.%I',v_rel.schemaname,v_rel.tablename);
  end loop;
end $$;

-- Avoid legacy profile creation for new v2 guests. Retain functions and rows.
drop trigger if exists on_auth_user_created_profile on auth.users;

-- Fence both requested channel and row topic, all extensions (Broadcast/Presence).
-- Supabase owns this table; do not ALTER TABLE or create helpers in realtime.
drop policy if exists legacy_cloud_topic_shutdown on realtime.messages;
create policy legacy_cloud_topic_shutdown on realtime.messages
as restrictive for all to anon, authenticated
using (coalesce((select realtime.topic()),'') not like 'cloud-project:%'
  and coalesce(topic,'') not like 'cloud-project:%')
with check (coalesce((select realtime.topic()),'') not like 'cloud-project:%'
  and coalesce(topic,'') not like 'cloud-project:%');

create schema if not exists legacy_cloud_private;
revoke all on schema legacy_cloud_private from public, anon, authenticated, service_role;
create table if not exists legacy_cloud_private.shutdown_settings (
  singleton boolean primary key default true check (singleton),
  cutover_at timestamptz not null default clock_timestamp() check (isfinite(cutover_at)),
  export_until timestamptz not null default (clock_timestamp()+interval '30 days') check (isfinite(export_until)),
  check (export_until>=cutover_at)
);
alter table legacy_cloud_private.shutdown_settings enable row level security;
revoke all on table legacy_cloud_private.shutdown_settings from public, anon, authenticated, service_role;
insert into legacy_cloud_private.shutdown_settings(singleton) values(true) on conflict do nothing;

-- INVOKER helper accessible only internally under the endpoint's definer role.
create or replace function legacy_cloud_private.require_export_account()
returns uuid language plpgsql stable security invoker set search_path = ''
as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null or not exists(select 1 from auth.users u where u.id=v_uid and u.is_anonymous is false) then
    raise exception using errcode='42501', message='PERMANENT_ACCOUNT_REQUIRED';
  end if;
  if not exists(select 1 from legacy_cloud_private.shutdown_settings s
    where s.singleton and clock_timestamp()<s.export_until) then
    raise exception using errcode='42501', message='LEGACY_EXPORT_EXPIRED';
  end if;
  return v_uid;
end $$;
revoke all on function legacy_cloud_private.require_export_account() from public, anon, authenticated, service_role;

create or replace function public.legacy_list_owned_projects(
  p_limit integer default 20, p_before_created_at timestamptz default null, p_before_project_id uuid default null
)
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
    select p.id,p.created_at,left(p.title,256) as title,p.mode,p.schema_version
    from public.projects p
    join public.project_members m on m.project_id=p.id and m.user_id=v_uid and m.role='owner'
    where p.deleted_at is null and (p_before_created_at is null
      or (p.created_at,p.id)<(p_before_created_at,p_before_project_id))
    order by p.created_at desc,p.id desc limit p_limit+1
  ), visible as (select * from page order by created_at desc,id desc limit p_limit)
  select jsonb_build_object('contractVersion',1,
    'items',coalesce((select jsonb_agg(jsonb_build_object('projectId',id,'title',title,
      'mode',mode,'schemaVersion',schema_version,'createdAt',created_at)
      order by created_at desc,id desc) from visible),'[]'::jsonb),
    'nextCursor',case when (select count(*) from page)>p_limit then
      (select jsonb_build_object('createdAt',created_at,'projectId',id)
       from visible order by created_at asc,id asc limit 1) else null end)
  into v_result;
  return v_result;
end $$;

-- STABLE queries share the calling statement's MVCC snapshot, including auth,
-- ownership, size preflight and all content. No old authorization helpers/locks.
create or replace function public.legacy_export_project(p_project_id uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  v_uid uuid := legacy_cloud_private.require_export_account();
  v_project jsonb;
  v_result jsonb;
  v_bytes bigint;
begin
  select jsonb_build_object('id',p.id,'title',p.title,'mode',p.mode,
    'schema_version',p.schema_version,'legacy_project_id',p.legacy_project_id,
    'created_at',p.created_at,'updated_at',p.updated_at)
  into v_project from public.projects p
  join public.project_members m on m.project_id=p.id and m.user_id=v_uid and m.role='owner'
  where p.id=p_project_id and p.deleted_at is null;
  if v_project is null then
    raise exception using errcode='42501', message='LEGACY_PROJECT_UNAVAILABLE';
  end if;
  if (select count(*) from public.project_resources r where r.project_id=p_project_id)<>5 then
    raise exception using errcode='22023', message='LEGACY_EXPORT_INCOMPLETE';
  end if;
  -- Reject oversized source before constructing the aggregate response. The
  -- final exact UTF-8 JSONB text size check also covers keys/metadata/escaping.
  select octet_length(v_project::text)::bigint
    +coalesce((select sum(octet_length(jsonb_build_object('resource_key',r.resource_key,
      'data',r.data,'version',r.version,'schema_version',r.schema_version)::text)::bigint)
      from public.project_resources r where r.project_id=p_project_id),0)
    +coalesce((select sum(octet_length(jsonb_build_object('scene_id',s.scene_id,
      'data',s.data,'version',s.version,'schema_version',s.schema_version)::text)::bigint)
      from public.scenes s where s.project_id=p_project_id),0)
  into v_bytes;
  if v_bytes>8388608 then
    raise exception using errcode='54000', message='LEGACY_EXPORT_TOO_LARGE';
  end if;
  select jsonb_build_object('contractVersion',1,'project',v_project,
    'resources',(select jsonb_agg(jsonb_build_object('resource_key',r.resource_key,
      'data',r.data,'version',r.version,'schema_version',r.schema_version)
      order by r.resource_key) from public.project_resources r where r.project_id=p_project_id),
    'scenes',coalesce((select jsonb_agg(jsonb_build_object('scene_id',s.scene_id,
      'data',s.data,'version',s.version,'schema_version',s.schema_version)
      order by s.scene_id) from public.scenes s where s.project_id=p_project_id),'[]'::jsonb))
  into v_result;
  if octet_length(v_result::text)>8388608 then
    raise exception using errcode='54000', message='LEGACY_EXPORT_TOO_LARGE';
  end if;
  return v_result;
end $$;

revoke all on function public.legacy_list_owned_projects(integer,timestamptz,uuid),
  public.legacy_export_project(uuid) from public, anon, authenticated, service_role;
grant execute on function public.legacy_list_owned_projects(integer,timestamptz,uuid),
  public.legacy_export_project(uuid) to authenticated;

-- Keyset rescue remains bounded in work for an established legacy archive.
create index if not exists legacy_owned_projects_cursor_idx
  on public.projects(created_at desc,id desc) where deleted_at is null;
create index if not exists legacy_owner_membership_idx
  on public.project_members(user_id,project_id) where role='owner';

-- Shared account endpoint: retain the legacy transfer/delete contract. v2's
-- existing Auth triggers/FKs perform v2 deletion and content-free ACL notices.
create or replace function public.delete_current_account(p_confirmation text)
returns table(success boolean,reason text,deleted_project_count integer,transferred_project_count integer)
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_email text;
  v_anonymous boolean;
  v_project record;
  v_next_owner uuid;
  v_deleted_count integer := 0;
  v_transferred_count integer := 0;
begin
  if v_uid is null then
    return query select false,'not_authenticated',0,0; return;
  end if;
  if p_confirmation is distinct from 'DELETE_MY_ACCOUNT' then
    return query select false,'confirmation_required',0,0; return;
  end if;
  -- Lock real account before any document side effects; serialized retries.
  select lower(u.email),u.is_anonymous into v_email,v_anonymous
  from auth.users u where u.id=v_uid for update;
  if not found then
    return query select false,'user_not_found',0,0; return;
  end if;
  if v_anonymous is distinct from false then
    return query select false,'permanent_account_required',0,0; return;
  end if;
  for v_project in
    select p.id from public.projects p
    where p.created_by=v_uid or exists(select 1 from public.project_members m
      where m.project_id=p.id and m.user_id=v_uid and m.role='owner')
    order by p.id for update of p
  loop
    select m.user_id into v_next_owner from public.project_members m
    where m.project_id=v_project.id and m.role='owner' and m.user_id<>v_uid
    order by m.joined_at,m.user_id limit 1;
    if v_next_owner is null then
      delete from public.projects p where p.id=v_project.id;
      v_deleted_count := v_deleted_count+1;
    else
      update public.projects p set created_by=v_next_owner,updated_at=now()
      where p.id=v_project.id and p.created_by=v_uid;
      delete from public.project_members m where m.project_id=v_project.id and m.user_id=v_uid;
      v_transferred_count := v_transferred_count+1;
    end if;
  end loop;
  delete from public.project_members m where m.user_id=v_uid;
  update public.project_resources set updated_by=null where updated_by=v_uid;
  update public.scenes set updated_by=null where updated_by=v_uid;
  update public.snapshots set created_by=null where created_by=v_uid;
  update public.audit_logs set actor_id=null where actor_id=v_uid;
  update public.project_invites set accepted_by=null where accepted_by=v_uid;
  update public.scene_cell_versions set updated_by=null where updated_by=v_uid;
  if v_email is not null then
    delete from public.project_invites i where lower(i.invited_email)=v_email;
  end if;
  delete from auth.users u where u.id=v_uid;
  return query select true,'ok',v_deleted_count,v_transferred_count;
end $$;
revoke all on function public.delete_current_account(text) from public, anon, authenticated, service_role;
grant execute on function public.delete_current_account(text) to authenticated;

commit;
