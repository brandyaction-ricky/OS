-- F4: label shared OS identities without changing or revoking existing keys.
alter table public.os_profiles
  add column if not exists is_shared_account boolean not null default false;

alter table public.os_security_audit_logs
  drop constraint if exists os_security_audit_logs_action_check;
alter table public.os_security_audit_logs
  add constraint os_security_audit_logs_action_check check (action in (
    'account.created', 'password.changed', 'password.reset',
    'member.shared_account', 'agent_key.issued_shared', 'agent_key.reissue_requested'
  ));

create or replace function public.os_set_shared_account(p_actor uuid, p_target uuid, p_shared boolean)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare old_shared boolean;
begin
  if not exists (select 1 from public.os_profiles where id = p_actor and is_active and role = 'admin') then
    raise exception using errcode = '42501', message = 'ADMIN_REQUIRED';
  end if;
  select is_shared_account into old_shared from public.os_profiles where id = p_target for update;
  if not found then raise exception using errcode = 'P0002', message = 'MEMBER_NOT_FOUND'; end if;
  if p_target = p_actor and p_shared then
    raise exception using errcode = '23514', message = 'OWN_ADMIN_CANNOT_BE_SHARED';
  end if;
  if old_shared is distinct from p_shared then
    update public.os_profiles set is_shared_account = p_shared, updated_at = now() where id = p_target;
    insert into public.os_security_audit_logs(actor_id, target_user_id, action, note)
    values (p_actor, p_target, 'member.shared_account', case when p_shared then '공용 계정으로 지정' else '공용 계정 지정 해제' end);
  end if;
  return true;
end $$;
revoke all on function public.os_set_shared_account(uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public.os_set_shared_account(uuid, uuid, boolean) to service_role;
