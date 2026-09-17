# Development handoff

Updated: 2026-09-17 Asia/Seoul.

## Repository

- Working path: `/Users/ricky/Projects/brandyaction-os`
- Working branch: `codex/execution-setup-20260917`
- Source base: `origin/main` at `0661eb4`
- Migration-guidance merge: `0db8b54`
- Local environment implementation: `337919a`
- Local migration readiness record: `a5ef2a6`
- Browser QA and remote environment gates: `b31e56c`
- No remote push or pull request has been created.

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
- The full repository verification gate passes, including lint, type checking, 230 automated tests, and a Next.js production build.
- The Chromium local-demo smoke test passes and verifies the application shell and health contract. Connected authentication QA is present but skips without explicit DEV/QA credentials.

## Deployment State

- No Preview, DEV, QA, or Production deployment was run by this work.
- The ignored `.vercel/project.json` links this checkout to the existing project. Branch pushes create Preview deployments and `main` pushes create Production deployments.
- The latest observed Production deployment remains ready at commit `0661eb4`.
- The connected Supabase project is Production, has no development branches, and has unresolved migration-history and advisor findings. It was not changed.
- Dedicated DEV and QA Supabase/integration resources and Vercel environment-variable scopes remain incomplete.

## Continuation

Before a remote push, remember that the push itself creates a Vercel deployment. Provision separate DEV and QA resources after cost approval, reconcile migration history, scope environment variables, and run authenticated QA against an immutable Preview commit. Obtain explicit approval before a `main` push, merge, or other Production change.

Next.js remains on the tested 15.x line; the affected transitive PostCSS release is overridden to a patched version. Treat a Next.js 16 upgrade as a separate compatibility migration.
