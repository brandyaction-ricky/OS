-- Cover the actor foreign key for profile maintenance without changing access rules.
create index os_member_menu_access_updated_by_idx
on public.os_member_menu_access (updated_by);
