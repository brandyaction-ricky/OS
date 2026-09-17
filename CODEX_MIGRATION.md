# Codex Migration Guide

## Goal

Move BrandyAction OS development from conversation-driven changes to repository-context-driven Codex development.

## Current State

The repository can be installed, tested, linted, type-checked, built, and run locally in demo mode. Repository CI performs the same side-effect-free gate plus a browser smoke test. The local checkout is linked to the existing Vercel project. Dedicated DEV and QA resources and Vercel environment-variable scope have not been established.

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
3. [ ] Provision and verify separate DEV and QA resources
4. [x] Establish repository validation and promotion rules
5. [x] Confirm Vercel Git integration and deployed commit mapping
6. [~] Add browser end-to-end QA (local demo active; connected authentication waits for DEV/QA resources)
7. [ ] Continue feature development through Codex

## First Codex Actions

- Review `PROJECT_CONTEXT.md`, `ARCHITECTURE.md`, and related implementation before changes.
- Run `npm run setup:local` once and `npm run verify` before review.
- Identify the exact deployment target and automatic Git deployment behavior before a remote push or merge.
- Keep production database, webhook, environment-variable, and deployment changes behind explicit approval.
