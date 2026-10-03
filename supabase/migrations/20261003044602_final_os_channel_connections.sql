begin;

-- Additive only: existing YouTube rows and tokens are preserved.
alter table public.os_youtube_connections add column if not exists team_shared boolean not null default false;
-- A7: fail (without altering any rows) if legacy duplicates need an owner decision.
-- This also closes simultaneous OAuth callbacks across different OS owners.
create unique index if not exists os_youtube_connections_channel_unique on public.os_youtube_connections (channel_id);

create table if not exists public.os_meta_connections (
  owner_id uuid not null references public.os_profiles(id),
  platform text not null check (platform in ('instagram', 'threads')),
  external_account_id text not null,
  account_name text not null default '',
  account_type text not null default '',
  scopes text[] not null default '{}',
  encrypted_access_token text not null,
  token_expires_at timestamptz not null,
  team_shared boolean not null default false,
  status text not null default 'connected' check (status in ('connected','expired','error','disconnected')),
  last_success_at timestamptz,
  last_error_code text,
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner_id, platform),
  unique (platform, external_account_id)
);
alter table public.os_meta_connections enable row level security;
revoke all on table public.os_meta_connections from public, anon, authenticated;
grant all on table public.os_meta_connections to service_role;
comment on table public.os_meta_connections is 'Encrypted channel tokens. Human owner/team authorization is enforced by server routes; never returned to browsers.';

commit;
