---
schema_version: "1.0"
id: automation-run-schema-v1
entity_type: schema
status: active
updated_at: 2026-08-24T15:00:00+09:00
updated_by: ricky
---

# Automation Run Schema

각 Content Run의 기계 상태는 `05_contents/{content_id}/{step_folder}/automation/state.json`에 저장한다.

```json
{
  "schemaVersion": "1.0",
  "contentId": "BA-0000",
  "pipelineId": "youtube-production-v1",
  "currentStageId": "subtitle_cleanup",
  "status": "ready",
  "updatedAt": "ISO-8601",
  "updatedBy": "person_id",
  "stages": {
    "subtitle_cleanup": {
      "status": "ready",
      "attempt": 0,
      "jobId": null,
      "outputPath": null,
      "assetUrl": null,
      "publishSettings": null,
      "error": null,
      "updatedAt": null
    }
  },
  "questions": [],
  "jobs": []
}
```

## 허용 상태

`locked | ready | queued | running | needs_input | needs_decision | blocked | failed | completed`

단계 상태와 별개로 사람이 확인한 실행 계획 Markdown은 `automation_result.status: approved`를 사용할 수 있다.

## 전이 원칙

1. 필수 선행 단계가 완료돼야 다음 단계를 `ready`로 연다.
2. `humanGate: true` 단계는 API 결과가 나와도 `needs_decision`에서 멈춘다.
3. 사람의 승인 또는 산출물 연결이 있어야 `completed`가 된다.
4. 실패는 입력·오류·재시도 횟수와 함께 기록한다.
5. 결과 본문은 Markdown artifact로 버전 누적하고 state에는 경로만 기록한다.
