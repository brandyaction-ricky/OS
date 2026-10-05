-- F6: bounded server-side date/cursor queries over document versions.
create index if not exists os_document_versions_created_at_idx
  on public.os_document_versions(created_at desc, document_id, version_no);
