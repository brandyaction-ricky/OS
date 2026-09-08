# Development handoff

Updated: 2026-09-08 UTC.

## Code

- Working branch: `codex/new-development-requests-41-20260908`.
- Changes cover content discovery filters and evidence selection, script file ordering, Markdown navigation, dashboard presentation, and integration feedback.
- Telegram capture requires an explicitly configured active owner. Personal email defaults have been removed from source and the environment template.
- The environment template contains names only. Supply environment-specific values through the deployment platform.

## Verification

- 217 automated tests pass.
- TypeScript, ESLint, and the local Next.js production build pass.
- External integration tests use mocks. Live account, media processing, and authenticated browser workflows require separate verification.

## Continuation

Read `AGENTS.md` and `docs/DEVELOPMENT_WORKFLOW.md`. Check the current branch, open pull request, CI result, and actual deployment status before making changes.

Keep request-specific context, approvals, and completion evidence in the application's development management records. A passing build or Preview is not evidence of production deployment.
