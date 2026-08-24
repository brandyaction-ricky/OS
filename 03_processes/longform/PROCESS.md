---
schema_version: "1.0"
id: longform-process-v1
entity_type: process
process_id: longform
version: "1.1"
status: active
first_step: package
automation_pipeline_id: youtube-production-v1
automation_pipeline_path: 03_processes/longform/YOUTUBE_PIPELINE.json
steps:
  - id: package
    order: 1
    label: 기획
    folder: 01_package
    type: HUMAN
    skill_id: null
    default_owner: jeongho
    input_pointers: []
    outputs:
      - key: package
        pointer: latest_package
        required: true
    completion:
      accepted_statuses: [approved]
      accepted_approval_statuses: [approved]
      result_status: approved
    work_action: 제목과 썸네일 카피 작성
    review_action: 대표 패키지 검수
    next_step: axis
  - id: axis
    order: 2
    label: 축
    folder: 02_axis
    type: AI+APPROVAL
    skill_id: longform-axis
    default_owner: ricky
    input_pointers: [latest_package]
    outputs:
      - key: axis
        pointer: latest_axis
        required: true
    completion:
      accepted_statuses: [approved]
      accepted_approval_statuses: [approved]
      result_status: approved
    work_action: 차별 관점 후보 생성
    review_action: 대표 축 승인
    next_step: script
  - id: script
    order: 3
    label: 설계/원고
    folder: 03_script
    type: AI+HUMAN
    skill_id: longform-script
    default_owner: jeongho
    input_pointers: [latest_package, latest_axis]
    outputs:
      - key: script
        pointer: latest_script
        required: true
      - key: reading_script
        pointer: latest_reading_script
        required: true
    completion:
      accepted_statuses: [approved]
      accepted_approval_statuses: [approved]
      result_status: approved
    work_action: 원고와 촬영용 낭독본 작성
    review_action: 대표 원고 검수
    next_step: shoot
  - id: shoot
    order: 4
    label: 촬영
    folder: 04_shoot
    type: HUMAN
    skill_id: null
    default_owner: jeongho
    input_pointers: [latest_reading_script]
    outputs:
      - key: shoot
        pointer: latest_shoot
        required: true
    completion:
      accepted_statuses: [completed]
      accepted_approval_statuses: [not_required, approved]
      result_status: completed
    work_action: 촬영 파일과 자막 자산 등록
    review_action: 촬영 산출물 확인
    next_step: edit
  - id: edit
    order: 5
    label: 편집
    folder: 05_edit
    type: AI+HUMAN
    skill_id: brandyaction-video-ppt
    default_owner: jay
    input_pointers: [latest_script, latest_reading_script, latest_shoot]
    outputs:
      - key: edit
        pointer: latest_edit
        required: true
    completion:
      accepted_statuses: [approved, completed]
      accepted_approval_statuses: [approved]
      result_status: approved
    work_action: 자막 검수부터 Premiere XML까지 제작 공정 실행
    review_action: 예외·사진·최종 렌더 확인
    next_step: thumbnail
  - id: thumbnail
    order: 6
    label: 썸네일
    folder: 06_thumbnail
    type: AI+HUMAN
    skill_id: null
    default_owner: jay
    input_pointers: [latest_package, latest_edit]
    outputs:
      - key: thumbnail
        pointer: latest_thumbnail
        required: true
    completion:
      accepted_statuses: [approved]
      accepted_approval_statuses: [approved]
      result_status: approved
    work_action: 썸네일 시안 제작
    review_action: 최종 썸네일 승인
    next_step: approval
  - id: approval
    order: 7
    label: 최종 승인
    folder: 07_approval
    type: APPROVAL
    skill_id: null
    default_owner: ricky
    input_pointers: [latest_edit, latest_thumbnail]
    outputs:
      - key: approval
        pointer: latest_approval
        required: true
    completion:
      accepted_statuses: [approved]
      accepted_approval_statuses: [approved]
      result_status: approved
    work_action: 최종 영상과 CTA 검토
    review_action: 대표 최종 승인
    next_step: publish
  - id: publish
    order: 8
    label: 게시
    folder: 08_publish
    type: AI+APPROVAL
    skill_id: publish-copy
    default_owner: jay
    input_pointers: [latest_script, latest_edit, latest_thumbnail, latest_approval]
    outputs:
      - key: publish
        pointer: latest_publish
        required: true
    completion:
      accepted_statuses: [completed]
      accepted_approval_statuses: [approved]
      result_status: completed
    work_action: 게시문구 작성과 업로드
    review_action: 게시 승인
    next_step: metrics
  - id: metrics
    order: 9
    label: 성과 회수
    folder: 09_metrics
    type: AUTO
    skill_id: null
    default_owner: eric
    input_pointers: [latest_publish]
    outputs:
      - key: metrics
        pointer: latest_metrics
        required: true
    completion:
      accepted_statuses: [completed]
      accepted_approval_statuses: [not_required, approved]
      result_status: completed
    work_action: 성과 데이터 수집
    review_action: 성과 회수 완료
    next_step: null
---

# Longform Process v1.1

| # | Step | Type | Completion |
|---:|---|---|---|
| 1 | package | HUMAN | 제목/썸네일 카피 승인 |
| 2 | axis | AI+APPROVAL | 대표 축 승인 |
| 3 | script | AI+HUMAN | 원고/낭독본 승인 |
| 4 | shoot | HUMAN | 촬영 자산 등록 |
| 5 | edit | AI+HUMAN | 편집본/XML 승인 |
| 6 | thumbnail | AI+HUMAN | 최종 썸네일 승인 |
| 7 | approval | APPROVAL | 최종 영상/CTA 승인 |
| 8 | publish | AI+APPROVAL | 게시문구 승인 + 게시 |
| 9 | metrics | AUTO | 성과 수집 완료 |

Frontmatter가 CLI와 웹 UI가 읽는 정본이다. 본문의 표는 운영자가 빠르게 확인하기 위한 설명이다.

`edit → thumbnail → approval → publish → metrics` 구간의 실제 14단계 반자동화 규격은 `YOUTUBE_PIPELINE.json`이 상세화한다. PDF에 정의된 후반작업 8개 공정과 OS가 보완한 입력 검증·최종 렌더·게시·성과 회수를 화면에서 구분한다.
