# 로컬 콘텐츠 스냅샷 가져오기

`발행·업로드 → 로컬 자료 가져오기`는 로컬 `radar.db`의 콘텐츠를 OS로 옮기는 관리자 전용 경로입니다. 같은 `id`를 다시 올리면 새 항목을 만들지 않고 기존 항목을 갱신합니다.

로컬 DB를 바로 변환하려면 다음 명령을 실행합니다.

```bash
python3 scripts/export-radar-snapshot.py /path/to/radar.db --output brandy-content-snapshot.json
```

```json
{
  "version": 1,
  "sources": [
    { "id": "source-1", "title": "롱폼 제목", "description": "최종 원고", "sourceUrl": "https://youtube.com/watch?v=..." }
  ],
  "derivatives": [
    { "id": "derivative-1", "sourceId": "source-1", "title": "파생 제목", "body": "본문", "platform": "column", "format": "SEO 칼럼", "status": "review" }
  ],
  "metrics": [
    { "id": "metric-1", "sourceId": "source-1", "title": "영상 제목", "views": 1000, "ctr": 5.2, "retention": 41.3, "conversions": 12 }
  ]
}
```

- 최대 파일 크기: 5MB
- 최대 건수: 원본 1,000건, 파생 3,000건, 성과 3,000건
- 파생 항목에 존재하지 않는 `sourceId`가 있으면 해당 항목만 건너뜁니다.
- 가져온 파생 콘텐츠도 사람의 검토 → 최종 승인 → 예약 단계를 그대로 거칩니다.
- 외부 서비스로 자동 발행하지 않습니다.
