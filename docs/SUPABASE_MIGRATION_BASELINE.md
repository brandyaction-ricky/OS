# Supabase Migration Baseline

Updated: 2026-09-17 Asia/Seoul.

## Decision

Do not apply the active chain to DEV or Production yet. `supabase/migrations` contains the locally validated, schema-only snapshot of the current Production `public` schema plus two forward migrations: one restores the `auth.users` profile trigger omitted by a public-only export, and one preserves the existing access rules while optimizing RLS policy evaluation. The 14 former delta files remain unchanged in `supabase/migrations-legacy` as historical evidence.

The manifest status is `validated_local` and its decision remains `do_not_apply`. The complete three-migration chain now passes a fresh zero-state reset, but `npm run db:migrations:ready` must continue to fail until DEV application receives separate approval. No remote migration, seed, reset, history repair, schema change, or Production data copy was performed.

## Current tooling state

- Supabase CLI is pinned as an exact development dependency at `2.117.0`; local configuration was generated with that CLI.
- Production PostgreSQL major version was confirmed through a read-only query as 17, and local `supabase/config.toml` matches it.
- Docker Desktop `4.91.0` is installed and running. The repository tooling discovers its bundled CLI without requiring an administrator-owned global symlink.
- Local Data API automatic table exposure and automatic seed execution are disabled. The baseline contains the Production grants and RLS policies explicitly, and no seed runs implicitly.
- The authenticated Production schema-only dump completed through the official Supabase containerized `pg_dump`. The uncommitted raw artifact remains in `/private/tmp`; it contained no `INSERT`, `COPY`, credential literal, Auth rows, Storage objects, or business rows.
- `npm run db:tooling:ready` passes with the Docker Desktop runtime.

The first local apply exposed two snapshot portability issues: a function-scoped `pg_trgm` setting required unavailable privileges, and the filtered dump omitted the `pg_trgm` extension declaration. The candidate now uses an explicit `word_similarity(...) > 0.3` predicate and declares `pgcrypto`, `pg_trgm`, and `vector` in `extensions`. Production and DEV were not changed.

## Evidence

- The active migration chain contains the CLI-generated `core_baseline` snapshot and two CLI-generated forward migrations. Their checksums are pinned in the manifest. The 14 ordered legacy files and their original SHA-256 checksums are preserved in `supabase/migrations-legacy`.
- Production migration history contains 7 entries, with no exact identifier match to the repository filenames.
- Production currently has the core OS schema, while DEV has no OS tables, functions, policies, triggers, or migration history.
- The first repository migration explicitly requires pre-existing `os_profiles`, `os_documents`, `os_doc_status`, and `os_search_knowledge` contracts and raises `OS_CORE_SCHEMA_REQUIRED` without them.
- The snapshot contains 34 tables, 5 enum types, 35 functions, 36 policies, 58 indexes, 10 triggers, and RLS enabled on all 34 public tables. Production and rebuilt Local object inventories match with no missing or unexpected objects.
- A clean local `supabase db reset --local --no-seed` succeeded for the complete active chain. The baseline and both forward migrations applied in order, producing exactly three local migration-history entries.
- Generated TypeScript types match Production after removing the provider-only PostgREST version metadata block; the normalized SHA-256 values are identical.
- The representative pgTAP suite passes 20 authenticated, inactive, admin, lead, member, ownership-write, finance-boundary, and anonymous RLS assertions. Every fixture is transaction-scoped and rolled back.
- The official Supabase CLI Security and Performance Advisors both report no warning-or-higher issues on the rebuilt local database. The previously observed 13 auth-function initialization-plan findings and 5 multiple-permissive-policy findings were addressed in a forward migration.
- Git history does not contain an earlier core migration. The application rebuild was written against an already-existing Production schema.

## Why a direct push is unsafe

The old delta chain could not build an empty database and must never be replayed from `supabase/migrations-legacy`. The complete active chain now builds an empty local database and passes the RLS and Advisor gates, but remote application remains blocked until a separate DEV approval is recorded. Production history repair is also blocked because history changes do not prove schema equivalence.

New Supabase projects also no longer guarantee automatic Data API grants for new `public` tables. The reviewed baseline must therefore contain explicit least-privilege grants as well as RLS policies. RLS alone is not sufficient. See the [Supabase Data API exposure change](https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically).

## Baseline construction gate

- [x] Pin and initialize the Supabase CLI without committing `.temp`, project references, database URLs, or credentials.
- [x] Start an approved container runtime and pass `npm run db:tooling:ready`.
- [x] Capture a filtered, schema-only Production export without `db pull` or row data.
- [x] Generate the snapshot filename with `supabase migration new core_baseline`; never manually backdate migration timestamps.
- [x] Preserve the 14 legacy deltas and checksums outside the active chain.
- [x] Review and validate extensions, object counts, RLS coverage, `SECURITY DEFINER` search paths, grants, revokes, and credential/data absence.
- [x] Rebuild the disposable local database from zero with no seed and confirm the baseline-only migration history.
- [x] Run local security and performance advisors and freeze the findings in the manifest.
- [x] Compare generated TypeScript schema types with Production.
- [x] Run representative authenticated RLS tests (20/20 passed).
- [x] Resolve the 18 performance warnings in a separate forward migration and confirm 0 findings for the two affected Advisor rules.
- [x] Rebuild the complete three-migration chain from zero after explicit approval to discard the prior local database.
- [ ] After explicit DEV approval, change the manifest to `ready`/`apply`, pass `npm run db:migrations:ready`, and apply only to DEV.

The command sequence and review expectations follow Supabase's [local development workflow](https://supabase.com/docs/guides/local-development/cli-workflows), with the stricter constraint that Production is never modified while the baseline is captured.

## Production reconciliation gate

Production is a separate future operation. First compare the reviewed baseline and every later migration with the live schema. Only then prepare a forward-only history reconciliation plan. `supabase migration repair` changes tracking records without applying SQL, so it requires a separately reviewed mapping and explicit Production approval.

Never reset Production, replay the legacy chain blindly, copy Production data into DEV, or use Production credentials for connected tests.

## Environment model

The current model uses Local, one isolated DEV Supabase project, and Production. QA remains a verification stage on an immutable PR Preview; it does not require a third database project. Connected Preview tests may use DEV only when concurrency and test-data isolation are controlled, and they must never point to Production.
