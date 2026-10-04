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
-- Display-only projection written by validated Edge in the append transaction.
alter table public.collab_v2_documents add column if not exists list_title text not null default '隊列表'
  check (pg_catalog.char_length(list_title) between 1 and 120);
alter table public.collab_v2_documents add column if not exists title_seq bigint not null default 0 check (title_seq >= 0);
create index if not exists collab_v2_documents_list_order on public.collab_v2_documents(created_at desc, id desc) where deleted_at is null;
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
  used_membership uuid,
  revoked_at timestamptz,
  check (expires_at <= issued_at + interval '24 hours')
);
create index if not exists collab_v2_invites_document_idx on public.collab_v2_invites(document_id, issued_at);
create index if not exists collab_v2_invites_issuer_idx on public.collab_v2_invites(issued_by);
-- Unapplied foundation revision: retry a consumed invite only in the SAME
-- membership. It cannot grant a new membership after removal/rejoin.
alter table public.collab_v2_invites add column if not exists used_membership uuid;
create table if not exists collab_v2_private.join_attempts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  window_started timestamptz not null,
  attempts integer not null check (attempts between 1 and 21)
);
create table if not exists collab_v2_private.departures (
  document_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  reason text not null check (reason in ('removed', 'ended')),
  primary key (document_id, user_id)
);
alter table collab_v2_private.join_attempts enable row level security;
alter table collab_v2_private.departures enable row level security;
revoke all on collab_v2_private.join_attempts, collab_v2_private.departures from public, anon, authenticated, service_role;
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
alter table public.collab_v2_update_receipts add column if not exists writer_id uuid;
alter table public.collab_v2_update_receipts add column if not exists writer_seq bigint;
create unique index if not exists collab_v2_receipts_writer_seq on public.collab_v2_update_receipts(document_id, generation, writer_id, writer_seq) where writer_id is not null;
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
-- 9a: configuration is private and may be lowered after measuring the actual DB.
create table if not exists collab_v2_private.budget_settings (
  singleton boolean primary key default true check (singleton),
  total_bytes bigint not null default 134217728,
  state_bytes bigint not null default 83886080,
  checkpoint_bytes bigint not null default 33554432,
  work_bytes bigint not null default 16777216,
  document_checkpoint_count integer not null default 64,
  document_checkpoint_bytes bigint not null default 2097152,
  document_state_bytes bigint not null default 25165824,
  mandatory_checkpoint_bytes bigint not null default 8388608,
  writer_count integer not null default 1024,
  row_overhead integer not null default 512,
  automatic_interval interval not null default interval '10 minutes',
  check (state_bytes > 0 and checkpoint_bytes > 0 and work_bytes > 0 and total_bytes <= 134217728 and
    state_bytes + checkpoint_bytes + work_bytes <= total_bytes and document_checkpoint_count > 0 and
    document_checkpoint_bytes > 0 and document_state_bytes > 0 and mandatory_checkpoint_bytes >= document_checkpoint_bytes and writer_count > 0 and row_overhead >= 512 and automatic_interval > interval '0')
);
insert into collab_v2_private.budget_settings(singleton) values(true) on conflict do nothing;
create table if not exists public.collab_v2_writers (
  document_id uuid not null references public.collab_v2_documents(id) on delete cascade,
  generation bigint not null check (generation > 0), writer_id uuid not null,
  actor_id uuid references auth.users(id) on delete set null, membership_generation uuid not null,
  accepted_through bigint not null default 0 check (accepted_through >= 0),
  reclaimed_through bigint not null default 0 check (reclaimed_through between 0 and accepted_through),
  primary key(document_id, generation, writer_id)
);
create table if not exists public.collab_v2_checkpoint_contents (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  document_id uuid not null references public.collab_v2_documents(id) on delete cascade,
  format_version integer not null check (format_version = 1), shared_schema_version integer not null check (shared_schema_version in (1,2)),
  bytes bytea not null check (pg_catalog.octet_length(bytes) between 1 and 8388608),
  digest bytea not null check (pg_catalog.octet_length(digest) = 32),
  unique(document_id, digest), unique(document_id, id)
);
create table if not exists public.collab_v2_checkpoints (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  document_id uuid not null references public.collab_v2_documents(id) on delete cascade,
  generation bigint not null check (generation > 0), confirmed_seq bigint not null check (confirmed_seq >= 0),
  content_id uuid not null, reason text not null check (reason in ('manual','automatic','before-restore','before-generation')),
  requested_by uuid references auth.users(id) on delete set null, automatic boolean not null,
  server_at timestamptz not null default pg_catalog.now(),
  foreign key(document_id, content_id) references public.collab_v2_checkpoint_contents(document_id, id),
  check ((reason = 'automatic') = automatic)
);
create index if not exists collab_v2_checkpoints_listing on public.collab_v2_checkpoints(document_id, server_at desc, id);
-- The cut is persisted BEFORE append; both cron and opportunistic Edge may claim it.
create table if not exists collab_v2_private.history_due (
  document_id uuid primary key references public.collab_v2_documents(id) on delete cascade,
  generation bigint not null, cut_seq bigint not null check (cut_seq >= 0),
  due_at timestamptz not null default pg_catalog.now(),
  lease_id uuid, lease_until timestamptz,
  check ((lease_id is null) = (lease_until is null))
);
create table if not exists collab_v2_private.work_reservations (
  document_id uuid not null references public.collab_v2_documents(id) on delete cascade,
  lease_id uuid primary key, bytes bigint not null check(bytes > 0),
  expires_at timestamptz not null
);
alter table public.collab_v2_documents add column if not exists last_checkpoint_at timestamptz not null default pg_catalog.now();
alter table public.collab_v2_documents add column if not exists last_checkpoint_seq bigint not null default 0;
alter table public.collab_v2_documents add column if not exists previous_snapshot_id uuid;
-- No implicit grants/default privileges on private settings, due or reservations.
alter table collab_v2_private.budget_settings enable row level security;
alter table collab_v2_private.history_due enable row level security;
alter table collab_v2_private.work_reservations enable row level security;
revoke all on collab_v2_private.budget_settings, collab_v2_private.history_due, collab_v2_private.work_reservations from public, anon, authenticated, service_role;
-- Composite FK prevents a snapshot belonging to another document being referenced.
do $$ begin
  if not exists (select 1 from pg_catalog.pg_constraint where conname = 'collab_v2_latest_snapshot_fk'
    and conrelid = 'public.collab_v2_documents'::pg_catalog.regclass) then
    alter table public.collab_v2_documents add constraint collab_v2_latest_snapshot_fk
      foreign key (id, latest_snapshot_id) references public.collab_v2_sync_snapshots(document_id, id)
      deferrable initially deferred;
  end if;
  if not exists (select 1 from pg_catalog.pg_constraint where conname = 'collab_v2_previous_snapshot_fk' and conrelid = 'public.collab_v2_documents'::pg_catalog.regclass) then
    alter table public.collab_v2_documents add constraint collab_v2_previous_snapshot_fk
      foreign key (id, previous_snapshot_id) references public.collab_v2_sync_snapshots(document_id, id) deferrable initially deferred;
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
    if exists (select 1 from auth.users where id = old.user_id) then
      insert into collab_v2_private.departures(document_id, user_id, reason)
        values (v_document, old.user_id, 'removed') on conflict (document_id, user_id) do nothing;
    end if;
  else
    delete from collab_v2_private.departures where document_id = v_document and user_id = new.user_id;
  end if;
  return null;
