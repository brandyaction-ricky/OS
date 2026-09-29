begin;

create table if not exists public.os_knowledge_attachment_uploads (
  path text primary key,
  encoded_path text not null,
  document_id uuid references public.os_documents(id) on delete set null,
  uploader_id uuid references public.os_profiles(id) on delete set null,
  status text not null default 'pending' check (status in ('pending', 'referenced', 'deleting')),
  created_at timestamptz not null default now(),
  referenced_at timestamptz,
  last_cleanup_attempt_at timestamptz,
  constraint os_knowledge_attachment_uploads_path_shape check (path ~ '^documents/[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9]{4}-[0-9]{2}-[0-9]{2}/[0-9a-f-]{36}\.(jpg|png|webp|gif|mp4|mov|webm|pdf|txt|csv|doc|docx|ppt|pptx|xls|xlsx|zip)$'),
  constraint os_knowledge_attachment_uploads_encoded_path_shape check (encoded_path = replace(path, '/', '%2F'))
);

alter table public.os_knowledge_attachment_uploads enable row level security;
revoke all on table public.os_knowledge_attachment_uploads from public, anon, authenticated;
grant select, insert, update, delete on table public.os_knowledge_attachment_uploads to service_role;

create index if not exists os_knowledge_attachment_uploads_cleanup_idx
  on public.os_knowledge_attachment_uploads (status, created_at, last_cleanup_attempt_at, path)
  where status in ('pending', 'deleting');

create or replace function public.os_claim_stale_knowledge_attachments(
  p_cutoff timestamptz,
  p_retry_before timestamptz,
  p_limit integer default 100
)
returns table(path text)
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  with candidates as (
    select upload.path
    from public.os_knowledge_attachment_uploads upload
    where (upload.status = 'pending' and upload.created_at < p_cutoff)
       or (upload.status = 'deleting' and coalesce(upload.last_cleanup_attempt_at, upload.created_at) < p_retry_before)
    order by upload.created_at, upload.path
    for update skip locked
    limit least(greatest(p_limit, 1), 1000)
  )
  update public.os_knowledge_attachment_uploads upload
  set status = 'deleting', last_cleanup_attempt_at = now()
  from candidates
  where upload.path = candidates.path
  returning upload.path;
end;
$$;

revoke all on function public.os_claim_stale_knowledge_attachments(timestamptz, timestamptz, integer) from public, anon, authenticated;
grant execute on function public.os_claim_stale_knowledge_attachments(timestamptz, timestamptz, integer) to service_role;

create or replace function public.os_mark_knowledge_attachments_referenced()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.os_knowledge_attachment_uploads
    where document_id = new.document_id
      and status = 'deleting'
      and position(encoded_path in new.content_md) > 0
  ) then
    raise exception 'OS_ATTACHMENT_EXPIRED';
  end if;

  update public.os_knowledge_attachment_uploads
  set status = 'referenced', referenced_at = coalesce(referenced_at, now())
  where document_id = new.document_id
    and status = 'pending'
    and position(encoded_path in new.content_md) > 0;
  return new;
end;
$$;

revoke all on function public.os_mark_knowledge_attachments_referenced() from public, anon, authenticated;

drop trigger if exists os_document_versions_mark_knowledge_attachments on public.os_document_versions;
create trigger os_document_versions_mark_knowledge_attachments
after insert on public.os_document_versions
for each row execute function public.os_mark_knowledge_attachments_referenced();

commit;
