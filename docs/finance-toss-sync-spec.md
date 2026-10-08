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

Next.js finance API, finance workspace sync panel, Toss GET provider, additive service-only Postgres sync state and RPC, unit / mocked verification. SQL execution and connected database verification remain unperformed under the current user constraint.

## Non-goals and release gates

No payment, cancellation/refund execution, bank API, customer personal data collection, automatic background schedules, other business connections, or production OS development-record writes.

New SQL is review-only until explicit environment-specific migration approval. Feature defaults disabled. Production ingestion, flag activation, merge and deployment require a separate approval identifying the target and effect. Existing live read-only deployment is unchanged by local development.

Do not bulk-push the migration chain: existing DEV and Production finance baseline timestamps differ. Apply only the approved additive sync migration after verifying the target schema.

Rollback: disable the sync flag, then restore the previously verified deployment. Retain collected ledger rows and additive schema; do not delete financial records to roll back code.