end $$;
drop trigger if exists collab_v2_member_changed on public.collab_v2_members;
create trigger collab_v2_member_changed after insert or delete on public.collab_v2_members
  for each row execute function collab_v2_private.member_changed();

-- Deferred snapshot FK permits auth.users -> document -> snapshot cascades.
-- Existing delete_current_account eventually deletes auth.users, so no override.
create or replace function collab_v2_private.document_deleted()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into collab_v2_private.departures(document_id, user_id, reason)
    select old.id, m.user_id, 'ended' from public.collab_v2_members m
      join auth.users u on u.id = m.user_id where m.document_id = old.id
    on conflict (document_id, user_id) do update set reason = 'ended';
  update collab_v2_private.departures set reason = 'ended' where document_id = old.id;
  return old;
end $$;
drop trigger if exists collab_v2_document_deleted on public.collab_v2_documents;
create trigger collab_v2_document_deleted before delete on public.collab_v2_documents
  for each row execute function collab_v2_private.document_deleted();

-- BEFORE Auth cascades SET NULL issued_by, so cascade ordering cannot leave
-- an unused invitation unrevoked. Also applies to existing account-delete RPC.
create or replace function collab_v2_private.user_deleting()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.collab_v2_invites set revoked_at = coalesce(revoked_at, pg_catalog.now())
    where issued_by = old.id and used_at is null;
  return old;
end $$;
drop trigger if exists collab_v2_user_deleting on auth.users;
create trigger collab_v2_user_deleting before delete on auth.users
  for each row execute function collab_v2_private.user_deleting();

drop function if exists collab_v2_private.require_budget(bigint);
create or replace function collab_v2_private.require_budget(p_extra bigint, p_pool text default 'state', p_replaced bigint default 0)
returns void language plpgsql security definer set search_path = '' as $$
declare c collab_v2_private.budget_settings%rowtype; v_state bigint; v_history bigint; v_work bigint; v_delta bigint;
begin
  if p_extra is null or p_replaced is null or p_extra < 0 or p_replaced < 0 or p_pool is null or p_pool not in ('state','checkpoint','work') then
    raise exception using errcode = '22023', message = 'INVALID_ARGUMENT';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(20261004, 2);
  select * into strict c from collab_v2_private.budget_settings where singleton;
  select coalesce(sum(d.log_bytes + d.receipt_count * c.row_overhead::bigint + c.row_overhead),0) into v_state from public.collab_v2_documents d;
  v_state := v_state + (select count(*) * c.row_overhead::bigint from public.collab_v2_updates)
    + (select coalesce(sum(pg_catalog.octet_length(s.bytes) + c.row_overhead),0) from public.collab_v2_sync_snapshots s)
    + (select count(*) * c.row_overhead::bigint from public.collab_v2_writers)
    + (select count(*) * c.row_overhead::bigint from collab_v2_private.history_due);
  select coalesce(sum(pg_catalog.octet_length(bytes) + c.row_overhead),0) into v_history from public.collab_v2_checkpoint_contents;
  v_history := v_history + (select count(*) * c.row_overhead::bigint from public.collab_v2_checkpoints);
  -- Expired reservations still count until an atomic lease cleanup actually removes them.
  select coalesce(sum(bytes + c.row_overhead),0) into v_work from collab_v2_private.work_reservations;
  v_delta := p_extra - p_replaced;
  if p_pool = 'state' then v_state := v_state + v_delta;
  elsif p_pool = 'checkpoint' then v_history := v_history + v_delta;
  else v_work := v_work + v_delta; end if;
  if v_delta > 0 and (v_state + v_history + v_work > c.total_bytes or
    p_pool = 'state' and v_state > c.state_bytes or p_pool = 'checkpoint' and v_history > c.checkpoint_bytes or p_pool = 'work' and v_work > c.work_bytes) then
    raise exception using errcode = '54000', message = 'PROJECT_QUOTA_EXCEEDED';
  end if;
