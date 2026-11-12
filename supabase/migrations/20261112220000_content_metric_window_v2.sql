-- 영상 성과 (2026-11-12): the daily YouTube Analytics job writes D1 · D7 · D28 rows for every channel video (9 metrics × 3 × ~400 videos),
-- and os_content_metric_window returns every channel snapshot on every call, whatever the dates. One 30-day read became 22k rows / 27 MB.
-- os_content_metric_window_v2(p_from, p_to, p_snapshots):
--   p_snapshots = false → the window rows exactly as v1 returns them, without channel snapshots (the summary, tables and charts);
--   p_snapshots = true  → only the channel snapshots of posts published in [p_from, p_to) (what 경과일 비교 compares).
-- v1 stays unchanged for anything still calling it. Security invoker: the caller's row policies apply. The snapshot branch uses
-- os_records_channel_snapshot_idx (20261103100000).
begin;

create or replace function public.os_content_metric_window_v2(p_from timestamptz, p_to timestamptz, p_snapshots boolean default false)
returns setof public.os_records language sql stable security invoker set search_path = '' as $$
  with keyed as (
    select r.id, r.metadata->>'metricMode' as mode,
      coalesce(nullif(r.metadata->>'contentId', ''), nullif(r.metadata->>'youtubeId', ''), r.parent_id::text, nullif(r.source_url, ''), r.id::text) as identity,
      coalesce(r.metadata->>'platform', '') as platform,
      coalesce(r.metadata->>'measuredAt', to_char(r.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"+00:00"')) as measured
    from public.os_records r
    where not p_snapshots and r.record_type = 'content_metric' and r.archived_at is null
      and coalesce(r.metadata->>'channelSnapshotVersion', '') <> '1'
      and coalesce(r.starts_at, r.created_at) >= p_from and coalesce(r.starts_at, r.created_at) < p_to
  ), picked as (
    select * from (select distinct on (identity, platform) id from keyed where mode = 'cumulative' order by identity, platform, measured desc) latest
    union all select id from keyed where coalesce(mode, 'daily') <> 'cumulative'
  )
  select r.* from public.os_records r where r.id in (select id from picked)
  union all
  select r.* from public.os_records r
  where p_snapshots and r.record_type = 'content_metric' and r.archived_at is null and r.metadata->>'channelSnapshotVersion' = '1'
    and r.metadata->>'publishedAt' >= to_char(p_from at time zone 'UTC', 'YYYY-MM-DD') and r.metadata->>'publishedAt' < to_char(p_to at time zone 'UTC', 'YYYY-MM-DD')
$$;
revoke all on function public.os_content_metric_window_v2(timestamptz, timestamptz, boolean) from public, anon;
grant execute on function public.os_content_metric_window_v2(timestamptz, timestamptz, boolean) to authenticated, service_role;

commit;
