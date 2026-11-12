-- Rollback for 20261112220000: the route falls back to os_content_metric_window when v2 is missing.
drop function if exists public.os_content_metric_window_v2(timestamptz, timestamptz, boolean);
