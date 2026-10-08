-- Run only in a verified disposable/local or dedicated DEV database.
-- Every fixture and setting is rolled back; no employee accounts are used.
begin;
set local search_path = public, extensions, auth;

insert into auth.users (id, role, email, encrypted_password, email_confirmed_at, raw_user_meta_data) values
  ('60000000-0000-0000-0000-000000000001', 'authenticated', 'menu-rls-admin@example.test', '', now(), '{}'),
  ('60000000-0000-0000-0000-000000000002', 'authenticated', 'menu-rls-a@example.test', '', now(), '{}'),
  ('60000000-0000-0000-0000-000000000003', 'authenticated', 'menu-rls-b@example.test', '', now(), '{}'),
  ('60000000-0000-0000-0000-000000000004', 'authenticated', 'menu-rls-inactive@example.test', '', now(), '{}');
update public.os_profiles set role = 'admin' where id = '60000000-0000-0000-0000-000000000001';
update public.os_profiles set is_active = false where id = '60000000-0000-0000-0000-000000000004';
insert into public.os_member_menu_access (member_id, allowed_menus, updated_by)
select id, array['/home'], '60000000-0000-0000-0000-000000000001'::uuid
from public.os_profiles where id in (
  '60000000-0000-0000-0000-000000000002',
  '60000000-0000-0000-0000-000000000003',
  '60000000-0000-0000-0000-000000000004'
);

do $$ begin
  assert (select relrowsecurity from pg_class where oid = 'public.os_member_menu_access'::regclass), 'RLS must be enabled';
  assert exists(select 1 from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
    where i.indrelid = 'public.os_member_menu_access'::regclass and a.attname = 'updated_by' and i.indisvalid), 'actor foreign key must be indexed';
  assert not has_table_privilege('anon', 'public.os_member_menu_access', 'SELECT'), 'anonymous reads denied';
  assert has_table_privilege('authenticated', 'public.os_member_menu_access', 'SELECT'), 'authenticated reads granted';
  assert not has_table_privilege('authenticated', 'public.os_member_menu_access', 'INSERT'), 'direct inserts denied';
  assert not has_table_privilege('authenticated', 'public.os_member_menu_access', 'UPDATE'), 'direct updates denied';
  assert not has_table_privilege('authenticated', 'public.os_member_menu_access', 'DELETE'), 'direct deletes denied';
end $$;

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '60000000-0000-0000-0000-000000000002', true);
do $$ begin
  assert (select count(*) from public.os_member_menu_access) = 1, 'member sees only own policy';
  assert (select member_id from public.os_member_menu_access) = auth.uid(), 'own identity matches';
  begin
    update public.os_member_menu_access set allowed_menus = null;
    raise exception 'direct member write unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;
end $$;

select set_config('request.jwt.claim.sub', '60000000-0000-0000-0000-000000000004', true);
do $$ begin
  assert (select count(*) from public.os_member_menu_access) = 0, 'inactive member sees no policies';
end $$;

select set_config('request.jwt.claim.sub', '60000000-0000-0000-0000-000000000001', true);
do $$ begin
  assert (select count(*) from public.os_member_menu_access where member_id in (
    '60000000-0000-0000-0000-000000000002',
    '60000000-0000-0000-0000-000000000003',
    '60000000-0000-0000-0000-000000000004'
  )) = 3, 'administrator can read all fixture policies';
  begin
    update public.os_member_menu_access set allowed_menus = null;
    raise exception 'direct admin write unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
rollback;
select 'member menu RLS assertions passed; fixtures rolled back' as result;
