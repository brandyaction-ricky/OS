# Skill Specification v1.0

Skill은 결과물을 보관하는 곳이 아니라 특정 업무를 실행하기 위한 **Context + Procedure + Output Contract + Quality Criteria**다.

## 폴더

```text
04_skills/{skill_id}/
├─ SKILL.md
├─ references.md     # optional
├─ templates/        # optional
└─ checks/           # optional
```

## SKILL.md 필수 Frontmatter

```yaml
---
skill_id: longform-script
version: "1.0"
process: longform
step: script
status: active
inputs: [content_context, approved_axis, company_rules]
outputs: [script_md, reading_script_md]
allowed_tools: [claude_code, codex]
completion_checks: [output_exists, frontmatter_valid, human_review_required]
---
```

## 본문 필수 섹션

1. PURPOSE
2. READ CONTEXT
3. PROCEDURE
4. OUTPUT CONTRACT
5. QUALITY CRITERIA
6. DO NOT
7. HANDOFF

## 금지

- 특정 콘텐츠의 값을 Skill 안에 하드코딩하지 않는다.
- 승인되지 않은 사람의 판단을 AI가 임의로 확정하지 않는다.
- Output 파일을 덮어쓰지 않는다.

