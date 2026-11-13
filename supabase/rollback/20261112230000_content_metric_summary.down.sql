-- Rollback for 20261112230000: the summary route falls back to the window rows when the function is missing.
drop function if exists public.os_content_metric_summary(timestamptz, timestamptz, boolean);
drop index if exists public.os_records_metric_daily_idx;
drop index if exists public.os_records_metric_other_idx;
