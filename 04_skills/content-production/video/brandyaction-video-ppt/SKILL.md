---
skill_id: brandyaction-video-ppt
category_id: content-production
category_label: 콘텐츠 제작
folder_id: video
folder_label: 영상 제작
version: "1.0"
process: longform
step: edit
status: active
inputs: [source_mp4, raw_srt, approved_script]
outputs: [edit_asset_manifest]
allowed_tools: [claude_code, ffmpeg, headless_chrome]
completion_checks: [output_exists, frontmatter_valid, asset_paths_valid, human_review_required]
---

# BrandyAction Video PPT

## PURPOSE

반복적인 영상 후반 작업을 수행한다.

## READ CONTEXT

`CONTEXT.md`, 승인된 원고와 낭독본, 촬영 자산 Markdown, Company/Brand Context를 읽는다.

## PROCEDURE

SRT 정리 → Deck 설계 → Image Prompt → Image Input → Render → CTA → Media → XML → Upload Asset 등록 순서로 작업한다.

## OUTPUT CONTRACT

`edit_vN.md`에 편집본, XML, 캡션, 이미지, 오디오의 `asset_id`, 상대 경로, checksum, 검수 상태를 기록한다.

## QUALITY CRITERIA

- 발화 내용을 임의로 바꾸지 않는다.
- deck/cap/media 상대 경로를 유지한다.
- 모든 자산 checksum과 존재 여부를 확인한다.
- Premiere Offline 항목이 없어야 한다.

## DO NOT

대용량 MP4, WAV, PNG를 Git에 직접 넣지 않는다. 승인된 원고의 의미를 편집 편의상 바꾸지 않는다.

## HANDOFF

`status: waiting_approval`, `approval_status: pending`으로 편집본 검수에 넘긴다.
