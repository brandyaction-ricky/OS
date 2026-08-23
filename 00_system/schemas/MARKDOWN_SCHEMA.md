# Markdown Schema v1.0

기계 판독 규격은 같은 폴더의 `frontmatter.schema.json`을 사용한다. 이 문서는 사람이 판단해야 하는 의미와 운영 규칙을 설명한다.

## Artifact Frontmatter

```yaml
---
schema_version: "1.0"
id: BA-0268-script-v3
entity_type: artifact
content_id: BA-0268
artifact_key: script
title: AI 시대에 직업이 사라지는 진짜 이유
process: longform
step: script
status: review
owner: jeongho
next_owner: ricky
version: 3
is_latest: true
created_at: 2026-08-23T09:00:00+09:00
updated_at: 2026-08-23T11:30:00+09:00
updated_by: jeongho
source_device: local-macbook
parent_id: BA-0268-script-v2
skill_id: longform-script
ai_used: true
ai_provider: codex
approval_status: pending
next_action: 대표 원고 검수
---
```

## entity_type

`content | artifact | decision | approval | metric | meeting | kpi | skill_output | context | process`

## status

`draft | ready | in_progress | waiting_human | waiting_approval | review | approved | rejected | completed | archived | locked`

공정 시작 전 상태는 `not_started`를 추가하지 않고 `locked`로 표현한다. 현재 시작 가능한 공정은 `ready`다.

## approval_status

`not_required | pending | approved | conditional | rejected`

## Version 규칙

- 산출물 수정은 `v1 → v2 → v3`로 새 파일을 만든다.
- 기존 산출물의 본문과 판단 기록은 덮어쓰지 않는다.
- 새 버전 생성 시 이전 버전에 허용되는 유일한 변경은 `is_latest: true → false`다.
- 최신본의 최종 판단 기준은 `CONTENT.md`의 `latest_*` 포인터다.
- `CONTENT.md` 자체는 현재 상태 인덱스이므로 갱신하고 `version`을 증가시키며, 변경 이력은 Git이 보존한다.

