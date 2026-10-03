-- Disposable Linux PostgreSQL only. Never paste this into SQL Editor.
create schema auth;
create schema extensions;
create schema realtime;
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
grant usage on schema public, auth, extensions, realtime to anon, authenticated, service_role;
-- Emulate permissive older Supabase defaults to expose missing REVOKEs.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges grant execute on functions to anon, authenticated, service_role;
create table auth.users (
  id uuid primary key,
  email text,
  is_anonymous boolean not null default false,
  created_at timestamptz not null default now(),
  raw_user_meta_data jsonb not null default '{}'::jsonb
);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
create function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;
grant execute on function auth.uid(), auth.jwt() to anon, authenticated, service_role;
create table realtime.messages (id bigint generated always as identity primary key, topic text, extension text, payload jsonb);
alter table realtime.messages enable row level security;
grant select, insert on realtime.messages to authenticated;
grant usage on sequence realtime.messages_id_seq to authenticated;
create function realtime.topic() returns text language sql stable as $$
  select nullif(current_setting('realtime.topic', true), '')
$$;
create function realtime.send(payload jsonb, event text, topic text, private boolean default true)
returns void language sql as $$
  insert into realtime.messages(topic, extension, payload) values (topic, 'broadcast', payload)
$$;
-- Simulate legacy broad policies: v2's restrictive fences must still deny access.
create policy test_legacy_receive on realtime.messages for select to authenticated using (true);
create policy test_legacy_send on realtime.messages for insert to authenticated with check (true);
create publication supabase_realtime;
