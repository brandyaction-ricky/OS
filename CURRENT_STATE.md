# Development handoff

Updated: 2026-09-18 Asia/Seoul.

## Repository

- Working path: `/Users/ricky/Projects/brandyaction-os`
- Working branch: `codex/execution-setup-20260917`
- Source base: `origin/main` at `0661eb4`
- Migration-guidance merge: `0db8b54`
- Local environment implementation: `337919a`
- Local migration readiness record: `a5ef2a6`
- Browser QA and remote environment gates: `b31e56c`
- Remote branch `codex/execution-setup-20260917` is published and pull request #41 is open against `main`.

## Local Development Environment

- Node.js is pinned by `.nvmrc` to `24.21.0`.
- `npm run setup:local` creates a permission-restricted `.env.local` in demo mode and never overwrites an existing file.
- `npm run env:check` validates required key names without printing values.
- `npm run verify` is the local gate for environment shape, lint, types, tests, and build. GitHub CI also runs the Playwright local-demo smoke test.
- `npm run build` is side-effect free. Telegram webhook registration is a separate, guarded command.
- PostCSS is pinned to a patched release through npm overrides; the production dependency audit reports no known vulnerabilities.
- Architecture and environment promotion rules are documented in `ARCHITECTURE.md` and `docs/ENVIRONMENTS.md`.

## Verification

- Local demo bootstrap creation and no-overwrite behavior pass.
- Local environment readiness passes.
- Production-mode mismatch is rejected before work begins.
- Webhook registration without explicit confirmation is rejected before any external call.
- The full repository verification gate passes, including lint, type checking, 232 automated tests, and a Next.js production build.
- The Chromium local-demo smoke test passes and verifies the application shell and health contract. Connected authentication QA is present but skips without explicit DEV/QA credentials.

## Deployment State

- Vercel automatically created a Preview for pull request #41 at commit `da421f4`; it reached `READY` and `/api/v1/health` returned HTTP 200 with database, auth, account-password, and agent-MCP readiness.
- A dedicated DEV-only Auth identity was created with automatic confirmation. Manual connected browser QA on the same Preview passed: login redirected to `/home`, the profile-backed account menu rendered, and the UI reported `서버 연결됨`.
- The ignored `.vercel/project.json` links this checkout to the existing project. Branch pushes create Preview deployments and `main` pushes create Production deployments.
- The latest observed Production deployment remains ready at commit `0661eb4`.
- The Production Supabase project has no development branches and has unresolved migration-history and advisor findings. It was not changed.
- A separate `brandyaction-os-dev` Supabase project exists in Seoul. All four active migrations are applied without seeds or Production data; the reviewed Auth trigger, RLS policies, and least-privilege function grants are present.
- QA is a Preview verification stage using isolated DEV resources; no separate QA database is planned. The eight core variables are configured only for Vercel Preview and Development scopes.
- The 14 prior repository migrations are frozen legacy evidence. Production retains 7 non-matching history entries and was not changed. DEV records the reviewed four-migration active chain.

## Continuation

The three required pull-request checks pass for commit `da421f4`, including repository validation and browser smoke coverage. Local verification also passes with 232 automated tests and the 23-case database suite. The local-environment migration and connected DEV/Preview QA are complete. The remaining gates are PR review and separate approval for merge, `main` push, Production migration reconciliation, or any Production deployment/change.

Next.js remains on the tested 15.x line; the affected transitive PostCSS release is overridden to a patched version. Treat a Next.js 16 upgrade as a separate compatibility migration.
