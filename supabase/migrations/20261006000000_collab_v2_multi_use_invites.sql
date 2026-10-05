-- Apply the complete transaction. Do not reapply foundation afterwards.
begin;
set local intervalstyle = 'postgres';
-- create_invite/join take FOR KEY SHARE on the caller's auth.users row, which
-- needs UPDATE on auth.users for the function owner. Fail the whole transaction
-- here instead of breaking every invite at runtime.
do $$
begin
  if not pg_catalog.has_table_privilege(current_user, 'auth.users', 'UPDATE') then
    raise exception 'Function owner % lacks UPDATE on auth.users (needed for row locks)', current_user;
  end if;
end $$;
alter table public.collab_v2_invites add column if not exists multi_use boolean not null default false;
do $$
declare v_count integer; v_name text; v_def text;
begin
  select count(*),min(c.conname::text),min(pg_catalog.regexp_replace(pg_catalog.pg_get_constraintdef(c.oid),'\s+','','g')) into v_count,v_name,v_def
  from pg_catalog.pg_constraint c where c.conrelid='public.collab_v2_invites'::pg_catalog.regclass and c.contype='c'
    and c.conkey @> array[(select attnum from pg_catalog.pg_attribute where attrelid=c.conrelid and attname='expires_at'),
      (select attnum from pg_catalog.pg_attribute where attrelid=c.conrelid and attname='issued_at')]::smallint[];
  if v_count <> 1 then raise exception 'Unexpected expiry constraints'; end if;
  if v_def not in ('CHECK((expires_at<=(issued_at+''24:00:00''::interval)))',
    'CHECK((expires_at<=(issued_at+CASEWHENmulti_useTHEN''7days''::intervalELSE''24:00:00''::intervalEND)))') then
    raise exception 'Unexpected expiry constraint: %',v_def;
  end if;
  execute pg_catalog.format('alter table public.collab_v2_invites drop constraint %I',v_name);
  alter table public.collab_v2_invites add constraint collab_v2_invites_expiry_limit
    check(expires_at <= issued_at + (case when multi_use then interval '7 days' else interval '24 hours' end));
