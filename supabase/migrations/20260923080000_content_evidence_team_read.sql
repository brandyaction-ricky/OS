-- Share the three append-only content evidence subtypes with active members of
-- the evidence row's explicitly assigned team. Blank teams never grant access.
-- The existing active-member SELECT policy must also pass. INSERT remains
-- owner-only, and the immutable trigger continues to reject edits/deletes.
DROP POLICY os_records_content_evidence_owner_select ON public.os_records;

CREATE POLICY os_records_content_evidence_team_select
ON public.os_records AS RESTRICTIVE
FOR SELECT TO authenticated
USING (
  record_type <> 'content_package'
  OR COALESCE(metadata ->> 'packageKind', '') NOT IN (
    'copy_decision_evidence', 'publication_copy_observation', 'claim_evidence'
  )
  OR owner_id = (SELECT auth.uid())
  OR (
    btrim(team) <> ''
    AND btrim(team) = btrim((SELECT public.os_my_team()))
  )
);
