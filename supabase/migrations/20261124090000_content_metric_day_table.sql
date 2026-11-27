-- 영상 성과 cold reads (2026-11-24 대표: "성과 화면 로딩이 너무 느려"): a 30-day summary read ~3,300 Analytics day rows spread over
-- ~1,600 os_records heap pages (each row carries ~1 KB of metadata). Warm it takes 0.15 s; once document searches push those pages
-- out of memory it took up to 7.7 s. The day rows' numbers now also live in a narrow table kept in step by triggers, so the
-- same window reads a few dozen pages. os_records stays the source; os_content_metric_summary only reads the copy.
-- Same rows as before: content_metric, not archived, dataSource youtube_analytics_daily, not a personal-space row (none exist;
-- the summary's row policies already hid other people's). Readers: active members, like os_records_active_select.
begin;

create table if not exists public.os_content_metric_days (
  record_id uuid primary key references public.os_records(id) on delete cascade,
  day text not null,
  format text not null,
  video text, channel text, title text, source_url text, published text,
  seconds numeric, views numeric, likes numeric, comments numeric, shares numeric, minutes numeric, subscribers numeric,
  retention numeric, duration numeric, impressions numeric, ctr numeric
);
create index if not exists os_content_metric_days_day_idx on public.os_content_metric_days (day);
alter table public.os_content_metric_days enable row level security;
drop policy if exists os_content_metric_days_read on public.os_content_metric_days;
create policy os_content_metric_days_read on public.os_content_metric_days for select to authenticated using ((select public.os_is_active_member()));
revoke all on public.os_content_metric_days from public, anon, authenticated;
grant select on public.os_content_metric_days to authenticated;
grant all on public.os_content_metric_days to service_role;

-- A JSON number, or null (never an error that would stop the os_records write).
create or replace function public.os_metric_number(m jsonb, k text) returns numeric language sql immutable set search_path = '' as $$
  select case when jsonb_typeof(m->k) = 'number' then (m->>k)::numeric end
$$;

create or replace function public.os_content_metric_days_sync() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.record_type = 'content_metric' and new.archived_at is null and new.metadata->>'dataSource' = 'youtube_analytics_daily'
    and coalesce(new.metadata->>'space', '') <> 'personal' and coalesce(new.metadata->>'day', '') <> '' then
    insert into public.os_content_metric_days as d (record_id, day, format, video, channel, title, source_url, published, seconds, views, likes,
      comments, shares, minutes, subscribers, retention, duration, impressions, ctr)
    values (new.id, new.metadata->>'day', coalesce(nullif(new.metadata->>'format', ''), 'long'), new.metadata->>'contentId', new.metadata->>'channelId',
      new.title, new.source_url, new.metadata->>'publishedAt', public.os_metric_number(new.metadata, 'durationSeconds'),
      public.os_metric_number(new.metadata, 'views'), public.os_metric_number(new.metadata, 'likes'), public.os_metric_number(new.metadata, 'comments'),
      public.os_metric_number(new.metadata, 'shares'), public.os_metric_number(new.metadata, 'watchMinutes'), public.os_metric_number(new.metadata, 'subscribers'),
      public.os_metric_number(new.metadata, 'retention'), public.os_metric_number(new.metadata, 'averageViewDuration'),
      public.os_metric_number(new.metadata, 'impressions'), public.os_metric_number(new.metadata, 'ctr'))
    on conflict (record_id) do update set day = excluded.day, format = excluded.format, video = excluded.video, channel = excluded.channel,
      title = excluded.title, source_url = excluded.source_url, published = excluded.published, seconds = excluded.seconds, views = excluded.views,
      likes = excluded.likes, comments = excluded.comments, shares = excluded.shares, minutes = excluded.minutes, subscribers = excluded.subscribers,
      retention = excluded.retention, duration = excluded.duration, impressions = excluded.impressions, ctr = excluded.ctr;
  elsif tg_op = 'UPDATE' then
    delete from public.os_content_metric_days where record_id = new.id;
  end if;
  return null;
end $$;
revoke all on function public.os_content_metric_days_sync() from public, anon, authenticated;

