-- Record lists filter by record_type and order by updated_at desc, id. The
-- existing (record_type, status, updated_at) index does not match when status
-- is not given, so every page sorted all rows of the type (7.4k content
-- metrics, spilling to disk) before taking its slice.
-- Additive only. On a live database apply with CONCURRENTLY.
create index if not exists os_records_type_updated_idx on public.os_records (record_type, updated_at desc, id) where archived_at is null;
