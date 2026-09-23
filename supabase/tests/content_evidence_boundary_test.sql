BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions, auth;
SELECT plan(16);

INSERT INTO auth.users (id, role, email, encrypted_password, email_confirmed_at, raw_user_meta_data)
VALUES
  ('00000000-0000-0000-0000-000000000031', 'authenticated', 'evidence-a@example.test', '', now(), '{}'),
  ('00000000-0000-0000-0000-000000000032', 'authenticated', 'evidence-b@example.test', '', now(), '{}'),
  ('00000000-0000-0000-0000-000000000033', 'authenticated', 'evidence-c@example.test', '', now(), '{}'),
  ('00000000-0000-0000-0000-000000000034', 'authenticated', 'evidence-d@example.test', '', now(), '{}'),
  ('00000000-0000-0000-0000-000000000035', 'authenticated', 'evidence-e@example.test', '', now(), '{}');

-- The auth trigger creates profiles with blank teams by default. Sharing must
-- depend on an explicit, active team assignment, never a blank default.
UPDATE public.os_profiles SET team = '콘텐츠' WHERE id IN (
  '00000000-0000-0000-0000-000000000031',
  '00000000-0000-0000-0000-000000000032',
  '00000000-0000-0000-0000-000000000035'
);
UPDATE public.os_profiles SET team = '다른팀' WHERE id = '00000000-0000-0000-0000-000000000033';
UPDATE public.os_profiles SET is_active = false WHERE id = '00000000-0000-0000-0000-000000000035';

INSERT INTO public.os_records (id, record_type, title, team, owner_id, created_by, updated_by, metadata)
VALUES
  ('30000000-0000-0000-0000-000000000031', 'content_package', 'Decision evidence', '콘텐츠',
   '00000000-0000-0000-0000-000000000031', '00000000-0000-0000-0000-000000000031',
   '00000000-0000-0000-0000-000000000031', '{"packageKind":"copy_decision_evidence"}'::jsonb),
  ('30000000-0000-0000-0000-000000000032', 'content_package', 'Public observation', '콘텐츠',
   '00000000-0000-0000-0000-000000000031', '00000000-0000-0000-0000-000000000031',
   '00000000-0000-0000-0000-000000000031', '{"packageKind":"publication_copy_observation"}'::jsonb),
  ('30000000-0000-0000-0000-000000000033', 'content_package', 'Claim evidence', '콘텐츠',
   '00000000-0000-0000-0000-000000000031', '00000000-0000-0000-0000-000000000031',
   '00000000-0000-0000-0000-000000000031', '{"packageKind":"claim_evidence"}'::jsonb),
  ('30000000-0000-0000-0000-000000000034', 'content_package', 'Ordinary package', '',
   '00000000-0000-0000-0000-000000000031', '00000000-0000-0000-0000-000000000031',
   '00000000-0000-0000-0000-000000000031', '{}'::jsonb),
  ('30000000-0000-0000-0000-000000000035', 'content_package', 'Unassigned evidence', '',
   '00000000-0000-0000-0000-000000000031', '00000000-0000-0000-0000-000000000031',
   '00000000-0000-0000-0000-000000000031', '{"packageKind":"claim_evidence"}'::jsonb);

SELECT is(
  has_function_privilege('authenticated', 'public.os_content_evidence_immutable()', 'EXECUTE'),
  false, 'authenticated clients cannot invoke the trigger function directly'
);

