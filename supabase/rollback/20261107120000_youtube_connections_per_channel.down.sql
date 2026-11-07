-- Undo 20261107120000_youtube_connections_per_channel.sql: back to one YouTube connection per person.
-- Works only while each person holds one connection — disconnect the extra channels first (내 계정 › 채널 연결), or the new
-- key fails on the repeated owner_id. Run the previous code first; the new code also works with this key while each person has one.
alter table public.os_youtube_connections drop constraint os_youtube_connections_pkey;
alter table public.os_youtube_connections add constraint os_youtube_connections_pkey primary key (owner_id);
