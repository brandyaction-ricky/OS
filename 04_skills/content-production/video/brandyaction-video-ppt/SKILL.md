---
skill_id: brandyaction-video-ppt
skill_type: os_context_loader
category_id: content-production
category_label: 콘텐츠 제작
folder_id: video
folder_label: 영상 제작
version: "3.0"
process: longform
step: edit
status: active
wiki_sources: [longform-edit, longform-publish, os-knowledge-model]
inputs: [content_id]
outputs: [context_bundle]
allowed_tools: [claude_code, codex, chatgpt]
completion_checks: [latest_wiki_resolved, content_scope_matched, provenance_recorded]
automation_recipe: youtube-production-v2
---

# BrandyAction Video Context Loader

## PURPOSE

롱폼 편집·게시 공정에 필요한 최신 Wiki, 승인 원고, 촬영 자산, Automation Run 상태와 현재 Content Run 데이터만 회사 OS에서 불러온다.

## READ CONTEXT

`CONTENT.md`, Longform Process, `youtube-production-v2` 공정 정의, `longform-edit`·`longform-publish` 최신 Process Wiki, 승인 원고·낭독본, 촬영 자산 포인터, Automation Run 상태와 Company/Brand Wiki를 읽는다.

## PROCEDURE

1. 사용자가 지정한 `content_id`의 현재 상태를 확인한다.
2. 현재 공정과 step이 `longform/edit`인지 확인한다.
3. `wiki_sources`의 `is_latest: true` 버전만 불러온다.
4. 승인된 원고와 촬영 자산의 최신 포인터를 해석한다.
5. 현재 Automation Stage와 연결할 Recipe ID를 확인한다.
6. 출처와 버전을 포함한 Context Bundle을 반환한다.

## OUTPUT CONTRACT

편집·렌더·업로드를 직접 수행하지 않고 `CONTEXT_BUNDLE.md` 또는 동등한 AI Context를 반환한다. 개인 PC 제작에 필요한 최신 맥락과 체크리스트를 우선 반환하고, 완료본 이후 실행은 `youtube-production-v2` Automation Recipe에 넘긴다.

## QUALITY CRITERIA

- 최신 편집 Wiki와 승인된 원고만 포함한다.
- 현재 Stage에 필요한 Context만 최소 범위로 포함한다.
- 대용량 자산은 복제하지 않고 참조 정보만 포함한다.
- 개인 Raw는 불러오지 않는다.
- 모든 Context의 출처와 버전을 확인할 수 있다.

## DO NOT

영상 편집, 렌더링이나 자산 수정을 실행하지 않는다. 개인 Obsidian의 Raw에 접근하지 않는다.

## HANDOFF

Context Bundle을 OS Automation Recipe, 편집 담당자의 AI와 실제 편집 환경에 전달한다.
