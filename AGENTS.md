# BrandyAction OS Codex Rules

## Project Role

BrandyAction OS is an internal operating system for managing company knowledge, projects, workflows, documents, and operational data.

## Before Any Code Change

1. Read `PROJECT_CONTEXT.md` and `ARCHITECTURE.md`.
2. Read related documentation and the existing implementation.
3. Check the current branch, status, remotes, and worktrees.
4. Confirm the intended environment and deployment target.

Preserve existing files, user changes, branches, and worktrees. Do not use `reset --hard`, `clean`, or force-push unless the user explicitly requests it.

## Development Rules

- Do not work directly on `main`, `master`, or a shared `develop` branch. Use an isolated worktree and a task branch named `codex/<task>` or the existing `work/<task>` convention.
- Do not switch a branch that belongs to another active worktree.
- Do not modify production directly.
- Do not change the database schema without an additive, backward-compatible migration.
- Do not remove existing features without approval.
- Preserve existing API contracts and verify shared-component impact.
- Do not write secrets, employee data, request contents, or internal identifiers to Git, public documentation, logs, or chat.

## Delivery Flow

1. **SPEC:** Define scope, completion criteria, affected systems, and non-goals.
2. **DEV:** Implement on a task branch and validate in a local or verified development environment.
3. **QA:** Review the committed diff and run relevant tests. Separate performed and unperformed verification.
4. **BUGFIX:** Fix failures on the task branch and repeat QA when needed.
5. **RELEASE:** Report a release candidate only after DEV and QA pass.
6. **Production:** Merge, production deployment, promotion, and post-deploy verification require separate user approval that identifies the target and impact.

A passing test, local build, or Preview deployment is not evidence of production deployment.

## Environment and External-Side-Effect Rules

- Production database data, schema, policies, and settings must not be changed automatically.
- Do not run migration, seed, or reset commands automatically.
- Do not perform live payments, refunds, production webhook calls, production deployments or promotions, or production environment-variable changes without explicit approval.
- Tests may use only a confirmed development database and sandbox payment target. If the target is unclear, stop external writes and continue with local verification.
- Check whether a remote push triggers an automatic deployment before pushing.

## Completion Records

At the end of every development task, update the matching project in the company OS development management workspace when an authorized write connection is available.

- Resolve the project by its existing repository mapping. Keep OS, Edu, and Myin work under their own project IDs; never create duplicates or store another project's work under OS by default.
- Record the change, verification performed and not performed, local commit, remote PR if created, environment, actual deployment state, remaining work, and risks.
- Update the original request using its current version when applicable and save a development log linked to the same project and request.
- Read the saved record back before claiming it was recorded.
- If access is read-only or a write is rejected, do not bypass it. Preserve the completion note locally and report that OS recording is pending.

## Completion Report

Report in Korean and include:

- Actual repository/worktree path and branch
- Base and result commits
- Uncommitted changes
- Pull request, or `없음`
- Tests performed and not performed, with reasons
- Actual deployment state
- Remaining gates and required user action

## Project Identification

- Product: BrandyAction OS
- Repository: `brandyaction-ricky/OS`
- During the local-environment migration, do not write to the production OS database or API. Keep a local completion record and report OS synchronization as pending.
