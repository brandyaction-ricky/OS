# Threads API publication SQL checks

Runs the new migration and its RPCs in an **in-memory PostgreSQL fixture** using PGlite. It does not connect to Supabase, load credentials, call Meta, or publish a real post. Repository dependencies are unchanged.

Install the test runtime outside this repository (the checked version is PGlite 0.5.13), then run:

```sh
npm install --prefix /tmp/threads-publication-db-qa --ignore-scripts --no-audit --no-fund @electric-sql/pglite@0.5.13
PGLITE_MODULE=/tmp/threads-publication-db-qa/node_modules/@electric-sql/pglite/dist/index.js node tests/integration/threads-publication-db.mjs
```

The fixture reads the repository's actual `os_records` and `os_record_events` definitions, record version/audit triggers, Meta connection table, review/event table definitions, and current team review command. It then executes the new publication migration without altering its SQL. Synthetic UUIDs, account names, and text are generated for each run.

The fixture substitutes only these surrounding dependencies:

- Minimal `os_profiles` with ID, active state, and role.
- `auth.uid()` using a synthetic session setting, plus `anon`, `authenticated`, and `service_role` roles.
- A permissive local reviewer helper; named reviewer membership is covered by the existing team-review tests.
- Fixture table grants for the simulated server. The new run table/RPC grants and its source guard are the migration's real definitions. Source writes under `authenticated` are intentionally permitted in the fixture so the new guard is tested independently of existing source RLS.

Checks cover approval snapshot matching, Unicode length, ownership, connection expiry/sharing/activity, a second claim while running, locked-source edits, partial receipts, immutable checkpoints, uncertain results, idempotent completion, atomic live result recording, and mock result separation. A fixture-only failing event trigger also verifies that a failed completion rolls back both source and run state, then finishes from durable receipts without another publish call after the database recovers.

This is **not** a full migration-chain, production RLS, multi-session concurrency, PostgREST, OAuth, or real Threads integration test. The second claim is sequential against a running claim; real simultaneous sessions still need separately authorized integration verification. The test records no persistent DB data after process exit.
