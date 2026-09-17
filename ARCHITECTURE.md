# BrandyAction OS Architecture

## System Boundary

BrandyAction OS is a single Next.js App Router application. It serves the internal web UI and versioned HTTP APIs from one deployable unit. Supabase provides authentication, PostgreSQL storage, row-level security, full-text search, and vector search. Vercel is the intended application runtime.

GitHub is the source of truth for application code, migrations, tests, and operational documentation. Supabase migration history is the source of truth for database structure. Vercel deployment history is the source of truth for what artifact is running in each hosted environment.

## Runtime Components

| Component | Location | Responsibility |
| --- | --- | --- |
| App Router UI | `app/(os)`, `components` | Internal operating workspaces and navigation |
| API layer | `app/api/v1` | Authenticated documents, records, development, content, integrations, and health APIs |
| Domain logic | `lib`, `lib/server` | Validation, authorization, content workflows, search, indexing, and integration logic |
| Active database changes | `supabase/migrations` | Reviewed baseline and future forward-only migrations |
| Legacy migration evidence | `supabase/migrations-legacy` | Frozen pre-baseline deltas; never applied as an active chain |
| Integration adapters | `tools`, `integrations/mcp` | Local import, explicit webhook registration, and MCP access |
| Verification | `tests`, `tests/e2e`, `.github/workflows/validate.yml` | Contract, regression, browser smoke, type, lint, build, and CI checks |

## Data and Trust Boundaries

- Browser code may receive only `NEXT_PUBLIC_*` configuration. Public Supabase keys are subject to row-level security and are not privileged secrets.
- Service-role keys and third-party credentials are server-only and must never enter client bundles, Git, screenshots, logs, or completion records.
- API routes authenticate and authorize before privileged database access.
- Database changes are represented by reviewed files in `supabase/migrations`; migration execution is a separately approved environment operation.
- Uploaded or synchronized content is untrusted input and remains subject to validation, access control, and bounded processing.

## External Integrations

The application can call Supabase, OpenAI, Anthropic, YouTube, Telegram, Meta Ads, and Google Ads. Missing credentials degrade to demo, keyword-only, or disconnected behavior where supported.

`npm run build` is side-effect free. Operations that change an external system, such as Telegram webhook registration, use a separate command and require an explicit environment plus a confirmation flag.

## Environment Topology

| Stage | Code source | Data/integrations | Purpose |
| --- | --- | --- | --- |
| Local | Task branch | Demo mode by default; optional development-only credentials | Implementation and fast verification |
| DEV | Task branch or shared integration ref | Dedicated development resources | Connected integration verification |
| QA | Immutable Preview commit | Isolated DEV resources with controlled test data and concurrency | Acceptance and regression testing |
| Production | Approved `main` commit | Production resources | Live operation after explicit approval |

Preview is not automatically QA-ready: the deployment commit, environment-variable scope, database target, and requested user flow must all be verified.

## Delivery Gates

1. Work starts from the latest intended base in an isolated worktree and task branch.
2. `npm run verify` and the local demo browser smoke test must pass without production credentials or external writes.
3. A pull request records the requested behavior, migrations, environment changes, verification, and rollback approach.
4. DEV and QA verification use non-production resources and identify the exact commit.
5. Production requires separate approval, an exact commit or previously verified artifact, and post-deploy verification.
6. Completion records distinguish local build, Preview readiness, merge, deployment readiness, actual deployment, and functional verification.

## Known Migration Gaps

- The local checkout is linked to the existing Vercel project through an ignored local metadata file. Git integration is active: task branches create Preview deployments and `main` creates Production deployments.
- A dedicated empty Supabase DEV project exists in Seoul, but its schema and environment variables are not configured yet. QA uses an immutable Preview commit against isolated DEV resources; a separate QA database is not required. Production must not be used for connected local or QA tests.
- Vercel environment-variable scope is not yet verified because provider-setting access requires a signed-in session.
- A schema-only Production snapshot is now the single active baseline and rebuilds successfully from zero locally. The 14 prior deltas are frozen outside the active chain, Production still records 7 non-matching history entries, and DEV remains empty. Authenticated RLS/type comparison, performance-warning disposition, and explicit DEV approval are still required. See `docs/SUPABASE_MIGRATION_BASELINE.md`.
- Connected authentication QA is implemented but remains intentionally skipped until the isolated DEV target, Preview environment variables, and a test account are ready.
- Supabase security and performance advisors have open findings that require a separate, dependency-aware remediation review.

See `docs/ENVIRONMENTS.md` for setup and promotion procedures.
