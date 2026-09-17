BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions, auth;

SELECT plan(20);

INSERT INTO auth.users (
  id,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_user_meta_data
) VALUES
  ('00000000-0000-0000-0000-000000000001', 'authenticated', 'admin@example.test', '', now(), '{}'),
  ('00000000-0000-0000-0000-000000000002', 'authenticated', 'lead@example.test', '', now(), '{}'),
  ('00000000-0000-0000-0000-000000000003', 'authenticated', 'member-a@example.test', '', now(), '{}'),
  ('00000000-0000-0000-0000-000000000004', 'authenticated', 'member-b@example.test', '', now(), '{}'),
  ('00000000-0000-0000-0000-000000000005', 'authenticated', 'inactive@example.test', '', now(), '{}');

UPDATE public.os_profiles
SET role = 'admin', team = 'alpha'
WHERE id = '00000000-0000-0000-0000-000000000001';

UPDATE public.os_profiles
SET role = 'lead', team = 'alpha'
WHERE id = '00000000-0000-0000-0000-000000000002';

UPDATE public.os_profiles
SET team = 'alpha'
WHERE id = '00000000-0000-0000-0000-000000000003';

UPDATE public.os_profiles
SET team = 'beta'
WHERE id = '00000000-0000-0000-0000-000000000004';

UPDATE public.os_profiles
SET team = 'alpha', is_active = false
WHERE id = '00000000-0000-0000-0000-000000000005';

INSERT INTO public.os_documents (id, title, content_md, status, owner_id, team) VALUES
  ('10000000-0000-0000-0000-000000000001', 'Member A draft', 'test', 'draft', '00000000-0000-0000-0000-000000000003', 'alpha'),
  ('10000000-0000-0000-0000-000000000002', 'Member B draft', 'test', 'draft', '00000000-0000-0000-0000-000000000004', 'beta'),
  ('10000000-0000-0000-0000-000000000003', 'Alpha team document', 'test', 'team', '00000000-0000-0000-0000-000000000004', 'alpha'),
  ('10000000-0000-0000-0000-000000000004', 'Beta team document', 'test', 'team', '00000000-0000-0000-0000-000000000004', 'beta'),
  ('10000000-0000-0000-0000-000000000005', 'Canonical document', 'test', 'canonical', '00000000-0000-0000-0000-000000000004', 'beta');

INSERT INTO public.os_skills (id, name, display_name, owner_id, scope, status, team) VALUES
  ('20000000-0000-0000-0000-000000000001', 'member-a-personal', 'Member A personal', '00000000-0000-0000-0000-000000000003', 'personal', 'personal', 'alpha'),
  ('20000000-0000-0000-0000-000000000002', 'member-b-personal', 'Member B personal', '00000000-0000-0000-0000-000000000004', 'personal', 'personal', 'beta'),
  ('20000000-0000-0000-0000-000000000003', 'alpha-team-skill', 'Alpha team', '00000000-0000-0000-0000-000000000004', 'team', 'team_verified', 'alpha'),
  ('20000000-0000-0000-0000-000000000004', 'beta-team-skill', 'Beta team', '00000000-0000-0000-0000-000000000004', 'team', 'team_verified', 'beta'),
  ('20000000-0000-0000-0000-000000000005', 'company-skill', 'Company', '00000000-0000-0000-0000-000000000004', 'company', 'company', 'beta');

INSERT INTO public.os_records (
  id,
  record_type,
  title,
  owner_id,
  created_by,
  updated_by
) VALUES
  ('30000000-0000-0000-0000-000000000001', 'task', 'Visible task', '00000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000004'),
  ('30000000-0000-0000-0000-000000000002', 'expense', 'Restricted expense', '00000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000004');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', true);

SELECT is(
  auth.uid(),
  '00000000-0000-0000-0000-000000000003'::uuid,
  'authenticated JWT subject is available through auth.uid()'
);

SELECT results_eq(
  $$ SELECT count(*)::bigint FROM public.os_documents $$,
  ARRAY[3::bigint],
  'member sees own draft, matching team document, and canonical document'
);

SELECT results_eq(
  $$ SELECT count(*)::bigint FROM public.os_skills $$,
  ARRAY[3::bigint],
  'member sees own personal skill, matching team skill, and company skill'
);

SELECT lives_ok(
  $$
    INSERT INTO public.os_documents (id, title, content_md, owner_id, status, team)
    VALUES (
      '10000000-0000-0000-0000-000000000006',
      'Member A new draft',
      'test',
      '00000000-0000-0000-0000-000000000003',
      'draft',
      'alpha'
    )
  $$,
  'member can create an owned draft document'
);

