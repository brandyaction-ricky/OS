-- New Supabase projects can retain explicit function grants from platform
-- defaults even after PUBLIC is revoked. Remove direct access from every
-- SECURITY DEFINER function, then grant only the authenticated entry points
-- required by RLS policies and user-facing RPCs. Trigger and worker functions
-- remain service_role/postgres only.

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated;

DO $$
DECLARE
  function_signature regprocedure;
BEGIN
  FOR function_signature IN
    SELECT p.oid::regprocedure
    FROM pg_proc AS p
    JOIN pg_namespace AS n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef
  LOOP
    EXECUTE format(
      'REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated',
      function_signature
    );
  END LOOP;
END
$$;

GRANT EXECUTE ON FUNCTION public.os_can_read_document(uuid, public.os_doc_status, text)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.os_can_read_skill(uuid, public.os_skill_scope, text)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.os_decide_leave_request(uuid, integer, text)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.os_get_document_versions(uuid)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.os_has_finance_access()
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.os_is_active_member()
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.os_is_admin()
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.os_is_lead_or_admin()
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.os_list_documents_v3(
  integer,
  integer,
  public.os_doc_status[],
  uuid,
  text,
  text,
  boolean
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.os_my_role()
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.os_my_team()
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.os_restore_document_version(uuid, integer, integer, text)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.os_rollback_document(uuid, integer, text)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.os_set_document_status(uuid, public.os_doc_status, text)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.os_set_skill_status(uuid, public.os_skill_status, text)
  TO authenticated;
