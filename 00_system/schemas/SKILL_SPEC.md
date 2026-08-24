# Skill Specification v1.0

Skill은 결과물을 만들거나 정본을 보관하는 곳이 아니다. 각자의 AI가 현재 공정에 필요한 **최신 Wiki + Content Run 데이터 + 입력 포인터**를 회사 OS에서 불러오기 위한 Context Loader다.

## 폴더

```text
04_skills/{category_id}/{folder_id}/{skill_id}/
├─ SKILL.md
├─ references.md     # optional
├─ templates/        # optional
└─ checks/           # optional
```

## SKILL.md 필수 Frontmatter

```yaml
---
skill_id: longform-script
skill_type: os_context_loader
category_id: content-production
category_label: 콘텐츠 제작
folder_id: writing
folder_label: 원고 · 카피
version: "1.0"
process: longform
step: script
status: active
inputs: [content_id]
wiki_sources: [longform-script, os-knowledge-model]
outputs: [context_bundle]
allowed_tools: [claude_code, codex, chatgpt]
completion_checks: [latest_wiki_resolved, content_scope_matched, provenance_recorded]
---
```

카테고리와 하위 폴더 목록은 `04_skills/CATEGORIES.json`이 정본이다. UI와 Validator는 이 파일을 읽으며, `skill_id`는 폴더 위치가 바뀌어도 변하지 않는 고유 식별자다.

## 본문 필수 섹션

1. PURPOSE — 어떤 공정의 맥락을 불러오는가
2. READ CONTEXT — 어떤 Wiki와 데이터를 읽는가
3. PROCEDURE — 최신본과 입력 포인터를 찾는 순서
4. OUTPUT CONTRACT — Context Bundle 반환 규격
5. QUALITY CRITERIA — 최신성·범위·출처 검증
6. DO NOT
7. HANDOFF

## 금지

- 개인 Obsidian의 Raw를 읽지 않는다.
- Skill이 업무 결과물을 직접 만들거나 사람의 판단을 확정하지 않는다.
- Wiki 본문을 Skill에 중복 저장하지 않는다.
