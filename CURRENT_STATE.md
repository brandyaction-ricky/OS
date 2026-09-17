# Development handoff

Updated: 2026-09-17 Asia/Seoul.

## Repository

- Working path: `/Users/ricky/Projects/brandyaction-os`
- Working branch: `codex/execution-setup-20260917`
- Source base: `origin/main` at `0661eb4`
- Migration-guidance merge: `0db8b54`
- Local environment implementation: `337919a`
- No remote push or pull request has been created.

## Local Development Environment

- Node.js is pinned by `.nvmrc` to `24.21.0`.
- `npm run setup:local` creates a permission-restricted `.env.local` in demo mode and never overwrites an existing file.
- `npm run env:check` validates required key names without printing values.
- `npm run verify` is the local and GitHub CI gate for environment shape, lint, types, tests, and build.
- `npm run build` is side-effect free. Telegram webhook registration is a separate, guarded command.
- Architecture and environment promotion rules are documented in `ARCHITECTURE.md` and `docs/ENVIRONMENTS.md`.

## Verification

- Local demo bootstrap creation and no-overwrite behavior pass.
- Local environment readiness passes.
- Production-mode mismatch is rejected before work begins.
- Webhook registration without explicit confirmation is rejected before any external call.
- The full repository verification gate passes, including lint, type checking, 230 automated tests, and a Next.js production build.

## Deployment State

- No Preview, DEV, QA, or Production deployment was run.
- The checkout has no `.vercel/project.json`; Vercel Git integration, automatic deployment behavior, and actual deployed SHAs remain unverified.
- Dedicated DEV and QA Supabase/integration resources remain unconfirmed.

## Continuation

Before a remote push or merge, inspect Vercel project settings and determine whether the Git action will deploy. Provision separate DEV and QA resources, scope their environment variables, run authenticated QA against an immutable Preview commit, and obtain explicit approval before Production changes.

The dependency audit still reports Next.js/PostCSS advisories whose suggested automatic fix is a Next.js major upgrade. Handle that as a separate tested change.
