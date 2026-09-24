-- A contributor owns only their own append-only evidence row. The parent
-- topic must still exist in the same explicitly assigned team. This helper
-- avoids recursive os_records RLS evaluation while checking the parent.
CREATE OR REPLACE FUNCTION public.os_can_append_content_evidence(p_parent_id uuid, p_team text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.os_records source
    WHERE source.id = p_parent_id
      AND source.record_type = 'content_topic'
      AND source.brand = '브랜디액션'
      AND source.archived_at IS NULL
      AND source.team = p_team
      AND (SELECT public.os_is_active_member())
      AND (
        source.owner_id = (SELECT auth.uid())
        OR (
          btrim(source.team) <> ''
          AND btrim(source.team) = btrim((SELECT public.os_my_team()))
        )
      )
  );
$$;

REVOKE ALL ON FUNCTION public.os_can_append_content_evidence(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.os_can_append_content_evidence(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.os_can_append_content_evidence(uuid, text) TO authenticated;

DROP POLICY os_records_content_evidence_owner_insert ON public.os_records;

CREATE POLICY os_records_content_evidence_team_insert
ON public.os_records AS RESTRICTIVE
FOR INSERT TO authenticated
WITH CHECK (
  record_type <> 'content_package'
  OR COALESCE(metadata ->> 'packageKind', '') NOT IN (
    'copy_decision_evidence', 'publication_copy_observation', 'claim_evidence'
  )
  OR (
    owner_id = (SELECT auth.uid())
    AND created_by = (SELECT auth.uid())
    AND updated_by = (SELECT auth.uid())
    AND public.os_can_append_content_evidence(parent_id, team)
  )
);