end $$;

-- Creation must go through Edge validation too, not an authenticated bytea RPC.
drop function if exists public.collab_v2_create_document(uuid, text, bytea);
create or replace function public.collab_v2_create_document(p_actor uuid, p_display_name text, p_bytes bytea, p_title text default '隊列表')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_snapshot uuid; v_guest boolean; v_digest bytea;
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
  perform collab_v2_private.require_budget(pg_catalog.octet_length(p_bytes) + (select 2 * row_overhead from collab_v2_private.budget_settings where singleton));
  if (select count(*) from public.collab_v2_documents where creator_id = p_actor) >= 20
    or (select count(*) from public.collab_v2_documents) >= 100 then
    raise exception using errcode = '54000', message = 'QUOTA_EXCEEDED';
  end if;
  insert into public.collab_v2_documents(creator_id, initial_digest, list_title) values (p_actor, v_digest, p_title) returning id into v_id;
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
  v_document uuid; v_member uuid; v_guest boolean; v_attempts integer;
begin
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
  if v_invite.used_at is not null and v_invite.used_by = v_user and v_invite.used_membership = v_member then
    -- Only replay the receipt; no INSERT/ACL rotation/name mutation.
    return (select pg_catalog.jsonb_build_object('documentId', d.id, 'generation', d.generation::text,
      'headSeq', d.head_seq::text, 'aclGeneration', d.acl_generation::text, 'topic', d.private_topic,
      'membershipGeneration', v_member) from public.collab_v2_documents d where d.id = v_document);
  end if;
  if v_invite.id is null or v_invite.revoked_at is not null or v_invite.used_at is not null
    or v_invite.expires_at <= pg_catalog.now() or not exists (
      select 1 from public.collab_v2_members where document_id = v_document and user_id = v_invite.issued_by) then
    return pg_catalog.jsonb_build_object('error', 'INVALID_INVITE');
  end if;
  if v_member is null then
    if (select count(*) from public.collab_v2_members where document_id = v_document) >= 8 then
      return pg_catalog.jsonb_build_object('error', 'MEMBER_LIMIT');
    end if;
    select is_anonymous into v_guest from auth.users where id = v_user;
    insert into public.collab_v2_members(document_id, user_id, display_name, is_guest)
      values (v_document, v_user, p_display_name, v_guest) returning membership_generation into v_member;
  end if;
  update public.collab_v2_invites set used_at = pg_catalog.now(), used_by = v_user, used_membership = v_member where id = v_invite.id;
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
  update public.collab_v2_documents set deleted_at = coalesce(deleted_at, pg_catalog.now()), latest_snapshot_id = null, previous_snapshot_id = null,
    acl_generation = acl_generation + 1, private_topic = 'collab-v2:' || pg_catalog.gen_random_uuid()::text,
    log_bytes = 0, receipt_count = 0 where id = p_document;
  delete from public.collab_v2_invites where document_id = p_document;
  delete from public.collab_v2_updates where document_id = p_document;
  delete from public.collab_v2_update_receipts where document_id = p_document;
  delete from public.collab_v2_checkpoints where document_id = p_document;
  delete from public.collab_v2_checkpoint_contents where document_id = p_document;
  delete from public.collab_v2_writers where document_id = p_document;
  delete from collab_v2_private.history_due where document_id = p_document;
  delete from collab_v2_private.work_reservations where document_id = p_document;
  delete from public.collab_v2_sync_snapshots where document_id = p_document;
  update collab_v2_private.departures set reason = 'ended' where document_id = p_document;
end $$;

-- Only the caller's prior relationship is disclosed; no document contents or
-- existence oracle for outsiders. A creator Auth deletion leaves this receipt.
create or replace function public.collab_v2_access_status(p_document uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_user uuid := collab_v2_private.require_user(); v_member uuid; v_deleted boolean; v_reason text;
begin
  if p_document is null then raise exception using errcode = '22023', message = 'INVALID_ARGUMENT'; end if;
  select m.membership_generation, d.deleted_at is not null into v_member, v_deleted
    from public.collab_v2_members m join public.collab_v2_documents d on d.id = m.document_id
    where m.document_id = p_document and m.user_id = v_user;
  if found then
    if v_deleted then return pg_catalog.jsonb_build_object('status', 'ended'); end if;
    return pg_catalog.jsonb_build_object('status', 'active', 'membershipGeneration', v_member);
  end if;
  select reason into v_reason from collab_v2_private.departures where document_id = p_document and user_id = v_user;
  return pg_catalog.jsonb_build_object('status', coalesce(v_reason, 'unavailable'));
end $$;
create or replace function public.collab_v2_list_members(p_document uuid)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
begin
  perform collab_v2_private.require_user();
  if p_document is null then raise exception using errcode = '22023', message = 'INVALID_ARGUMENT'; end if;
  if not collab_v2_private.is_member(p_document) then raise exception using errcode = '42501', message = 'NOT_MEMBER'; end if;
  if exists (select 1 from public.collab_v2_documents where id = p_document and deleted_at is not null) then
    raise exception using errcode = '42501', message = 'DOCUMENT_DELETED';
  end if;
  return (select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('userId', m.user_id,
    'displayName', m.display_name, 'isGuest', m.is_guest, 'isCreator', m.user_id = d.creator_id)
    order by m.joined_at, m.user_id), '[]'::jsonb)
    from public.collab_v2_members m join public.collab_v2_documents d on d.id = m.document_id where d.id = p_document);
