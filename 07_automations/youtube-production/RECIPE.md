---
schema_version: "1.0"
id: youtube-production-v2
entity_type: automation_recipe
process: longform
entry_step: edit
status: active
version: 2
pipeline_path: 03_processes/longform/YOUTUBE_PIPELINE.json
wiki_sources: [longform-edit, longform-publish, os-knowledge-model]
access_skill: brandyaction-video-ppt
updated_at: 2026-08-24T15:57:36+09:00
updated_by: ricky
---

# YouTube PC Production & Distribution Recipe

## 운영 경계

- **개인 PC**: 자막, 덱, 이미지, Premiere 메인 편집과 개인 AI 토큰 사용
- **Company OS**: 최신 Wiki·작업 패키지 제공, 공정 상태·Asset ID·결과 이력 관리
- **실행 서버**: 완료본 검증, 숏폼 구간 제안, 9:16 렌더, YouTube 업로드, 성과 회수
- **Object Storage**: MP4·SRT·PNG 원본과 파생 영상 저장

OS는 직원 PC의 파일이나 개인 AI 계정에 접근하지 않는다. 사용자는 PC 제작을 끝낸 뒤 최종 MP4·SRT·썸네일만 회사 자산 저장소로 인계한다.

## 실행 어댑터

| Adapter | OS 역할 | 연결 대상 | 실패 시 |
|---|---|---|---|
| `asset_upload` | 완료본 직접 업로드 세션 발급 | S3·R2·사내 자산 서비스 | Asset ID 수동 등록 |
| `openai` | 숏폼 구간 후보·게시 문안 생성 | OpenAI Responses API | 직원 PC에서 수동 작성 |
| `render_worker` | FFprobe 검증·9:16 숏폼 렌더 | FFmpeg Worker | 입력 보존·같은 작업 재시도 |
| `youtube` | 롱폼·숏폼·자막·썸네일 업로드 | YouTube Data API | 업로드 세션 이어받기 |
| `youtube_data` | 게시 후 성과 수집 | YouTube Data/Analytics API | 다음 스냅샷에서 재수집 |

## 화면 원칙

사용자는 다섯 개 결과 단계만 먼저 본다.

1. PC 제작
2. 최종 마스터 접수
3. 숏폼 생성
4. 업로드·게시
5. 성과

PDF에 정의된 자막·요약 덱·사진·CTA·오디오·XML·Premiere 세부 공정은 `PC 제작` 안의 체크리스트로 유지한다. 입력·출력 계약과 Worker 로그는 기본 화면을 방해하지 않도록 공정 세부정보에 둔다.

## 인증 원칙

YouTube 화면에서 작업 코드를 반복 입력하지 않는다. 팀 작업 코드는 한 번만 교환하고 8시간 만료되는 `HttpOnly; Secure; SameSite=Strict` 세션으로 바꾼다. 기존 CLI는 과도기적으로 Bearer 인증을 사용할 수 있다. YouTube 실제 게시 승인은 별도 코드로 유지한다.

## 대용량 자산 원칙

MP4·SRT·PNG는 GitHub나 Vercel 함수 본문에 넣지 않는다. 브라우저가 자산 서비스에서 발급한 HTTPS 업로드 세션으로 Object Storage에 직접 전송한다. 공개 Repository에는 `asset://` 식별자, checksum, 파일 규격과 결과 Markdown만 저장한다.

## 장시간 작업 원칙

Vercel 함수는 상태와 작업 전달만 담당한다. FFprobe·FFmpeg·대용량 YouTube 업로드는 별도 Worker가 실행하며, 단계별 operation key와 callback secret으로 중복 실행·위조 callback을 막는다.
