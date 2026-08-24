---
schema_version: "1.0"
id: youtube-production-v2
entity_type: automation_recipe
process: longform
entry_step: edit
status: active
version: 3
pipeline_path: 03_processes/longform/YOUTUBE_PIPELINE.json
wiki_sources: [longform-edit, longform-thumbnail, longform-publish, os-knowledge-model]
access_skill: brandyaction-video-ppt
updated_at: 2026-08-24T19:30:00+09:00
updated_by: ricky
---

# YouTube PC Production & Distribution Recipe

## 운영 경계

- **개인 PC**: 자막, 덱, 이미지, Premiere 메인 편집과 개인 AI 토큰 사용
- **Company OS**: 최신 Wiki·작업 패키지 제공, 공정 상태·Asset ID·결과 이력 관리
- **실행 서버**: 완료본 검증, 썸네일 AI 생성·평가, 숏폼 구간 제안, 9:16 렌더, YouTube 업로드, 성과·CTR 회수
- **Object Storage**: MP4·SRT·PNG 원본과 파생 영상 저장

OS는 직원 PC의 파일이나 개인 AI 계정에 접근하지 않는다. 사용자는 PDF의 8개 후반작업 공정을 PC에서 끝낸 뒤 최종 MP4·SRT만 회사 자산 저장소로 인계한다. 썸네일은 OS의 별도 폐쇄 루프에서 생성·평가·승인·업로드·측정·학습한다.

## 실행 어댑터

| Adapter | OS 역할 | 연결 대상 | 실패 시 |
|---|---|---|---|
| `asset_upload` | 완료본 직접 업로드 세션 발급 | S3·R2·사내 자산 서비스 | Asset ID 수동 등록 |
| `openai` | 숏폼 구간 후보·게시 문안 생성 | OpenAI Responses API | 직원 PC에서 수동 작성 |
| `thumbnail_worker` | 썸네일 후보 생성·Vision 평가 | Image API·Vision 모델 Worker | 후보 Asset ID·평가표 수동 등록 |
| `render_worker` | FFprobe 검증·9:16 숏폼 렌더 | FFmpeg Worker | 입력 보존·같은 작업 재시도 |
| `youtube` | 롱폼·숏폼·자막·썸네일 업로드 | YouTube Data API | 업로드 세션 이어받기 |
| `youtube_data` | 게시 후 성과 수집 | YouTube Data/Analytics API | 다음 스냅샷에서 재수집 |

## 화면 원칙

상위 구분은 탐색을 위한 폴더일 뿐 공정을 대체하지 않는다. 왼쪽 공정 탐색에는 14개 실행 Stage를 항상 표시하고, `PDF 원본 후반작업 8공정` 화면에는 다음 원본 단계를 설명·도구·산출물과 함께 모두 표시한다.

1. 자막 검수·정리
2. 요약 덱 저술
3. 사진 프롬프트
4. 렌더 + 사진 삽입
5. 캡처카드
6. 미디어 처리
7. XML 조립
8. 유튜브 자산

기술 입력·출력 계약과 Worker 로그는 현재 Stage 아래에서 펼쳐볼 수 있게 유지한다.

## 썸네일 폐쇄 루프

`아이디어 → AI 생성 → AI 평가 → 사람 승인 → YouTube 업로드 → CTR 측정 → 학습`을 한 Content Run 안에서 추적한다.

- 아이디어 단계는 이전 콘텐츠의 `thumbnail_learn` 결과를 자동으로 읽는다.
- AI 생성은 서로 다른 시각 전략의 후보를 최소 3개 만든다.
- AI 평가는 가독성·위계·주제 명확성·대비·호기심·차별성·완성도와 주제 일치·약속 일관성·제목 보완성을 분리 평가한다.
- 사람 승인은 AI 1위 자동 채택이 아니라 후보 Asset ID와 선택 이유를 기록한다.
- YouTube 업로드 영수증과 1h·6h·24h·7d CTR을 같은 Run에 연결한다.
- 학습 결과는 다음 콘텐츠의 아이디어 생성 Context로 다시 투입한다.

## 인증 원칙

YouTube 화면에서 작업 코드를 반복 입력하지 않는다. 팀 작업 코드는 한 번만 교환하고 8시간 만료되는 `HttpOnly; Secure; SameSite=Strict` 세션으로 바꾼다. 기존 CLI는 과도기적으로 Bearer 인증을 사용할 수 있다. YouTube 실제 게시 승인은 별도 코드로 유지한다.

## 대용량 자산 원칙

MP4·SRT·PNG는 GitHub나 Vercel 함수 본문에 넣지 않는다. 브라우저가 자산 서비스에서 발급한 HTTPS 업로드 세션으로 Object Storage에 직접 전송한다. 공개 Repository에는 `asset://` 식별자, checksum, 파일 규격과 결과 Markdown만 저장한다.

## 장시간 작업 원칙

Vercel 함수는 상태와 작업 전달만 담당한다. FFprobe·FFmpeg·대용량 YouTube 업로드는 별도 Worker가 실행하며, 단계별 operation key와 callback secret으로 중복 실행·위조 callback을 막는다.
