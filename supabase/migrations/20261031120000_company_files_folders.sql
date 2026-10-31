-- 경영지원 서류함 폴더째 올리기 (요청 4954c050, 대표 결정 2026-10-31). The browser now sends each file straight to this private
-- bucket through a signed upload URL, so a project folder (e.g. TIPS R&D, ~3.6 GB in 380 files) keeps its own files: office and
-- 한글 documents, archives, and any other file stored as a plain download. Same list as lib/company-files.ts.
-- Only the bucket's size limit and accepted types change; files, rows and policies stay as they are.
begin;

update storage.buckets set
  file_size_limit = 524288000,
  allowed_mime_types = array[
    'application/pdf','image/jpeg','image/png','image/webp','image/gif','text/csv','text/plain','application/zip',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/msword',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation','application/vnd.ms-powerpoint',
    'application/x-hwp','application/hwp+zip','application/octet-stream'
  ]::text[]
where id = 'os-company-files';

commit;
