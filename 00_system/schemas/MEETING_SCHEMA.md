# Meeting Markdown Schema v1.0

회의 문서는 회사 공용 기록이며 공개 OS와 분리된 비공개 회의 Repository의 `06_meetings/`에서 관리한다. 개인이 기억하기 위해 남기는 Raw는 각자의 Obsidian에 둔다. 공개 웹 인덱스에는 회의 메타데이터나 본문을 포함하지 않는다.

```yaml
---
schema_version: "1.0"
id: MTG-20260824-103000
entity_type: meeting
title: 주간 콘텐츠 회의
meeting_date: 2026-08-24T10:30:00+09:00
owner: ricky
participants: [ricky, jay, jeongho]
status: organized
location: office
process: longform
content_id: BA-0268
source_type: recording
transcript_status: completed
summary_status: completed
version: 1
created_at: 2026-08-24T10:30:00+09:00
updated_at: 2026-08-24T11:20:00+09:00
updated_by: ricky
---
```

본문의 표준 섹션은 `한 줄 요약`, `핵심 논의`, `결정사항`, `액션 아이템`, `보류·추가 확인`, `원문 메모·전사`다.

녹음 파일은 장기 보관하지 않는다. 브라우저에서 짧은 구간으로 전사하고, 비공개 Repository에는 전사문과 회의록 Markdown만 남긴다. `06_meetings/index.json`은 페이지 단위 목록용 메타데이터만 보관하고 본문은 문서를 열 때 지연 로드한다.
