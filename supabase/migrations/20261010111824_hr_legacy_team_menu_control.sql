-- The old Team leave views stay available until an HR administrator explicitly
-- finishes the reviewed migration. No existing rows are moved or rewritten.
create function public.os_hr_legacy_team_menus_hidden()
returns boolean language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.role() <> 'service_role' and not public.os_hr_session_active() then
    raise exception using errcode = '42501', message = 'HR_ACCESS_REQUIRED';
  end if;
  return coalesce(
    (select value #>> '{}' from public.os_hr_settings where key = 'legacy_team_menus') = 'hidden',
    false
  );
end $$;

create function public.os_hr_set_legacy_team_menus(p_hidden boolean)
returns boolean language plpgsql security definer set search_path = '' as $$
declare old_hidden boolean;
begin
  perform os_hr_private.authorize();
  if not public.os_is_admin() then
    raise exception using errcode = '42501', message = 'ADMIN_REQUIRED';
  end if;
  if p_hidden is null then raise exception 'INVALID_INPUT'; end if;
  if p_hidden and exists (
    select 1 from public.os_profiles p
    where not p.is_shared_account
      and (p.person_kind is null or (
        p.person_kind = 'employee' and not exists (
          select 1 from public.os_hr_employees e where e.profile_id = p.id
        )
      ))
  ) then raise exception 'HR_MIGRATION_INCOMPLETE'; end if;
  old_hidden := public.os_hr_legacy_team_menus_hidden();
  if old_hidden is distinct from p_hidden then
    insert into public.os_hr_settings(key, value)
      values ('legacy_team_menus', to_jsonb(case when p_hidden then 'hidden' else 'visible' end))
      on conflict (key) do update set value = excluded.value;
    perform os_hr_private.event(null, 'legacy_team_menus.changed',
      jsonb_build_object('from', case when old_hidden then 'hidden' else 'visible' end,
                         'to', case when p_hidden then 'hidden' else 'visible' end));
  end if;
  return p_hidden;
end $$;

revoke all on function public.os_hr_legacy_team_menus_hidden(),
  public.os_hr_set_legacy_team_menus(boolean) from public, anon, authenticated, service_role;
grant execute on function public.os_hr_legacy_team_menus_hidden() to authenticated, service_role;
grant execute on function public.os_hr_set_legacy_team_menus(boolean) to authenticated;