drop trigger if exists os_content_metric_days_insert on public.os_records;
create trigger os_content_metric_days_insert after insert on public.os_records
  for each row when (new.record_type = 'content_metric') execute function public.os_content_metric_days_sync();
drop trigger if exists os_content_metric_days_update on public.os_records;
create trigger os_content_metric_days_update after update on public.os_records
  for each row when (old.record_type = 'content_metric' or new.record_type = 'content_metric') execute function public.os_content_metric_days_sync();

insert into public.os_content_metric_days (record_id, day, format, video, channel, title, source_url, published, seconds, views, likes,
  comments, shares, minutes, subscribers, retention, duration, impressions, ctr)
select r.id, r.metadata->>'day', coalesce(nullif(r.metadata->>'format', ''), 'long'), r.metadata->>'contentId', r.metadata->>'channelId',
  r.title, r.source_url, r.metadata->>'publishedAt', public.os_metric_number(r.metadata, 'durationSeconds'),
  public.os_metric_number(r.metadata, 'views'), public.os_metric_number(r.metadata, 'likes'), public.os_metric_number(r.metadata, 'comments'),
  public.os_metric_number(r.metadata, 'shares'), public.os_metric_number(r.metadata, 'watchMinutes'), public.os_metric_number(r.metadata, 'subscribers'),
  public.os_metric_number(r.metadata, 'retention'), public.os_metric_number(r.metadata, 'averageViewDuration'),
  public.os_metric_number(r.metadata, 'impressions'), public.os_metric_number(r.metadata, 'ctr')
from public.os_records r
where r.record_type = 'content_metric' and r.archived_at is null and r.metadata->>'dataSource' = 'youtube_analytics_daily'
  and coalesce(r.metadata->>'space', '') <> 'personal' and coalesce(r.metadata->>'day', '') <> ''
on conflict (record_id) do nothing;

create or replace function public.os_content_metric_summary(p_from timestamptz, p_to timestamptz, p_observed boolean default false)
returns jsonb language sql stable security invoker set search_path = '' as $$
  with daily as (
    select d.title, d.source_url, d.day, d.format, d.video, d.channel, d.published, d.seconds, d.views, d.likes, d.comments, d.shares,
      d.minutes, d.subscribers, d.retention, d.duration, d.impressions, d.ctr
    from public.os_content_metric_days d
    where d.day >= to_char(p_from at time zone 'UTC', 'YYYY-MM-DD') and d.day < to_char(p_to at time zone 'UTC', 'YYYY-MM-DD')
  ), by_day as (
    select jsonb_build_object('day', day, 'format', format, 'views', sum(views), 'likes', sum(likes), 'comments', sum(comments), 'shares', sum(shares),
      'watchMinutes', sum(minutes), 'subscribers', sum(subscribers),
      'retentionViews', sum(views) filter (where retention is not null and views > 0), 'retentionSum', sum(retention * views) filter (where retention is not null and views > 0),
      'impressions', sum(impressions), 'ctrImpressions', sum(impressions) filter (where ctr is not null and impressions > 0), 'ctrSum', sum(ctr * impressions) filter (where ctr is not null and impressions > 0)) as item
    from daily group by day, format
  ), by_video as (
    select jsonb_build_object('video', video, 'format', format, 'title', max(title), 'url', max(source_url), 'channelId', max(channel), 'publishedAt', max(published),
      'durationSeconds', max(seconds), 'days', count(*), 'lastDay', max(day), 'views', sum(views), 'likes', sum(likes), 'comments', sum(comments), 'shares', sum(shares),
      'watchMinutes', sum(minutes), 'subscribers', sum(subscribers),
      'retentionViews', sum(views) filter (where retention is not null and views > 0), 'retentionSum', sum(retention * views) filter (where retention is not null and views > 0),
      'durationSum', sum(duration * views) filter (where duration is not null and views > 0),
      'impressions', sum(impressions), 'ctrImpressions', sum(impressions) filter (where ctr is not null and impressions > 0), 'ctrSum', sum(ctr * impressions) filter (where ctr is not null and impressions > 0)) as item
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
