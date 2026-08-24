---
schema_version: "1.0"
id: wiki-process-longform-edit-v2
entity_type: wiki
wiki_id: longform-edit
wiki_type: process
process: longform
step: edit
category: video-production
owner: jay
title: 롱폼 영상 후반작업·게시 기준
status: active
version: 2
is_latest: true
source_ids: [brandyaction-production-process-pdf-20260821, wiki-process-longform-edit-v1]
promoted_by: ricky
promoted_at: 2026-08-24T15:00:00+09:00
created_at: 2026-08-24T15:00:00+09:00
updated_at: 2026-08-24T15:00:00+09:00
updated_by: ricky
---

# 롱폼 영상 후반작업·게시 기준

## 공정 범위

실제 후반작업은 컷편집 MP4와 추출 SRT를 입력으로 받아 정리 SRT, 요약 덱, 사진 프롬프트, 렌더 자산, 캡처카드, 미디어, Premiere XML과 YouTube 업로드 문안을 만든다.

원본 PDF의 완료 지점은 **Premiere 준비 완료**다. **YouTube 게시 완료**로 표시하려면 최종 MP4 렌더·QA, 제목·썸네일 확정, 실제 업로드·예약, 게시 URL 확인까지 끝나야 한다.

## 절대 규칙

1. PPT는 자막이 아니라 핵심 요약·대조·도식이다.
2. 인물은 사진으로, 개념은 이미지 대신 글로 설명한다.
3. 움직이는 그림 효과는 사진에만 적용하고 상단 게이지바와 레이어를 분리한다.
4. 인명·용어·사실은 맥락과 확인 가능한 근거로 검수하며 애매하면 질문한다.
5. 원본 음성은 무거운 보정을 하지 않는다.
6. 오디오에는 samplerate를 선언하고 음악은 인트로·아웃트로 타임라인에 포함한다.
7. 화자는 알파 영상으로 굽지 않고 Premiere 타원 마스크를 적용한다.
8. 인물 사진 프롬프트에는 한국인을 명시한다.
9. 사진은 `프롬프트 → 확인 → 생성 → 선택 → 삽입 → 재렌더` 순서로 처리한다.
10. 사진이 오기 전에는 후반작업을 완료 처리하지 않는다.
11. `deck`, `cap`, `media`를 이동해 Premiere 미디어가 오프라인 되지 않게 한다.

## 자동 품질검사

- SRT 파싱·타임코드 순서·겹침·영상 길이 초과 검사
- 덱 6챕터·슬라이드별 시작/종료 큐·게이지 존재 검사
- 인물 프롬프트의 `한국인`·`단색 레드 배경`·`피사체 하나` 검사
- 사진/게이지 레이어 분리와 사진 캡션 없음 검사
- 오디오 sample rate와 인트로·아웃트로 음악 존재 검사
- XML 트랙 V1/V2/V3/A1/A2와 모든 상대경로 검사
- Premiere 임포트 후 오프라인 미디어 0개 검사
- 게시 전 최종 MP4·썸네일·자막·제목·설명·공개상태·URL 검사

## XML 트랙

- V1: 덱 + 엔딩
- V2: 화자
- V3: 캡처카드
- A1: 원본 음성
- A2: 음악

자막 트랙 위치와 30fps/29.97fps 허용 기준은 아직 확정되지 않았다. 실행 시 입력 영상 FPS를 표시하고 담당자가 선택하도록 한다.

## 예외 중심 검수

사람에게 전체 결과를 다시 읽게 하지 않는다. 낮은 신뢰도 용어·사실, 누락 자산, 규칙 위반, Worker 실패, 외부 공개 직전 의사결정만 `확인 필요`로 모은다.

## 산출물 기록

대용량 MP4·PNG·WAV는 Asset Storage에 저장하고 OS에는 asset ID, storage URI, filename, checksum, version, duration, resolution, fps, sample rate와 부모 자산 ID를 기록한다. Markdown 결과와 실행 로그는 새 버전으로 누적한다.
