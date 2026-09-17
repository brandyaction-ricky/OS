# BrandyAction OS Architecture

## System Boundary

BrandyAction OS is a single Next.js App Router application. It serves the internal web UI and versioned HTTP APIs from one deployable unit. Supabase provides authentication, PostgreSQL storage, row-level security, full-text search, and vector search. Vercel is the intended application runtime.

GitHub is the source of truth for application code, migrations, tests, and operational documentation. Supabase migration history is the source of truth for database structure. Vercel deployment history is the source of truth for what artifact is running in each hosted environment.

## Runtime Components

| Component | Location | Responsibility |
| --- | --- | --- |
| App Router UI | `app/(os)`, `components` | Internal operating workspaces and navigation |
| API layer | `app/api/v1` | Authenticated documents, records, development, content, integrations, and health APIs |
| Domain logic | `lib`, `lib/server` | Validation, authorization, content workflows, search, indexing, and integration logic |
| Database changes | `supabase/migrations` | Additive schema, policy, function, and storage changes |
| Integration adapters | `tools`, `integrations/mcp` | Local import, explicit webhook registration, and MCP access |
| Verification | `tests`, `.github/workflows/validate.yml` | Contract, regression, type, lint, build, and CI checks |

## Data and Trust Boundaries

- Browser code may receive only `NEXT_PUBLIC_*` configuration. Public Supabase keys are subject to row-level security and are not privileged secrets.
- Service-role keys and third-party credentials are server-only and must never enter client bundles, Git, screenshots, logs, or completion records.
- API routes authenticate and authorize before privileged database access.
- Database changes are represented by reviewed files in `supabase/migrations`; migration execution is a separately approved environment operation.
- Uploaded or synchronized content is untrusted input and remains subject to validation, access control, and bounded processing.

## External Integrations

The application can call Supabase, OpenAI, Anthropic, YouTube, Telegram, Meta Ads, and Google Ads. Missing credentials degrade to demo, keyword-only, or disconnected behavior where supported.

`npm run build` is side-effect free. Operations that change an external system, such as Telegram webhook registration, use a separate command and require an explicit environment plus a confirmation flag.

## Environment Topology

| Stage | Code source | Data/integrations | Purpose |
| --- | --- | --- | --- |
| Local | Task branch | Demo mode by default; optional development-only credentials | Implementation and fast verification |
| DEV | Task branch or shared integration ref | Dedicated development resources | Connected integration verification |
| QA | Immutable Preview commit | Dedicated QA/Preview resources | Acceptance and regression testing |
| Production | Approved `main` commit | Production resources | Live operation after explicit approval |

Preview is not automatically QA-ready: the deployment commit, environment-variable scope, database target, and requested user flow must all be verified.

## Delivery Gates

1. Work starts from the latest intended base in an isolated worktree and task branch.
2. `npm run verify` must pass without production credentials or external writes.
3. A pull request records the requested behavior, migrations, environment changes, verification, and rollback approach.
4. DEV and QA verification use non-production resources and identify the exact commit.
5. Production requires separate approval, an exact commit or previously verified artifact, and post-deploy verification.
6. Completion records distinguish local build, Preview readiness, merge, deployment readiness, actual deployment, and functional verification.

## Known Migration Gaps

- The local checkout is not linked to a Vercel project, so automatic Git deployment settings and the current deployed SHA are not verifiable from this workspace.
- Dedicated DEV and QA Supabase/integration resources have not been confirmed.
- Browser end-to-end tests are not yet part of the repository CI gate.
- Dependency advisories must be resolved through a separately tested Next.js upgrade.

See `docs/ENVIRONMENTS.md` for setup and promotion procedures.
