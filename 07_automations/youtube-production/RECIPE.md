---
schema_version: "1.0"
id: youtube-production-v1
entity_type: automation_recipe
process: longform
entry_step: edit
status: active
version: 1
pipeline_path: 03_processes/longform/YOUTUBE_PIPELINE.json
wiki_sources: [longform-edit, longform-publish, os-knowledge-model]
access_skill: brandyaction-video-ppt
updated_at: 2026-08-24T15:00:00+09:00
updated_by: ricky
---

# YouTube Production Automation Recipe

## 역할 분리

- **Company Wiki**: 편집자가 따라야 할 최신 판단 기준과 절대 규칙
- **OS Access Skill**: 현재 Content Run에 필요한 최신 Wiki와 자산 포인터만 불러오기
- **Automation Recipe**: 어떤 단계에서 어떤 API·Worker·사람 확인을 호출할지 정의
- **Content Run**: 영상 한 건의 상태, 질문, 산출물, 재시도와 담당자를 기록

Skill은 작업을 직접 수행하지 않는다. 이 Recipe가 Skill이 반환한 Context Bundle을 받아 실제 서비스를 호출한다.

## 실행 어댑터

| Adapter | OS 역할 | 연결 대상 | 실패 시 |
|---|---|---|---|
| `openai` | 자막 정리, 요약 덱, 사진 프롬프트, 업로드 문안 | OpenAI Responses API | 입력을 보존하고 재시도 |
| `gemini_image` | 승인된 사진 프롬프트 이미지 생성 | Gemini Image API | Google Flow 수동 생성 |
| `render_worker` | Headless Chrome, FFmpeg, XML 조립 | 별도 영상 Worker | 작업 중단·오류 로그·재시도 |
| `premiere_bridge` | XML 임포트, 원형 마스크, 최종 렌더 | 편집자 Mac Bridge | 수동 Premiere 작업 |
| `youtube` | 영상·썸네일·자막·메타데이터 업로드 | YouTube Data API | 업로드 세션 이어받기 |
| `youtube_data` | 게시 후 성과 수집 | YouTube Data/Analytics API | 다음 스냅샷에서 재수집 |

각 외부 Adapter는 서로 다른 Worker/Callback secret을 사용한다. 이미지·렌더 Worker 권한으로 YouTube 게시 callback을 만들 수 없으며, URL·Worker secret·Callback secret·GitHub 연결이 모두 있을 때만 OS가 해당 Adapter를 `설정됨`으로 표시한다.

## 사람 확인 원칙

사람은 모든 결과를 처음부터 읽지 않는다. 다음 예외만 확인한다.

1. 인명·사실·용어 교정의 신뢰도가 낮다.
2. 사진 프롬프트 또는 생성 이미지가 브랜드 기준을 벗어난다.
3. 사진·음악·썸네일 등 필수 자산이 누락됐다.
4. Worker 품질검사가 실패했다.
5. 외부 공개 직전 제목·썸네일·공개 시각을 확정해야 한다.

YouTube Worker는 OS에서 `privacyStatus`, 시간대가 포함된 `publishAt`, 확정 제목·썸네일 자산 ID를 먼저 기록하고 게시 전용 코드로 **게시 설정 승인**을 누른 뒤에만 호출한다. `pipelineId + contentId + stageId + attempt`로 만든 operation key와 resumable upload session을 보존해 전달 여부가 모호한 재시도에도 영상을 중복 생성하지 않는다.

## 대용량 자산 원칙

MP4·WAV·PNG 묶음은 GitHub에 저장하지 않는다. 공개 Repository에는 만료형·서명형 URL도 넣지 않고 `asset://` 형식의 불투명 자산 ID와 checksum만 남긴다. 실제 URL 해석은 인증된 Worker가 담당한다. GitHub에는 Wiki, Recipe, 프롬프트 버전, 단계 상태, 질문, 실행 로그와 비민감 산출물 메타데이터만 저장한다.

## 장시간 작업 원칙

Vercel 함수는 공정 상태와 API 호출만 관제한다. Headless Chrome·FFmpeg·Premiere·대용량 YouTube 업로드는 별도 Worker 또는 편집자 Mac Bridge에서 실행하고, 완료 callback으로 OS 상태를 갱신한다.
