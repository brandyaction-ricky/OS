-- Evaluate auth.uid() once per statement and remove overlapping permissive
-- policies without changing the effective access rules.

DROP POLICY IF EXISTS os_document_links_write ON public.os_document_links;

CREATE POLICY os_document_links_insert
ON public.os_document_links
FOR INSERT TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.os_documents AS d
    WHERE d.id = os_document_links.from_id
      AND (
        d.owner_id = (SELECT auth.uid())
        OR public.os_is_admin()
      )
  )
);

CREATE POLICY os_document_links_update
ON public.os_document_links
FOR UPDATE TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.os_documents AS d
    WHERE d.id = os_document_links.from_id
      AND (
        d.owner_id = (SELECT auth.uid())
        OR public.os_is_admin()
      )
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.os_documents AS d
    WHERE d.id = os_document_links.from_id
      AND (
        d.owner_id = (SELECT auth.uid())
        OR public.os_is_admin()
      )
  )
);

CREATE POLICY os_document_links_delete
ON public.os_document_links
FOR DELETE TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.os_documents AS d
    WHERE d.id = os_document_links.from_id
      AND (
        d.owner_id = (SELECT auth.uid())
        OR public.os_is_admin()
      )
  )
);

DROP POLICY IF EXISTS os_documents_delete ON public.os_documents;
CREATE POLICY os_documents_delete
ON public.os_documents
FOR DELETE TO authenticated
USING (
  public.os_is_admin()
  OR (
    owner_id = (SELECT auth.uid())
    AND status = 'draft'::public.os_doc_status
  )
);

DROP POLICY IF EXISTS os_documents_insert ON public.os_documents;
CREATE POLICY os_documents_insert
ON public.os_documents
FOR INSERT TO authenticated
WITH CHECK (
  owner_id = (SELECT auth.uid())
  AND status = 'draft'::public.os_doc_status
);

DROP POLICY IF EXISTS os_documents_update ON public.os_documents;
CREATE POLICY os_documents_update
ON public.os_documents
FOR UPDATE TO authenticated
USING (
  public.os_is_admin()
  OR (
    owner_id = (SELECT auth.uid())
    AND status <> 'canonical'::public.os_doc_status
  )
  OR (
    status = 'canonical'::public.os_doc_status
    AND EXISTS (
      SELECT 1
      FROM public.os_profiles AS p
      WHERE p.id = (SELECT auth.uid())
        AND p.is_active
    )
  )
)
WITH CHECK (
  public.os_is_admin()
  OR (
    owner_id = (SELECT auth.uid())
    AND status <> 'canonical'::public.os_doc_status
  )
  OR (
    status = 'canonical'::public.os_doc_status
    AND EXISTS (
      SELECT 1
      FROM public.os_profiles AS p
      WHERE p.id = (SELECT auth.uid())
        AND p.is_active
    )
  )
);

DROP POLICY IF EXISTS os_profiles_admin_all ON public.os_profiles;
DROP POLICY IF EXISTS os_profiles_update_self ON public.os_profiles;

CREATE POLICY os_profiles_admin_insert
ON public.os_profiles
FOR INSERT TO authenticated
WITH CHECK (public.os_is_admin());

CREATE POLICY os_profiles_admin_delete
ON public.os_profiles
FOR DELETE TO authenticated
USING (public.os_is_admin());

CREATE POLICY os_profiles_update
ON public.os_profiles
FOR UPDATE TO authenticated
USING (
  public.os_is_admin()
  OR id = (SELECT auth.uid())
)
WITH CHECK (
  public.os_is_admin()
  OR (
    id = (SELECT auth.uid())
    AND role = public.os_my_role()
    AND is_active = true
  )
);

DROP POLICY IF EXISTS os_records_active_insert ON public.os_records;
CREATE POLICY os_records_active_insert
ON public.os_records
FOR INSERT TO authenticated
WITH CHECK (
  public.os_is_active_member()
  AND created_by = (SELECT auth.uid())
  AND updated_by = (SELECT auth.uid())
  AND (
    record_type <> ALL (
      ARRAY['expense', 'contract', 'subscription', 'company_document']::text[]
    )
    OR public.os_has_finance_access()
  )
);

