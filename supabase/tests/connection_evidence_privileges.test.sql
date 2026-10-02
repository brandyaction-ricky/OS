-- Run only against an approved DEV database after the forward migration.
begin;
select plan(8);
select ok(not has_table_privilege('anon', 'public.os_connection_checks', 'select'), 'anonymous cannot read probe history');
select ok(not has_table_privilege('authenticated', 'public.os_connection_checks', 'insert'), 'clients cannot forge successful probes');
select ok(not has_table_privilege('authenticated', 'public.os_connection_checks', 'update'), 'clients cannot erase failures');
select ok(not has_table_privilege('authenticated', 'public.os_connection_owners', 'update'), 'owners are changed only through the admin route');
select ok(has_table_privilege('service_role', 'public.os_connection_checks', 'insert'), 'server can persist probes');
select ok(has_table_privilege('service_role', 'public.os_connection_owners', 'update'), 'server can update owners');
select ok((select relrowsecurity from pg_class where oid = 'public.os_connection_checks'::regclass), 'history RLS enabled');
select ok((select relrowsecurity from pg_class where oid = 'public.os_connection_owners'::regclass), 'owner RLS enabled');
select * from finish();
rollback;
