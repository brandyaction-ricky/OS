---
schema_version: "1.0"
id: multichannel-repurposing-api
entity_type: context
scope: company
title: 멀티채널 확장 API Contracts
status: active
version: 1
updated_at: 2026-08-25T12:00:00+09:00
updated_by: ricky
---

# Channel API Contracts v1.0

## 내부 공통 계약

`POST /api/repurposing`은 `run|approve|schedule|retry`를 받고 Stage 상태만 전이한다. 대용량 파일은 서명 업로드 세션으로 Object Storage에 직접 전송한다.

## Provider Adapter

- `openai`: Content DNA, Atom, 숏츠·카드뉴스·Threads 초안, 학습 요약
- `render_worker`: FFmpeg 9:16 숏츠 렌더
- `design_worker`: 디자인 토큰 + 슬라이드 JSON → 1080×1350 JPEG
- `youtube`: OAuth + resumable upload, Shorts 게시 영수증 반환
- `instagram`: Professional Account OAuth, Reels·Carousel container 생성/게시
- `threads`: Threads OAuth, text/thread container 생성/게시
- `metrics_worker`: 채널별 원시 지표를 공통 KPI로 정규화

외부 게시 Adapter는 `idempotency_key`, `scheduled_at`, `callback_url`을 필수로 받고 `external_id`, `public_url`, `published_at`을 반환한다. 토큰 원문은 Repository·브라우저·DB 일반 컬럼에 저장하지 않는다.
