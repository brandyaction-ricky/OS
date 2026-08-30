begin;

-- YouTube OAuth credentials are encrypted by the application before they are
-- written here. Only the service role can read or mutate this table.
create table if not exists public.os_youtube_connections (
  owner_id uuid primary key references public.os_profiles(id) on delete cascade,
  encrypted_refresh_token text not null,
  encrypted_access_token text,
  access_token_expires_at timestamptz,
  scope text not null default '',
  channel_id text not null default '',
  channel_title text not null default '',
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.os_youtube_connections enable row level security;
revoke all on public.os_youtube_connections from anon, authenticated;
grant all on public.os_youtube_connections to service_role;

commit;
