# JEV Content Packaging Shadow Pilot

## Decision

JEV is an optional evaluator inside the OS judgment workflow, not the source of business policy. The OS canonical
documents remain the source of criteria; application code composes atomic decisions; JEV returns typed probability
distributions. Claude/OpenAI remain responsible for generation and human-readable revision suggestions.

## Scope

- DEV/QA Preview only; Production is fail-closed.
- One authenticated owner-visible `content_topic` at its expected version.
- Reads the saved planning handoff and selected title/thumbnail material.
- Sends only the bounded content fields needed by five pilot questions.
- Returns an ephemeral shadow result to the current browser session.
- Does not write a record, create an approval, move a stage, or execute a follow-up action.

## Pilot questions

1. Topic relevance
2. Thumbnail clarity without the title
3. Curiosity strength
4. Evidence/scenario/interpretation boundary
5. Overclaim risk

The five questions are a pilot contract, not a canonical policy. Replacing them with OS-managed versioned criteria is
a later gate and requires a reviewed machine-readable policy contract.

## Initial Playground evidence (2026-09-22)

Four non-sensitive Korean cases were evaluated with `jev-1.13.0`.

| Case | Relevance | Thumbnail | Curiosity | Evidence boundary | Overclaim |
| --- | ---: | ---: | ---: | ---: | --- |
| Original package | 3.19 | 2.91 | 3.13 | 3.84 | medium 63% |
| Vague package | 2.01 | 0.73 | 1.60 | 1.25 | medium 62% |
| Misleading package | 3.76 | 3.21 | 3.82 | 0.01 | high 100% |
| Scenario-framed package | 3.17 | 2.08 | 2.85 | 3.85 | low 59% |

The important finding is that the misleading package scored highest on attention dimensions while failing the evidence
boundary and overclaim checks. Therefore no aggregate “high score equals approval” rule is allowed. Safety/evidence
dimensions must remain independent blocking signals, and low-confidence outputs must route to human review.

## Remaining gates

1. Configure a dedicated TypeSafe API key only in Vercel Preview/Development and local approved secret storage.
2. Run the same cases through the server adapter and compare with Playground request IDs.
3. Expand to at least 30 archived or synthetic packages with representative labels.
4. Confirm TypeSafe contractual scope before using outputs for any model training, imitation, or competing-model work.
5. Decide thresholds only after calibration; never infer them from these four examples.
