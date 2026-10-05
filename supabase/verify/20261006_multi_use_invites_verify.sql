-- Read-only metadata checks. No document contents, identities, tokens or hashes.
begin read only;
select column_name,data_type,is_nullable,column_default
from information_schema.columns where table_schema='public' and table_name='collab_v2_invites' and column_name='multi_use';
select n.nspname,c.relname,c.relrowsecurity
from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
where n.nspname='collab_v2_private' and c.relname='invite_uses';
select c.conname,c.contype,pg_catalog.pg_get_constraintdef(c.oid) as definition
from pg_catalog.pg_constraint c where c.conrelid in
  ('public.collab_v2_invites'::pg_catalog.regclass,'collab_v2_private.invite_uses'::pg_catalog.regclass)
order by c.conrelid,c.conname;
select p.oid::pg_catalog.regprocedure as signature,p.prosecdef,p.proconfig,
  pg_catalog.has_function_privilege('anon',p.oid,'EXECUTE') as anon_execute,
  pg_catalog.has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated_execute,
  pg_catalog.has_function_privilege('service_role',p.oid,'EXECUTE') as service_execute,
  exists(select 1 from pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
    where a.grantee=0 and a.privilege_type='EXECUTE') as public_execute
from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
where (n.nspname='public' and p.proname in ('collab_v2_create_invite','collab_v2_join','collab_v2_list_invites'))
  or (n.nspname='collab_v2_private' and p.proname in ('member_changed','user_deleting'))
order by p.oid::pg_catalog.regprocedure::text;
select r.role,
  pg_catalog.has_table_privilege(r.role,'collab_v2_private.invite_uses','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') as history_access
from (values ('anon'),('authenticated'),('service_role')) r(role);
select exists(select 1 from pg_catalog.pg_class c,
  lateral pg_catalog.aclexplode(coalesce(c.relacl,pg_catalog.acldefault('r',c.relowner))) a
  where c.oid='collab_v2_private.invite_uses'::pg_catalog.regclass and a.grantee=0) as public_history_access;
commit;
