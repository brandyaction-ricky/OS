---
skill_id: longform-axis
skill_type: os_context_loader
category_id: content-production
category_label: 콘텐츠 제작
folder_id: planning
folder_label: 기획 · 전략
version: "2.0"
process: longform
step: axis
status: active
wiki_sources: [longform-axis, os-knowledge-model]
inputs: [content_id]
outputs: [context_bundle]
allowed_tools: [claude_code, codex, chatgpt]
completion_checks: [latest_wiki_resolved, content_scope_matched, provenance_recorded]
---

# Longform Axis Context Loader

## PURPOSE

롱폼 축 의사결정에 필요한 회사 OS의 최신 Wiki와 현재 Content Run 데이터만 불러온다.

## READ CONTEXT

`CONTENT.md`, Longform Process, `longform-axis` 최신 Process Wiki, Company Wiki, 최신 Package와 연결된 입력을 읽는다.

## PROCEDURE

1. 사용자가 지정한 `content_id`의 `CONTENT.md`를 찾는다.
2. 현재 공정과 step이 `longform/axis`인지 확인한다.
3. `wiki_sources`의 `is_latest: true` 버전만 불러온다.
4. Process의 input pointer가 가리키는 최신 파일을 불러온다.
5. 출처 경로와 버전을 포함한 Context Bundle을 반환한다.

## OUTPUT CONTRACT

업무 결과물을 만들지 않고 `CONTEXT_BUNDLE.md` 또는 동등한 AI Context를 반환한다. 각 항목에 source path, wiki version과 loaded_at을 기록한다.

## QUALITY CRITERIA

- 최신 Wiki만 포함한다.
- 요청한 Content ID와 공정 범위를 벗어나지 않는다.
- 개인 Raw는 불러오지 않는다.
- 모든 Context의 출처와 버전을 확인할 수 있다.

## DO NOT

축 후보를 직접 확정하거나 회사 Wiki를 수정하지 않는다. 개인 Obsidian의 Raw에 접근하지 않는다.

## HANDOFF

Context Bundle을 사용자의 AI에 전달해 축 후보 생성과 사람의 의사결정을 시작한다.
