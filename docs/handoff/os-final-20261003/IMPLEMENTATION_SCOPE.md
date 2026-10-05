# Implementation scope

The uploaded final UI/UX workorder supersedes the earlier navigation proposal.
Implementation is isolated on `codex/os-final-uiux-20261003`.

- Upstream main: `4db7de2`.
- Starting point: `5ed063d`, preserving the existing QA integration candidate.
- The superseded contents-auto prototype is not a dependency and will not be copied.
- Keep existing APIs, records, authorization gates and historical migrations.
- New channel behavior defaults to mock mode. No real posts, OAuth authorization,
  remote migrations, production merge, or production deployment are included.
- Stage order: S0 evidence, S1 style, S2 navigation, S3 guidance, S4 content context,
  S5 generation queue, S6 account connections, S7 publishing, S8 comments,
  S9 metrics, S10 remaining workspaces, S11 verification.
- Each completed stage requires a commit and verification. Unperformed connected
  verification must remain explicitly pending.

The reference package remains unchanged. Its old-main assumptions are compared
against the starting QA candidate rather than overwriting that candidate.
