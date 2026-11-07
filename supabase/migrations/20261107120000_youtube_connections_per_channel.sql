-- 다채널 2단계 (2026-11-07): one person may connect several YouTube channels, one per 채널 카드 (brand channels picked
-- in Google's account chooser). A connection is now (owner_id, channel_id); channel_id stays unique across the OS
-- (os_youtube_connections_channel_unique), so a channel is still held by one OS account.
-- Safe before the code that uses it: while each person has one row, every owner_id lookup still finds exactly one.
alter table public.os_youtube_connections drop constraint os_youtube_connections_pkey;
alter table public.os_youtube_connections add constraint os_youtube_connections_pkey primary key (owner_id, channel_id);
