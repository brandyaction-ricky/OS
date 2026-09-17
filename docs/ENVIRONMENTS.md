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
```

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

The repository workflow validates pull requests and pushes to `main`; it does not deploy. Vercel Git integration may still deploy automatically outside this repository, so its project settings must be inspected before the first remote push or merge.

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

- Local demo bootstrap and repository CI validation are implemented.
- The Vercel project is not linked in this checkout.
- DEV/QA resource separation and automatic deployment behavior remain to be confirmed in the provider settings.
- No deployment or production configuration change is performed by this setup.
