begin;

-- Fourth handoff: read-only advertising aggregation. Credentials remain in the
-- server environment and are never persisted in Supabase.
create table if not exists public.os_ad_performance_daily (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('meta', 'google')),
  brand_key text not null check (brand_key in ('myin', 'brandyedu')),
  metric_date date not null,
  spend numeric(18, 2) not null default 0 check (spend >= 0),
  attributed_revenue numeric(18, 2) not null default 0 check (attributed_revenue >= 0),
  conversions numeric(18, 4) not null default 0 check (conversions >= 0),
  impressions bigint not null default 0 check (impressions >= 0),
  clicks bigint not null default 0 check (clicks >= 0),
  currency text not null default 'KRW' check (currency ~ '^[A-Z]{3}$'),
  source_account text not null default '',
  fetched_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, brand_key, metric_date)
);

create index if not exists os_ad_performance_daily_date_idx
  on public.os_ad_performance_daily(metric_date desc, brand_key, provider);

create table if not exists public.os_ad_sync_runs (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('meta', 'google')),
  brand_key text not null check (brand_key in ('myin', 'brandyedu')),
  status text not null check (status in ('running', 'done', 'failed', 'skipped')),
  range_start date not null,
  range_end date not null,
  rows_written integer not null default 0 check (rows_written >= 0),
  error_message text not null default '',
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

create index if not exists os_ad_sync_runs_latest_idx
  on public.os_ad_sync_runs(provider, brand_key, started_at desc);

alter table public.os_ad_performance_daily enable row level security;
alter table public.os_ad_sync_runs enable row level security;

drop policy if exists os_ad_performance_active_select on public.os_ad_performance_daily;
create policy os_ad_performance_active_select on public.os_ad_performance_daily
  for select to authenticated using (public.os_is_active_member());

drop policy if exists os_ad_sync_runs_admin_select on public.os_ad_sync_runs;
create policy os_ad_sync_runs_admin_select on public.os_ad_sync_runs
  for select to authenticated using (public.os_is_admin());

revoke insert, update, delete on public.os_ad_performance_daily from authenticated, anon;
revoke insert, update, delete on public.os_ad_sync_runs from authenticated, anon;
grant select on public.os_ad_performance_daily to authenticated;
grant select on public.os_ad_sync_runs to authenticated;

commit;
