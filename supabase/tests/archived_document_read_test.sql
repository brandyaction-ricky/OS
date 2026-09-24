BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions, auth;

SELECT plan(9);

INSERT INTO auth.users (
  id, role, email, encrypted_password, email_confirmed_at, raw_user_meta_data
) VALUES
  ('00000000-0000-0000-0000-000000009101', 'authenticated', 'archive-owner@example.test', '', now(), '{}'),
  ('00000000-0000-0000-0000-000000009102', 'authenticated', 'archive-teammate@example.test', '', now(), '{}'),
  ('00000000-0000-0000-0000-000000009103', 'authenticated', 'archive-admin@example.test', '', now(), '{}');

UPDATE public.os_profiles SET team = 'qa-archive'
WHERE id IN (
  '00000000-0000-0000-0000-000000009101',
  '00000000-0000-0000-0000-000000009102'
);
UPDATE public.os_profiles SET role = 'admin', team = 'qa-archive'
WHERE id = '00000000-0000-0000-0000-000000009103';

INSERT INTO public.os_documents (id, title, content_md, status, owner_id, team) VALUES
  ('10000000-0000-0000-0000-000000009101', 'Archived synthetic document', 'test', 'archived', '00000000-0000-0000-0000-000000009101', 'qa-archive'),
  ('10000000-0000-0000-0000-000000009102', 'Draft synthetic document', 'test', 'draft', '00000000-0000-0000-0000-000000009101', 'qa-archive'),
  ('10000000-0000-0000-0000-000000009103', 'Team synthetic document', 'test', 'team', '00000000-0000-0000-0000-000000009101', 'qa-archive'),
  ('10000000-0000-0000-0000-000000009104', 'Canonical synthetic document', 'test', 'canonical', '00000000-0000-0000-0000-000000009101', 'qa-archive');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000009102', true);

SELECT results_eq(
  $$ SELECT count(*)::bigint FROM public.os_documents WHERE id = '10000000-0000-0000-0000-000000009101' $$,
  ARRAY[0::bigint], 'teammate cannot read an archived document'
);
SELECT results_eq(
  $$ SELECT count(*)::bigint FROM public.os_document_versions WHERE document_id = '10000000-0000-0000-0000-000000009101' $$,
  ARRAY[0::bigint], 'teammate cannot read archived document versions'
);
SELECT results_eq(
  $$ SELECT count(*)::bigint FROM public.os_documents WHERE id = '10000000-0000-0000-0000-000000009102' $$,
  ARRAY[0::bigint], 'another member draft remains private'
);
SELECT results_eq(
  $$ SELECT count(*)::bigint FROM public.os_documents WHERE id = '10000000-0000-0000-0000-000000009103' $$,
  ARRAY[1::bigint], 'same-team document remains readable'
);
SELECT results_eq(
  $$ SELECT count(*)::bigint FROM public.os_documents WHERE id = '10000000-0000-0000-0000-000000009104' $$,
  ARRAY[1::bigint], 'company canonical document remains readable'
);

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000009101', true);
SELECT results_eq(
  $$ SELECT count(*)::bigint FROM public.os_documents WHERE id = '10000000-0000-0000-0000-000000009101' $$,
  ARRAY[1::bigint], 'owner can recover their archived document'
);
SELECT results_eq(
  $$ SELECT count(*)::bigint FROM public.os_document_versions WHERE document_id = '10000000-0000-0000-0000-000000009101' $$,
  ARRAY[1::bigint], 'owner can read the archived document version'
);

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000009103', true);
SELECT results_eq(
  $$ SELECT count(*)::bigint FROM public.os_documents WHERE id = '10000000-0000-0000-0000-000000009101' $$,
  ARRAY[1::bigint], 'administrator can recover another member archive'
);

RESET ROLE;
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claim.role', 'anon', true);
SELECT set_config('request.jwt.claim.sub', '', true);
SELECT results_eq(
  $$ SELECT count(*)::bigint FROM public.os_documents WHERE id = '10000000-0000-0000-0000-000000009101' $$,
  ARRAY[0::bigint], 'anonymous user cannot read the archive'
);

RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
