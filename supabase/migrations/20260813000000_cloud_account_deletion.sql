-- Self-service account deletion for App Store distribution.
-- The caller must reauthenticate in the client immediately before invoking
-- this RPC. Projects with no other owner are removed; co-owned projects are
-- transferred to another owner before the caller is detached.

drop function if exists public.delete_current_account(text);

create function public.delete_current_account(
  p_confirmation text
)
returns table (
  success boolean,
  reason text,
  deleted_project_count integer,
  transferred_project_count integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_email text;
  v_project record;
  v_next_owner uuid;
  v_deleted_count integer := 0;
  v_transferred_count integer := 0;
begin
  if v_uid is null then
    return query select false, 'not_authenticated', 0, 0;
    return;
  end if;

  if p_confirmation <> 'DELETE_MY_ACCOUNT' then
    return query select false, 'confirmation_required', 0, 0;
    return;
  end if;

  select lower(u.email)
  into v_email
  from auth.users u
  where u.id = v_uid;

  -- A project created by the caller can outlive a changed membership role.
  -- Handle both creator and owner membership so auth.users can be deleted
  -- without leaving a required created_by reference behind.
  for v_project in
    select distinct p.id
    from public.projects p
    left join public.project_members own_membership
      on own_membership.project_id = p.id
      and own_membership.user_id = v_uid
      and own_membership.role = 'owner'
    where p.created_by = v_uid
       or own_membership.user_id is not null
  loop
    select pm.user_id
    into v_next_owner
    from public.project_members pm
    where pm.project_id = v_project.id
      and pm.role = 'owner'
      and pm.user_id <> v_uid
    order by pm.joined_at asc, pm.user_id asc
    limit 1;

    if v_next_owner is null then
      delete from public.projects p
      where p.id = v_project.id;
      v_deleted_count := v_deleted_count + 1;
    else
      update public.projects p
      set created_by = v_next_owner,
          updated_at = now()
      where p.id = v_project.id
        and p.created_by = v_uid;

      delete from public.project_members pm
      where pm.project_id = v_project.id
        and pm.user_id = v_uid;

      v_transferred_count := v_transferred_count + 1;
    end if;
  end loop;

  -- Remove participation in projects the caller does not own.
  delete from public.project_members pm
  where pm.user_id = v_uid;

  -- Preserve project history while removing the deleted account identifier.
  update public.project_resources set updated_by = null where updated_by = v_uid;
  update public.scenes set updated_by = null where updated_by = v_uid;
  update public.snapshots set created_by = null where created_by = v_uid;
  update public.audit_logs set actor_id = null where actor_id = v_uid;
  update public.project_invites set accepted_by = null where accepted_by = v_uid;
  update public.scene_cell_versions set updated_by = null where updated_by = v_uid;

  -- Invitations sent to the account contain its email address and should not
  -- remain after a deletion request. Invitations created by the caller are
  -- removed by the invited_by ON DELETE CASCADE relationship below.
  if v_email is not null then
    delete from public.project_invites pi
    where lower(pi.invited_email) = v_email;
  end if;

  delete from auth.users u
  where u.id = v_uid;

  if not found then
    return query select false, 'user_not_found', v_deleted_count, v_transferred_count;
    return;
  end if;

  return query
  select true, 'ok', v_deleted_count, v_transferred_count;
end;
$$;

revoke all on function public.delete_current_account(text) from public;
grant execute on function public.delete_current_account(text) to authenticated;
