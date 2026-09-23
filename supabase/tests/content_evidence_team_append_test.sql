BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions, auth;
SELECT plan(10);

INSERT INTO auth.users (id, role, email, encrypted_password, email_confirmed_at, raw_user_meta_data)
VALUES
  ('00000000-0000-0000-0000-000000000041', 'authenticated', 'append-owner@example.test', '', now(), '{}'),
  ('00000000-0000-0000-0000-000000000042', 'authenticated', 'append-member@example.test', '', now(), '{}'),
  ('00000000-0000-0000-0000-000000000043', 'authenticated', 'append-other@example.test', '', now(), '{}');

UPDATE public.os_profiles SET team = '콘텐츠' WHERE id IN (
  '00000000-0000-0000-0000-000000000041', '00000000-0000-0000-0000-000000000042'
);
UPDATE public.os_profiles SET team = '다른팀' WHERE id = '00000000-0000-0000-0000-000000000043';

INSERT INTO public.os_records (id, record_type, title, brand, team, owner_id, created_by, updated_by)
VALUES
  ('40000000-0000-0000-0000-000000000041', 'content_topic', 'Shared topic', '브랜디액션', '콘텐츠',
   '00000000-0000-0000-0000-000000000041', '00000000-0000-0000-0000-000000000041', '00000000-0000-0000-0000-000000000041'),
  ('40000000-0000-0000-0000-000000000042', 'content_topic', 'Blank-team topic', '브랜디액션', '',
   '00000000-0000-0000-0000-000000000041', '00000000-0000-0000-0000-000000000041', '00000000-0000-0000-0000-000000000041');

SELECT is(has_function_privilege('authenticated', 'public.os_can_append_content_evidence(uuid,text)', 'EXECUTE'), true,
  'authenticated users may invoke the guarded append predicate');
SELECT is(has_function_privilege('anon', 'public.os_can_append_content_evidence(uuid,text)', 'EXECUTE'), false,
  'anonymous users cannot invoke the guarded append predicate');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000042', true);

SELECT lives_ok(
  $$ INSERT INTO public.os_records (id, record_type, title, brand, team, parent_id, owner_id, created_by, updated_by, metadata)
     VALUES ('40000000-0000-0000-0000-000000000043', 'content_package', 'Team claim', '브랜디액션', '콘텐츠',
       '40000000-0000-0000-0000-000000000041',
       '00000000-0000-0000-0000-000000000042', '00000000-0000-0000-0000-000000000042',
       '00000000-0000-0000-0000-000000000042', '{"packageKind":"claim_evidence"}'::jsonb) $$,
  'same-team contributor can append under their own identity'
);
SELECT results_eq(
  $$ SELECT count(*)::bigint FROM public.os_records WHERE id = '40000000-0000-0000-0000-000000000043'
     AND owner_id = '00000000-0000-0000-0000-000000000042'
     AND created_by = owner_id $$,
  ARRAY[1::bigint], 'contributor identity is retained'
);
SELECT throws_ok(
  $$ INSERT INTO public.os_records (record_type, title, brand, team, parent_id, owner_id, created_by, updated_by, metadata)
     VALUES ('content_package', 'Wrong row team', '브랜디액션', '다른팀', '40000000-0000-0000-0000-000000000041',
       '00000000-0000-0000-0000-000000000042', '00000000-0000-0000-0000-000000000042',
       '00000000-0000-0000-0000-000000000042', '{"packageKind":"claim_evidence"}'::jsonb) $$,
  '42501', 'new row violates row-level security policy "os_records_content_evidence_team_insert" for table "os_records"',
  'a contributor cannot set a different evidence team'
);
SELECT throws_ok(
  $$ INSERT INTO public.os_records (record_type, title, brand, team, parent_id, owner_id, created_by, updated_by, metadata)
     VALUES ('content_package', 'Forged owner', '브랜디액션', '콘텐츠', '40000000-0000-0000-0000-000000000041',
       '00000000-0000-0000-0000-000000000041', '00000000-0000-0000-0000-000000000042',
       '00000000-0000-0000-0000-000000000042', '{"packageKind":"claim_evidence"}'::jsonb) $$,
  '42501', 'new row violates row-level security policy "os_records_content_evidence_team_insert" for table "os_records"',
  'a contributor cannot claim the topic owner identity'
);
SELECT throws_ok(
  $$ INSERT INTO public.os_records (record_type, title, brand, team, parent_id, owner_id, created_by, updated_by, metadata)
     VALUES ('content_package', 'No parent', '브랜디액션', '콘텐츠', NULL,
       '00000000-0000-0000-0000-000000000042', '00000000-0000-0000-0000-000000000042',
       '00000000-0000-0000-0000-000000000042', '{"packageKind":"claim_evidence"}'::jsonb) $$,
  '42501', 'new row violates row-level security policy "os_records_content_evidence_team_insert" for table "os_records"',
  'an evidence row must refer to a real topic'
);
SELECT throws_ok(
  $$ INSERT INTO public.os_records (record_type, title, brand, team, parent_id, owner_id, created_by, updated_by, metadata)
     VALUES ('content_package', 'Blank parent team', '브랜디액션', '', '40000000-0000-0000-0000-000000000042',
       '00000000-0000-0000-0000-000000000042', '00000000-0000-0000-0000-000000000042',
       '00000000-0000-0000-0000-000000000042', '{"packageKind":"claim_evidence"}'::jsonb) $$,
  '42501', 'new row violates row-level security policy "os_records_content_evidence_team_insert" for table "os_records"',
  'blank-team topic does not admit a teammate'
);

SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000043', true);
SELECT throws_ok(
  $$ INSERT INTO public.os_records (record_type, title, brand, team, parent_id, owner_id, created_by, updated_by, metadata)
     VALUES ('content_package', 'Different team', '브랜디액션', '콘텐츠', '40000000-0000-0000-0000-000000000041',
       '00000000-0000-0000-0000-000000000043', '00000000-0000-0000-0000-000000000043',
       '00000000-0000-0000-0000-000000000043', '{"packageKind":"claim_evidence"}'::jsonb) $$,
  '42501', 'new row violates row-level security policy "os_records_content_evidence_team_insert" for table "os_records"',
  'a different team cannot append to the topic'
);

SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000041', true);
SELECT lives_ok(
  $$ INSERT INTO public.os_records (record_type, title, brand, team, parent_id, owner_id, created_by, updated_by, metadata)
     VALUES ('content_package', 'Owner blank-team evidence', '브랜디액션', '', '40000000-0000-0000-0000-000000000042',
       '00000000-0000-0000-0000-000000000041', '00000000-0000-0000-0000-000000000041',
       '00000000-0000-0000-0000-000000000041', '{"packageKind":"claim_evidence"}'::jsonb) $$,
  'the owner may still append to their own blank-team topic'
);

SELECT * FROM finish();
ROLLBACK;
