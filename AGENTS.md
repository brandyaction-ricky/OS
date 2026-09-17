# BrandyAction OS Codex Rules

## Project Role

BrandyAction OS is an internal operating system for managing company knowledge, projects, workflows, and operational data.

## Before Any Code Change

1. Read PROJECT_CONTEXT.md
2. Read ARCHITECTURE.md
3. Check related docs and existing implementation
4. Confirm current branch and deployment target

## Development Rules

- Do not modify production directly.
- Do not change database schema without migration.
- Do not remove existing features without approval.
- Preserve existing API contracts.
- Verify impact before changing shared components.

## Branch Flow

feature/*
  -> develop
  -> QA
  -> main
  -> Production

## Environment Rules

Development changes must be validated in DEV before production release.

## Completion Records

At the end of every task record:
- Change summary
- Verification result
- Commit / PR information
- Deployment environment
- Remaining risks

Update BrandyAction OS development management records when the related system is available.
