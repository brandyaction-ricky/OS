-- A document promoted to `team` is deliberately shared with every active
-- company member. Drafts stay owner-only, and the remaining workflow states
-- keep their existing visibility.
create or replace function public.os_can_read_document(
  p_owner uuid,
  p_status public.os_doc_status,
  p_team text
) returns boolean
language sql
stable
security definer
set search_path = 'public'
as $$
  select case
    when auth.uid() is null then false
    when public.os_is_admin() then true
    when p_owner = auth.uid() then true
    when p_status = 'draft' then false
    when p_status = 'team' then public.os_is_active_member()
    else true
  end
$$;

comment on function public.os_can_read_document(uuid, public.os_doc_status, text)
is 'Allows every active member to read team-shared documents while keeping drafts owner-only.';