SELECT throws_ok(
  $$ UPDATE public.os_records SET title = 'Tampered' WHERE id = '30000000-0000-0000-0000-000000000031' $$,
  '23514', 'Content evidence rows are append-only', 'direct evidence update is blocked'
);
SELECT throws_ok(
  $$ UPDATE public.os_records SET archived_at = now() WHERE id = '30000000-0000-0000-0000-000000000032' $$,
  '23514', 'Content evidence rows are append-only', 'direct evidence archive is blocked'
);
SELECT throws_ok(
  $$ DELETE FROM public.os_records WHERE id = '30000000-0000-0000-0000-000000000033' $$,
  '23514', 'Content evidence rows are append-only', 'direct evidence deletion is blocked'
);
SELECT throws_ok(
  $$ UPDATE public.os_records SET metadata = '{"packageKind":"claim_evidence"}'::jsonb
     WHERE id = '30000000-0000-0000-0000-000000000034' $$,
  '23514', 'Content evidence rows are append-only', 'ordinary row cannot be relabelled as evidence'
);
SELECT lives_ok(
  $$ UPDATE public.os_records SET title = 'Ordinary package updated'
     WHERE id = '30000000-0000-0000-0000-000000000034' $$,
  'ordinary packages remain editable'
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000031', true);
SELECT results_eq(
  $$ SELECT count(*)::bigint FROM public.os_records WHERE id IN (
    '30000000-0000-0000-0000-000000000031', '30000000-0000-0000-0000-000000000032',
    '30000000-0000-0000-0000-000000000033') $$,
  ARRAY[3::bigint], 'owner sees all three evidence subtypes'
);
SELECT results_eq(
  $$ SELECT count(*)::bigint FROM public.os_records WHERE id = '30000000-0000-0000-0000-000000000035' $$,
  ARRAY[1::bigint], 'owner still sees evidence without a team assignment'
);
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000032', true);
SELECT results_eq(
  $$ SELECT count(*)::bigint FROM public.os_records WHERE id IN (
    '30000000-0000-0000-0000-000000000031', '30000000-0000-0000-0000-000000000032',
    '30000000-0000-0000-0000-000000000033') $$,
  ARRAY[3::bigint], 'another active member of the assigned team can read all three evidence subtypes'
);
SELECT results_eq(
  $$ SELECT count(*)::bigint FROM public.os_records WHERE id = '30000000-0000-0000-0000-000000000035' $$,
  ARRAY[0::bigint], 'a blank evidence team does not share with a teammate'
);
SELECT throws_ok(
  $$ INSERT INTO public.os_records (record_type, title, team, owner_id, created_by, updated_by, metadata)
     VALUES ('content_package', 'Teammate forged owner evidence', '콘텐츠',
       '00000000-0000-0000-0000-000000000031',
       '00000000-0000-0000-0000-000000000032',
       '00000000-0000-0000-0000-000000000032',
       '{"packageKind":"claim_evidence"}'::jsonb) $$,
  '42501', 'new row violates row-level security policy "os_records_content_evidence_team_insert" for table "os_records"',
  'team read access does not grant owner-assigned evidence writes'
);
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000033', true);
SELECT results_eq(
  $$ SELECT count(*)::bigint FROM public.os_records WHERE id IN (
    '30000000-0000-0000-0000-000000000031', '30000000-0000-0000-0000-000000000032',
    '30000000-0000-0000-0000-000000000033') $$,
  ARRAY[0::bigint], 'a member of another team cannot read evidence rows'
);
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000034', true);
SELECT results_eq(
  $$ SELECT count(*)::bigint FROM public.os_records WHERE id IN (
    '30000000-0000-0000-0000-000000000031', '30000000-0000-0000-0000-000000000032',
    '30000000-0000-0000-0000-000000000033', '30000000-0000-0000-0000-000000000035') $$,
  ARRAY[0::bigint], 'a blank viewer team grants no shared evidence access'
);
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000035', true);
SELECT results_eq(
  $$ SELECT count(*)::bigint FROM public.os_records WHERE id IN (
    '30000000-0000-0000-0000-000000000031', '30000000-0000-0000-0000-000000000032',
    '30000000-0000-0000-0000-000000000033') $$,
  ARRAY[0::bigint], 'an inactive member of the assigned team cannot read evidence'
);
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000033', true);
SELECT results_eq(
  $$ SELECT count(*)::bigint FROM public.os_records WHERE id = '30000000-0000-0000-0000-000000000034' $$,
  ARRAY[1::bigint], 'ordinary package visibility remains unchanged'
);
SELECT throws_ok(
  $$ INSERT INTO public.os_records (record_type, title, owner_id, created_by, updated_by, metadata)
     VALUES ('content_package', 'Forged owner evidence',
       '00000000-0000-0000-0000-000000000031',
       '00000000-0000-0000-0000-000000000033',
       '00000000-0000-0000-0000-000000000033',
       '{"packageKind":"claim_evidence"}'::jsonb) $$,
  '42501', 'new row violates row-level security policy "os_records_content_evidence_team_insert" for table "os_records"',
  'member cannot insert evidence under another owner'
);

SELECT * FROM finish();
ROLLBACK;
