-- Apply this migration alone as one transaction; no document data is changed.
-- Failure during application: ROLLBACK the transaction, never continue midway.
-- After COMMIT: use a corrective migration. Do not roll back the strengthened RLS.
begin;

create index if not exists collab_v2_documents_live_creator_idx
  on public.collab_v2_documents(creator_id) where deleted_at is null;

create or replace function public.collab_v2_create_document(p_actor uuid, p_display_name text, p_bytes bytea, p_title text default '隊列表', p_checkpoint bytea default null, p_checkpoint_digest bytea default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_snapshot uuid; v_guest boolean; v_digest bytea; v_checkpoint_result jsonb;
begin
  perform collab_v2_private.require_service();
  if p_title is null or pg_catalog.char_length(p_title) not between 1 and 120 or p_actor is null or p_display_name is null or p_bytes is null
    or pg_catalog.char_length(p_display_name) not between 1 and 80 or pg_catalog.btrim(p_display_name) = '' then
    raise exception using errcode = '22023', message = 'INVALID_ARGUMENT';
  end if;
  select u.is_anonymous into v_guest from auth.users u where u.id = p_actor;
  if not found then raise exception using errcode = '42501', message = 'NOT_AUTHENTICATED'; end if;
  -- Guests join by invitation; disallow disposable-account document spam.
  if v_guest then raise exception using errcode = '42501', message = 'PERMANENT_ACCOUNT_REQUIRED'; end if;
  if pg_catalog.octet_length(p_bytes) not between 1 and (select max_snapshot_bytes from collab_v2_private.budget_settings where singleton) then
    raise exception using errcode = '54000', message = 'QUOTA_EXCEEDED';
  end if;
  -- Global create-only lock, not on the append path. Replays precede quotas.
  v_digest := extensions.digest(p_bytes, 'sha256');
  perform pg_catalog.pg_advisory_xact_lock(20261004, 2);
  select id into v_id from public.collab_v2_documents where creator_id = p_actor and initial_digest = v_digest;
  if v_id is not null then
    if exists (select 1 from public.collab_v2_documents where id = v_id and deleted_at is not null) then
      raise exception using errcode = '42501', message = 'DOCUMENT_DELETED';
    end if;
  else
  if (select count(*) from public.collab_v2_documents where creator_id = p_actor and deleted_at is null) >= 20 then
    raise exception using errcode = '54000', message = 'DOCUMENT_QUOTA_EXCEEDED';
  end if;
  perform collab_v2_private.require_budget(pg_catalog.octet_length(p_bytes) + (select 3 * row_overhead from collab_v2_private.budget_settings where singleton));
  insert into public.collab_v2_documents(creator_id, initial_digest, list_title) values (p_actor, v_digest, p_title) returning id into v_id;
  insert into public.collab_v2_sync_snapshots(document_id, generation, upto_seq, bytes, digest)
    values (v_id, 1, 0, p_bytes, extensions.digest(p_bytes, 'sha256')) returning id into v_snapshot;
  update public.collab_v2_documents set latest_snapshot_id = v_snapshot where id = v_id;
  insert into public.collab_v2_members(document_id, user_id, display_name, is_guest)
    values (v_id, p_actor, p_display_name, v_guest);
  if p_checkpoint is not null then
    v_checkpoint_result := public.collab_v2_store_checkpoint(v_id,p_actor,1,0,p_checkpoint,p_checkpoint_digest,'automatic');
  end if;
  -- Old service callers can omit the DTO; preserve seq=0 until it is generated.
  -- A full checkpoint pool must not prevent creating/editing the current state.
  if p_checkpoint is null or v_checkpoint_result->>'result'='DEFERRED_CAPACITY' then
    insert into collab_v2_private.history_due(document_id,generation,cut_seq) values(v_id,1,0);
  end if;
  end if;
  return (select pg_catalog.jsonb_build_object('documentId', d.id, 'generation', d.generation::text,
    'headSeq', d.head_seq::text, 'aclGeneration', d.acl_generation::text, 'topic', d.private_topic,
    'membershipGeneration', m.membership_generation)
    from public.collab_v2_documents d join public.collab_v2_members m on m.document_id = d.id
    where d.id = v_id and m.user_id = p_actor);
end $$;


-- Check only the caller; bypass member RLS without permitting identity probes.
create or replace function collab_v2_private.can_read_document(p_document uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists (
    select 1 from public.collab_v2_documents d
    join public.collab_v2_members m on m.document_id = d.id
    join auth.users u on u.id = m.user_id
    where d.id = p_document and d.deleted_at is null and m.user_id = auth.uid())
$$;
-- Use the management owner of the existing narrow DEFINER predicate.
do $$ declare v_owner name; begin
  select pg_catalog.pg_get_userbyid(p.proowner) into strict v_owner
    from pg_catalog.pg_proc p where p.oid = 'collab_v2_private.is_member(uuid)'::pg_catalog.regprocedure;
  execute pg_catalog.format('alter function collab_v2_private.can_read_document(uuid) owner to %I', v_owner);
end $$;
revoke all on function collab_v2_private.can_read_document(uuid) from public, anon, authenticated, service_role;
grant execute on function collab_v2_private.can_read_document(uuid) to authenticated;

drop policy if exists collab_v2_member_read on public.collab_v2_documents;
create policy collab_v2_member_read on public.collab_v2_documents for select to authenticated
  using (collab_v2_private.can_read_document(id));
drop policy if exists collab_v2_member_read on public.collab_v2_members;
create policy collab_v2_member_read on public.collab_v2_members for select to authenticated
  using (collab_v2_private.can_read_document(document_id));
drop policy if exists collab_v2_member_read on public.collab_v2_updates;
create policy collab_v2_member_read on public.collab_v2_updates for select to authenticated
  using (collab_v2_private.can_read_document(document_id));
drop policy if exists collab_v2_member_read on public.collab_v2_sync_snapshots;
create policy collab_v2_member_read on public.collab_v2_sync_snapshots for select to authenticated
  using (collab_v2_private.can_read_document(document_id));
-- checkpoints/checkpoint_contents retain history_allowed(document_id,'view').

create or replace function public.collab_v2_get_updates(p_document uuid, p_generation bigint, p_cursor bigint, p_limit integer default 32, p_known_snapshot_id uuid default null)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare v_state jsonb;
begin
  perform collab_v2_private.require_user();
  if p_document is null or p_generation is null or p_cursor is null or p_limit is null
    or p_generation <= 0 or p_cursor < 0 or p_limit not between 1 and 32 then
    raise exception using errcode = '22023', message = 'INVALID_ARGUMENT';
  end if;
  if not collab_v2_private.is_member(p_document) then raise exception using errcode = '42501', message = 'NOT_MEMBER'; end if;
  if public.collab_v2_access_status(p_document)->>'status' = 'ended' then
    raise exception using errcode = '42501', message = 'DOCUMENT_DELETED';
  end if;
  v_state := collab_v2_private.read_state(p_document, p_cursor, p_limit, p_known_snapshot_id);
  if v_state is null then raise exception using errcode = '42501', message = 'NOT_MEMBER'; end if;
  if (v_state->>'deleted')::boolean then raise exception using errcode = '42501', message = 'DOCUMENT_DELETED'; end if;
  if (v_state->>'generation')::bigint <> p_generation then raise exception using errcode = '40001', message = 'STALE_GENERATION'; end if;
  if p_cursor > (v_state->>'headSeq')::bigint then raise exception using errcode = '22023', message = 'INVALID_CURSOR'; end if;
  return v_state;
end $$;


create or replace function public.collab_v2_list_members(p_document uuid)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
begin
  perform collab_v2_private.require_user();
  if p_document is null then raise exception using errcode = '22023', message = 'INVALID_ARGUMENT'; end if;
  if not collab_v2_private.is_member(p_document) then raise exception using errcode = '42501', message = 'NOT_MEMBER'; end if;
  if public.collab_v2_access_status(p_document)->>'status' = 'ended' then
    raise exception using errcode = '42501', message = 'DOCUMENT_DELETED';
  end if;
  return (select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('userId', m.user_id,
    'displayName', m.display_name, 'isGuest', m.is_guest, 'isCreator', m.user_id = d.creator_id)
    order by m.joined_at, m.user_id), '[]'::jsonb)
    from public.collab_v2_members m join public.collab_v2_documents d on d.id = m.document_id where d.id = p_document);
end $$;


revoke all on function public.collab_v2_create_document(uuid, text, bytea, text, bytea, bytea) from public, anon, authenticated, service_role;
grant execute on function public.collab_v2_create_document(uuid, text, bytea, text, bytea, bytea) to service_role;
revoke all on function public.collab_v2_get_updates(uuid, bigint, bigint, integer, uuid) from public, anon, authenticated, service_role;
grant execute on function public.collab_v2_get_updates(uuid, bigint, bigint, integer, uuid) to authenticated;
revoke all on function public.collab_v2_list_members(uuid) from public, anon, authenticated, service_role;
grant execute on function public.collab_v2_list_members(uuid) to authenticated;

commit;
