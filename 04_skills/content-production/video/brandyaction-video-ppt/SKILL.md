---
skill_id: brandyaction-video-ppt
skill_type: os_context_loader
category_id: content-production
category_label: 콘텐츠 제작
folder_id: video
folder_label: 영상 제작
version: "2.0"
process: longform
step: edit
status: active
wiki_sources: [longform-edit, os-knowledge-model]
inputs: [content_id]
outputs: [context_bundle]
allowed_tools: [claude_code, codex, chatgpt]
completion_checks: [latest_wiki_resolved, content_scope_matched, provenance_recorded]
---

# BrandyAction Video Context Loader

## PURPOSE

롱폼 편집에 필요한 최신 Wiki, 승인 원고, 촬영 자산과 현재 Run 데이터만 회사 OS에서 불러온다.

## READ CONTEXT

`CONTENT.md`, Longform Process, `longform-edit` 최신 Process Wiki, 승인 원고·낭독본, 촬영 자산 포인터와 Company/Brand Wiki를 읽는다.

## PROCEDURE

1. 사용자가 지정한 `content_id`의 현재 상태를 확인한다.
2. 현재 공정과 step이 `longform/edit`인지 확인한다.
3. `wiki_sources`의 `is_latest: true` 버전만 불러온다.
4. 승인된 원고와 촬영 자산의 최신 포인터를 해석한다.
5. 출처와 버전을 포함한 Context Bundle을 반환한다.

## OUTPUT CONTRACT

편집을 직접 수행하지 않고 `CONTEXT_BUNDLE.md` 또는 동등한 AI Context를 반환한다. 자산은 asset ID, path와 checksum 정보만 포함한다.

## QUALITY CRITERIA

- 최신 편집 Wiki와 승인된 원고만 포함한다.
- 대용량 자산은 복제하지 않고 참조 정보만 포함한다.
- 개인 Raw는 불러오지 않는다.
- 모든 Context의 출처와 버전을 확인할 수 있다.

## DO NOT

영상 편집, 렌더링이나 자산 수정을 실행하지 않는다. 개인 Obsidian의 Raw에 접근하지 않는다.

## HANDOFF

Context Bundle을 편집 담당자의 AI와 실제 편집 환경에 전달한다.
