-- Document search and backlinks filter with title/content/source_ref ILIKE '%…%'.
-- title already has a trigram index; without the other two every search
-- scanned all document bodies (~1.3 s on 5k documents / 23 MB).
-- Additive only. On a live database apply each statement with CONCURRENTLY.
create index if not exists os_documents_content_trgm on public.os_documents using gin (content_md extensions.gin_trgm_ops);
create index if not exists os_documents_source_ref_trgm on public.os_documents using gin (source_ref extensions.gin_trgm_ops);
