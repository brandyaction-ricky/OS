# Team absence read hotfix — release candidate

## Scope

Production Team v1 QA found that Team schedule and people pages fail while loading approved absences. The HR migration intentionally denies direct service-role reads of leave requests and employee details, but the Team API queried those tables directly.

The API now calls an authenticated, date-bounded SQL function. It returns only an active non-partner member's display name, approved absence dates, and whole-day or half-day part. It does not expose leave reasons, proof files, employee identifiers, or pending requests. Existing HR and company document rows are unchanged.

## Verification

- Production read-only QA: meeting list, review filter, decisions, preparation, meeting detail tabs, my tasks, team board, and classification inbox loaded; creation dialogs were opened and cancelled. Team schedule and people both showed the same absence load error. No QA records were saved.
- Local `npm run verify`: passed (789 tests, typecheck, lint with one existing image warning, production build).
- Migration manifest integrity and new API regression tests: passed.
- DEV DB precheck: Team command exists, new absence function does not, and direct service-role leave-date read is denied.
- DEV migration: applied after approval; generated version `20261011064111`. Execution is limited to `authenticated`; `anon` and `service_role` cannot call it. Document count 879 and HR leave-request count 3 matched the pre-apply values.
- Connected browser QA: pending an authenticated session on the new Preview.

## Release order and rollback

1. Test Team schedule and people in an authenticated Preview against DEV. Do not create QA records.
2. Review and approve the production SQL and exact application commit separately.
3. In production, apply the additive function before deploying the API commit; then verify both Team pages. Existing direct HR table grants remain unchanged.
4. If the API deployment fails, revert to the prior application deployment. The new function can remain unused; dropping it is optional and requires a separately reviewed migration.

The company OS development-management entry remains pending while its write connection is unavailable during the local-environment migration.