end $$;

-- Current membership only. No CRDT, topic, names or emails in the home listing.
create or replace function public.collab_v2_list_my_documents(p_limit integer default 32,
  p_before_created_at timestamptz default null, p_before_id uuid default null)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare v_user uuid := collab_v2_private.require_user(); v_rows jsonb; v_last jsonb;
begin
  if p_limit is null or p_limit not between 1 and 100 or (p_before_created_at is null) <> (p_before_id is null) then
    raise exception using errcode = '22023', message = 'INVALID_ARGUMENT';
  end if;
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('documentId', d.id, 'title', d.list_title,
    'createdAt', d.created_at, 'isCreator', d.creator_id = v_user, 'memberCount',
    (select count(*) from public.collab_v2_members m where m.document_id = d.id), 'documentSchema', d.document_schema)
    order by d.created_at desc, d.id desc), '[]'::jsonb) into v_rows
    from (select d.* from public.collab_v2_documents d where d.deleted_at is null
      and exists (select 1 from public.collab_v2_members mine where mine.document_id = d.id and mine.user_id = v_user)
      and (p_before_id is null or (d.created_at, d.id) < (p_before_created_at, p_before_id))
      order by d.created_at desc, d.id desc limit p_limit + 1) d;
  if pg_catalog.jsonb_array_length(v_rows) > p_limit then v_rows := v_rows - p_limit; v_last := v_rows -> (p_limit - 1); end if;
  return pg_catalog.jsonb_build_object('items', v_rows, 'nextCursor', case when v_last is null then null else
    pg_catalog.jsonb_build_object('createdAt', v_last->>'createdAt', 'documentId', v_last->>'documentId') end);
end $$;

create or replace function public.collab_v2_open_existing(p_document uuid)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare v_user uuid := collab_v2_private.require_user(); v_receipt jsonb;
begin
  select pg_catalog.jsonb_build_object('documentId', d.id, 'generation', d.generation::text,
    'headSeq', d.head_seq::text, 'aclGeneration', d.acl_generation::text, 'topic', d.private_topic,
    'membershipGeneration', m.membership_generation) into v_receipt
    from public.collab_v2_documents d join public.collab_v2_members m on m.document_id = d.id
    where d.id = p_document and d.deleted_at is null and m.user_id = v_user;
  if v_receipt is null then raise exception using errcode = '42501', message = 'NOT_MEMBER'; end if;
  return v_receipt;
end $$;

-- Invites are private; expose expiry/state after current membership check.
-- Never return tokens/hashes after issuance.
create or replace function public.collab_v2_list_invites(p_document uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform collab_v2_private.require_user();
  if not collab_v2_private.is_member(p_document) or not exists
    (select 1 from public.collab_v2_documents where id = p_document and deleted_at is null) then
    raise exception using errcode = '42501', message = 'NOT_MEMBER';
  end if;
  return (select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('inviteId', id, 'expiresAt', expires_at,
    'status', case when revoked_at is not null then 'revoked' when used_at is not null then 'used'
      when expires_at <= pg_catalog.now() then 'expired' else 'active' end) order by issued_at desc, id), '[]'::jsonb)
    from public.collab_v2_invites where document_id = p_document);
end $$;

-- One SELECT = one MVCC snapshot. Never mix a newer head with an older page.
drop function if exists public.collab_v2_get_updates(uuid,bigint,bigint,integer);
drop function if exists collab_v2_private.read_state(uuid,bigint,integer);
create or replace function collab_v2_private.read_state(p_document uuid, p_cursor bigint, p_limit integer, p_known_snapshot_id uuid default null)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select pg_catalog.jsonb_build_object('documentId', d.id, 'documentSchema', d.document_schema,
    'generation', d.generation::text, 'headSeq', d.head_seq::text, 'aclGeneration', d.acl_generation::text,
    'topic', d.private_topic, 'deleted', d.deleted_at is not null,
    'snapshot', case when p_cursor < s.upto_seq or p_known_snapshot_id is distinct from s.id then
      pg_catalog.jsonb_build_object('id', s.id, 'uptoSeq', s.upto_seq::text, 'bytes', pg_catalog.replace(pg_catalog.encode(s.bytes, 'base64'), E'\n', '')) else null end,
    'updates', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'seq', u.seq::text, 'updateId', u.client_update_id, 'actor', u.actor_id,
      'bytes', pg_catalog.replace(pg_catalog.encode(u.bytes, 'base64'), E'\n', '')) order by u.seq)
      from (select * from public.collab_v2_updates where document_id = d.id and generation = d.generation
        and seq > greatest(p_cursor, coalesce(s.upto_seq, 0)) and seq <= d.head_seq order by seq limit p_limit) u), '[]'::jsonb))
  from public.collab_v2_documents d left join public.collab_v2_sync_snapshots s on s.id = d.latest_snapshot_id and s.document_id = d.id
  where d.id = p_document
