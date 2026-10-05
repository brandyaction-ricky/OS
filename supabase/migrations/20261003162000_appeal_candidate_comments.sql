-- F3: append-only, per-candidate discussion; existing decisions and records stay intact.
create table if not exists public.os_appeal_candidate_comments (
  id uuid primary key default gen_random_uuid(),
  package_id uuid not null references public.os_records(id),
  candidate_set_version text not null,
  candidate_index integer not null check (candidate_index between 0 and 11),
  body text not null check (length(btrim(body)) between 1 and 2000),
  author_id uuid not null references public.os_profiles(id),
  created_at timestamptz not null default now()
);
create index if not exists os_appeal_candidate_comments_lookup
  on public.os_appeal_candidate_comments(package_id, candidate_set_version, candidate_index, created_at);
alter table public.os_appeal_candidate_comments enable row level security;
revoke all on public.os_appeal_candidate_comments from public, anon, authenticated;
grant select, insert on public.os_appeal_candidate_comments to service_role;
