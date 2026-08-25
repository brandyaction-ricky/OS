---
schema_version: "1.0"
id: multichannel-repurposing-v1
entity_type: automation_recipe
process: longform
entry_step: content_dna
status: active
version: 1
pipeline_path: 03_processes/longform/REPURPOSING_PIPELINE.json
wiki_sources: [os-knowledge-model, longform-publish]
access_skill: brandyaction-video-ppt
updated_at: 2026-08-25T12:00:00+09:00
updated_by: ricky
---

# Multichannel Repurposing Recipe v1.0

## 확정 운영값

- 롱폼 1개당 숏츠 3개, 카드뉴스 1개, Threads 3개
- 숏츠 3개는 YouTube Shorts와 Instagram Reels에 각각 동시 발행
- Threads는 단문 2개와 연속형 1개
- `AI 생성 → 현재 Stage 미리보기 → 사람 확정 → 예약 자동 게시`
- 별도 결재함을 만들지 않는다.

## 실행 경계

- GitHub Markdown: Content DNA, Atom, 확정 원고, 프롬프트 버전, 학습 정본
- Supabase: 실행 상태, 예약, 게시 ID, 오류, 성과 스냅샷
- Object Storage: MP4, 숏츠, 카드뉴스 이미지
- Vercel: UI, 짧은 AI 요청, Queue 관제
- Worker: FFmpeg 렌더, 디자인 렌더, 채널 게시, 성과 회수

세 채널 분기는 병렬이다. 한 채널의 실패가 다른 채널 발행을 막지 않으며, 공통 성과 수집만 세 게시 분기의 완료를 기다린다.
