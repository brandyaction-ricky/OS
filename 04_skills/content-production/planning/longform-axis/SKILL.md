---
skill_id: longform-axis
category_id: content-production
category_label: 콘텐츠 제작
folder_id: planning
folder_label: 기획 · 전략
version: "1.0"
process: longform
step: axis
status: active
inputs: [package, comments, insight_cards, company_viewpoint_rules]
outputs: [axis_candidates]
allowed_tools: [claude_code, codex]
completion_checks: [output_exists, frontmatter_valid, human_approval_required]
---

# Longform Axis

## PURPOSE

대표가 판단할 축 후보를 만든다.

## READ CONTEXT

`CONTEXT.md`, 최신 Package, Company Context, Brand Context, 댓글/인사이트 카드가 있다면 함께 읽는다.

## PROCEDURE

1. Package의 제목과 약속을 확인한다.
2. 시장의 흔한 설명을 먼저 분리한다.
3. BrandyAction 관점의 차별 축 후보를 만든다.
4. 각 후보의 근거, 반론, 범용성 위험을 비교한다.
5. 대표가 판단할 수 있는 비교표로 정리한다.

## OUTPUT CONTRACT

`axis_vN.md` 한 개를 만든다. Frontmatter의 `artifact_key`는 `axis`, `approval_status`는 대표 승인 전 `pending`이어야 한다.

## QUALITY CRITERIA

- 회사 관점과 연결되어 있다.
- 흔한 주장과 차이가 한 문장으로 설명된다.
- 실제 사례나 자료로 설득할 수 있다.
- 반론과 오해 가능성을 함께 적었다.

## DO NOT

AI가 최종 축을 승인하지 않는다. 특정 콘텐츠의 결론을 Skill 안에 하드코딩하지 않는다.

## HANDOFF

`status: waiting_approval`, `approval_status: pending`으로 대표에게 넘긴다.