SELECT throws_ok(
  $$
    INSERT INTO public.os_documents (id, title, owner_id, status, team)
    VALUES (
      '10000000-0000-0000-0000-000000000007',
      'Forged owner draft',
      '00000000-0000-0000-0000-000000000004',
      'draft',
      'beta'
    )
  $$,
  '42501',
  'new row violates row-level security policy for table "os_documents"',
  'member cannot create a draft owned by another user'
);

SELECT throws_ok(
  $$
    UPDATE public.os_profiles
    SET role = 'admin'
    WHERE id = '00000000-0000-0000-0000-000000000003'
  $$,
  '42501',
  'new row violates row-level security policy for table "os_profiles"',
  'member cannot promote their own profile'
);

SELECT lives_ok(
  $$
    UPDATE public.os_profiles
    SET display_name = 'Member A updated'
    WHERE id = '00000000-0000-0000-0000-000000000003'
  $$,
  'member can update allowed fields on their own profile'
);

SELECT lives_ok(
  $$
    INSERT INTO public.os_document_links (from_id, to_id, link_text)
    VALUES (
      '10000000-0000-0000-0000-000000000001',
      '10000000-0000-0000-0000-000000000005',
      'owned link'
    )
  $$,
  'member can link from an owned document'
);

SELECT throws_ok(
  $$
    INSERT INTO public.os_document_links (from_id, to_id, link_text)
    VALUES (
      '10000000-0000-0000-0000-000000000002',
      '10000000-0000-0000-0000-000000000005',
      'forged link'
    )
  $$,
  '42501',
  'new row violates row-level security policy for table "os_document_links"',
  'member cannot link from another user document'
);

SELECT lives_ok(
  $$
    INSERT INTO public.os_skill_evidence (skill_id, document_id, note)
    VALUES (
      '20000000-0000-0000-0000-000000000001',
      '10000000-0000-0000-0000-000000000005',
      'owned evidence'
    )
  $$,
  'member can add evidence to an owned skill'
);

SELECT throws_ok(
  $$
    INSERT INTO public.os_skill_evidence (skill_id, document_id, note)
    VALUES (
      '20000000-0000-0000-0000-000000000002',
      '10000000-0000-0000-0000-000000000005',
      'forged evidence'
    )
  $$,
  '42501',
  'new row violates row-level security policy for table "os_skill_evidence"',
  'member cannot add evidence to another user skill'
);

SELECT results_eq(
  $$ SELECT count(*)::bigint FROM public.os_records $$,
  ARRAY[1::bigint],
  'member cannot read finance records without finance access'
);

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000005', true);

SELECT is(
  public.os_is_active_member(),
  false,
  'inactive profile is not an active member'
);

SELECT results_eq(
  $$ SELECT count(*)::bigint FROM public.os_records $$,
  ARRAY[0::bigint],
  'inactive profile cannot read records'
);

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', true);

SELECT results_eq(
  $$ SELECT count(*)::bigint FROM public.os_documents $$,
  ARRAY[3::bigint],
  'lead sees team documents across teams and canonical documents but not drafts'
);

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);

SELECT results_eq(
  $$ SELECT count(*)::bigint FROM public.os_documents $$,
  ARRAY[6::bigint],
  'admin sees every document'
);

SELECT results_eq(
  $$ SELECT count(*)::bigint FROM public.os_records $$,
  ARRAY[2::bigint],
  'admin sees finance and non-finance records'
);

SELECT lives_ok(
  $$
    UPDATE public.os_profiles
    SET display_name = 'Member B updated by admin'
    WHERE id = '00000000-0000-0000-0000-000000000004'
  $$,
  'admin can update another user profile'
);

RESET ROLE;
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claim.role', 'anon', true);
SELECT set_config('request.jwt.claim.sub', '', true);

SELECT results_eq(
  $$ SELECT count(*)::bigint FROM public.os_documents $$,
  ARRAY[0::bigint],
  'anonymous users cannot read documents'
);

SELECT throws_ok(
  $$
    INSERT INTO public.os_documents (id, title, owner_id, status)
    VALUES (
      '10000000-0000-0000-0000-000000000008',
      'Anonymous draft',
      '00000000-0000-0000-0000-000000000003',
      'draft'
    )
  $$,
  '42501',
  'new row violates row-level security policy for table "os_documents"',
  'anonymous users cannot create documents'
);

RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
