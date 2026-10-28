-- 링크관리 · UTM 링크 (기능요청서 2026-10-28). Additive: two new service-role tables; nothing existing changes.
-- os_utm_options: the shared choices for utm_source/medium/campaign/content. Any staff member adds one (API checks);
--   a code never changes (a new meaning gets a new choice), unused ones are turned off, not deleted.
-- os_utm_links: the company link ledger. One row per created UTM link; request_id makes a double click or retry
--   return the same row; the tracking values are kept as they were when the link was made.
begin;

create table public.os_utm_options (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('source', 'medium', 'campaign', 'content')),
  label text not null check (char_length(btrim(label)) between 1 and 80),
  code text not null check (code ~ '^[a-z0-9_-]{1,80}$'),
  active boolean not null default true,
  created_by uuid not null references public.os_profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (kind, code)
);
create unique index os_utm_options_label_unique on public.os_utm_options (kind, lower(btrim(label)));
alter table public.os_utm_options enable row level security;
revoke all on public.os_utm_options from public, anon, authenticated;
grant all on public.os_utm_options to service_role;

create table public.os_utm_links (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique,
  brand text not null check (brand in ('마이인', '브랜디액션 에듀', '브랜디액션')),
  usage text not null check (char_length(btrim(usage)) between 1 and 200),
  origin_url text not null check (char_length(origin_url) between 1 and 2000),
  source_id uuid not null references public.os_utm_options(id),
  medium_id uuid not null references public.os_utm_options(id),
  campaign_id uuid not null references public.os_utm_options(id),
  content_id uuid references public.os_utm_options(id),
  params jsonb not null,
  target text not null default '' check (char_length(target) <= 200),
  location text not null default '' check (char_length(location) <= 200),
  etc text not null default '' check (char_length(etc) <= 500),
  utm_url text not null check (char_length(utm_url) between 1 and 4000),
  short_key text,
  short_url text check (short_url is null or char_length(short_url) <= 300),
  ledger_status text not null default 'pending' check (ledger_status in ('pending', 'saved', 'failed')),
  created_by uuid not null references public.os_profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index os_utm_links_created_idx on public.os_utm_links (created_at desc, id);
alter table public.os_utm_links enable row level security;
revoke all on public.os_utm_links from public, anon, authenticated;
grant all on public.os_utm_links to service_role;

commit;
