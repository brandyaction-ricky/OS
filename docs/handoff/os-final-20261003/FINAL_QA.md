# Final UI/UX — local QA and release gates

## Scope

One task branch: `codex/os-final-uiux-20261003`, based on `5ed063d`.
The earlier knowledge QA integration is preserved. No contents-auto code is included.
The uploaded reference inputs are local private working material, not intended for public repository distribution.

## Verified

- Full local verify: 503 tests, TypeScript and production build passed. ESLint: zero errors, one local image-preview warning.
- Browser regression: 62 passed, one connected-login test skipped because no dedicated DEV test credentials were supplied.
- Screenshot matrix: 24 pages (23 menus + account), 1440px light/dark; five main pages at 390px light/dark, 58 captures in ignored `test-results/final-uiux-*` folders.
- All matrix pages: expected primary title/theme, no horizontal document overflow and no uncaught browser page errors.
- Legacy retirement: all ten removed UI addresses go to home with an explanation; records/APIs are preserved.
- Original 36-address table: retained/merged pages select the expected final menu, and removed pages display the retirement destination.
- Selected content survives navigation and reload across all eight process screens. Comments/performance/calendar default to all content.
- Local mock: account connect/share/test, Threads edit/approve/schedule/publish, two-card image rendering, private-channel reply controls, checked reply submission, metrics sample bounds and missing snapshots.
- Existing knowledge editing, image movement, folder actions, meeting review, task triage, search/indexing, access-key controls and contextual request drawer regressions passed.
- New migration SQL was scanned for destructive table/column/data commands; none found. This is static review, not database execution.
- Public archive verification at `6971645`: full verify passed again with no private inputs or local environment files present. The guide snapshot test no longer depends on a private document.

## Preview delivery

- Draft PR: https://github.com/brandyaction-ricky/OS/pull/132.
- This task branch alone has credential-free demo/mock Preview overrides. Production, global configuration and other branches are unchanged.
- Preview is a UI/mock review artifact, not connected DEV acceptance or Production readiness. The final deployment URL, exact SHA and browser result are recorded in the PR and local completion note after deployment finishes.

## Differences from reference boards

| Board | Implementation and difference |
| --- | --- |
| F0 menu | Six groups and 23 menus. Legacy URLs may render the corresponding selected tab without forcing a redirect, preserving bookmarked query parameters. Account remains outside the menu count. |
| F1 home | Real-data summary or explicit loading/error/connection notice. No fabricated KPI counts. Old management revenue view is removed. |
| F2 topics | Existing topic/planning tools remain under the new shell and shared content selector. Default generation is the queue; an external subscription worker must still be configured. |
| F3 publishing | Right-side editing and human-confirmed mock operations implemented. Live Meta publishing is intentionally server-blocked until a DB-enforced approval/checkpoint boundary and real-post QA exist. First comments remain manual. |
| F4 calendar | Seven format rows, week/month and human-confirmation panels. Date changes preserve wall-clock time. Production scheduling/notifications have not been executed. |
| F5 comments | Post groups, classification, assignee and human-confirmed mock replies. Instagram nested-reply collection remains incomplete; live replies/hiding are blocked. |
| F6 performance | D1/D7/D28 windows, median/range/n and source distinction. Missing data is not zero. Threads chains compare the first post only. YouTube analytics is explicitly unconnected. |
| F7 settings | Measured connection evidence retained. Company-wide private channel inventory is admin-only; regular staff see only their own/shared channels. |
| F8 style | Existing color tokens preserved, card surface added, local Pretendard and 11px minimum CSS text. Existing deep editors/tables retain compatible structure; not pixel-identical. |
| F9 account | Account and personal channel controls implemented. Password UI reuses the existing flow; password changes and real OAuth were not performed. |

Document body headings and existing detailed editors are retained to avoid changing the parallel knowledge editor. Guide panels cover all 24 pages; numbered hints are present in new primary flows but not every legacy deep-editor button.

## Not verified / release gates

1. Neither new migration is applied to DEV or Production. Baseline integrity passes, but seven migrations (including five inherited prerequisites) still await approval; readyToApply is false. Test real RLS, duplicate external-account constraints and optimistic concurrency after an explicitly approved DEV migration.
2. Do not enable real Meta publishing/moderation by environment variable alone. The server deliberately rejects these actions. Add and test a database-enforced approval/checkpoint model before a separately authorized real-post test.
3. Meta tester registration, platform account eligibility, provider permissions/API version, real OAuth/token refresh, storage media upload and rate limits require connected QA.
4. Subscription queue worker scheduling, actual AI cost/usage, and notification delivery remain unverified. Telegram failures are counted but not automatically retried.
5. Channel cron is disabled by default. Its bounded sequential collection can time out at large volumes; add incremental cursors/job splitting before enabling it for a large backlog. Missing D1 windows are not backfilled.
6. With explicit approval, all 25 private inputs were excluded from the 12 unpublished task commits. Their working files and original commits remain in a local backup; code content, base and other branches are unchanged. Git and CLI deployment ignore rules protect those inputs. Only the sanitized task branch is published.
7. OS completion synchronization remains pending under the local-migration no-production-write rule. Merge, Production database/environment changes and Production deployment require separate approval.

## Evidence limitations

Local UI uses demo data, not employee records. Browser action tests do not prove live DB authorization or provider behavior. Static authorization tests passed; the full connected multi-account permission matrix remains a release gate.
