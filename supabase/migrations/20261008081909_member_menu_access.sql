-- Menu visibility / page navigation only. Existing data RLS and action gates remain authoritative.
create table public.os_member_menu_access (
  member_id uuid primary key references public.os_profiles(id) on delete cascade,
  allowed_menus text[] null,
  version integer not null default 1 check (version > 0),
  updated_by uuid not null references public.os_profiles(id),
  updated_at timestamptz not null default now(),
  constraint os_member_menu_access_bounded check (
    allowed_menus is null or (cardinality(allowed_menus) <= 100 and array_position(allowed_menus, null) is null)
  )
);

alter table public.os_member_menu_access enable row level security;
revoke all on public.os_member_menu_access from public, anon, authenticated;
grant select on public.os_member_menu_access to authenticated;
grant select, insert, update on public.os_member_menu_access to service_role;

create policy os_member_menu_access_read on public.os_member_menu_access
for select to authenticated
using ((select public.os_is_active_member()) and (member_id = (select auth.uid()) or (select public.os_is_admin())));

comment on table public.os_member_menu_access is 'Menu visibility and page navigation configuration; writes require the admin-only application API. Data permissions are unchanged.';