DROP POLICY IF EXISTS os_records_owner_update ON public.os_records;
CREATE POLICY os_records_owner_update
ON public.os_records
FOR UPDATE TO authenticated
USING (
  public.os_is_active_member()
  AND (
    record_type <> ALL (
      ARRAY['expense', 'contract', 'subscription', 'company_document']::text[]
    )
    OR public.os_has_finance_access()
  )
  AND (
    created_by = (SELECT auth.uid())
    OR owner_id = (SELECT auth.uid())
    OR assignee_id = (SELECT auth.uid())
    OR public.os_is_admin()
  )
)
WITH CHECK (
  public.os_is_active_member()
  AND (
    record_type <> ALL (
      ARRAY['expense', 'contract', 'subscription', 'company_document']::text[]
    )
    OR public.os_has_finance_access()
  )
);

DROP POLICY IF EXISTS os_search_logs_admin_select ON public.os_search_logs;
CREATE POLICY os_search_logs_admin_select
ON public.os_search_logs
FOR SELECT TO authenticated
USING (
  public.os_is_admin()
  OR actor_id = (SELECT auth.uid())::text
);

DROP POLICY IF EXISTS os_security_audit_admin_select ON public.os_security_audit_logs;
DROP POLICY IF EXISTS os_security_audit_self_select ON public.os_security_audit_logs;
CREATE POLICY os_security_audit_select
ON public.os_security_audit_logs
FOR SELECT TO authenticated
USING (
  public.os_is_admin()
  OR target_user_id = (SELECT auth.uid())
  OR actor_id = (SELECT auth.uid())
);

DROP POLICY IF EXISTS os_skill_evidence_write ON public.os_skill_evidence;

CREATE POLICY os_skill_evidence_insert
ON public.os_skill_evidence
FOR INSERT TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.os_skills AS s
    WHERE s.id = os_skill_evidence.skill_id
      AND (
        s.owner_id = (SELECT auth.uid())
        OR public.os_is_admin()
      )
  )
);

CREATE POLICY os_skill_evidence_update
ON public.os_skill_evidence
FOR UPDATE TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.os_skills AS s
    WHERE s.id = os_skill_evidence.skill_id
      AND (
        s.owner_id = (SELECT auth.uid())
        OR public.os_is_admin()
      )
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.os_skills AS s
    WHERE s.id = os_skill_evidence.skill_id
      AND (
        s.owner_id = (SELECT auth.uid())
        OR public.os_is_admin()
      )
  )
);

CREATE POLICY os_skill_evidence_delete
ON public.os_skill_evidence
FOR DELETE TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.os_skills AS s
    WHERE s.id = os_skill_evidence.skill_id
      AND (
        s.owner_id = (SELECT auth.uid())
        OR public.os_is_admin()
      )
  )
);

DROP POLICY IF EXISTS os_skills_delete ON public.os_skills;
CREATE POLICY os_skills_delete
ON public.os_skills
FOR DELETE TO authenticated
USING (
  public.os_is_admin()
  OR (
    owner_id = (SELECT auth.uid())
    AND status = 'personal'::public.os_skill_status
  )
);

DROP POLICY IF EXISTS os_skills_insert ON public.os_skills;
CREATE POLICY os_skills_insert
ON public.os_skills
FOR INSERT TO authenticated
WITH CHECK (
  owner_id = (SELECT auth.uid())
  AND status = 'personal'::public.os_skill_status
  AND scope = 'personal'::public.os_skill_scope
);

DROP POLICY IF EXISTS os_skills_update ON public.os_skills;
CREATE POLICY os_skills_update
ON public.os_skills
FOR UPDATE TO authenticated
USING (
  public.os_is_admin()
  OR owner_id = (SELECT auth.uid())
)
WITH CHECK (
  public.os_is_admin()
  OR owner_id = (SELECT auth.uid())
);
