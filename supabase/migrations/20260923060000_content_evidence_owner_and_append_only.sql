-- Keep the three DEV content-evidence subtypes private to their owner and
-- append-only at the database boundary. Other os_records retain their current
-- access and update behavior. Applying this file is a separate environment step.

CREATE OR REPLACE FUNCTION public.os_content_evidence_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF OLD.record_type = 'content_package'
     AND COALESCE(OLD.metadata ->> 'packageKind', '') IN (
       'copy_decision_evidence', 'publication_copy_observation', 'claim_evidence'
     ) THEN
    RAISE EXCEPTION 'Content evidence rows are append-only'
      USING ERRCODE = '23514';
  END IF;

  -- A normal record must not be relabelled as an immutable evidence row.
  IF TG_OP = 'UPDATE'
     AND NEW.record_type = 'content_package'
     AND COALESCE(NEW.metadata ->> 'packageKind', '') IN (
       'copy_decision_evidence', 'publication_copy_observation', 'claim_evidence'
     ) THEN
    RAISE EXCEPTION 'Content evidence rows are append-only'
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.os_content_evidence_immutable() FROM PUBLIC;

CREATE TRIGGER os_records_content_evidence_immutable_trigger
BEFORE UPDATE OR DELETE ON public.os_records
FOR EACH ROW EXECUTE FUNCTION public.os_content_evidence_immutable();

-- The existing broad SELECT policy remains in place for ordinary records.
-- Restrictive policies compose with it instead of opening another OR path.
CREATE POLICY os_records_content_evidence_owner_select
ON public.os_records AS RESTRICTIVE
FOR SELECT TO authenticated
USING (
  record_type <> 'content_package'
  OR COALESCE(metadata ->> 'packageKind', '') NOT IN (
    'copy_decision_evidence', 'publication_copy_observation', 'claim_evidence'
  )
  OR owner_id = (SELECT auth.uid())
);

-- Prevent a direct client INSERT from assigning an evidence row to somebody
-- else. This is not a validation or provenance guarantee for owner-entered data.
CREATE POLICY os_records_content_evidence_owner_insert
ON public.os_records AS RESTRICTIVE
FOR INSERT TO authenticated
WITH CHECK (
  record_type <> 'content_package'
  OR COALESCE(metadata ->> 'packageKind', '') NOT IN (
    'copy_decision_evidence', 'publication_copy_observation', 'claim_evidence'
  )
  OR owner_id = (SELECT auth.uid())
);