$$;
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
  v_state := collab_v2_private.read_state(p_document, p_cursor, p_limit, p_known_snapshot_id);
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
drop function if exists public.collab_v2_append(uuid, uuid, bigint, uuid, bigint, text, bytea, bytea);
drop function if exists public.collab_v2_append(uuid, uuid, bigint, uuid, bigint, text, bytea, bytea, text);
create or replace function public.collab_v2_append(p_document uuid, p_actor uuid, p_generation bigint,
  p_membership uuid, p_expected_head bigint, p_update_id text, p_bytes bytea, p_digest bytea, p_title text default '隊列表', p_writer uuid default null, p_writer_seq bigint default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_doc public.collab_v2_documents%rowtype; v_receipt public.collab_v2_update_receipts%rowtype; v_writer public.collab_v2_writers%rowtype; v_seq bigint; c collab_v2_private.budget_settings%rowtype;
begin
  perform collab_v2_private.require_service();
  if p_title is null or pg_catalog.char_length(p_title) not between 1 and 120 or p_document is null or p_actor is null or p_generation is null or p_membership is null
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
  if (p_writer is null) <> (p_writer_seq is null) or p_writer_seq <= 0 then raise exception using errcode = '22023', message = 'INVALID_WRITER'; end if;
  select * into strict c from collab_v2_private.budget_settings where singleton;
  if p_writer is not null then
    select * into v_writer from public.collab_v2_writers where document_id = p_document and generation = p_generation and writer_id = p_writer;
    if not found then
      if (select count(*) from public.collab_v2_writers where document_id = p_document) >= c.writer_count then raise exception using errcode = '54000', message = 'WRITER_QUOTA_EXCEEDED'; end if;
      perform collab_v2_private.require_budget(c.row_overhead);
      insert into public.collab_v2_writers(document_id,generation,writer_id,actor_id,membership_generation)
        values(p_document,p_generation,p_writer,p_actor,p_membership) returning * into v_writer;
    end if;
    if v_writer.actor_id is distinct from p_actor or v_writer.membership_generation <> p_membership then raise exception using errcode = '42501', message = 'WRITER_MISMATCH'; end if;
    if p_writer_seq <= v_writer.reclaimed_through then
      return pg_catalog.jsonb_build_object('result','RECEIPT_RECLAIMED','writerId',p_writer,'reclaimedThrough',v_writer.reclaimed_through::text);
    end if;
  end if;
  select * into v_receipt from public.collab_v2_update_receipts
    where document_id = p_document and generation = p_generation and client_update_id = p_update_id;
  if found then
    if v_receipt.digest <> p_digest or v_receipt.byte_length <> pg_catalog.octet_length(p_bytes) then
      raise exception using errcode = '22023', message = 'UPDATE_ID_CONFLICT';
    end if;
    if v_receipt.actor_id is distinct from p_actor then raise exception using errcode = '42501', message = 'ACTOR_MISMATCH'; end if;
    if p_writer is not null and v_receipt.writer_id is null then
      -- Upgrade an ACK-lost legacy request without appending its bytes again.
      if v_writer.accepted_through = 9223372036854775807 or p_writer_seq <> v_writer.accepted_through + 1 then raise exception using errcode='40001',message='WRITER_SEQUENCE_CONFLICT'; end if;
      update public.collab_v2_update_receipts set writer_id=p_writer,writer_seq=p_writer_seq where document_id=p_document and generation=p_generation and client_update_id=p_update_id;
      update public.collab_v2_writers set accepted_through=p_writer_seq where document_id=p_document and generation=p_generation and writer_id=p_writer;
    elsif v_receipt.writer_id is distinct from p_writer or v_receipt.writer_seq is distinct from p_writer_seq then raise exception using errcode='22023',message='WRITER_SEQUENCE_CONFLICT';
    end if;
    return pg_catalog.jsonb_build_object('seq', v_receipt.seq::text, 'duplicate', true);
  end if;
  -- Once any writer exists, an old unsequenced executable must not bypass a
  -- collected writer fence after 9b removes the corresponding log entry.
  if p_writer is null and exists(select 1 from public.collab_v2_writers where document_id=p_document and generation=p_generation) then raise exception using errcode='22023',message='WRITER_REQUIRED'; end if;
  if v_doc.head_seq = 9223372036854775807 or p_writer is not null and v_writer.accepted_through = 9223372036854775807 then raise exception using errcode='54000',message='SEQUENCE_QUOTA_EXCEEDED'; end if;
  if p_writer is not null and p_writer_seq <> v_writer.accepted_through + 1 then raise exception using errcode = '40001', message = 'WRITER_SEQUENCE_CONFLICT'; end if;
  if exists(select 1 from public.collab_v2_updates where document_id=p_document and generation=p_generation and client_update_id=p_update_id) then
    raise exception using errcode='22023', message='UPDATE_ID_CONFLICT';
  end if;
  if v_doc.head_seq <> p_expected_head then raise exception using errcode = '40001', message = 'HEAD_CONFLICT'; end if;
  if v_doc.log_bytes + pg_catalog.octet_length(p_bytes) > 4194304 or v_doc.receipt_count >= 4096
    or (select count(*) from public.collab_v2_updates where document_id=p_document) >= 4096
    or v_doc.log_bytes + pg_catalog.octet_length(p_bytes) + (v_doc.receipt_count + 1) * c.row_overhead
      + (select coalesce(sum(pg_catalog.octet_length(bytes) + c.row_overhead),0) from public.collab_v2_sync_snapshots where document_id = p_document)
      + (select count(*) * c.row_overhead from public.collab_v2_writers where document_id=p_document)
      + (select (count(*)+1) * c.row_overhead from public.collab_v2_updates where document_id=p_document) > c.document_state_bytes then
    raise exception using errcode = '54000', message = 'QUOTA_EXCEEDED';
  end if;
  perform collab_v2_private.require_budget(pg_catalog.octet_length(p_bytes) + 2 * c.row_overhead +
    case when v_doc.head_seq > v_doc.last_checkpoint_seq and pg_catalog.now() - v_doc.last_checkpoint_at >= c.automatic_interval
      and not exists(select 1 from collab_v2_private.history_due where document_id=p_document) then c.row_overhead else 0 end);
  if v_doc.head_seq > v_doc.last_checkpoint_seq and pg_catalog.now() - v_doc.last_checkpoint_at >= c.automatic_interval then
    insert into collab_v2_private.history_due(document_id,generation,cut_seq) values(p_document,p_generation,v_doc.head_seq) on conflict do nothing;
  end if;
  v_seq := v_doc.head_seq + 1;
  insert into public.collab_v2_updates(document_id, seq, generation, client_update_id, actor_id, bytes, digest)
    values (p_document, v_seq, p_generation, p_update_id, p_actor, p_bytes, p_digest);
  insert into public.collab_v2_update_receipts(document_id, generation, client_update_id, seq, actor_id, digest, byte_length, writer_id, writer_seq)
    values (p_document, p_generation, p_update_id, v_seq, p_actor, p_digest, pg_catalog.octet_length(p_bytes), p_writer, p_writer_seq);
  if p_writer is not null then update public.collab_v2_writers set accepted_through=p_writer_seq where document_id=p_document and generation=p_generation and writer_id=p_writer; end if;
  update public.collab_v2_documents set head_seq = v_seq, log_bytes = log_bytes + pg_catalog.octet_length(p_bytes),
    receipt_count = receipt_count + 1, list_title = p_title, title_seq = v_seq where id = p_document;
  -- Transactional notification: only the current topic, no binary/document data.
  perform realtime.send(pg_catalog.jsonb_build_object('documentId', p_document, 'generation', p_generation::text,
    'headSeq', v_seq::text, 'aclGeneration', v_doc.acl_generation::text), 'update', v_doc.private_topic, true);
  return pg_catalog.jsonb_build_object('seq', v_seq::text, 'duplicate', false);
end $$;

-- Only continuous server-accepted writer sequences can be confirmed. The client
-- calls this AFTER the atomic local ACK/base/boundary commit, also after restart.
create or replace function public.collab_v2_confirm_writer(p_document uuid, p_generation bigint, p_membership uuid, p_writer uuid, p_ack_through bigint)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user uuid := collab_v2_private.require_user(); d public.collab_v2_documents%rowtype; w public.collab_v2_writers%rowtype; c collab_v2_private.budget_settings%rowtype; v_removed integer;
begin
  if p_document is null or p_generation is null or p_generation <= 0 or p_membership is null or p_writer is null or p_ack_through is null or p_ack_through < 0 then raise exception using errcode='22023', message='INVALID_ARGUMENT'; end if;
  select * into d from public.collab_v2_documents where id=p_document for update;
  if not found or d.deleted_at is not null then raise exception using errcode='42501',message='DOCUMENT_DELETED'; end if;
  if not exists(select 1 from public.collab_v2_members where document_id=p_document and user_id=v_user and membership_generation=p_membership) then raise exception using errcode='42501',message='NOT_MEMBER'; end if;
  if d.generation <> p_generation then raise exception using errcode='40001',message='STALE_GENERATION'; end if;
  select * into w from public.collab_v2_writers where document_id=p_document and generation=p_generation and writer_id=p_writer;
  if not found then
    if p_ack_through <> 0 then raise exception using errcode='22023',message='ACK_AHEAD'; end if;
    select * into strict c from collab_v2_private.budget_settings where singleton;
    if (select count(*) from public.collab_v2_writers where document_id=p_document) >= c.writer_count then raise exception using errcode='54000',message='WRITER_QUOTA_EXCEEDED'; end if;
    perform collab_v2_private.require_budget(c.row_overhead);
    insert into public.collab_v2_writers(document_id,generation,writer_id,actor_id,membership_generation) values(p_document,p_generation,p_writer,v_user,p_membership) returning * into w;
  end if;
  if w.actor_id is distinct from v_user or w.membership_generation <> p_membership then raise exception using errcode='42501',message='WRITER_MISMATCH'; end if;
  if p_ack_through > w.accepted_through then raise exception using errcode='22023',message='ACK_AHEAD'; end if;
  if p_ack_through > w.reclaimed_through then
    delete from public.collab_v2_update_receipts where document_id=p_document and generation=p_generation and writer_id=p_writer and writer_seq <= p_ack_through;
    get diagnostics v_removed = row_count;
    update public.collab_v2_documents set receipt_count=receipt_count-v_removed where id=p_document;
    update public.collab_v2_writers set reclaimed_through=p_ack_through where document_id=p_document and generation=p_generation and writer_id=p_writer;
    w.reclaimed_through := p_ack_through;
  end if;
  return pg_catalog.jsonb_build_object('writerId',p_writer,'reclaimedThrough',w.reclaimed_through::text);
end $$;

-- Early result avoids replaying today's full Doc for an ancient reclaimed request.
create or replace function public.collab_v2_probe_writer(p_document uuid, p_actor uuid, p_generation bigint, p_membership uuid, p_writer uuid, p_writer_seq bigint)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare d public.collab_v2_documents%rowtype; w public.collab_v2_writers%rowtype;
begin
  perform collab_v2_private.require_service();
  if p_document is null or p_actor is null or p_generation is null or p_generation <= 0 or p_membership is null or p_writer is null or p_writer_seq is null or p_writer_seq <= 0 then raise exception using errcode='22023',message='INVALID_ARGUMENT'; end if;
  select * into d from public.collab_v2_documents where id=p_document;
  if not found or d.deleted_at is not null then raise exception using errcode='42501',message='DOCUMENT_DELETED'; end if;
  if not exists(select 1 from public.collab_v2_members m join auth.users u on u.id=m.user_id where document_id=p_document and user_id=p_actor and membership_generation=p_membership) then raise exception using errcode='42501',message='NOT_MEMBER'; end if;
  if d.generation <> p_generation then raise exception using errcode='40001',message='STALE_GENERATION'; end if;
  select * into w from public.collab_v2_writers where document_id=p_document and generation=p_generation and writer_id=p_writer;
  if found then
    if w.actor_id is distinct from p_actor or w.membership_generation <> p_membership then raise exception using errcode='42501',message='WRITER_MISMATCH'; end if;
    if p_writer_seq <= w.reclaimed_through then return pg_catalog.jsonb_build_object('result','RECEIPT_RECLAIMED','writerId',p_writer,'reclaimedThrough',w.reclaimed_through::text); end if;
  end if;
  return null;
end $$;

-- USER CONFIRMATION PENDING: this is the ONE history authorization decision.
-- Active members (including guests) may view/copy/create/restore pre-join history;
-- only the creator may manually delete. Automatic thinning is server-only (9b).
create or replace function collab_v2_private.history_allowed(p_document uuid, p_operation text, p_actor uuid default auth.uid())
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.collab_v2_members m join auth.users u on u.id=m.user_id where m.document_id=p_document and m.user_id=p_actor)
    and exists(select 1 from public.collab_v2_documents d where d.id=p_document and d.deleted_at is null and
    (p_operation in ('view','copy','create','restore') or p_operation='delete' and d.creator_id=p_actor))
