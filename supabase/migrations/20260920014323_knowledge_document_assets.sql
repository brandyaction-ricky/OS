-- Private image assets referenced by knowledge document Markdown.
-- Additive only: existing document content and version contracts are unchanged.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'os-knowledge-assets', 'os-knowledge-assets', false, 15728640,
  array['image/jpeg','image/png','image/webp','image/gif','image/avif','image/svg+xml']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create table if not exists public.os_document_assets (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.os_documents(id) on delete cascade,
  reference text not null,
  reference_key text not null,
  file_name text not null,
  file_size bigint not null check (file_size > 0 and file_size <= 15728640),
  mime_type text not null check (mime_type = any (array['image/jpeg','image/png','image/webp','image/gif','image/avif','image/svg+xml'])),
  storage_path text not null,
  sha256 text check (sha256 is null or sha256 ~ '^[a-f0-9]{64}$'),
  source_document text,
  created_by uuid references public.os_profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (document_id, reference_key)
);

create index if not exists os_document_assets_document_created_idx on public.os_document_assets(document_id, created_at);
create index if not exists os_document_assets_document_sha256_idx on public.os_document_assets(document_id, sha256) where sha256 is not null;

alter table public.os_document_assets enable row level security;

drop policy if exists os_document_assets_read on public.os_document_assets;
create policy os_document_assets_read on public.os_document_assets for select to authenticated
using (public.os_can_read_document(document_id));

revoke all on table public.os_document_assets from anon, authenticated;
grant select on table public.os_document_assets to authenticated;

drop trigger if exists os_document_assets_touch_updated_at on public.os_document_assets;
create trigger os_document_assets_touch_updated_at before update on public.os_document_assets
for each row execute function public.os_touch_updated_at();
