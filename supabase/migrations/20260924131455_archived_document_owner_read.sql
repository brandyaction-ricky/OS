-- Keep deleted documents recoverable for their owner and administrators, but
-- do not expose their contents, versions, links, or folder to former readers.
-- The existing document-related SELECT policies all call this helper.
CREATE OR REPLACE FUNCTION public.os_can_read_document(
  p_owner uuid,
  p_status public.os_doc_status,
  p_team text
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN auth.uid() IS NULL THEN false
    WHEN os_is_admin() THEN true
    WHEN p_owner = auth.uid() THEN true
    WHEN p_status IN ('draft', 'archived') THEN false
    WHEN p_status = 'team' THEN (p_team = '' OR p_team = os_my_team() OR os_is_lead_or_admin())
    ELSE true
  END
$$;
