# YouTube automation implementation contract

Status: development specification. This file describes application behavior; BRANDYACTION OS remains the source of company content rules and approvals.

## Scope and sequence

For each `content_topic`, retain the existing content ID and artifact versions. Resolve the live OS rules at execution time. Follow the canonical sequence: topic plan, selected title and thumbnail copy, narration script, media production, review, private YouTube upload. A board or shooting-plan format cannot enter the cloned-narration path without an approved full script.

The first production format is the owner's cloned voice over a clean explanatory screen with the existing BRANDYACTION character illustrations, short Korean text, and progressively drawn diagrams. The approved motion study reveals the character outline, fills the original colors, then draws a simple relationship diagram. It is a new `narrated_visual` production format, not a change to the existing shortform clip renderer. Photoreal illustrative B-roll is optional and must be justified by the script and evidence. Private upload is the only permitted visibility for automated jobs. Public release remains a distinct workflow.

The visual contract is versioned as `brandyaction-character-draw-v1`. Each narration paragraph selects one of five layouts: question with character, character situation, comparison cards, relationship diagram, or one-line action. Existing character art is a set of flattened PNG scenes rather than animation rigs; a renderer may reveal their outlines and colors, but must not assume independent limb or expression layers. Character images belong in owner-scoped private media storage with an asset manifest before a connected render worker can use them. Existing scene plans without the current template version are stale and must be regenerated before new work starts.

The development pilot reads four live canonical OS documents (brand context, editing, audit, production design) via server-side `YOUTUBE_SCENE_RULE_IDS`; identifiers and document contents stay out of Git. It requires explicit configuration of that mapping in the development environment. Scene previews are invalidated when the mapped document versions change. The pilot also requires distinct DEV and Production Supabase references and an exact DEV URL match; it is unavailable on Production or a main/master deployment.

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

An automation run has a stable run ID and source ID. Capture script ID/version, selected package ID/version, source input digest, OS rule IDs/versions, prompt/model versions, voice reference fingerprint, and media template version before external work. A changed source or artifact makes the run stale. Every stage writes its own status, outputs and error category. Provider request IDs and media-template version remain future work. Retrying a voice stage reuses completed output for the same input key. Never issue a second YouTube `videos.insert` when a video ID or resumable session exists; verify the existing upload first.

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
2. Durable job queue and worker for paragraph-level voice generation and private asset storage. Timestamp/alignment output is a separate next step before editing.
3. Sol scene plan, repeatable character and diagram templates, optional evidence-backed still generation, captions and render worker.
4. Automated multimodal review, targeted repair loop, and scoped private-only YouTube worker upload.
5. Topic scheduling and outcome analysis after public release, using the current OS metrics rules and real observed windows.

No stage is reported as available merely because its adapter or UI exists. Connected DEV, Preview QA, and Production activation are separate gates.

## Current development pilot

Implemented in this branch: owner-scoped readiness, Sol scene planning from four live OS rules, one Fish voice preview, one generated still preview, and a durable Luna-reviewed voice job. The job captures script and package versions, the scene-plan version, rule versions, a fingerprint of the private voice ID, and hashes of narration paragraphs. The exact voice ID and full script are not copied into job metadata. It uses one `ai_job` record per input key, a compare-and-swap lease, one Luna pronunciation review, then one Fish MP3 paragraph per worker call. Files use deterministic paths in the private `os-youtube-voice` bucket. The owner can request a 60-second signed playback URL. A failed retry can resume the same job after its configuration is corrected, while changed source inputs require a new job. JEV remains advisory and is not called by this worker.

This code is closed unless `YOUTUBE_AUTOMATION_PILOT_ENABLED=true`, `OS_ENVIRONMENT=development` or `qa`, `NEXT_PUBLIC_DEMO_MODE=false`, and the configured DEV Supabase project reference exactly matches the server URL. Production project references must differ. On Vercel, only a Preview deployment from a non-main branch may pass the gate. To operate the voice stage, configure `YOUTUBE_SCENE_RULE_IDS`, server-only `OPENAI_API_KEY`, `FISH_API_KEY`, `FISH_VOICE_REFERENCE_ID`, optional `FISH_TTS_MODEL`, `SUPABASE_SERVICE_ROLE_KEY`, and `CRON_SECRET` in the verified DEV/Preview environment. The additive private-bucket migration `20260923070000_youtube_voice_media.sql` was applied to the isolated DEV project on 2026-09-23 after explicit user approval; the SQL Editor transaction also recorded the migration history. Readback showed `public=false`, 12 MiB file limit, MP3-only MIME restriction, one migration statement, and a statement checksum matching the committed file. Production was not changed. A DEV scheduler must call `POST /api/v1/content/youtube-automation/worker` with `Authorization: Bearer <CRON_SECRET>` repeatedly; one call advances at most one step. No scheduler is registered in `vercel.json`, and the worker has not been run against a connected DEV environment. The existing Preview build alone does not prove voice synthesis works.

The branch still does not render a video, make a production thumbnail, produce timed captions, or upload to YouTube. A local 10-second silent character-and-diagram motion study was approved as the visual direction on 2026-09-23; it does not prove the connected OS renderer is implemented. Final brand typography and colors remain adjustable. Voice files are retained privately until a retention policy and cleanup worker are implemented, so connected use should use controlled pilot data.
