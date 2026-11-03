-- 영상 성과 (2026-11-03): os_content_metric_window returns channel snapshots (metadata.channelSnapshotVersion = 1)
-- in a second branch that has no date bound, so every call read all content_metric history (YouTube observation
-- writes about 2,400 hourly rows a day) to find them. A partial index on exactly that branch's condition lets it
-- read only those rows. Additive: the function, rows and policies are unchanged, so results stay the same.
create index if not exists os_records_channel_snapshot_idx on public.os_records (id)
  where record_type = 'content_metric' and archived_at is null and metadata->>'channelSnapshotVersion' = '1';
