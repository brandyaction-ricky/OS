-- 영상 성과 under a second (2026-11-12 대표: "1초 이내로"): the page summed thousands of rows it had downloaded. The YouTube Analytics
-- day rows are now added up here and only the totals travel:
--   days   — per Korean-calendar day and 롱폼/숏폼: views, likes, comments, shares, watch minutes, subscriber change, retention weights
--   videos — per video and 롱폼/숏폼: the same sums for the chosen days, how many days it had, title and link
--   rows   — every other metric row of the window as before (manual entries, older API rows; hourly tracked-channel rows only when
--            p_observed, which the page asks for when it shows 시장 레퍼런스 or 전체 — they are the slow part of the window)
-- Two partial indexes keep each part proportional to what it returns, not to the ~70k hourly rows of a month.
-- Security invoker: the caller's row policies apply to every os_records read here.
begin;

create index if not exists os_records_metric_daily_idx on public.os_records ((metadata->>'day'))
  where record_type = 'content_metric' and archived_at is null and metadata->>'dataSource' = 'youtube_analytics_daily';
create index if not exists os_records_metric_other_idx on public.os_records ((coalesce(starts_at, created_at)))
  where record_type = 'content_metric' and archived_at is null
    and coalesce(metadata->>'dataSource', '') not in ('youtube_data_api', 'youtube_analytics_daily')
    and coalesce(metadata->>'channelSnapshotVersion', '') <> '1';

create or replace function public.os_content_metric_summary(p_from timestamptz, p_to timestamptz, p_observed boolean default false)
returns jsonb language sql stable security invoker set search_path = '' as $$
  with daily as (
    select r.title, r.source_url, r.metadata->>'day' as day, coalesce(nullif(r.metadata->>'format', ''), 'long') as format,
      r.metadata->>'contentId' as video, r.metadata->>'channelId' as channel, r.metadata->>'publishedAt' as published,
      (r.metadata->>'durationSeconds')::numeric as seconds,
      (r.metadata->>'views')::numeric as views, (r.metadata->>'likes')::numeric as likes, (r.metadata->>'comments')::numeric as comments,
      (r.metadata->>'shares')::numeric as shares, (r.metadata->>'watchMinutes')::numeric as minutes, (r.metadata->>'subscribers')::numeric as subscribers,
      (r.metadata->>'retention')::numeric as retention, (r.metadata->>'averageViewDuration')::numeric as duration
    from public.os_records r
    where r.record_type = 'content_metric' and r.archived_at is null and r.metadata->>'dataSource' = 'youtube_analytics_daily'
      and r.metadata->>'day' >= to_char(p_from at time zone 'UTC', 'YYYY-MM-DD') and r.metadata->>'day' < to_char(p_to at time zone 'UTC', 'YYYY-MM-DD')
  ), by_day as (
    select jsonb_build_object('day', day, 'format', format, 'views', sum(views), 'likes', sum(likes), 'comments', sum(comments), 'shares', sum(shares),
      'watchMinutes', sum(minutes), 'subscribers', sum(subscribers),
      'retentionViews', sum(views) filter (where retention is not null and views > 0), 'retentionSum', sum(retention * views) filter (where retention is not null and views > 0)) as item
    from daily group by day, format
  ), by_video as (
    select jsonb_build_object('video', video, 'format', format, 'title', max(title), 'url', max(source_url), 'channelId', max(channel), 'publishedAt', max(published),
      'durationSeconds', max(seconds), 'days', count(*), 'lastDay', max(day), 'views', sum(views), 'likes', sum(likes), 'comments', sum(comments), 'shares', sum(shares),
      'watchMinutes', sum(minutes), 'subscribers', sum(subscribers),
      'retentionViews', sum(views) filter (where retention is not null and views > 0), 'retentionSum', sum(retention * views) filter (where retention is not null and views > 0),
      'durationSum', sum(duration * views) filter (where duration is not null and views > 0)) as item
    from daily where video is not null group by video, format
  ), others as (
    select r.* from public.os_records r
    where r.record_type = 'content_metric' and r.archived_at is null
      and coalesce(r.metadata->>'dataSource', '') not in ('youtube_data_api', 'youtube_analytics_daily')
      and coalesce(r.metadata->>'channelSnapshotVersion', '') <> '1'
      and coalesce(r.starts_at, r.created_at) >= p_from and coalesce(r.starts_at, r.created_at) < p_to
  ), observed as (
    select distinct on (identity) id from (
      select r.id, coalesce(nullif(r.metadata->>'contentId', ''), r.id::text) || '|' || coalesce(r.metadata->>'platform', '') as identity,
        coalesce(r.metadata->>'measuredAt', to_char(r.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"+00:00"')) as measured
      from public.os_records r
      where p_observed and r.record_type = 'content_metric' and r.archived_at is null and r.metadata->>'dataSource' = 'youtube_data_api'
        and coalesce(r.starts_at, r.created_at) >= p_from and coalesce(r.starts_at, r.created_at) < p_to
    ) keyed order by identity, measured desc
  )
  select jsonb_build_object(
    'days', coalesce((select jsonb_agg(item) from by_day), '[]'::jsonb),
    'videos', coalesce((select jsonb_agg(item) from by_video), '[]'::jsonb),
    'rows', coalesce((select jsonb_agg(to_jsonb(o)) from others o), '[]'::jsonb)
      || coalesce((select jsonb_agg(to_jsonb(r)) from public.os_records r where r.id in (select id from observed)), '[]'::jsonb))
$$;
revoke all on function public.os_content_metric_summary(timestamptz, timestamptz, boolean) from public, anon;
grant execute on function public.os_content_metric_summary(timestamptz, timestamptz, boolean) to authenticated, service_role;

commit;
