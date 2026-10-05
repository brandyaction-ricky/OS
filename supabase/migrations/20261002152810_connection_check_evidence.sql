begin;
-- Server-written probe history must not be forgeable via generic records metadata.
create table public.os_connection_checks (
  id uuid primary key default gen_random_uuid(),
  service text not null check (service in ('database','auth','embeddings','telegram','contentAi','youtube','advertising','orders')),
  ok boolean not null,
  source text not null default 'probe' check (source in ('probe', 'embedding_job')),
  checked_at timestamptz not null default now()
);
create index os_connection_checks_service_time on public.os_connection_checks(service, checked_at desc);
create table public.os_connection_owners (
  service text primary key check (service in ('database','auth','embeddings','telegram','contentAi','youtube','advertising','orders')),
  primary_owner uuid references public.os_profiles(id) on delete set null,
  backup_owner uuid references public.os_profiles(id) on delete set null,
  version integer not null default 1 check (version > 0),
  check (primary_owner is null or backup_owner is null or primary_owner <> backup_owner)
);
alter table public.os_connection_checks enable row level security;
alter table public.os_connection_owners enable row level security;
revoke all on public.os_connection_checks, public.os_connection_owners from public, anon, authenticated;
-- Access is through authenticated admin-only routes; no direct browser grants.
grant select, insert on public.os_connection_checks to service_role;
grant select, insert, update on public.os_connection_owners to service_role;
-- Preserve each finished indexing attempt even after a retry clears the queue row.
-- Runs with the caller's privileges: only the server can write evidence.
create function public.os_record_embedding_connection_check()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if (new.status = 'failed' or (new.status = 'done' and new.last_error is null)) and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    insert into public.os_connection_checks(service, ok, source, checked_at)
    values ('embeddings', new.status = 'done' and new.last_error is null, 'embedding_job', coalesce(new.finished_at, now()));
  end if;
  return new;
end;
$$;
revoke all on function public.os_record_embedding_connection_check() from public, anon, authenticated;
grant execute on function public.os_record_embedding_connection_check() to service_role;
create trigger os_embedding_connection_check
  after insert or update of status on public.os_embedding_jobs
  for each row execute function public.os_record_embedding_connection_check();
commit;
