-- Rollback of 20261128130000_document_library: 자료실 goes away and every document listed there shows as company canon again
-- (the documents themselves were never changed).
begin;
drop function if exists public.os_set_document_library(uuid[],boolean,text);
drop table if exists public.os_document_library;
delete from supabase_migrations.schema_migrations where version = '20261128130000';
commit;
