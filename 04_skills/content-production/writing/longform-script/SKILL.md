---
skill_id: longform-script
category_id: content-production
category_label: 콘텐츠 제작
folder_id: writing
folder_label: 원고 · 카피
version: "1.0"
process: longform
step: script
status: active
inputs: [content_context, approved_axis, company_rules]
outputs: [script_md, reading_script_md]
allowed_tools: [claude_code, codex]
completion_checks: [output_exists, frontmatter_valid, human_review_required]
---

# Longform Script

## PURPOSE

승인된 축을 바꾸지 않고 설계표, 원고, 낭독본을 만든다.

## READ CONTEXT

`CONTEXT.md`, 승인된 Package와 Axis, Company Context, Brand Context를 읽는다.

## PROCEDURE

1. 승인된 축과 바꾸면 안 되는 핵심 문장을 확인한다.
2. 시청자의 기존 믿음에서 새 결론까지 설득 구조를 만든다.
3. 실제 근거와 사례만 사용해 원고 초안을 쓴다.
4. 주장, 톤, 난이도, 분량, CTA를 점검한다.
5. 촬영자가 읽기 좋은 낭독본으로 분리한다.

## OUTPUT CONTRACT

`script_vN.md`, `reading_script_vN.md` 두 파일을 만들며 각 파일은 자신의 직전 버전보다 1 증가한다.

## QUALITY CRITERIA

- 승인된 축을 유지한다.
- 처음 듣는 사람도 이해할 수 있다.
- 주장마다 실제 설득 재료가 있다.
- 목표 말투와 분량을 지킨다.
- 두 산출물의 핵심 내용이 일치한다.

## DO NOT

승인된 축 임의 변경, 경험 창작, 출처 없는 수치 생성, 기존 파일 덮어쓰기를 금지한다.

## HANDOFF

두 파일 모두 대표 검수 상태로 Push한다.
