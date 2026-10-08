# Toss finance ledger sync — development specification

## Scope and completion criteria

- EDU only. Server-held Toss credentials; live in Production, test in isolated development only.
- Activation must explicitly name the approved database using `FINANCE_TOSS_SYNC_PROJECT_REF`, matching the server Supabase URL. Missing or mismatched targets stop before service-role access.
- Explicit user-started collection, maximum 31 days per run. Transactions use transaction time, settlements use paid-out date (the two counts need not match).
- Each button press processes one bounded page and persists its cursor atomically with normalized ledger rows. Resume after failure/reload; no unattended collection or cron.
- Idempotent payment / cancellation / settlement upserts. Single active run per store, expiring page lease, merchant/environment binding, current active finance permission checked again at commit.
- Show partial versus complete collection, counts, safe errors and last success. Existing notes, bank transactions and receipts are preserved.
- Existing GET-only inspection endpoints remain non-persistent. Actual cash income still requires bank evidence; settlement collection does not manufacture deposits.

## Affected systems

Next.js finance API, finance workspace sync panel, Toss GET provider, additive service-only Postgres sync state and RPC, unit / mocked and isolated DEV verification.

## Non-goals and release gates

No payment, cancellation/refund execution, bank API, customer personal data collection, automatic background schedules, other business connections, or production OS development-record writes.

New SQL is review-only until explicit environment-specific migration approval. Feature defaults disabled. Production ingestion, flag activation, merge and deployment require a separate approval identifying the target and effect. Existing live read-only deployment is unchanged by local development.

Do not bulk-push the migration chain: existing DEV and Production finance baseline timestamps differ. Apply only the approved additive sync migration after verifying the target schema.

Rollback: disable the sync flag, then restore the previously verified deployment. Retain collected ledger rows and additive schema; do not delete financial records to roll back code.

## Actual DEV finding and forward fix

The approved original migration applied successfully in isolated DEV, but actual service-role RPC execution found SQLSTATE 42703: the store composite variable `s` shadows settlement alias `s` in fee backfill. The entire failing page rolled back; no live API call or Production write occurred. Synthetic fixtures were removed.

Keep the applied migration immutable. The forward migration `20261008063500_finance_toss_sync_store_alias.sql` replaces only the function body with a distinct `store_row` composite name. The function signature, grants, RLS, ledger rows, cursors and lease semantics are preserved. Re-run actual DEV commit, duplicate, rollback, lease, concurrency and permission tests. A changed release commit requires new approval before Production schema/config/deployment/collection.

The forward fix passed ten connected DEV RPC/API checks: restricted grants, begin idempotency/window binding, concurrent claim exclusion, atomic rollback, retry, signed refund/fee backfill, duplicate runs, stale/expired lease rejection, HTTP contracts and live permission revocation. The connected browser verified consent-gated start, persisted status after reload, ledger amounts and non-destructive abandon. No real Toss request was sent. Use the opt-in `tools/finance-toss-sync-dev-qa.mjs` with `FINANCE_QA_PROJECT_REF` and `FINANCE_QA_CONFIRM=isolated-dev` against the existing isolated DEV project; it refuses preexisting stores and removes only its own synthetic fixtures. Immutable Preview CI/QA and live upstream verification remain separate, unperformed release gates.
