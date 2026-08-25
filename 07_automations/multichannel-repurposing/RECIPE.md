---
schema_version: "1.0"
id: multichannel-repurposing-v1
entity_type: automation_recipe
process: longform
entry_step: content_dna
status: active
version: 2
pipeline_path: 03_processes/longform/REPURPOSING_PIPELINE.json
wiki_sources: [os-knowledge-model, longform-publish]
access_skill: brandyaction-video-ppt
updated_at: 2026-08-25T18:30:00+09:00
updated_by: ricky
---

# Multichannel Repurposing Recipe v1.0

## 확정 운영값

- 롱폼 1개당 숏츠 3개, 카드뉴스 1개, Threads 3개
- 숏츠 3개는 YouTube Shorts와 Instagram Reels에 각각 동시 발행
- Threads는 단문 2개와 연속형 1개
- `AI 생성 → 현재 Stage 미리보기 → 사람 확정 → 예약 자동 게시`
- 별도 결재함을 만들지 않는다.
- YouTube 공정이 끝나기 전에도 완료본 URL·Asset ID·SRT·대본을 직접 접수해 시작할 수 있다.
- 상태는 `잠김` 하나로 표시하지 않고 `선행 공정 대기`, `연결 필요`, `실행 가능`, `확인 필요`로 구분한다.
- Provider가 연결되지 않은 단계는 완료 기준을 체크하고 수동 결과를 등록해 우회할 수 있다.

## 실행 경계

- GitHub Markdown: Content DNA, Atom, 확정 원고, 프롬프트 버전, 학습 정본
- Supabase: 실행 상태, 예약, 게시 ID, 오류, 성과 스냅샷
- Object Storage: MP4, 숏츠, 카드뉴스 이미지
- Vercel: UI, 짧은 AI 요청, Queue 관제
- Worker: FFmpeg 렌더, 디자인 렌더, 채널 게시, 성과 회수

실행 상태와 생성된 Markdown은 `05_contents/{content_id}/10_repurposing/`에 저장한다. API·Worker 자격증명은 Vercel 또는 Worker의 암호화 환경변수에만 보관한다.

세 채널 분기는 병렬이다. 한 채널의 실패가 다른 채널 발행을 막지 않으며, 공통 성과 수집만 세 게시 분기의 완료를 기다린다.
