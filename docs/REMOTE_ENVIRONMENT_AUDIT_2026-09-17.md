# Remote environment audit — 2026-09-17

This record contains only non-secret, non-identifying operational facts. Provider IDs, credentials, employee data, request contents, and database rows are intentionally excluded.

## Vercel

- The existing project is linked to `brandyaction-ricky/OS`.
- The project runtime is configured for Node.js 24.x.
- Task-branch pushes create Preview deployments.
- Pushes to `main` create Production deployments.
- The latest observed Production deployment was ready at commit `0661eb4`, matching the observed remote `main` at audit time.
- This audit did not create, promote, redeploy, roll back, or change a deployment.
- Environment-variable names and scopes were not inspected because the available provider connection does not expose them and the settings UI required interactive sign-in.

## Supabase

- The connected BrandyAction OS project is active and contains Production data.
- No Supabase development branches were present.
- A separate `brandyaction-os-dev` project was later created in the approved organization and Seoul region at a confirmed monthly cost of $0. It was verified healthy and empty, with no public tables or migration history.
- No schema, seed data, Auth user, environment variable, or Production data was copied into DEV.
- The provider's applied-migration history does not directly reconcile with the repository migration filenames. Migration execution is blocked pending a reviewed baseline and forward-only reconciliation plan.
- Security advisors reported policy/grant/password-protection findings. Performance advisors reported foreign-key indexing, RLS evaluation, unused-index, and overlapping-policy findings.
- This audit performed read-only inspection only. It did not query business row contents, run SQL, create a branch, change Auth settings, apply a migration, or change Production.

## Required gates

1. Approve the provider cost and ownership for the remaining isolated QA resource.
2. Reconcile schema and migration history without rewriting Production history.
3. Scope Vercel Preview/Production environment variables and verify the target project for every key.
4. Use dedicated non-employee test identities for connected browser QA.
5. Review security findings for application dependencies before preparing additive migrations or provider-setting changes.
