# YouTube automation implementation contract

Status: development specification. This file describes application behavior; BRANDYACTION OS remains the source of company content rules and approvals.

## Scope and sequence

For each `content_topic`, retain the existing content ID and artifact versions. Resolve the live OS rules at execution time. Follow the canonical sequence: topic plan, selected title and thumbnail copy, narration script, media production, review, private YouTube upload. A board or shooting-plan format cannot enter the cloned-narration path without an approved full script.

The first production format is the owner's cloned voice over a mix of photoreal illustrative B-roll and designed graphics. It is a new `narrated_visual` production format, not a change to the existing shortform clip renderer. Private upload is the only permitted visibility for automated jobs. Public release remains a distinct workflow.

The development pilot reads four live canonical OS documents (brand context, editing, audit, production design) via server-side `YOUTUBE_SCENE_RULE_IDS`; identifiers and document contents stay out of Git. It requires explicit configuration of that mapping in the development environment. Scene previews are invalidated when the mapped document versions change.

| Owner | Responsibility |
| --- | --- |
| GPT-6 Sol | Topic and package judgment, script, scene direction, final multimodal review |
| GPT-6 Luna | Bounded execution of a versioned brief, tool orchestration, asset accounting, recoverable retries |
| Existing System One layer | Typed advisory judgments; currently JEV packaging shadow in DEV only |
| Fish Audio | Owner voice synthesis from the configured private voice reference |
| Media worker | Generate assets and render audio, scenes, captions and final MP4 outside Vercel request time limits |
| Existing YouTube adapter | OAuth upload and verification, extended for scoped private-only worker execution after final gate |

## Boundary with the JEV project

The existing System One project owns `jev-content-packaging-shadow-v2`, its API call, contract versions, authentication, and calibration. The automation project must not copy its prompts, call TypeSafe directly, persist its shadow scores as approvals, or assume that a text-only thumbnail-copy score inspects the rendered image. It may read a future versioned judgment record through an internal adapter when the System One owner makes one available. A missing, stale, or shadow-only judgment is `advisory_unavailable`, never `approved`.

The P0-3 shadow route is limited to DEV/Preview and returns no durable decision. Its branch PR #61 is stacked on PR #43. Do not bind a production worker to that route or merge/rebase those branches as part of this project.

## Versioned run contract

An automation run has a stable run ID and source ID. Capture script ID/version, selected package ID/version, source input digest, OS rule IDs/versions, prompt/model versions, voice reference ID, and media template version before external work. A changed source or artifact makes the run stale. Every stage writes its own status, outputs, error category and provider request ID. Retrying a stage reuses completed output for the same input key. Never issue a second YouTube `videos.insert` when a video ID or resumable session exists; verify the existing upload first.

Stages: `planned` → `voice_pending` → `voice_ready` → `scene_pending` → `assets_ready` → `render_pending` → `render_ready` → `review_pending` → `review_ready` → `private_upload_pending` → `private_uploaded`. Every stage can enter `needs_input`, `failed`, or `stale`. `private_uploaded` is set only after YouTube confirms channel and actual `private` visibility and the OS publication record is saved.

## Gate policy

1. Existing OS gate 1 must approve the current topic and package before the script is generated.
2. Existing OS gate 2 must approve the current script before voice generation. The selected package promise and script must agree. Missing evidence or conflicting rules pauses the run.
3. The media worker may create draft assets without granting publication authority. It must compare transcript, scene timing, asset manifest and render output; Sol reviews the finished audio and video.
4. Existing OS gate 3 must approve the current final video and publication kit before upload. A dedicated worker authorization may upload `private` only. The existing browser admin upload route remains unchanged.
5. JEV scores remain advisory until the System One project's own validation and promotion contract explicitly allows a particular judgment to affect a particular gate. A confidence number alone is never a publication approval.

## Provider and data boundaries

Fish API key and voice reference ID stay server-side. The voice model should be private. Send the minimal narration segment needed to synthesize each clip; do not send all OS knowledge or sensitive internal notes. Keep generated audio, images and video in private storage with owner-scoped access and a defined retention policy. Use an explicit synthetic-content disclosure field when YouTube's realistic-content rules apply. Renderers and generator models are replaceable adapters; do not make the job state depend on a particular video API.

## Delivery slices

1. Readiness and version contract; Fish transport with bounded input and explicit errors. The current development pilot generates only the first approved script paragraph on an explicit preview click.
2. Durable job queue and worker for paragraph-level voice generation with timestamp/alignment output and private asset storage.
3. Sol scene plan, repeatable visual templates, image generation, captions and render worker.
4. Automated multimodal review, targeted repair loop, and scoped private-only YouTube worker upload.
5. Topic scheduling and outcome analysis after public release, using the current OS metrics rules and real observed windows.

No stage is reported as available merely because its adapter or UI exists. Connected DEV, Preview QA, and Production activation are separate gates.

## Current development pilot

Implemented in this branch: owner-scoped readiness, Sol scene planning from four live OS rules, one Fish voice preview, and one generated still preview. The pilot is closed unless `YOUTUBE_AUTOMATION_PILOT_ENABLED=true` in a non-Production environment. It does not start a durable Luna job, render a video, make a thumbnail, or upload to YouTube. Those stages need private media storage, a worker runtime, scoped upload authorization, and connected QA before they can be exposed as available.
