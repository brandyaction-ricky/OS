# Raw / Wiki Schema v1.0

## Raw

Raw는 직원의 실무 기록 또는 회사 운영 과정에서 발생한 원본이다. 승격 후에도 삭제하거나 이동하지 않는다.

필수 Frontmatter:

```yaml
schema_version: "1.0"
id: raw-company-os-knowledge-model-v1
entity_type: raw
scope: company
category: decision
owner: ricky
title: Raw와 Wiki 운영 구조
status: promoted
version: 1
wiki_target: os-knowledge-model
promoted_to: 10_wiki/company/os-knowledge-model/WIKI_v1.md
created_at: 2026-08-23T14:40:00+09:00
updated_at: 2026-08-23T14:40:00+09:00
updated_by: ricky
```

`scope`은 `company` 또는 `person`, `status`는 `raw`, `promoted`, `archived`를 사용한다.

## Wiki

Wiki는 Raw에서 승격된 회사의 최신 정본이다. 승인 상태를 사용하지 않으며 승격자가 즉시 최신본을 만든다.

```yaml
schema_version: "1.0"
id: wiki-company-os-knowledge-model-v1
entity_type: wiki
wiki_id: os-knowledge-model
wiki_type: company
category: operating_system
owner: ricky
title: Raw와 Wiki 운영 구조
status: active
version: 1
is_latest: true
source_ids: [raw-company-os-knowledge-model-v1]
promoted_by: ricky
promoted_at: 2026-08-23T14:45:00+09:00
created_at: 2026-08-23T14:45:00+09:00
updated_at: 2026-08-23T14:45:00+09:00
updated_by: ricky
```

새 버전 승격 시 기존 Wiki의 `is_latest`만 `false`로 바꾸고 `WIKI_vN.md`를 누적한다.
