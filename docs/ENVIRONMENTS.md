# Development, QA, and Production Environments

## Local Bootstrap

Requirements: Git, Node.js from `.nvmrc`, and npm.

```bash
nvm use
npm ci
npm run setup:local
npm run env:check -- --mode local --file .env.local
npm run dev
```

`setup:local` creates `.env.local` only when it does not exist. It never overwrites an existing file and defaults to demo mode. Add development-only credentials manually or with an approved Vercel environment pull. Never copy production secrets into local files.

Run the full local gate with:

```bash
npm run verify
npm run test:e2e
```

The browser test starts a local development server, verifies `/home` in demo mode, and checks the `/api/v1/health` response contract. It does not use external credentials.

## Environment Contract

| Logical stage | `OS_ENVIRONMENT` | Vercel scope | Database and integrations |
| --- | --- | --- | --- |
| Local demo | `local` | None | No credentials required |
| DEV | `development` | Development or a DEV-only Preview branch | Development-only resources |
| QA | `qa` | Preview | Isolated DEV resources with controlled test data and concurrency |
| Production | `production` | Production | Production resources |

DEV, QA, and Production require the core keys reported by `npm run env:check`. Optional integration groups are reported as `configured`, `partial`, or `not configured` without printing their values.

The TypeSafe/JEV integration is a separate DEV/QA-only shadow experiment. It requires `TYPESAFE_API_KEY`, both
`SYSTEM_ONE_JEV_SHADOW_ENABLED=true` and `NEXT_PUBLIC_SYSTEM_ONE_JEV_SHADOW_ENABLED=true`, a verified DEV Supabase
identity, and a non-main Preview (or local development). Keep both flags false in Production. Shadow results are
ephemeral observations: they do not save a judgment, approve a stage, or move a content record.

The content-planning handoff/reference panel and content-evidence panels currently share DEV/QA-only gates with
preflight or JEV. Deploying the current code to Production therefore does not make those panels available. Do not
reuse either experimental flag to expose a Production content workflow; use the reviewed design in
[`SYSTEM_ONE_PRODUCTION_GATE_DESIGN.md`](SYSTEM_ONE_PRODUCTION_GATE_DESIGN.md) before implementing a separate gate.

Environment values belong in `.env.local`/`.env.*.local`, the approved secret store, or Vercel environment variables. Only empty names and safe defaults belong in tracked templates. `NEXT_PUBLIC_*` values are browser-visible and must never contain secrets.

## Branch and Promotion Flow

```text
codex/<task> or work/<task>
  -> local DEV verification
  -> pull request + CI
  -> immutable Preview commit
  -> QA verification
  -> approved merge to main
  -> approved Production deployment or promotion
  -> post-deploy verification
```

The repository workflow validates pull requests and pushes to `main`; it does not deploy by itself. The existing Vercel Git integration does: a task-branch push creates a Preview deployment, and a `main` push creates a Production deployment. Treat every push to `main` as a production-affecting action that requires explicit approval.

The local `.vercel/project.json` links this checkout to the existing project and is intentionally ignored by Git because it contains provider identifiers. Do not copy those identifiers into tracked documentation.

## Connected Browser QA

Authenticated QA is opt-in and must target the isolated DEV resource:

```bash
PLAYWRIGHT_BASE_URL=https://approved-preview.example \
E2E_TEST_EMAIL=dedicated-test-account@example.com \
npm run test:e2e:connected
```

Inject `E2E_TEST_PASSWORD` from the approved secret store before running the command. Do not put these values in tracked files, command logs, completion records, or screenshots. The test skips when the required values are absent. Production URLs and employee accounts are not valid test targets.

## Supabase Promotion Gate

The Production Supabase project has no development branches. A separate `brandyaction-os-dev` project exists in the approved organization and Seoul region. QA is a verification stage on an immutable Preview commit and uses isolated DEV resources, not a third database project. The repository currently contains one baseline plus 14 forward migrations; the original four-file zero-state validation is historical bootstrap evidence, not verification of the entire current chain. Four later content-evidence and archived-document migrations are recorded as DEV-only and require separate Production authorization. Before any database promotion, freshly compare the exact target's migration history and schema with the candidate; do not infer live state from file counts or older snapshots.

1. Keep the provisioned DEV project isolated from Production and control concurrent Preview test data.
2. Treat the core schema snapshot and forward migrations in `supabase/migrations` as the active chain. The 14 pre-baseline historical deltas are preserved in `supabase/migrations-legacy` and must never be replayed as the active chain. The most recent recorded Production inventory is a dated snapshot, not a live check; it showed unmatched history entries, so refresh it before preparing a candidate.
3. Preserve the original four-file zero-state validation, incremental privilege-hardening check, 23-case RLS/function-grant suite, and recorded Advisor disposition as historical bootstrap evidence. A full-chain local reset is a separate destructive action and requires separate approval.
4. Preview and Development Vercel scopes contain only DEV Supabase/configuration values. Verify each immutable Preview against that DEV schema with a dedicated test identity.
5. Keep Production migration, seed, reset, policy, auth, and configuration changes behind separate approval.

The provider security review currently reports policy/grant/password-protection findings, and the performance review reports indexing and RLS-efficiency findings. These are assessment inputs, not authorization to change Production.

## External Writes

Build and verification commands do not register webhooks or perform database migrations.

Telegram registration is intentionally separate:

```bash
OS_ENVIRONMENT=development npm run telegram:webhook:register -- --confirm
```

Run it only after confirming `OS_PUBLIC_URL`, bot credentials, the intended environment, and authorization for the external change. Production registration requires explicit production approval.

Database migrations, seeds, resets, environment-variable changes, Preview deployments, Production deployments, promotions, and rollbacks are separate operations. Never infer them from a successful local build.

## Release Evidence

For every candidate, record:

- Base and result commit SHA
- Pull request and CI status
- Environment and exact deployment SHA/URL
- Database migration and environment-variable changes
- Verification performed and not performed
- Rollback approach
- Actual production approval and post-deploy result, when applicable

## Current State

- Local demo bootstrap, dependency audit, repository validation, and browser smoke CI are implemented.
- The checkout is locally linked to the existing Vercel project. GitHub integration and automatic Preview/Production behavior are confirmed.
- The latest observed Production deployment is ready at repository commit `0661eb4`; this work did not deploy or change it.
- The dedicated Supabase DEV project is provisioned and isolated. The active repository chain is one baseline plus 14 forward migrations. The original zero-state bootstrap verified the first four files; later migrations were applied individually under separate approvals. The four content-evidence/archived-document migrations are recorded as DEV-only. See `supabase/migration-baseline.json` and the dated evidence in `docs/SUPABASE_MIGRATION_BASELINE.md`; always perform a fresh read-only environment preflight before a new promotion.
- The local four-file bootstrap validation and 23-case RLS/function-grant suite are historical evidence, not a full reset of the present chain. Do not infer current table, policy, trigger, or migration-history counts from the initial snapshot.
- QA uses Preview plus isolated DEV resources. The eight core variables are configured only for Vercel Preview and Development scopes; Production values were not changed. A dedicated DEV-only Auth identity exists outside Git, and connected browser QA on the immutable `da421f4` Preview passed login, `/home` redirect, profile rendering, and the `서버 연결됨` readiness indicator.
- No Production database, Production environment-variable, merge, promotion, or deployment change is performed by this setup.
