# Company Wiki Schema v1.0

회사 OS의 Wiki는 공정과 Access Skill이 참고하는 최신 공유 정본이다. 개인 Raw와 개인 전용 Wiki는 각자의 Obsidian에 둔다.

```yaml
schema_version: "1.0"
id: wiki-process-longform-script-v1
entity_type: wiki
wiki_id: longform-script
wiki_type: process
process: longform
step: script
category: content-writing
owner: jeongho
title: 롱폼 원고 작성 기준
status: active
version: 1
is_latest: true
source_ids: [shared-personal-wiki-id]
promoted_by: jeongho
promoted_at: 2026-08-24T10:30:00+09:00
created_at: 2026-08-24T10:30:00+09:00
updated_at: 2026-08-24T10:30:00+09:00
updated_by: jeongho
```

`wiki_type`은 `company`, `process`, `people`을 사용한다. 새 버전이 생기면 이전 파일의 `is_latest`만 `false`로 바꾸고 `WIKI_vN.md`를 누적한다.
