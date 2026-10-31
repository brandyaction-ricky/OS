-- Manual undo of 20261031120000_company_files_folders.sql: the bucket's original 10 MB limit and five types.
-- Files already stored under the wider rule stay readable; only new uploads are held to the old rule again.
begin;

update storage.buckets set
  file_size_limit = 10000000,
  allowed_mime_types = array['application/pdf','image/jpeg','image/png','text/csv','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']::text[]
where id = 'os-company-files';

commit;
