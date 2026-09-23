# Supabase Migration Baseline

Updated: 2026-09-23 Asia/Seoul.

## 2026-09-23 content evidence team read — DEV applied

`20260923080000_content_evidence_team_read.sql` follows the DEV-applied owner
boundary below. It replaces only the restrictive evidence SELECT policy: an
active owner still reads their rows, and another active user reads the three
evidence subtypes only when the row has a nonblank team matching that user's
active `os_profiles.team`. A blank row or viewer team fails closed. The broad
ordinary-record policy does not bypass this restriction. The prior owner-only
INSERT policy and append-only trigger remain unchanged. The content screen
shows a non-owner the cards without an add control.

The representative separately approved the DEV access change on 2026-09-23.
Read-only preflight found exactly the three P03 evidence rows assigned to
`콘텐츠`, one active owner and one active intended reader, both with blank
profile teams, and no existing active content-team members. The 16-check
transaction-scoped pgTAP suite passed against the candidate policy before
application. In the isolated `brandyaction-os-dev` project, one guarded
transaction assigned exactly those two profiles to `콘텐츠`, replaced the
restrictive SELECT policy with the exact 816-byte repository migration, and
recorded version `20260923080000` in migration history. Postflight found two
expected active content-team profiles, three unchanged evidence rows, the new
policy present, the old one absent, and one history entry. The recorded SQL
MD5 `1ff47692a8082391655f0dbd92890a10` matches the repository file.

The manifest now records DEV application only. `requiresApproval: true` and
`productionAuthorized: false` remain in force. The migration did not modify
evidence rows, INSERT policy, or append-only trigger. Browser QA on the new
PR Preview still needs the two accounts to log in to that host; policy-level
post-application checks and PR integration review remain release gates. A
local SQL run was unavailable in this worktree because Docker/Podman was not
on `PATH`; static and app tests do not substitute for the connected DEV gate.
Production schema changes and deployment need separate approval.

## 2026-09-23 content evidence boundary — DEV applied

After merging this DEV-only migration into the newer eleven-file active chain,
the manifest contains twelve active files. The 2026-09-22 Production approval
ends at `20260922063605_knowledge_review_return.sql`; it does not extend to
`20260923060000_content_evidence_owner_and_append_only.sql`. The current full
chain therefore has `productionAuthorized: false` and the new entry retains
`requiresApproval: true`. Integrity checks may pass, but
`npm run db:migrations:ready` must fail until a separate Production decision is
recorded. Do not treat the historical `ready`/`apply` fields as fresh approval.

`20260923060000_content_evidence_owner_and_append_only.sql` is a forward-only
migration for the three content-evidence `packageKind` values. It narrows
authenticated reads and owner assignment for those rows and rejects direct
UPDATE/archival/DELETE or relabelling through a database trigger. It leaves
ordinary `os_records` access unchanged. The transaction-scoped pgTAP suite is
`supabase/tests/content_evidence_boundary_test.sql`.

The representative explicitly approved applying this SQL to
`brandyaction-os-dev` only. Before application, the live DEV migration history
(including the separate quota migration) was inspected, and the SQL plus all
10 pgTAP checks passed inside a rolled-back DEV transaction. No local
PostgreSQL runtime was available. The exact migration was then applied in a
transaction and recorded as version `20260923060000`; the trigger function,
two policies and history row were verified. The pgTAP suite passed 10/10 again
against the applied DEV schema, and the existing owner account could still
read its cards in Preview. Independent second-account browser QA remains open;
the pgTAP suite did verify cross-account read denial and forged-owner INSERT
denial using two authenticated identities. This is **not** applied to Local or
Production. Production requires its own schema comparison, plan and explicit
approval. Owner-entered rows remain user claims, not source-verified or
tamper-proof audit evidence; a same-owner client can still INSERT unvalidated
evidence directly.

The DEV migration-history statement is the repository SQL without its final
newline (2,391 versus 2,392 bytes). Its MD5 matches the repository file with
only that final newline removed; no SQL statement differs. Do not mistake this
byte-level formatting difference for a missing or different migration.

## 2026-09-21 narrowly approved quota maintenance

The historical baseline status below describes the four-migration DEV rollout;
it does not describe later individually approved Production maintenance.
`20260921140000_agent_update_daily_limit.sql` was approved and applied separately
to Production: only `knowledge.update` changes from 200 to 1000 per rolling
24 hours. All minute, create/delete and authorization checks remain unchanged.
The application was not merged or deployed to Production by this operation.

The follow-up `supabase/maintenance/record_agent_update_quota_history.sql`
records only that already-verified version and the exact migration SQL. It
checks the live quota, refuses mismatched existing tracking records, and does
not execute the payload or reconcile any other migration. The checksum of the
stored statement must match the repository file after application. This is not
approval to replay the baseline or repair unrelated historical entries.

The new quota migration has not been applied to DEV by this task. Before a
future DEV application, review that environment's live definition separately.
The original baseline's `applied_dev` manifest fields remain historical facts,
not a claim that every subsequently added forward migration is deployed.

## Decision

The reviewed eleven-file active chain contains the isolated DEV schema baseline and ten forward migrations, including Telegram team workflow and knowledge review return. Do not replay the schema baseline against Production. The newest migration adds the review-to-team return transition while preserving existing authorization, row locking, and audit events. The 14 former delta files remain unchanged in `supabase/migrations-legacy` as historical evidence.

