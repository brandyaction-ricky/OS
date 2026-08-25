---
schema_version: "1.0"
id: multichannel-repurposing-api
entity_type: context
scope: company
title: 멀티채널 확장 Runtime API Contracts
status: active
version: 2
updated_at: 2026-08-25T18:30:00+09:00
updated_by: ricky
---

# Channel API Contracts v2.0

## 내부 공통 계약

`GET /api/repurposing?contentId=BA-0000`은 GitHub 정본의 최신 Run 상태와 Provider 연결 상태를 반환한다.

`POST /api/repurposing`은 아래 작업을 실제 처리한다.

- `activate`: YouTube 완료 이력 또는 직접 등록한 완료본·SRT로 확장 Run 시작
- `run`: OpenAI Responses API 또는 외부 Worker 실행
- `approve`: 현재 Stage의 AI 결과·미리보기 확정
- `manual_complete`: API 미연결 시 수동 산출물로 다음 Stage 진행
- `retry`: 실패·입력 필요 Stage 재시도
- `callback`: Worker 결과를 검증해 GitHub 상태·Markdown에 반영

Vercel은 대용량 영상 자체를 처리하지 않는다. MP4는 Object Storage 또는 공개 완료본 URL로 전달하고 FFmpeg Worker가 처리한다.

## 운영 환경변수

- `OPENAI_API_KEY`, `OPENAI_REPURPOSING_MODEL`
- `VIDEO_WORKER_WEBHOOK_URL`, `VIDEO_WORKER_SECRET`, `VIDEO_CALLBACK_SECRET`
- `DESIGN_WORKER_WEBHOOK_URL`, `DESIGN_WORKER_SECRET`, `DESIGN_CALLBACK_SECRET`
- `SOCIAL_PUBLISH_WORKER_URL`, `SOCIAL_PUBLISH_WORKER_SECRET`, `SOCIAL_PUBLISH_CALLBACK_SECRET`
- `MULTICHANNEL_METRICS_WORKER_URL`, `MULTICHANNEL_METRICS_WORKER_SECRET`, `MULTICHANNEL_METRICS_CALLBACK_SECRET`
- `REPURPOSING_CALLBACK_URL` 선택값

## Provider Adapter

- `openai`: Content DNA, Atom, 숏츠·카드뉴스·Threads 초안, 학습 요약
- `render_worker`: FFmpeg 9:16 숏츠 렌더
- `design_worker`: 디자인 토큰 + 슬라이드 JSON → 1080×1350 JPEG
- `social_publish_worker`: YouTube OAuth + Meta OAuth를 사용해 Shorts·Reels 동시 발행
- `instagram`: Professional Account OAuth, Carousel container 생성/게시
- `threads`: Threads OAuth, text/thread container 생성/게시
- `metrics_worker`: 채널별 원시 지표를 공통 KPI로 정규화

외부 게시 Adapter는 `idempotency_key`, `scheduled_at`, `callback_url`을 필수로 받고 `external_id`, `public_url`, `published_at`을 반환한다. 토큰 원문은 Repository·브라우저·DB 일반 컬럼에 저장하지 않는다.
