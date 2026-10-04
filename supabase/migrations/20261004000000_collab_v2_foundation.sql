-- Collaboration document schemas 1 (legacy fixture) and 2 (full Project). No legacy table changes.
-- Apply as one transaction. Reapplication preserves data and ACLs.
begin;

create schema if not exists collab_v2_private;
revoke all on schema collab_v2_private from public, anon, authenticated, service_role;
grant usage on schema collab_v2_private to authenticated, service_role;

create table if not exists public.collab_v2_documents (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  creator_id uuid not null references auth.users(id) on delete cascade,
  initial_digest bytea not null check (pg_catalog.octet_length(initial_digest) = 32),
  document_schema integer not null default 2 check (document_schema in (1, 2)),
  generation bigint not null default 1 check (generation > 0),
  head_seq bigint not null default 0 check (head_seq >= 0),
  latest_snapshot_id uuid,
  deleted_at timestamptz,
  acl_generation bigint not null default 1 check (acl_generation > 0),
  private_topic text not null unique default ('collab-v2:' || pg_catalog.gen_random_uuid()::text),
  log_bytes bigint not null default 0 check (log_bytes between 0 and 4194304),
  receipt_count integer not null default 0 check (receipt_count between 0 and 4096),
  created_at timestamptz not null default pg_catalog.now(),
  unique (creator_id, initial_digest)
);
create table if not exists public.collab_v2_members (
  document_id uuid not null references public.collab_v2_documents(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  membership_generation uuid not null default pg_catalog.gen_random_uuid(),
  display_name text not null check (pg_catalog.char_length(display_name) between 1 and 80 and pg_catalog.btrim(display_name) <> ''),
  is_guest boolean not null,
  joined_at timestamptz not null default pg_catalog.now(),
  primary key (document_id, user_id)
);
create index if not exists collab_v2_members_user_idx on public.collab_v2_members(user_id, document_id);
create index if not exists collab_v2_documents_creator_idx on public.collab_v2_documents(creator_id);
create table if not exists public.collab_v2_invites (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  document_id uuid not null references public.collab_v2_documents(id) on delete cascade,
  token_hash bytea not null unique check (pg_catalog.octet_length(token_hash) = 32),
  issued_by uuid references auth.users(id) on delete set null,
  issued_at timestamptz not null default pg_catalog.now(),
  expires_at timestamptz not null default (pg_catalog.now() + interval '24 hours'),
  used_at timestamptz,
  used_by uuid references auth.users(id) on delete set null,
  revoked_at timestamptz,
  check (expires_at <= issued_at + interval '24 hours')
);
create index if not exists collab_v2_invites_document_idx on public.collab_v2_invites(document_id, issued_at);
create index if not exists collab_v2_invites_issuer_idx on public.collab_v2_invites(issued_by);
create table if not exists public.collab_v2_updates (
  document_id uuid not null references public.collab_v2_documents(id) on delete cascade,
  seq bigint not null check (seq > 0),
  generation bigint not null check (generation > 0),
  client_update_id text not null check (pg_catalog.octet_length(client_update_id) between 1 and 255),
  actor_id uuid references auth.users(id) on delete set null,
  bytes bytea not null check (pg_catalog.octet_length(bytes) between 1 and 262144),
  digest bytea not null check (pg_catalog.octet_length(digest) = 32),
  created_at timestamptz not null default pg_catalog.now(),
  primary key (document_id, seq),
  unique (document_id, generation, client_update_id)
);
create index if not exists collab_v2_updates_actor_idx on public.collab_v2_updates(actor_id);
create table if not exists public.collab_v2_update_receipts (
  document_id uuid not null references public.collab_v2_documents(id) on delete cascade,
  generation bigint not null,
  client_update_id text not null check (pg_catalog.octet_length(client_update_id) between 1 and 255),
  seq bigint not null,
  actor_id uuid references auth.users(id) on delete set null,
  digest bytea not null check (pg_catalog.octet_length(digest) = 32),
  byte_length integer not null check (byte_length between 1 and 262144),
  created_at timestamptz not null default pg_catalog.now(),
  primary key (document_id, generation, client_update_id)
);
create index if not exists collab_v2_receipts_actor_idx on public.collab_v2_update_receipts(actor_id);
create table if not exists public.collab_v2_sync_snapshots (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  document_id uuid not null references public.collab_v2_documents(id) on delete cascade,
  generation bigint not null,
  upto_seq bigint not null check (upto_seq >= 0),
  bytes bytea not null check (pg_catalog.octet_length(bytes) between 1 and 8388608),
  digest bytea not null check (pg_catalog.octet_length(digest) = 32),
  created_at timestamptz not null default pg_catalog.now(),
  unique (document_id, id)
);
-- Composite FK prevents a snapshot belonging to another document being referenced.
do $$ begin
  if not exists (select 1 from pg_catalog.pg_constraint where conname = 'collab_v2_latest_snapshot_fk'
    and conrelid = 'public.collab_v2_documents'::pg_catalog.regclass) then
    alter table public.collab_v2_documents add constraint collab_v2_latest_snapshot_fk
      foreign key (id, latest_snapshot_id) references public.collab_v2_sync_snapshots(document_id, id)
      deferrable initially deferred;
  end if;
end $$;

-- Narrow predicates bypass recursive member RLS; no caller-supplied user identity.
create or replace function collab_v2_private.is_member(p_document uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists (
    select 1 from public.collab_v2_members m join auth.users u on u.id = m.user_id
    where m.document_id = p_document and m.user_id = auth.uid())
$$;
create or replace function collab_v2_private.require_user()
returns uuid language plpgsql stable security definer set search_path = '' as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null or not exists (select 1 from auth.users where id = v_user) then
    raise exception using errcode = '42501', message = 'NOT_AUTHENTICATED';
  end if;
  return v_user;
end $$;
create or replace function collab_v2_private.require_service()
returns void language plpgsql stable security invoker set search_path = '' as $$
begin
  if (auth.jwt()->>'role') is distinct from 'service_role' then
    raise exception using errcode = '42501', message = 'SERVICE_ONLY';
  end if;
end $$;

-- All member changes, including auth.users cascades, rotate the ACL and topic.
-- The document lock serializes this with join/append/remove/delete.
create or replace function collab_v2_private.member_changed()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_document uuid := coalesce(new.document_id, old.document_id);
begin
  update public.collab_v2_documents set acl_generation = acl_generation + 1,
    private_topic = 'collab-v2:' || pg_catalog.gen_random_uuid()::text where id = v_document;
  if tg_op = 'DELETE' then
    update public.collab_v2_invites set revoked_at = coalesce(revoked_at, pg_catalog.now())
      where document_id = v_document and issued_by = old.user_id and used_at is null;
  end if;
  return null;
end $$;
drop trigger if exists collab_v2_member_changed on public.collab_v2_members;
create trigger collab_v2_member_changed after insert or delete on public.collab_v2_members
  for each row execute function collab_v2_private.member_changed();

-- Deferred snapshot FK permits auth.users -> document -> snapshot cascades.
-- Existing delete_current_account eventually deletes auth.users, so no override.

create or replace function collab_v2_private.require_budget(p_extra bigint)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(20261004, 2);
  if (select coalesce(sum(d.log_bytes + d.receipt_count * 512::bigint), 0)
    from public.collab_v2_documents d) + (select coalesce(sum(pg_catalog.octet_length(s.bytes)), 0)
    from public.collab_v2_sync_snapshots s) + p_extra > 134217728 then
    raise exception using errcode = '54000', message = 'PROJECT_QUOTA_EXCEEDED';
  end if;
end $$;

-- Creation must go through Edge validation too, not an authenticated bytea RPC.
create or replace function public.collab_v2_create_document(p_actor uuid, p_display_name text, p_bytes bytea)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_snapshot uuid; v_guest boolean; v_digest bytea;
begin
  perform collab_v2_private.require_service();
  if p_actor is null or p_display_name is null or p_bytes is null
    or pg_catalog.char_length(p_display_name) not between 1 and 80 or pg_catalog.btrim(p_display_name) = '' then
    raise exception using errcode = '22023', message = 'INVALID_ARGUMENT';
  end if;
  select u.is_anonymous into v_guest from auth.users u where u.id = p_actor;
  if not found then raise exception using errcode = '42501', message = 'NOT_AUTHENTICATED'; end if;
  -- Guests join by invitation; disallow disposable-account document spam.
  if v_guest then raise exception using errcode = '42501', message = 'PERMANENT_ACCOUNT_REQUIRED'; end if;
  if pg_catalog.octet_length(p_bytes) not between 1 and 8388608 then
    raise exception using errcode = '54000', message = 'QUOTA_EXCEEDED';
  end if;
  -- Global create-only lock, not on the append path. Tombstones count as quota.
  v_digest := extensions.digest(p_bytes, 'sha256');
  perform pg_catalog.pg_advisory_xact_lock(20261004, 2);
  select id into v_id from public.collab_v2_documents where creator_id = p_actor and initial_digest = v_digest;
  if v_id is not null then
    if exists (select 1 from public.collab_v2_documents where id = v_id and deleted_at is not null) then
      raise exception using errcode = '42501', message = 'DOCUMENT_DELETED';
    end if;
  else
  perform collab_v2_private.require_budget(pg_catalog.octet_length(p_bytes));
  if (select count(*) from public.collab_v2_documents where creator_id = p_actor) >= 20
    or (select count(*) from public.collab_v2_documents) >= 100 then
    raise exception using errcode = '54000', message = 'QUOTA_EXCEEDED';
  end if;
  insert into public.collab_v2_documents(creator_id, initial_digest) values (p_actor, v_digest) returning id into v_id;
  insert into public.collab_v2_sync_snapshots(document_id, generation, upto_seq, bytes, digest)
    values (v_id, 1, 0, p_bytes, extensions.digest(p_bytes, 'sha256')) returning id into v_snapshot;
  update public.collab_v2_documents set latest_snapshot_id = v_snapshot where id = v_id;
  insert into public.collab_v2_members(document_id, user_id, display_name, is_guest)
    values (v_id, p_actor, p_display_name, v_guest);
  end if;
  return (select pg_catalog.jsonb_build_object('documentId', d.id, 'generation', d.generation::text,
    'headSeq', d.head_seq::text, 'aclGeneration', d.acl_generation::text, 'topic', d.private_topic,
    'membershipGeneration', m.membership_generation)
    from public.collab_v2_documents d join public.collab_v2_members m on m.document_id = d.id
    where d.id = v_id and m.user_id = p_actor);
end $$;

create or replace function public.collab_v2_create_invite(p_document uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user uuid := collab_v2_private.require_user(); v_token text; v_id uuid; v_expiry timestamptz;
begin
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
  insert into public.collab_v2_invites(document_id, token_hash, issued_by)
    values (p_document, extensions.digest(v_token, 'sha256'), v_user) returning id, expires_at into v_id, v_expiry;
  return pg_catalog.jsonb_build_object('inviteId', v_id, 'token', v_token, 'expiresAt', v_expiry);
end $$;

create or replace function public.collab_v2_join(p_token text, p_display_name text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user uuid := collab_v2_private.require_user(); v_invite public.collab_v2_invites%rowtype;
  v_document uuid; v_member uuid; v_guest boolean;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' or p_display_name is null
    or pg_catalog.char_length(p_display_name) not between 1 and 80 or pg_catalog.btrim(p_display_name) = '' then
    raise exception using errcode = '22023', message = 'INVALID_ARGUMENT';
  end if;
  select document_id into v_document from public.collab_v2_invites where token_hash = extensions.digest(p_token, 'sha256');
  if v_document is null then raise exception using errcode = '42501', message = 'INVALID_INVITE'; end if;
  -- Always document first, then invitation. Same order as remove and revoke.
  perform 1 from public.collab_v2_documents where id = v_document and deleted_at is null for update;
  if not found then raise exception using errcode = '42501', message = 'INVALID_INVITE'; end if;
  select * into v_invite from public.collab_v2_invites where token_hash = extensions.digest(p_token, 'sha256') for update;
  if not found or v_invite.revoked_at is not null or v_invite.used_at is not null
    or v_invite.expires_at <= pg_catalog.now() or not exists (
      select 1 from public.collab_v2_members where document_id = v_document and user_id = v_invite.issued_by) then
    raise exception using errcode = '42501', message = 'INVALID_INVITE';
  end if;
  select membership_generation into v_member from public.collab_v2_members where document_id = v_document and user_id = v_user;
  if v_member is null then
    if (select count(*) from public.collab_v2_members where document_id = v_document) >= 8 then
      raise exception using errcode = '54000', message = 'MEMBER_LIMIT';
    end if;
    select is_anonymous into v_guest from auth.users where id = v_user;
    insert into public.collab_v2_members(document_id, user_id, display_name, is_guest)
      values (v_document, v_user, p_display_name, v_guest) returning membership_generation into v_member;
  end if;
  update public.collab_v2_invites set used_at = pg_catalog.now(), used_by = v_user where id = v_invite.id;
  return (select pg_catalog.jsonb_build_object('documentId', d.id, 'generation', d.generation::text,
    'headSeq', d.head_seq::text, 'aclGeneration', d.acl_generation::text, 'topic', d.private_topic,
    'membershipGeneration', v_member) from public.collab_v2_documents d where id = v_document);
end $$;

create or replace function public.collab_v2_revoke_invite(p_document uuid, p_invite uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform collab_v2_private.require_user();
  if p_document is null or p_invite is null then raise exception using errcode = '22023', message = 'INVALID_ARGUMENT'; end if;
  perform 1 from public.collab_v2_documents where id = p_document and deleted_at is null for update;
  if not found or not collab_v2_private.is_member(p_document) then raise exception using errcode = '42501', message = 'NOT_MEMBER'; end if;
  update public.collab_v2_invites set revoked_at = coalesce(revoked_at, pg_catalog.now()) where id = p_invite and document_id = p_document;
  if not found then raise exception using errcode = '22023', message = 'INVALID_INVITE'; end if;
end $$;

create or replace function public.collab_v2_remove_member(p_document uuid, p_user uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_creator uuid;
begin
  perform collab_v2_private.require_user();
  if p_document is null or p_user is null then raise exception using errcode = '22023', message = 'INVALID_ARGUMENT'; end if;
  select creator_id into v_creator from public.collab_v2_documents where id = p_document and deleted_at is null for update;
  if not found or not collab_v2_private.is_member(p_document) then raise exception using errcode = '42501', message = 'NOT_MEMBER'; end if;
  if p_user = v_creator then raise exception using errcode = '42501', message = 'CREATOR_PROTECTED'; end if;
  delete from public.collab_v2_members where document_id = p_document and user_id = p_user;
  if not found then raise exception using errcode = '22023', message = 'NOT_MEMBER'; end if;
end $$;
create or replace function public.collab_v2_leave(p_document uuid)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  perform public.collab_v2_remove_member(p_document, auth.uid());
end $$;

create or replace function public.collab_v2_delete_document(p_document uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_user uuid := collab_v2_private.require_user(); v_creator uuid;
begin
  if p_document is null then raise exception using errcode = '22023', message = 'INVALID_ARGUMENT'; end if;
  select creator_id into v_creator from public.collab_v2_documents where id = p_document for update;
  if not found or v_creator is distinct from v_user then raise exception using errcode = '42501', message = 'CREATOR_ONLY'; end if;
  update public.collab_v2_documents set deleted_at = coalesce(deleted_at, pg_catalog.now()), latest_snapshot_id = null,
    acl_generation = acl_generation + 1, private_topic = 'collab-v2:' || pg_catalog.gen_random_uuid()::text,
    log_bytes = 0, receipt_count = 0 where id = p_document;
  delete from public.collab_v2_invites where document_id = p_document;
  delete from public.collab_v2_updates where document_id = p_document;
  delete from public.collab_v2_update_receipts where document_id = p_document;
  delete from public.collab_v2_sync_snapshots where document_id = p_document;
end $$;

-- One SELECT = one MVCC snapshot. Never mix a newer head with an older page.
create or replace function collab_v2_private.read_state(p_document uuid, p_cursor bigint, p_limit integer)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select pg_catalog.jsonb_build_object('documentId', d.id, 'documentSchema', d.document_schema,
    'generation', d.generation::text, 'headSeq', d.head_seq::text, 'aclGeneration', d.acl_generation::text,
    'topic', d.private_topic, 'deleted', d.deleted_at is not null,
    'snapshot', case when p_cursor < s.upto_seq or p_cursor = 0 then
      pg_catalog.jsonb_build_object('uptoSeq', s.upto_seq::text, 'bytes', pg_catalog.replace(pg_catalog.encode(s.bytes, 'base64'), E'\n', '')) else null end,
    'updates', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'seq', u.seq::text, 'updateId', u.client_update_id, 'actor', u.actor_id,
      'bytes', pg_catalog.replace(pg_catalog.encode(u.bytes, 'base64'), E'\n', '')) order by u.seq)
      from (select * from public.collab_v2_updates where document_id = d.id and generation = d.generation
        and seq > greatest(p_cursor, coalesce(s.upto_seq, 0)) and seq <= d.head_seq order by seq limit p_limit) u), '[]'::jsonb))
  from public.collab_v2_documents d left join public.collab_v2_sync_snapshots s on s.id = d.latest_snapshot_id and s.document_id = d.id
  where d.id = p_document
$$;
create or replace function public.collab_v2_get_updates(p_document uuid, p_generation bigint, p_cursor bigint, p_limit integer default 32)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare v_state jsonb;
begin
  perform collab_v2_private.require_user();
  if p_document is null or p_generation is null or p_cursor is null or p_limit is null
    or p_generation <= 0 or p_cursor < 0 or p_limit not between 1 and 32 then
    raise exception using errcode = '22023', message = 'INVALID_ARGUMENT';
  end if;
  if not collab_v2_private.is_member(p_document) then raise exception using errcode = '42501', message = 'NOT_MEMBER'; end if;
  v_state := collab_v2_private.read_state(p_document, p_cursor, p_limit);
  if v_state is null then raise exception using errcode = '42501', message = 'NOT_MEMBER'; end if;
  if (v_state->>'deleted')::boolean then raise exception using errcode = '42501', message = 'DOCUMENT_DELETED'; end if;
  if (v_state->>'generation')::bigint <> p_generation then raise exception using errcode = '40001', message = 'STALE_GENERATION'; end if;
  if p_cursor > (v_state->>'headSeq')::bigint then raise exception using errcode = '22023', message = 'INVALID_CURSOR'; end if;
  return v_state;
end $$;

create or replace function public.collab_v2_ingest_state(p_document uuid, p_actor uuid, p_generation bigint, p_membership uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_state jsonb;
begin
  perform collab_v2_private.require_service();
  if p_document is null or p_actor is null or p_generation is null or p_membership is null or p_generation <= 0 then
    raise exception using errcode = '22023', message = 'INVALID_ARGUMENT';
  end if;
  if not exists (select 1 from public.collab_v2_members m join auth.users u on u.id = m.user_id
    where document_id = p_document and user_id = p_actor and membership_generation = p_membership) then
    raise exception using errcode = '42501', message = 'NOT_MEMBER';
  end if;
  v_state := collab_v2_private.read_state(p_document, 0, 4096);
  if v_state is null or (v_state->>'deleted')::boolean then raise exception using errcode = '42501', message = 'DOCUMENT_DELETED'; end if;
  if (v_state->>'generation')::bigint <> p_generation then raise exception using errcode = '40001', message = 'STALE_GENERATION'; end if;
  return v_state;
end $$;

-- Only Edge's server credential can execute this. p_actor comes from Auth getUser,
-- never from payload or Yjs client ID. All checks repeated under document lock.
create or replace function public.collab_v2_append(p_document uuid, p_actor uuid, p_generation bigint,
  p_membership uuid, p_expected_head bigint, p_update_id text, p_bytes bytea, p_digest bytea)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_doc public.collab_v2_documents%rowtype; v_receipt public.collab_v2_update_receipts%rowtype; v_seq bigint;
begin
  perform collab_v2_private.require_service();
  if p_document is null or p_actor is null or p_generation is null or p_membership is null
    or p_expected_head is null or p_update_id is null or p_bytes is null or p_digest is null
    or p_generation <= 0 or p_expected_head < 0 or pg_catalog.octet_length(p_update_id) not between 1 and 255
    or pg_catalog.octet_length(p_digest) <> 32 then
    raise exception using errcode = '22023', message = 'INVALID_ARGUMENT';
  end if;
  if pg_catalog.octet_length(p_bytes) not between 1 and 262144 then raise exception using errcode = '54000', message = 'QUOTA_EXCEEDED'; end if;
  if extensions.digest(p_bytes, 'sha256') <> p_digest then raise exception using errcode = '22023', message = 'DIGEST_MISMATCH'; end if;
  select * into v_doc from public.collab_v2_documents where id = p_document for update;
  if not found or v_doc.deleted_at is not null then raise exception using errcode = '42501', message = 'DOCUMENT_DELETED'; end if;
  if not exists (select 1 from public.collab_v2_members m join auth.users u on u.id = m.user_id
    where document_id = p_document and user_id = p_actor and membership_generation = p_membership) then
    raise exception using errcode = '42501', message = 'NOT_MEMBER';
  end if;
  if v_doc.generation <> p_generation then raise exception using errcode = '40001', message = 'STALE_GENERATION'; end if;
  select * into v_receipt from public.collab_v2_update_receipts
    where document_id = p_document and generation = p_generation and client_update_id = p_update_id;
  if found then
    if v_receipt.digest <> p_digest or v_receipt.byte_length <> pg_catalog.octet_length(p_bytes) then
      raise exception using errcode = '22023', message = 'UPDATE_ID_CONFLICT';
    end if;
    if v_receipt.actor_id is distinct from p_actor then raise exception using errcode = '42501', message = 'ACTOR_MISMATCH'; end if;
    return pg_catalog.jsonb_build_object('seq', v_receipt.seq::text, 'duplicate', true);
  end if;
  if v_doc.head_seq <> p_expected_head then raise exception using errcode = '40001', message = 'HEAD_CONFLICT'; end if;
  if v_doc.log_bytes + pg_catalog.octet_length(p_bytes) > 4194304 or v_doc.receipt_count >= 4096
    or v_doc.log_bytes + pg_catalog.octet_length(p_bytes) + (v_doc.receipt_count + 1) * 512
      + (select pg_catalog.octet_length(bytes) from public.collab_v2_sync_snapshots where id = v_doc.latest_snapshot_id) > 16777216 then
    raise exception using errcode = '54000', message = 'QUOTA_EXCEEDED';
  end if;
  perform collab_v2_private.require_budget(pg_catalog.octet_length(p_bytes) + 512);
  v_seq := v_doc.head_seq + 1;
  insert into public.collab_v2_updates(document_id, seq, generation, client_update_id, actor_id, bytes, digest)
    values (p_document, v_seq, p_generation, p_update_id, p_actor, p_bytes, p_digest);
  insert into public.collab_v2_update_receipts(document_id, generation, client_update_id, seq, actor_id, digest, byte_length)
    values (p_document, p_generation, p_update_id, v_seq, p_actor, p_digest, pg_catalog.octet_length(p_bytes));
  update public.collab_v2_documents set head_seq = v_seq, log_bytes = log_bytes + pg_catalog.octet_length(p_bytes),
    receipt_count = receipt_count + 1 where id = p_document;
  -- Transactional notification: only the current topic, no binary/document data.
  perform realtime.send(pg_catalog.jsonb_build_object('documentId', p_document, 'generation', p_generation::text,
    'headSeq', v_seq::text, 'aclGeneration', v_doc.acl_generation::text), 'update', v_doc.private_topic, true);
  return pg_catalog.jsonb_build_object('seq', v_seq::text, 'duplicate', false);
end $$;

-- RLS and explicit grants, including protection against permissive old defaults.
do $$ declare v_table text; begin
  foreach v_table in array array['documents','members','invites','updates','update_receipts','sync_snapshots'] loop
    execute pg_catalog.format('alter table public.collab_v2_%I enable row level security', v_table);
    execute pg_catalog.format('revoke all on public.collab_v2_%I from public, anon, authenticated, service_role', v_table);
    if v_table in ('documents','members','updates','sync_snapshots') then
      execute pg_catalog.format('grant select on public.collab_v2_%I to authenticated', v_table);
      execute pg_catalog.format('drop policy if exists collab_v2_member_read on public.collab_v2_%I', v_table);
      execute pg_catalog.format('create policy collab_v2_member_read on public.collab_v2_%I for select to authenticated using (collab_v2_private.is_member(%I))',
        v_table, case when v_table = 'documents' then 'id' else 'document_id' end);
    end if;
  end loop;
end $$;
drop policy if exists collab_v2_private_receive on realtime.messages;
create policy collab_v2_private_receive on realtime.messages for select to authenticated using (
  topic = (select realtime.topic()) and extension = 'broadcast' and exists (select 1 from public.collab_v2_documents d
    where d.private_topic = (select realtime.topic()) and d.deleted_at is null and collab_v2_private.is_member(d.id))
);
-- Restrictive fence prevents legacy permissive policies from granting v2 topics.
drop policy if exists collab_v2_receive_fence on realtime.messages;
create policy collab_v2_receive_fence on realtime.messages as restrictive for select to anon, authenticated using (
  topic not like 'collab-v2:%' or
  (topic = (select realtime.topic()) and extension = 'broadcast' and exists (select 1 from public.collab_v2_documents d
    where d.private_topic = (select realtime.topic()) and d.deleted_at is null and collab_v2_private.is_member(d.id)))
);
drop policy if exists collab_v2_send_fence on realtime.messages;
create policy collab_v2_send_fence on realtime.messages as restrictive for insert to anon, authenticated
  with check (topic not like 'collab-v2:%' and coalesce((select realtime.topic()), '') not like 'collab-v2:%');

-- No implicit PUBLIC execute. Internal functions are not exposed via private schema.
do $$ declare v_function record; begin
  for v_function in select p.oid::pg_catalog.regprocedure as signature, p.proname, n.nspname
    from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'collab_v2_private' or (n.nspname = 'public' and p.proname like 'collab_v2_%') loop
    execute pg_catalog.format('revoke all on function %s from public, anon, authenticated, service_role', v_function.signature);
    if v_function.proname in ('collab_v2_create_document', 'collab_v2_ingest_state', 'collab_v2_append') then
      execute pg_catalog.format('grant execute on function %s to service_role', v_function.signature);
    elsif v_function.nspname = 'public' or v_function.proname in ('is_member', 'require_user', 'read_state') then
      execute pg_catalog.format('grant execute on function %s to authenticated', v_function.signature);
    end if;
  end loop;
end $$;
commit;
