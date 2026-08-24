---
skill_id: publish-copy
skill_type: os_context_loader
category_id: content-production
category_label: 콘텐츠 제작
folder_id: publishing
folder_label: 게시 · 배포
version: "2.0"
process: longform
step: publish
status: active
wiki_sources: [longform-publish, os-knowledge-model]
inputs: [content_id]
outputs: [context_bundle]
allowed_tools: [claude_code, codex, chatgpt]
completion_checks: [latest_wiki_resolved, content_scope_matched, provenance_recorded]
---

# Publish Context Loader

## PURPOSE

게시 문안 생성에 필요한 최신 Wiki, 최종 승인본, 썸네일과 CTA 데이터를 회사 OS에서 불러온다.

## READ CONTEXT

`CONTENT.md`, Longform Process, `longform-publish` 최신 Process Wiki, 최종 승인 원고·편집본·썸네일·CTA와 Company/Brand Wiki를 읽는다.

## PROCEDURE

1. 사용자가 지정한 `content_id`의 현재 상태를 확인한다.
2. 현재 공정과 step이 `longform/publish`인지 확인한다.
3. `wiki_sources`의 `is_latest: true` 버전만 불러온다.
4. 최종 승인 결과물과 CTA의 최신 포인터를 해석한다.
5. 출처와 버전을 포함한 Context Bundle을 반환한다.

## OUTPUT CONTRACT

게시 문안을 직접 확정하거나 게시하지 않고 `CONTEXT_BUNDLE.md` 또는 동등한 AI Context를 반환한다.

## QUALITY CRITERIA

- 최종 승인된 결과물과 최신 게시 Wiki를 포함한다.
- CTA, 출처와 추적 가능한 UTM Context를 포함한다.
- 개인 Raw는 불러오지 않는다.
- 모든 Context의 출처와 버전을 확인할 수 있다.

## DO NOT

실제 게시하거나 Wiki를 수정하지 않는다. 개인 Obsidian의 Raw에 접근하지 않는다.

## HANDOFF

Context Bundle을 게시 담당자의 AI에 전달해 게시 문안 생성을 시작한다.