$$;
-- Foundation primitive for a dedicated validating Edge in 9b. There is no client
-- endpoint for inserting arbitrary DTOs; server time/requester are set here.
create or replace function public.collab_v2_store_checkpoint(p_document uuid, p_actor uuid, p_generation bigint, p_seq bigint, p_bytes bytea, p_digest bytea, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare d public.collab_v2_documents%rowtype; c collab_v2_private.budget_settings%rowtype; v_content public.collab_v2_checkpoint_contents%rowtype;
  v_payload jsonb; v_new_bytes bigint; v_used bigint; v_count bigint; v_id uuid; v_mandatory boolean;
begin
  perform collab_v2_private.require_service();
  if p_document is null or p_actor is null or p_generation is null or p_generation <= 0 or p_seq is null or p_seq < 0 or p_bytes is null or
    pg_catalog.octet_length(p_bytes) not between 1 and 8388608 or p_digest is null or pg_catalog.octet_length(p_digest) <> 32 or
    p_reason is null or p_reason not in ('manual','automatic','before-restore','before-generation') then raise exception using errcode='22023',message='INVALID_ARGUMENT'; end if;
  if extensions.digest(p_bytes,'sha256') <> p_digest then raise exception using errcode='22023',message='CHECKPOINT_DIGEST_MISMATCH'; end if;
  v_payload := pg_catalog.convert_from(p_bytes,'UTF8')::jsonb;
  if pg_catalog.jsonb_typeof(v_payload) <> 'object' or not (v_payload ?& array['formatVersion','sharedSchemaVersion','content','song']) or
    pg_catalog.jsonb_typeof(v_payload->'formatVersion') <> 'number' or pg_catalog.jsonb_typeof(v_payload->'sharedSchemaVersion') <> 'number' or
    v_payload->>'formatVersion' <> '1' or v_payload->>'sharedSchemaVersion' not in ('1','2') or
    pg_catalog.jsonb_typeof(v_payload->'content') <> 'object' or not v_payload ? 'song' or (select count(*) from pg_catalog.jsonb_object_keys(v_payload)) <> 4 then raise exception using errcode='22023',message='INVALID_CHECKPOINT'; end if;
  select * into d from public.collab_v2_documents where id=p_document for update;
  if not collab_v2_private.history_allowed(p_document,'create',p_actor) then raise exception using errcode='42501',message='NOT_MEMBER'; end if;
  if d.generation <> p_generation or p_seq > d.head_seq then raise exception using errcode='40001',message='INVALID_CHECKPOINT_CUT'; end if;
  if (v_payload->>'sharedSchemaVersion')::integer <> d.document_schema then raise exception using errcode='22023',message='UNSUPPORTED_SCHEMA'; end if;
  select * into strict c from collab_v2_private.budget_settings where singleton;
  select * into v_content from public.collab_v2_checkpoint_contents where document_id=p_document and digest=p_digest;
  if found and v_content.bytes <> p_bytes then raise exception using errcode='22023',message='CHECKPOINT_DIGEST_MISMATCH'; end if;
  v_new_bytes := case when v_content.id is null then pg_catalog.octet_length(p_bytes) + c.row_overhead else 0 end;
  select count(*) into v_count from public.collab_v2_checkpoints where document_id=p_document;
  select coalesce(sum(pg_catalog.octet_length(bytes)+c.row_overhead),0) into v_used from public.collab_v2_checkpoint_contents where document_id=p_document;
  v_used := v_used + (v_count + 1) * c.row_overhead + v_new_bytes;
  v_mandatory := p_reason in ('before-restore','before-generation');
  begin
    if v_count >= c.document_checkpoint_count + case when v_mandatory then 2 else 0 end or v_used > case when v_mandatory then c.mandatory_checkpoint_bytes else c.document_checkpoint_bytes end then
      raise exception using errcode='54000',message='CHECKPOINT_QUOTA_EXCEEDED';
    end if;
    perform collab_v2_private.require_budget(v_new_bytes + c.row_overhead,'checkpoint');
  exception when sqlstate '54000' then
    if p_reason='automatic' then return pg_catalog.jsonb_build_object('result','DEFERRED_CAPACITY'); else raise; end if;
  end;
  if v_content.id is null then
    insert into public.collab_v2_checkpoint_contents(document_id,format_version,shared_schema_version,bytes,digest)
      values(p_document,1,(v_payload->>'sharedSchemaVersion')::integer,p_bytes,p_digest) returning * into v_content;
  end if;
  insert into public.collab_v2_checkpoints(document_id,generation,confirmed_seq,content_id,reason,requested_by,automatic)
    values(p_document,p_generation,p_seq,v_content.id,p_reason,p_actor,p_reason='automatic') returning id into v_id;
  return pg_catalog.jsonb_build_object('id',v_id,'contentId',v_content.id,'result','STORED');
end $$;
create or replace function public.collab_v2_list_checkpoints(p_document uuid, p_before_at timestamptz default null, p_before_id uuid default null, p_limit integer default 32)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
begin
  perform collab_v2_private.require_user();
  if p_document is null or p_limit is null or p_limit not between 1 and 64 or (p_before_at is null) <> (p_before_id is null) then raise exception using errcode='22023',message='INVALID_ARGUMENT'; end if;
  if not collab_v2_private.history_allowed(p_document,'view') then raise exception using errcode='42501',message='NOT_MEMBER'; end if;
  return (select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id',h.id,'documentId',h.document_id,'generation',h.generation::text,'confirmedSeq',h.confirmed_seq::text,
    'reason',h.reason,'serverAt',pg_catalog.to_char(h.server_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'requestedBy',h.requested_by,'automatic',h.automatic,'digest',pg_catalog.encode(c.digest,'hex'),'formatVersion',c.format_version,'sharedSchemaVersion',c.shared_schema_version) order by h.server_at desc,h.id desc),'[]'::jsonb)
    from (select * from public.collab_v2_checkpoints where document_id=p_document and (p_before_at is null or (server_at,id)<(p_before_at,p_before_id)) order by server_at desc,id desc limit p_limit) h
    join public.collab_v2_checkpoint_contents c on c.document_id=h.document_id and c.id=h.content_id);
