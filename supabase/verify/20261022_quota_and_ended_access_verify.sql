-- Read-only metadata checks. No document contents, identities, tokens or hashes.
begin read only;

-- create: same arguments/defaults/result; creator's live count >=20 precedes
-- require_budget; no global 100-document cap; duplicate lookup includes tombstones.
-- get_updates/list_members: INVOKER, is_member before access_status ended check.
-- can_read_document: SQL/STABLE/DEFINER, auth.uid(), live document + membership.
select p.oid::pg_catalog.regprocedure as signature,
  pg_catalog.pg_get_function_arguments(p.oid) as arguments,
  pg_catalog.pg_get_function_result(p.oid) as result,
  pg_catalog.pg_get_functiondef(p.oid) as definition,
  pg_catalog.pg_get_userbyid(p.proowner) as owner,p.prosecdef,p.provolatile,p.proconfig,
  pg_catalog.has_function_privilege('anon',p.oid,'EXECUTE') as anon_execute,
  pg_catalog.has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated_execute,
  pg_catalog.has_function_privilege('service_role',p.oid,'EXECUTE') as service_execute,
  exists(select 1 from pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
    where a.grantee=0 and a.privilege_type='EXECUTE') as public_execute
from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
where (n.nspname='public' and p.proname in ('collab_v2_create_document','collab_v2_get_updates','collab_v2_list_members','collab_v2_access_status'))
  or (n.nspname='collab_v2_private' and p.proname in ('can_read_document','is_member','history_allowed'))
order by p.oid::pg_catalog.regprocedure::text;

-- true; compare against existing DEFINER owner, not a hard-coded role name.
select (select proowner from pg_catalog.pg_proc where oid='collab_v2_private.can_read_document(uuid)'::pg_catalog.regprocedure)
  = (select proowner from pg_catalog.pg_proc where oid='collab_v2_private.is_member(uuid)'::pg_catalog.regprocedure) as predicate_owner_matches;

-- Six true RLS flags. Inspect all SELECT/ALL policies, including extra permissive
-- policies: four member_read predicates use can_read_document; the history pair
-- still uses history_allowed(document_id,'view').
select c.relname,c.relrowsecurity,c.relforcerowsecurity
from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relname in ('collab_v2_documents','collab_v2_members','collab_v2_updates',
  'collab_v2_sync_snapshots','collab_v2_checkpoints','collab_v2_checkpoint_contents') order by c.relname;
select schemaname,tablename,policyname,permissive,roles,cmd,qual,with_check
from pg_catalog.pg_policies where schemaname='public' and cmd in ('SELECT','ALL')
  and tablename in ('collab_v2_documents','collab_v2_members','collab_v2_updates',
    'collab_v2_sync_snapshots','collab_v2_checkpoints','collab_v2_checkpoint_contents')
order by tablename,policyname;

select indexname,indexdef from pg_catalog.pg_indexes where schemaname='public'
  and indexname='collab_v2_documents_live_creator_idx';
commit;
