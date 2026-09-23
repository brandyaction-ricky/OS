-- Add the return-for-revision transition used by the review inbox.
-- Existing transitions, row lock, ownership checks and event recording stay intact.
CREATE OR REPLACE FUNCTION "public"."os_set_document_status"("p_document_id" "uuid", "p_to" "public"."os_doc_status", "p_note" "text" DEFAULT ''::"text") RETURNS "public"."os_documents"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  d public.os_documents;
  v_from public.os_doc_status;
  v_uid uuid := auth.uid();
  v_owner boolean;
  v_active boolean;
  v_admin boolean := public.os_is_admin();
  ok boolean := false;
begin
  select * into d from public.os_documents where id = p_document_id for update;
  if not found then raise exception 'OS_DOC_NOT_FOUND' using errcode = 'P0002'; end if;

  select exists(
    select 1 from public.os_profiles p where p.id = v_uid and p.is_active
  ) into v_active;
  v_from := d.status;
  v_owner := d.owner_id = v_uid;
  if v_from = p_to then return d; end if;

  ok := case
    when v_from = 'draft' and p_to = 'team' then v_owner or v_admin
    when v_from in ('draft', 'team', 'review', 'reviewed') and p_to = 'canonical'
      then (v_owner and v_active) or v_admin
    when v_from = 'team' and p_to = 'review' then (v_owner and v_active) or v_admin
    when v_from = 'review' and p_to = 'team' then v_active or v_admin
    when v_from = 'review' and p_to = 'reviewed' then v_active or v_admin
    when v_from = 'reviewed' and p_to = 'review' then v_active or v_admin
    when v_from = 'canonical' and p_to = 'review' then v_active or v_admin
    when p_to = 'archived' then v_admin or (v_owner and v_from <> 'canonical')
    when p_to = 'draft' and v_from in ('team', 'review', 'reviewed') then v_owner or v_admin
    when v_from = 'archived' and p_to in ('draft', 'team') then v_owner or v_admin
    else false
  end;
  if not ok then
    raise exception 'OS_STATUS_TRANSITION_DENIED: % -> %', v_from, p_to using errcode = 'P0001';
  end if;

  perform set_config('os.status_change_ok', '1', true);
  update public.os_documents set status = p_to where id = p_document_id returning * into d;
  perform set_config('os.status_change_ok', '', true);
  insert into public.os_document_events (document_id, from_status, to_status, actor_id, note)
  values (p_document_id, v_from, p_to, v_uid, coalesce(p_note, ''));
  return d;
end;
$$;

REVOKE ALL ON FUNCTION public.os_set_document_status(uuid, public.os_doc_status, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.os_set_document_status(uuid, public.os_doc_status, text) TO authenticated, service_role;
