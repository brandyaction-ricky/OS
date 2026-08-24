---
skill_id: longform-script
skill_type: os_context_loader
category_id: content-production
category_label: 콘텐츠 제작
folder_id: writing
folder_label: 원고 · 카피
version: "2.0"
process: longform
step: script
status: active
wiki_sources: [longform-script, os-knowledge-model]
inputs: [content_id]
outputs: [context_bundle]
allowed_tools: [claude_code, codex, chatgpt]
completion_checks: [latest_wiki_resolved, content_scope_matched, provenance_recorded]
---

# Longform Script Context Loader

## PURPOSE

롱폼 원고 작업에 필요한 최신 Wiki, 승인된 축과 현재 Content Run 데이터만 회사 OS에서 불러온다.

## READ CONTEXT

`CONTENT.md`, Longform Process, `longform-script` 최신 Process Wiki, Company/Brand Wiki, 승인된 Package·Axis를 읽는다.

## PROCEDURE

1. 사용자가 지정한 `content_id`의 현재 상태를 확인한다.
2. 현재 공정과 step이 `longform/script`인지 확인한다.
3. `wiki_sources`의 `is_latest: true` 버전만 불러온다.
4. 승인된 Package와 Axis 최신 포인터를 해석한다.
5. 출처와 버전을 포함한 Context Bundle을 반환한다.

## OUTPUT CONTRACT

원고를 직접 만들지 않고 `CONTEXT_BUNDLE.md` 또는 동등한 AI Context를 반환한다. 각 항목에 source path, wiki version과 loaded_at을 기록한다.

## QUALITY CRITERIA

- 승인된 축과 최신 원고 기준 Wiki를 포함한다.
- 요청한 Content ID의 입력만 포함한다.
- 개인 Raw는 불러오지 않는다.
- 모든 Context의 출처와 버전을 확인할 수 있다.

## DO NOT

원고 내용을 임의로 작성하거나 Wiki를 수정하지 않는다. 개인 Obsidian의 Raw에 접근하지 않는다.

## HANDOFF

Context Bundle을 사용자의 AI에 전달해 원고와 낭독본 생성을 시작한다.
