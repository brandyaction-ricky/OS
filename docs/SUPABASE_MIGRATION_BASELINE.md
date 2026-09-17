# Supabase Migration Baseline

Updated: 2026-09-17 Asia/Seoul.

## Decision

Do not apply the current repository migration chain to DEV or Production yet. The files in `supabase/migrations` are frozen legacy deltas, not a complete schema baseline. `npm run db:migrations:ready` is the mandatory preflight and must continue to fail until a reviewed core baseline exists.

No migration, seed, reset, history repair, schema change, or Production write was performed while establishing this decision.

## Current tooling state

- Supabase CLI is pinned as an exact development dependency at `2.117.0`; local configuration was generated with that CLI.
- Production PostgreSQL major version was confirmed through a read-only query as 17, and local `supabase/config.toml` matches it.
- Local Data API automatic table exposure and automatic seed execution are disabled. The reviewed baseline must grant only the intended API privileges, and no seed will run implicitly.
- The authenticated Production schema-only dump dry run succeeded. The real dump is currently blocked because neither Docker nor Podman is installed; Supabase CLI runs its filtered `pg_dump` in a container.
- `npm run db:tooling:check` reports the pinned/configured state. `npm run db:tooling:ready` is the hard gate for the schema export and intentionally fails until an operational container runtime is present.

The failed export produced no schema output. It did not run a migration or modify Production or DEV.

## Evidence

- The repository contains 14 ordered migration files.
- Production migration history contains 7 entries, with no exact identifier match to the repository filenames.
- Production currently has the core OS schema, while DEV has no OS tables, functions, policies, triggers, or migration history.
- The first repository migration explicitly requires pre-existing `os_profiles`, `os_documents`, `os_doc_status`, and `os_search_knowledge` contracts and raises `OS_CORE_SCHEMA_REQUIRED` without them.
- Additional unversioned core contracts include document versions, chunks, events, embedding jobs, skills, allowed domains, functions, triggers, policies, grants, and enum types. The non-secret inventory is frozen in `supabase/migration-baseline.json`.
- Git history does not contain an earlier core migration. The application rebuild was written against an already-existing Production schema.

## Why a direct push is unsafe

Running `db push`, `apply_migration`, or the SQL files individually against empty DEV would fail at the first migration. Marking migrations as applied would be worse: it would create a false history while leaving required objects absent. Production history repair is also blocked because history changes do not prove schema equivalence.

New Supabase projects also no longer guarantee automatic Data API grants for new `public` tables. The reviewed baseline must therefore contain explicit least-privilege grants as well as RLS policies. RLS alone is not sufficient. See the [Supabase Data API exposure change](https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically).

## Baseline construction gate

1. Keep the pinned Supabase CLI and committed local configuration. Never commit `.temp`, linked project identifiers, database URLs, or credentials.
2. Install and start an approved Docker or Podman runtime, then pass `npm run db:tooling:ready`.
3. Obtain a schema-only Production export through the approved read-only database connection. Do not use `db pull` against Production because it can update remote migration history. Do not export rows, Auth users, Storage objects, secrets, or employee data.
4. Reduce the export to the application-owned core contract that predates the first frozen legacy delta. Exclude provider-managed schemas and all business data.
5. Preserve the 14 legacy files and their checksums in an archive, then generate a clean active chain with `supabase migration new`: first `core_baseline`, followed by reviewed copies of the legacy deltas in their original order. Never invent or manually backdate migration timestamps.
6. Review extension handling, enum types, table constraints, foreign-key indexes, triggers, `SECURITY DEFINER` functions, fixed `search_path`, function execution grants, explicit Data API grants, and RLS policies.
7. Rebuild a disposable local Supabase stack from zero and apply the complete chain. A clean `supabase db reset` is required before any remote DEV write.
8. Run schema contract tests, generated type comparison, security advisor, performance advisor, and representative authenticated RLS tests.
9. Update `supabase/migration-baseline.json` for the clean active chain and its checksums, then change its status to `ready` and decision to `apply` only after review evidence is recorded.
10. Run `npm run db:migrations:ready`. It must pass before requesting separate approval to apply migrations to DEV.

The command sequence and review expectations follow Supabase's [local development workflow](https://supabase.com/docs/guides/local-development/cli-workflows), with the stricter constraint that Production is never modified while the baseline is captured.

## Production reconciliation gate

Production is a separate future operation. First compare the reviewed baseline and every later migration with the live schema. Only then prepare a forward-only history reconciliation plan. `supabase migration repair` changes tracking records without applying SQL, so it requires a separately reviewed mapping and explicit Production approval.

Never reset Production, replay the legacy chain blindly, copy Production data into DEV, or use Production credentials for connected tests.

## Environment model

The current model uses Local, one isolated DEV Supabase project, and Production. QA remains a verification stage on an immutable PR Preview; it does not require a third database project. Connected Preview tests may use DEV only when concurrency and test-data isolation are controlled, and they must never point to Production.
