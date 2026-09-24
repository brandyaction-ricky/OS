# System One and Content Workflow Production Gate Design

Status: design proposal only. No runtime flags, API behavior, database policy, or deployment changed.

## Purpose

Allow the approved content-planning and production workflow to become available in Production without enabling
the DEV-only System One document preflight or the TypeSafe/JEV shadow experiment. Each capability must have its own
availability gate, data permission checks, and release evidence.

## Current behavior

- `canUseSystemOnePreflight`, `canUseSystemOneJevShadow`, and `canUseSystemOneContentEvidence` reject Production and
  require a Development/QA environment with a Preview deployment when hosted.
- The topic reference/planning handoff panel is shown only when the preflight or JEV gate passes. Content evidence
  panels are shown only when the content-evidence gate passes.
- The JEV shadow call also requires a server-side `TYPESAFE_API_KEY`, two explicit flags, verified DEV/Production
  Supabase identities, and a non-main Preview. It returns an ephemeral observation; it does not save a judgment or
  approve or advance content.
- Result: the current merged DEV code can be present in a Production bundle while its new planning and evidence
  panels remain unavailable. Turning on an experimental flag is not a Production rollout path.

## Proposed capability boundaries

1. **Content workflow UI and handoff** — a dedicated fail-closed feature gate controls only the workflow presentation
   and handoff fields. It does not grant document access or authorize a business judgment. Existing authenticated
   APIs and Supabase RLS remain the authorization boundary.
2. **Content evidence** — a separate gate controls evidence-card reads and append operations. It may open only after
   the exact evidence migrations have been independently reviewed and applied to the target environment, and the
   target policies have passed owner, same-team, non-team, and archived-record checks. User-entered evidence remains
   attributed input until a source has actually been checked.
3. **Canonical reference resolution** — a distinct capability reads only an explicitly configured, versioned
   registry and its referenced OS documents through the signed-in person's authorized access. It must fail closed
   on missing, stale, private, ambiguous, or mismatched references. A selected reference is not itself proof that a
   rule applies to the content.
4. **System One preflight and JEV shadow** — remain non-Production, DEV/QA-only diagnostics. They do not enable the
   content workflow, persist approvals, or trigger external actions. JEV thresholds and business policy remain
   uncalibrated until the shadow pilot's separate evidence gates are met.

## Release behavior

- Every Production-facing capability has a distinct server-checked flag that defaults off. A browser-visible flag
  may control presentation only; API handlers must independently check environment, signed-in identity, organization
  membership, ownership/team scope, expected document versions, and RLS.
- A per-environment setting must not replace the existing role and row-level access rules. Initial Production access
  should be restricted to a named internal pilot cohort through the OS's existing authorization model, not inferred
  from a client-supplied flag or URL.
- The app may be deployed with all new capabilities closed. Open one capability only after its specific prerequisites
  pass. Preflight and JEV flags must remain false in Production regardless of other capabilities.
- Do not apply the evidence or archive migrations as a side effect of deploying code. Inspect Production schema and
  migration history first, prepare a migration-specific compatibility and recovery plan, and obtain separate approval
  for the exact SQL and target.

## Acceptance gates before implementation

- The representative confirms the first Production user journey: topic → title/thumbnail → either a full script or a
  format-specific plan → evidence review → stage review. The format stays selectable and changeable.
- The canonical registry location, version rule, and mapping from OS criteria to each content stage are explicitly
  defined. Missing applicability evidence produces “unverified / human review”, never automatic approval.
- Two-person tests cover owner, same-team contributor, other-team member, archived document, and stale-version cases
  in a Production-like environment using synthetic records.
- Each flag is tested independently: workflow UI on while preflight/JEV remain off; evidence on only after its schema
  and RLS checks; all new capabilities off during rollback.
- The JEV shadow set reaches at least the separately documented pilot size and its external-use terms are reviewed.
  Shadow results remain informational until calibration and explicit policy approval.
- The migration manifest and environment docs agree with the actual active files and dated environment inventory.

## Rollback and non-goals

Turn off the affected capability flag to hide its UI and reject its API route. Database migrations are forward-only;
rollback uses a reviewed corrective migration or restores the compatible application while preserving schema. This
design does not enable production JEV, auto-approve content, persist shadow judgments, apply migrations, alter roles,
or authorize a Production deployment.
