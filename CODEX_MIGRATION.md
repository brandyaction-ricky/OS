# Codex Migration Guide

## Goal

Move BrandyAction OS development from conversation-driven changes to repository-context-driven Codex development.

## Current State

The repository can be installed, tested, linted, type-checked, built, and run locally in demo mode. Repository CI performs the same side-effect-free gate plus a browser smoke test. The local checkout is linked to the existing Vercel project. The four active migrations are applied to the dedicated Supabase DEV project without seeds or Production data, including Auth-trigger restoration, RLS performance optimization, and least-privilege function execution. The 23-case pgTAP suite passes. Local Advisors are clean; DEV Performance warnings are zero and the remaining 15 DEV Security findings are the intentional authenticated RLS/RPC grants. QA uses an immutable Preview with isolated DEV resources, and the eight core Vercel variables are scoped only to Preview and Development. A dedicated DEV-only identity completed connected login QA on commit `da421f4`; Production remains blocked and untouched.

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