The user explicitly approved DEV and Production database application plus Production deployment on 2026-09-22 after the repository tests and first Preview passed. The manifest records `ready` / `apply`; the Telegram migration has been applied and verified in Production, while DEV remains pending. This approval does not authorize replaying the schema baseline, seeds, reset, Production data copy, or unrelated history repair.

## Knowledge review return release — 2026-09-22

The approved `20260922063605_knowledge_review_return.sql` migration was applied independently to DEV and Production. The live function source matched the reviewed prerequisite in both environments before execution. A guarded transaction replaced only that function and recorded the exact SQL; no baseline replay, seed, reset, or unrelated migration was executed. DEV now has 10 history entries and Production has 14; the Telegram DEV migration remains pending.

DEV transaction-scoped tests passed for owner review requests, active reviewer return, audit events, inactive and anonymous denial, nonowner publish denial, and repeated-call idempotence. All synthetic fixtures were rolled back. Postflight confirmed the function source, migration entry, anonymous denial, authenticated execution, and unchanged Production Security Advisor findings. The original function definition is retained outside Git for rollback; the previous application remains compatible with this additive transition.

The manifest approval applies to this exact forward migration and does not authorize whole-chain Production application or history reconciliation. Earlier evidence below remains a historical record.

## Current tooling state

- Supabase CLI is pinned as an exact development dependency at `2.117.0`; local configuration was generated with that CLI.
- Production PostgreSQL major version was confirmed through a read-only query as 17, and local `supabase/config.toml` matches it.
- Docker Desktop `4.91.0` is installed and running. The repository tooling discovers its bundled CLI without requiring an administrator-owned global symlink.
- Local Data API automatic table exposure and automatic seed execution are disabled. The baseline contains the Production grants and RLS policies explicitly, and no seed runs implicitly.
- The authenticated Production schema-only dump completed through the official Supabase containerized `pg_dump`. The uncommitted raw artifact remains in `/private/tmp`; it contained no `INSERT`, `COPY`, credential literal, Auth rows, Storage objects, or business rows.
- `npm run db:tooling:ready` passes with the Docker Desktop runtime.

The first local apply exposed two snapshot portability issues: a function-scoped `pg_trgm` setting required unavailable privileges, and the filtered dump omitted the `pg_trgm` extension declaration. The candidate now uses an explicit `word_similarity(...) > 0.3` predicate and declares `pgcrypto`, `pg_trgm`, and `vector` in `extensions`. Production and DEV were not changed by that snapshot-repair work; later forward migrations were applied only under their separate approvals.

## Evidence

- The active migration chain contains the CLI-generated `core_baseline` snapshot and nine forward migrations. Their checksums are pinned in the manifest. The newest migration is schema-only and adds two RLS-protected Telegram workflow tables plus additive receipt/profile-link columns and deduplication indexes. The 14 ordered legacy files and original SHA-256 checksums remain preserved in `supabase/migrations-legacy`.
- Production migration history now contains 13 entries, with six exact repository migration matches: the agent update-quota patch, development-request comments, development notifications, indexed knowledge search, agent write rate-limit metadata, and Telegram team workflow. The Telegram postflight confirmed four receipt/metadata columns, one profile-link column, two RLS-enabled tables, four indexes, and three policies.
- DEV currently records all preceding nine active migration versions. It retains the indexed knowledge-search function, notification controls, agent write-limit metadata, and restored Auth profile trigger. The Telegram migration is pending until the approved application and postflight below complete.
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
- [x] Apply all nine active migrations to the isolated DEV project without seed/Vault changes and record remote verification.
- [x] Apply and verify the tenth Telegram workflow migration in Production under the 2026-09-22 explicit approval (history 13, public tables 37, public policies 39).
- [ ] Apply and verify the tenth Telegram workflow migration in DEV under the 2026-09-22 explicit approval.
- [x] After separate Production approval, preflight and apply the notification migration, preserve the two existing comments, and verify history, constraints, indexes, triggers, function privileges, and zero notification fixtures.
- [x] After separate Production approval, preflight and apply the agent write rate-limit metadata migration, then verify migration history, the move bucket, 1,000-write update fallback, RLS, service-role-only configuration access, and the audit-log lookup index.
- [ ] Repeat a destructive local zero-state reset for the complete ten-file chain only after separate approval; incremental validation and the automated suite already pass.

The command sequence and review expectations follow Supabase's [local development workflow](https://supabase.com/docs/guides/local-development/cli-workflows), with the stricter constraint that Production is never modified while the baseline is captured.

## Production reconciliation gate

The notification, agent write rate-limit metadata, and Telegram team-workflow Production gates are complete: live prerequisites were checked, explicit approval named Production Supabase and Vercel impact, each migration was applied transactionally, and postflight verification passed. A fresh inventory also confirms the knowledge-search and update-quota migrations in both DEV and Production. Broader baseline reconciliation remains a different operation. `supabase migration repair` changes tracking records without applying SQL, so it still requires a separately reviewed mapping and explicit Production approval.

Never reset Production, replay the legacy chain blindly, copy Production data into DEV, or use Production credentials for connected tests.

## Environment model

The current model uses Local, one isolated DEV Supabase project, and Production. QA remains a verification stage on an immutable PR Preview; it does not require a third database project. Connected Preview tests may use DEV only when concurrency and test-data isolation are controlled, and they must never point to Production.
