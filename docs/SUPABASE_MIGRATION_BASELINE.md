# Supabase Migration Baseline

Updated: 2026-09-21 Asia/Seoul.

## Decision

The six-file active chain is fully recorded in the isolated `brandyaction-os-dev` project. `supabase/migrations` contains the locally validated, schema-only snapshot of the Production `public` schema plus five forward migrations: Auth profile-trigger restoration, RLS optimization, privileged-function hardening, append-only development-request comments, and recipient-only development notifications. The 14 former delta files remain unchanged in `supabase/migrations-legacy` as historical evidence.

The user approved DEV application and later separately approved the notification migration for Production on 2026-09-21. All six active migrations are recorded in DEV, and the development-comment plus notification migrations are recorded in Production under their respective approvals. The manifest records `applied_dev_and_production` / `applied`. `npm run db:migrations:verify` remains the repository-integrity check; `db:migrations:ready` is intentionally false after application.

## Current tooling state

- Supabase CLI is pinned as an exact development dependency at `2.117.0`; local configuration was generated with that CLI.
- Production PostgreSQL major version was confirmed through a read-only query as 17, and local `supabase/config.toml` matches it.
- Docker Desktop `4.91.0` is installed and running. The repository tooling discovers its bundled CLI without requiring an administrator-owned global symlink.
- Local Data API automatic table exposure and automatic seed execution are disabled. The baseline contains the Production grants and RLS policies explicitly, and no seed runs implicitly.
- The authenticated Production schema-only dump completed through the official Supabase containerized `pg_dump`. The uncommitted raw artifact remains in `/private/tmp`; it contained no `INSERT`, `COPY`, credential literal, Auth rows, Storage objects, or business rows.
- `npm run db:tooling:ready` passes with the Docker Desktop runtime.

The first local apply exposed two snapshot portability issues: a function-scoped `pg_trgm` setting required unavailable privileges, and the filtered dump omitted the `pg_trgm` extension declaration. The candidate now uses an explicit `word_similarity(...) > 0.3` predicate and declares `pgcrypto`, `pg_trgm`, and `vector` in `extensions`. Production and DEV were not changed by that snapshot-repair work; later forward migrations were applied only under their separate approvals.

## Evidence

- The active migration chain contains the CLI-generated `core_baseline` snapshot and five forward migrations. Their checksums are pinned in the manifest. The fifth forward migration adds `@`멘션·담당 지정 알림, 수신자 전용 조회, 전달·읽음 상태, 중복 차단과 불변 조건을 추가한다. The 14 ordered legacy files and their original SHA-256 checksums are preserved in `supabase/migrations-legacy`.
- Production migration history contains 10 entries, with two exact repository migration matches: the previously approved development-comment migration and the separately approved notification migration. Postflight verification confirmed the notification record type, two indexes, both triggers, mention-aware comment guard, safe `SECURITY DEFINER` search path, and execution denial for `PUBLIC`, `anon`, and `authenticated`; the two existing comments were preserved and no notification fixture was created.
- DEV records all six active migration versions. It retains the two existing comments, has no generated notification fixtures, and contains the notification guard/creation triggers plus inbox/deduplication indexes. Direct execution of the privileged creation trigger function is denied to `PUBLIC`, `anon`, and `authenticated`, while `service_role` remains allowed.
- The first repository migration explicitly requires pre-existing `os_profiles`, `os_documents`, `os_doc_status`, and `os_search_knowledge` contracts and raises `OS_CORE_SCHEMA_REQUIRED` without them.
- The snapshot contains 34 tables, 5 enum types, 35 functions, 36 policies, 58 indexes, 10 triggers, and RLS enabled on all 34 public tables. Production and rebuilt Local object inventories match with no missing or unexpected objects.
- A clean local `supabase db reset --local --no-seed` succeeded for the original three-migration chain. The fourth privilege-hardening migration was then applied incrementally to the same local database and DEV, producing exactly four migration-history entries in both targets. A destructive zero-state reset of the four-migration chain was not repeated because that separate reset approval was not granted.
- Generated TypeScript types match Production after removing the provider-only PostgREST version metadata block; the normalized SHA-256 values are identical.
- The representative pgTAP suite passes 23 authenticated, inactive, admin, lead, member, ownership-write, finance-boundary, anonymous RLS, and function-execution assertions. Every fixture is transaction-scoped and rolled back.
- The official Supabase CLI Security and Performance Advisors report no warning-or-higher issues locally. The DEV Performance Advisor reports zero warnings. The DEV Security Advisor reports 15 intentional authenticated `SECURITY DEFINER` execution findings for the exact RLS helpers and user-facing RPCs retained by the hardening migration; anonymous privileged execution and authenticated service-only execution are both zero.
- Git history does not contain an earlier core migration. The application rebuild was written against an already-existing Production schema.

## Why a direct push is unsafe

The old delta chain could not build an empty database and must never be replayed from `supabase/migrations-legacy`. The reviewed notification migration is applied to DEV and, after an exact Production preflight and separate user approval, to Production. Broader baseline history repair remains blocked because these forward-migration approvals do not authorize rewriting unrelated Production history.

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
- [x] Run representative authenticated RLS and function-grant tests (23/23 passed).
- [x] Resolve the 18 performance warnings in a separate forward migration and confirm 0 findings for the two affected Advisor rules.
- [x] Rebuild the original three-migration chain from zero after explicit approval to discard the prior local database.
- [x] After explicit DEV approval, change the manifest to `ready`/`apply` and pass `npm run db:migrations:ready`.
- [x] Apply all six active migrations to the isolated DEV project without seed/Vault changes and record remote verification.
- [x] After separate Production approval, preflight and apply the notification migration, preserve the two existing comments, and verify history, constraints, indexes, triggers, function privileges, and zero notification fixtures.
- [ ] Repeat a destructive local zero-state reset for the complete six-file chain only after separate approval; incremental validation and the automated suite already pass.

The command sequence and review expectations follow Supabase's [local development workflow](https://supabase.com/docs/guides/local-development/cli-workflows), with the stricter constraint that Production is never modified while the baseline is captured.

## Production reconciliation gate

The notification migration Production gate is complete: live prerequisites were checked, explicit approval named Production Supabase and Vercel impact, the migration was applied transactionally, and postflight verification passed. Broader baseline reconciliation remains a different operation. `supabase migration repair` changes tracking records without applying SQL, so it still requires a separately reviewed mapping and explicit Production approval.

Never reset Production, replay the legacy chain blindly, copy Production data into DEV, or use Production credentials for connected tests.

## Environment model

The current model uses Local, one isolated DEV Supabase project, and Production. QA remains a verification stage on an immutable PR Preview; it does not require a third database project. Connected Preview tests may use DEV only when concurrency and test-data isolation are controlled, and they must never point to Production.
