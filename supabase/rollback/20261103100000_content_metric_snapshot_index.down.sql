-- Undo of 20261103100000_content_metric_snapshot_index.sql (not run by the migration runner; for a manual roll-back only).
drop index if exists public.os_records_channel_snapshot_idx;
