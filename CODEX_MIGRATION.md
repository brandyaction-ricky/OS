# Codex Migration Guide

## Goal

Move BrandyAction OS development from conversation-driven changes to repository-context-driven Codex development.

## Current State

> Historical setup notes below describe the initial migration and connectivity milestone, not the current migration inventory or current release state. For current environment/migration guidance, use [`docs/ENVIRONMENTS.md`](docs/ENVIRONMENTS.md) and [`docs/SUPABASE_MIGRATION_BASELINE.md`](docs/SUPABASE_MIGRATION_BASELINE.md). For the current content-workflow/System One release boundary, use [`docs/SYSTEM_ONE_PRODUCTION_GATE_DESIGN.md`](docs/SYSTEM_ONE_PRODUCTION_GATE_DESIGN.md).

At the initial setup milestone, the repository could be installed, tested, linted, type-checked, built, and run locally in demo mode; CI ran side-effect-free checks plus a browser smoke test. The first four-file migration bootstrap, 23-case pgTAP suite, initial Advisor review, Preview-only Vercel variables, and DEV-only login QA on commit `da421f4` are historical evidence. They do not describe the full current forward-migration chain or authorize Production changes. Production remains behind a separate review and approval.

## Target State

- GitHub as code source of truth
- Documented project context
- Controlled branch strategy
- DEV validation before production

## Recommended Branch Model

main = Production
codex/* or work/* = Individual work
Pull Request Preview = QA candidate

## Migration Steps

1. [x] Analyze current repository
2. [x] Document architecture
3. [x] Provision and verify isolated DEV resources (QA uses Preview plus controlled DEV data; Production stays separate)
4. [x] Establish repository validation and promotion rules
5. [x] Confirm Vercel Git integration and deployed commit mapping
6. [x] Add browser end-to-end QA (local demo smoke is automated; connected DEV/Preview login, profile, and server-readiness flow passed on commit `da421f4`)
7. [ ] Continue feature development through Codex

## First Codex Actions

- Review `PROJECT_CONTEXT.md`, `ARCHITECTURE.md`, and related implementation before changes.
- Run `npm run setup:local` once and `npm run verify` before review.
- Identify the exact deployment target and automatic Git deployment behavior before a remote push or merge.
- Keep production database, webhook, environment-variable, and deployment changes behind explicit approval.