end $$;
-- No auth.users FK: account deletion must not reset the 64-use budget.
-- Private UUID audit identifiers survive departure; invitation/document deletion cascades.
create table if not exists collab_v2_private.invite_uses (
  invite_id uuid not null references public.collab_v2_invites(id) on delete cascade,
  user_id uuid not null, membership_generation uuid not null,
  used_at timestamptz not null default pg_catalog.now(),
  primary key(invite_id,user_id,membership_generation)
);
alter table collab_v2_private.invite_uses enable row level security;
revoke all on collab_v2_private.invite_uses from public, anon, authenticated, service_role;
create or replace function public.collab_v2_create_invite(p_document uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user uuid := collab_v2_private.require_user(); v_token text; v_id uuid; v_expiry timestamptz;
begin
  -- Pin the caller before document locks/FK writes, so deleting this same
  -- account cannot wait on our document while we wait on its auth row.
  perform 1 from auth.users where id=v_user for key share;
  if not found then raise exception using errcode='42501',message='NOT_AUTHENTICATED'; end if;
  if p_document is null then raise exception using errcode = '22023', message = 'INVALID_ARGUMENT'; end if;
  perform 1 from public.collab_v2_documents where id = p_document and deleted_at is null for update;
  if not found or not collab_v2_private.is_member(p_document) then
    raise exception using errcode = '42501', message = 'NOT_MEMBER';
  end if;
  -- Stored invitations and issuance rate are bounded even after expiry/revocation.
  if (select count(*) from public.collab_v2_invites where document_id = p_document) >= 256
    or (select count(*) from public.collab_v2_invites where document_id = p_document
      and issued_at > pg_catalog.now() - interval '1 hour') >= 32 then
    raise exception using errcode = '54000', message = 'INVITE_RATE_LIMIT';
  end if;
  v_token := pg_catalog.encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.collab_v2_invites(document_id, token_hash, issued_by, multi_use, expires_at)
    values (p_document, extensions.digest(v_token, 'sha256'), v_user, true, pg_catalog.now() + interval '7 days') returning id, expires_at into v_id, v_expiry;
  return pg_catalog.jsonb_build_object('inviteId', v_id, 'token', v_token, 'expiresAt', v_expiry);
end $$;

create or replace function public.collab_v2_join(p_token text, p_display_name text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user uuid := collab_v2_private.require_user(); v_invite public.collab_v2_invites%rowtype;
  v_document uuid; v_member uuid; v_guest boolean; v_attempts integer;
begin
  perform 1 from auth.users where id=v_user for key share;
  if not found then raise exception using errcode='42501',message='NOT_AUTHENTICATED'; end if;
  -- Returning errors (rather than raising) is deliberate: failed guesses MUST
  -- commit the rate counter. The client maps this result to a typed error.
  insert into collab_v2_private.join_attempts(user_id, window_started, attempts)
    values (v_user, pg_catalog.clock_timestamp(), 1)
    on conflict (user_id) do update set
      attempts = case when collab_v2_private.join_attempts.window_started <= pg_catalog.clock_timestamp() - interval '10 minutes'
        then 1 else least(collab_v2_private.join_attempts.attempts + 1, 21) end,
      window_started = case when collab_v2_private.join_attempts.window_started <= pg_catalog.clock_timestamp() - interval '10 minutes'
        then pg_catalog.clock_timestamp() else collab_v2_private.join_attempts.window_started end
    returning attempts into v_attempts;
  if v_attempts > 20 then return pg_catalog.jsonb_build_object('error', 'INVITE_ATTEMPT_LIMIT'); end if;
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' or p_display_name is null
    or pg_catalog.char_length(p_display_name) not between 1 and 80 or pg_catalog.btrim(p_display_name) = '' then
    return pg_catalog.jsonb_build_object('error', 'INVALID_ARGUMENT');
  end if;
  select document_id into v_document from public.collab_v2_invites where token_hash = extensions.digest(p_token, 'sha256');
  if v_document is null then return pg_catalog.jsonb_build_object('error', 'INVALID_INVITE'); end if;
  -- Always document first, then invitation. Same order as remove and revoke.
  perform 1 from public.collab_v2_documents where id = v_document and deleted_at is null for update;
  if not found then return pg_catalog.jsonb_build_object('error', 'INVALID_INVITE'); end if;
  select * into v_invite from public.collab_v2_invites where token_hash = extensions.digest(p_token, 'sha256') for update;
  select membership_generation into v_member from public.collab_v2_members where document_id = v_document and user_id = v_user;
  if not found then v_member := null; end if;
  if not v_invite.multi_use and v_invite.used_at is not null and v_invite.used_by = v_user and v_invite.used_membership = v_member then
    -- Only replay the receipt; no INSERT/ACL rotation/name mutation.
    return (select pg_catalog.jsonb_build_object('documentId', d.id, 'generation', d.generation::text,
      'headSeq', d.head_seq::text, 'aclGeneration', d.acl_generation::text, 'topic', d.private_topic,
      'membershipGeneration', v_member) from public.collab_v2_documents d where d.id = v_document);
  end if;
  if v_invite.multi_use then
    if exists(select 1 from collab_v2_private.invite_uses where invite_id=v_invite.id and user_id=v_user and membership_generation=v_member) then
      return (select pg_catalog.jsonb_build_object('documentId', d.id, 'generation', d.generation::text,
      'headSeq', d.head_seq::text, 'aclGeneration', d.acl_generation::text, 'topic', d.private_topic,
      'membershipGeneration', v_member) from public.collab_v2_documents d where d.id=v_document);
    end if;
    if exists(select 1 from collab_v2_private.invite_uses where invite_id=v_invite.id and user_id=v_user) then
      return pg_catalog.jsonb_build_object('error','INVALID_INVITE');
    end if;
  end if;
  if v_invite.id is null or v_invite.revoked_at is not null or (not v_invite.multi_use and v_invite.used_at is not null)
    or v_invite.expires_at <= pg_catalog.now() or not exists (
      select 1 from public.collab_v2_members where document_id = v_document and user_id = v_invite.issued_by) then
    return pg_catalog.jsonb_build_object('error', 'INVALID_INVITE');
  end if;
  if v_invite.multi_use and (select count(*) from collab_v2_private.invite_uses where invite_id=v_invite.id) >= 64 then
    return pg_catalog.jsonb_build_object('error','INVALID_INVITE');
  end if;
  if v_member is null then
    if (select count(*) from public.collab_v2_members where document_id = v_document) >= 8 then
      return pg_catalog.jsonb_build_object('error', 'MEMBER_LIMIT');
    end if;
    select is_anonymous into v_guest from auth.users where id = v_user;
    insert into public.collab_v2_members(document_id, user_id, display_name, is_guest)
      values (v_document, v_user, p_display_name, v_guest) returning membership_generation into v_member;
    if v_invite.multi_use then
      insert into collab_v2_private.invite_uses(invite_id,user_id,membership_generation) values(v_invite.id,v_user,v_member);
    end if;
  end if;
  if not v_invite.multi_use then
    update public.collab_v2_invites set used_at = pg_catalog.now(), used_by = v_user, used_membership = v_member where id = v_invite.id;
  end if;
  return (select pg_catalog.jsonb_build_object('documentId', d.id, 'generation', d.generation::text,
    'headSeq', d.head_seq::text, 'aclGeneration', d.acl_generation::text, 'topic', d.private_topic,
    'membershipGeneration', v_member) from public.collab_v2_documents d where id = v_document);
end $$;

create or replace function collab_v2_private.member_changed()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_document uuid := coalesce(new.document_id, old.document_id);
begin
  if tg_op = 'UPDATE' and new.membership_generation is not distinct from old.membership_generation then return null; end if;
  update public.collab_v2_documents set acl_generation = acl_generation + 1,
    private_topic = 'collab-v2:' || pg_catalog.gen_random_uuid()::text where id = v_document;
  if tg_op = 'DELETE' then
    update public.collab_v2_invites set revoked_at = coalesce(revoked_at, pg_catalog.now())
      where document_id = v_document and issued_by = old.user_id and revoked_at is null and expires_at > pg_catalog.now() and (multi_use or used_at is null);
    if exists (select 1 from auth.users where id = old.user_id) then
      insert into collab_v2_private.departures(document_id, user_id, reason)
        values (v_document, old.user_id, 'removed') on conflict (document_id, user_id) do nothing;
    end if;
  else
    delete from collab_v2_private.departures where document_id = v_document and user_id = new.user_id;
  end if;
  return null;
end $$;

create or replace function collab_v2_private.user_deleting()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform d.id from public.collab_v2_documents d where d.creator_id=old.id
    or exists(select 1 from public.collab_v2_members m where m.document_id=d.id and m.user_id=old.id)
    or exists(select 1 from public.collab_v2_invites i where i.document_id=d.id and i.issued_by=old.id)
    order by d.id for update;
  update public.collab_v2_invites set revoked_at=pg_catalog.now()
    where issued_by=old.id and revoked_at is null and expires_at > pg_catalog.now() and (multi_use or used_at is null);
  return old;
end $$;

create or replace function public.collab_v2_list_invites(p_document uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform collab_v2_private.require_user();
  if not collab_v2_private.is_member(p_document) or not exists
    (select 1 from public.collab_v2_documents where id = p_document and deleted_at is null) then
    raise exception using errcode = '42501', message = 'NOT_MEMBER';
  end if;
  return (select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'inviteId',i.id,'expiresAt',i.expires_at,'multiUse',i.multi_use,
    'joinedCount',case when i.multi_use then u.people else (case when i.used_at is null then 0 else 1 end) end,
    'status',case when i.revoked_at is not null then 'revoked'
      when i.multi_use then (case when i.expires_at <= pg_catalog.now() then 'expired' when u.uses >= 64 then 'used' else 'active' end)
      when i.used_at is not null then 'used' when i.expires_at <= pg_catalog.now() then 'expired' else 'active' end)
    order by i.issued_at desc,i.id),'[]'::jsonb)
    from public.collab_v2_invites i cross join lateral
      (select count(*) uses,count(distinct user_id) people from collab_v2_private.invite_uses where invite_id=i.id) u
    where i.document_id=p_document);
end $$;
revoke all on function public.collab_v2_create_invite(uuid) from public, anon, authenticated, service_role;
grant execute on function public.collab_v2_create_invite(uuid) to authenticated;
revoke all on function public.collab_v2_join(text,text) from public, anon, authenticated, service_role;
grant execute on function public.collab_v2_join(text,text) to authenticated;
revoke all on function public.collab_v2_list_invites(uuid) from public, anon, authenticated, service_role;
grant execute on function public.collab_v2_list_invites(uuid) to authenticated;
revoke all on function collab_v2_private.member_changed() from public, anon, authenticated, service_role;
revoke all on function collab_v2_private.user_deleting() from public, anon, authenticated, service_role;
commit;
