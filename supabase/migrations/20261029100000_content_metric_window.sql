-- 영상 성과: the dashboard sums "the latest cumulative snapshot per video inside the chosen dates", but read
-- every content_metric row to do it. YouTube observation writes one cumulative snapshot per tracked video per
-- hour (about 2,400 rows a day, 33,500 by 2026-10-29), so the page waited ~5 s for rows it then discarded.
-- os_content_metric_window(from, to) returns, for one date window, what dedupeMetricSnapshots keeps from it:
-- the latest cumulative row per (identity, platform) plus every non-cumulative row, plus channel snapshots
-- (their panel filters dates itself). Keys are picked from narrow rows, then only those rows are read whole.
-- Security invoker: the caller's row policies apply to every os_records read here.
-- The index keeps the window scan proportional to the window, not to all history.
begin;

create index if not exists os_records_metric_window_idx on public.os_records (record_type, (coalesce(starts_at, created_at)))
  where archived_at is null and record_type = 'content_metric';

create or replace function public.os_content_metric_window(p_from timestamptz, p_to timestamptz)
returns setof public.os_records language sql stable security invoker set search_path = '' as $$
  with keyed as (
    select r.id, r.metadata->>'metricMode' as mode, r.metadata->>'channelSnapshotVersion' as snap,
      coalesce(nullif(r.metadata->>'contentId', ''), nullif(r.metadata->>'youtubeId', ''), r.parent_id::text, nullif(r.source_url, ''), r.id::text) as identity,
      coalesce(r.metadata->>'platform', '') as platform,
      coalesce(r.metadata->>'measuredAt', to_char(r.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"+00:00"')) as measured
    from public.os_records r
    where r.record_type = 'content_metric' and r.archived_at is null
      and coalesce(r.starts_at, r.created_at) >= p_from and coalesce(r.starts_at, r.created_at) < p_to
  ), picked as (
    select * from (select distinct on (identity, platform) id from keyed where mode = 'cumulative' and coalesce(snap, '') <> '1' order by identity, platform, measured desc) latest
    union all select id from keyed where coalesce(mode, 'daily') <> 'cumulative' and coalesce(snap, '') <> '1'
  )
  select r.* from public.os_records r where r.id in (select id from picked)
  union all
  select r.* from public.os_records r where r.record_type = 'content_metric' and r.archived_at is null and r.metadata->>'channelSnapshotVersion' = '1'
$$;
revoke all on function public.os_content_metric_window(timestamptz, timestamptz) from public, anon;
grant execute on function public.os_content_metric_window(timestamptz, timestamptz) to authenticated, service_role;

commit;
