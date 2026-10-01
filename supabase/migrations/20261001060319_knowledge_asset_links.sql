begin;

create table if not exists public.os_knowledge_assets (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.os_documents(id) on delete cascade,
  reference text not null,
  reference_key text not null,
  file_name text not null,
  file_size bigint not null,
  mime_type text not null,
  storage_path text not null,
  sha256 text,
  source_document text not null default '',
  file_created_at timestamptz,
  created_by uuid references public.os_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint os_knowledge_assets_reference_length check (length(reference) between 1 and 1000),
  constraint os_knowledge_assets_reference_key_length check (length(reference_key) between 1 and 1000),
  constraint os_knowledge_assets_file_name_length check (length(file_name) between 1 and 240),
  constraint os_knowledge_assets_file_size check (file_size > 0 and file_size <= 104857600),
  constraint os_knowledge_assets_mime_type check (mime_type in ('image/jpeg', 'image/png', 'image/webp', 'image/gif')),
  constraint os_knowledge_assets_storage_path check (storage_path ~ '^documents/[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9]{4}-[0-9]{2}-[0-9]{2}/[0-9a-f-]{36}\.(jpg|png|webp|gif)$'),
  constraint os_knowledge_assets_storage_document check (split_part(storage_path, '/', 2) = document_id::text),
  constraint os_knowledge_assets_sha256 check (sha256 is null or sha256 ~ '^[a-f0-9]{64}$'),
  constraint os_knowledge_assets_source_document_length check (length(source_document) <= 500),
  constraint os_knowledge_assets_document_reference_key unique (document_id, reference_key)
);

create index if not exists os_knowledge_assets_document_id_idx
  on public.os_knowledge_assets (document_id, updated_at desc, id);

create index if not exists os_knowledge_assets_document_sha256_idx
  on public.os_knowledge_assets (document_id, sha256)
  where sha256 is not null;

alter table public.os_knowledge_assets enable row level security;
revoke all on table public.os_knowledge_assets from public, anon, authenticated;
grant select on table public.os_knowledge_assets to authenticated;
grant select, insert, update, delete on table public.os_knowledge_assets to service_role;

drop policy if exists os_knowledge_assets_select on public.os_knowledge_assets;
create policy os_knowledge_assets_select on public.os_knowledge_assets
  for select to authenticated
  using (exists (
    select 1 from public.os_documents document
    where document.id = os_knowledge_assets.document_id
  ));

create or replace function public.os_mark_knowledge_asset_attachment_referenced()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  upload_status text;
begin
  -- Serialize adoption with cleanup before checking the current state.
  select status into upload_status
  from public.os_knowledge_attachment_uploads
  where path = new.storage_path
    and document_id = new.document_id
  for update;

  if not found or upload_status = 'deleting' then
    raise exception 'OS_ATTACHMENT_EXPIRED';
  end if;

  update public.os_knowledge_attachment_uploads
  set status = 'referenced', referenced_at = coalesce(referenced_at, now())
  where path = new.storage_path
    and document_id = new.document_id
    and status = 'pending';
  return new;
end;
$$;

revoke all on function public.os_mark_knowledge_asset_attachment_referenced() from public, anon, authenticated;

drop trigger if exists os_knowledge_assets_mark_attachment on public.os_knowledge_assets;
create trigger os_knowledge_assets_mark_attachment
after insert or update of storage_path on public.os_knowledge_assets
for each row execute function public.os_mark_knowledge_asset_attachment_referenced();

drop trigger if exists os_knowledge_assets_touch_updated_at on public.os_knowledge_assets;
create trigger os_knowledge_assets_touch_updated_at
before update on public.os_knowledge_assets
for each row execute function public.os_touch_updated_at();

commit;
