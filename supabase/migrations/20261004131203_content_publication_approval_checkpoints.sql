begin;

-- Live publication approval must not rely on editable os_records.metadata alone.
-- This table is service-only and additive; existing publication rows are untouched.
create table if not exists public.os_content_publication_approvals (
  publication_id uuid primary key references public.os_records(id) on delete cascade,
  signature text not null check (signature ~ '^[0-9a-f]{64}$'),
  source_version integer not null check (source_version > 0),
  approved_by uuid not null references public.os_profiles(id),
  approved_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists os_content_publication_approvals_actor_time
  on public.os_content_publication_approvals (approved_by, approved_at desc);

alter table public.os_content_publication_approvals enable row level security;
revoke all on table public.os_content_publication_approvals from public, anon, authenticated;
grant all on table public.os_content_publication_approvals to service_role;

comment on table public.os_content_publication_approvals is
  'Service-only approval checkpoints for live Meta publication. Browser clients cannot read or write this evidence.';

commit;