end $$;
create or replace function public.collab_v2_get_checkpoint(p_document uuid, p_checkpoint uuid)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
begin
  perform collab_v2_private.require_user();
  if not collab_v2_private.history_allowed(p_document,'view') then raise exception using errcode='42501',message='NOT_MEMBER'; end if;
  return (select pg_catalog.jsonb_build_object('documentId',h.document_id,'generation',h.generation::text,'confirmedSeq',h.confirmed_seq::text,
    'formatVersion',c.format_version,'sharedSchemaVersion',c.shared_schema_version,'content',pg_catalog.convert_from(c.bytes,'UTF8')::jsonb->'content',
    'song',pg_catalog.convert_from(c.bytes,'UTF8')::jsonb->'song','digest',pg_catalog.encode(c.digest,'hex'),'reason',h.reason,'serverAt',pg_catalog.to_char(h.server_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'requestedBy',h.requested_by,'automatic',h.automatic)
    from public.collab_v2_checkpoints h join public.collab_v2_checkpoint_contents c on c.document_id=h.document_id and c.id=h.content_id where h.document_id=p_document and h.id=p_checkpoint);
end $$;
create or replace function public.collab_v2_delete_checkpoint(p_document uuid, p_checkpoint uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_content uuid;
begin
  perform collab_v2_private.require_user();
  perform 1 from public.collab_v2_documents where id=p_document for update;
  if not collab_v2_private.history_allowed(p_document,'delete') then raise exception using errcode='42501',message='CREATOR_ONLY'; end if;
  delete from public.collab_v2_checkpoints where document_id=p_document and id=p_checkpoint returning content_id into v_content;
  delete from public.collab_v2_checkpoint_contents c where c.document_id=p_document and c.id=v_content and not exists(select 1 from public.collab_v2_checkpoints h where h.document_id=p_document and h.content_id=c.id);
end $$;

-- RLS and explicit grants, including protection against permissive old defaults.
do $$ declare v_table text; begin
  foreach v_table in array array['documents','members','invites','updates','update_receipts','sync_snapshots','writers','checkpoints','checkpoint_contents'] loop
    execute pg_catalog.format('alter table public.collab_v2_%I enable row level security', v_table);
    execute pg_catalog.format('revoke all on public.collab_v2_%I from public, anon, authenticated, service_role', v_table);
    if v_table in ('documents','members','updates','sync_snapshots','checkpoints','checkpoint_contents') then
      execute pg_catalog.format('grant select on public.collab_v2_%I to authenticated', v_table);
      execute pg_catalog.format('drop policy if exists collab_v2_member_read on public.collab_v2_%I', v_table);
      execute pg_catalog.format('create policy collab_v2_member_read on public.collab_v2_%I for select to authenticated using (collab_v2_private.is_member(%I))',
        v_table, case when v_table = 'documents' then 'id' else 'document_id' end);
      if v_table in ('checkpoints','checkpoint_contents') then
        execute pg_catalog.format('drop policy if exists collab_v2_member_read on public.collab_v2_%I',v_table);
        execute pg_catalog.format('create policy collab_v2_member_read on public.collab_v2_%I for select to authenticated using(collab_v2_private.history_allowed(document_id,''view''))',v_table);
      end if;
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
    if v_function.proname in ('collab_v2_create_document', 'collab_v2_ingest_state', 'collab_v2_append','collab_v2_probe_writer','collab_v2_store_checkpoint') then
      execute pg_catalog.format('grant execute on function %s to service_role', v_function.signature);
    elsif v_function.nspname = 'public' or v_function.proname in ('is_member', 'require_user', 'read_state','history_allowed') then
      execute pg_catalog.format('grant execute on function %s to authenticated', v_function.signature);
    end if;
  end loop;
end $$;
commit;
