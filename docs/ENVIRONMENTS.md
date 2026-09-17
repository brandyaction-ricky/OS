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
| QA | `qa` | Preview | QA-only resources |
| Production | `production` | Production | Production resources |

DEV, QA, and Production require the core keys reported by `npm run env:check`. Optional integration groups are reported as `configured`, `partial`, or `not configured` without printing their values.

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

Authenticated QA is opt-in and must target isolated DEV or QA resources:

```bash
PLAYWRIGHT_BASE_URL=https://approved-preview.example \
E2E_TEST_EMAIL=dedicated-test-account@example.com \
npm run test:e2e:connected
```

Inject `E2E_TEST_PASSWORD` from the approved secret store before running the command. Do not put these values in tracked files, command logs, completion records, or screenshots. The test skips when the required values are absent. Production URLs and employee accounts are not valid test targets.

## Supabase Promotion Gate

The Production Supabase project has no development branches. A separate `brandyaction-os-dev` project now exists in the approved organization and Seoul region. It is healthy and empty: no public tables, migrations, or Production data were copied. Before connected DEV or QA:

1. Keep the provisioned DEV project isolated and provision QA separately after its own cost confirmation.
2. Establish a reviewed schema baseline; current repository migration filenames and remote migration-history identifiers do not reconcile.
3. Configure only environment-specific keys and confirm RLS and function grants with test identities.
4. Run migrations in DEV first, then QA, recording exact migration identities and results.
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
- The dedicated Supabase DEV project is provisioned, healthy, and empty. Its schema and environment variables are intentionally not configured yet.
- QA resource separation and Vercel environment-variable scope remain incomplete.
- No deployment, production database change, or production configuration change is performed by this setup.
